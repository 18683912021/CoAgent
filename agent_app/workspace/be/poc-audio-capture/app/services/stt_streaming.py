"""火山引擎实时流式语音识别会话。

端点: bigmodel（双向流式）
鉴权: X-Api-Key + X-Api-Resource-Id

帧结构（大端序）:
  4 字节 Header     [version|hdr_size] [type|flags] [ser|comp] [reserved]
  [4 字节 Sequence]  可选，flags 指示是否携带
  4 字节 PayloadSize uint32
  Payload
"""

import asyncio
import gzip
import json
import logging
import struct
import uuid
from io import BytesIO

import websockets

logger = logging.getLogger("stt_streaming")

WS_ENDPOINT = "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel"
RESOURCE_ID = "volc.seedasr.sauc.duration"

HDR = 4   # Header 字节数
SEQ = 4   # Sequence 字节数
SIZ = 4   # PayloadSize 字节数


def _header(msg_type: int, flags: int, ser: int, comp: int) -> bytes:
    """4 字节 Header: [0x11] [type|flags] [ser|comp] [0x00]"""
    return struct.pack(">BBBB", 0x11, (msg_type << 4) | flags, (ser << 4) | comp, 0x00)


def _gzip(data: bytes) -> bytes:
    buf = BytesIO()
    with gzip.GzipFile(fileobj=buf, mode="wb") as f:
        f.write(data)
    return buf.getvalue()


class StreamingASRSession:
    """一次实时 ASR 会话。"""

    def __init__(self, api_key: str, source: str, tx_queue: "asyncio.Queue"):
        self._api_key = api_key
        self._source = source
        self._tx_queue = tx_queue
        self._ws = None
        self._recv_task = None
        self._running = False
        self._seq = 1
        self._last_sent = ""
        self._text_parts: list[str] = []
        self._on_text = None  # 旧协议回调占位，避免 AttributeError

    async def connect(self) -> None:
        self._seq = 2  # 配置帧占序列 1，音频帧从 2 开始
        self._last_sent = ""
        self._ws = await websockets.connect(
            WS_ENDPOINT,
            additional_headers={
                "X-Api-Key": self._api_key,
                "X-Api-Resource-Id": RESOURCE_ID,
                "X-Api-Connect-Id": str(uuid.uuid4()),
                "X-Api-Request-Id": str(uuid.uuid4()),
                "X-Api-Sequence": "-1",
            },
        )
        config = {
            "user": {"uid": "audio-capture"},
            "audio": {"format": "pcm", "rate": 16000, "bits": 16, "channel": 1, "language": "zh-CN"},
            "request": {"model_name": "bigmodel", "enable_itn": True, "enable_punc": True, "enable_vad": True},
        }
        payload = _gzip(json.dumps(config).encode("utf-8"))
        # 配置帧: Header + PayloadSize + Payload（无序列号，flags=0）
        await self._ws.send(_header(0b0001, 0, 0b0001, 0b0001) + struct.pack(">I", len(payload)) + payload)

        self._running = True
        self._recv_task = asyncio.create_task(self._recv_loop())
        logger.info("ASR 实时会话已建立")

    async def feed(self, pcm: bytes) -> None:
        """音频帧: Header + Sequence + PayloadSize + PCM。"""
        if not self._ws or not self._running:
            return
        try:
            seq_bytes = struct.pack(">I", self._seq)
            self._seq += 1
            await self._ws.send(
                _header(0b0010, 0b0001, 0, 0) + seq_bytes + struct.pack(">I", len(pcm)) + pcm
            )
            if self._seq == 3:
                logger.info("ASR 音频帧已开始推送 (seq=2+)")
        except websockets.exceptions.ConnectionClosed:
            logger.warning("ASR WebSocket 已断开")
            self._running = False

    async def finish(self) -> str:
        """结束帧: Header + 负序列号 + PayloadSize=0。"""
        if not self._ws or not self._running:
            return ""
        self._running = False

        try:
            await self._ws.send(
                _header(0b0010, 0b0011, 0, 0) + struct.pack(">i", -self._seq) + struct.pack(">I", 0)
            )
        except Exception:
            pass

        if self._recv_task:
            try:
                await asyncio.wait_for(self._recv_task, timeout=8.0)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                self._recv_task.cancel()

        try:
            await self._ws.close()
        except (Exception, asyncio.CancelledError):
            pass
        self._ws = None
        return "".join(self._text_parts)

    async def _recv_loop(self) -> None:
        """接收结果。"""
        logger.info("ASR 接收循环已启动")
        try:
            async for raw in self._ws:
                if isinstance(raw, str):
                    continue
                if len(raw) < HDR:
                    continue

                msg_type = (raw[1] >> 4) & 0x0F
                flags = raw[1] & 0x0F
                comp = raw[2] & 0x0F
                body = raw[HDR + SEQ + SIZ:]  # 跳过 Header + Seq + PayloadSize

                if msg_type == 0b1001:
                    ack_body = raw[HDR:]
                    json_start = ack_body.find(b"{")
                    if json_start > 0:
                        try:
                            ack_json = json.loads(ack_body[json_start:].decode("utf-8"))
                            result = ack_json.get("result", {})
                            txt = result.get("text", "")
                            if txt and txt != self._last_sent:
                                self._last_sent = txt
                                is_final = result.get("definite", False)
                                logger.info("ASR[%s]%s: %s", self._source, " 最终" if is_final else "", txt)
                                self._text_parts.append(txt)
                                if self._tx_queue is not None:
                                    try:
                                        self._tx_queue.put_nowait((txt, is_final, self._source))
                                        logger.info("转录入队[%s]: %s", self._source, txt[:50])
                                    except Exception:
                                        pass
                        except Exception:
                            pass
                    continue

                if msg_type == 0b1111:
                    if comp == 0b0001:
                        body = gzip.decompress(body)
                    text = body.decode("utf-8", errors="replace")
                    brace = text.find("{")
                    if brace > 0:
                        text = text[brace:]
                    try:
                        resp = json.loads(text)
                    except Exception:
                        continue

                    if "error" in resp:
                        logger.warning("ASR 错误: %s", resp.get("error", "")[:200])
                        continue

                    result = resp.get("result", {})
                    txt = result.get("text", "")
                    if txt:
                        is_final = result.get("definite", False)
                        logger.info("ASR%s: %s", " 最终" if is_final else "", txt)
                        self._text_parts.append(txt)
                        if self._on_text:
                            self._on_text(txt, is_final=is_final)

                    if flags == 0b0011:
                        return

        except websockets.exceptions.ConnectionClosed:
            pass
        except Exception as exc:
            logger.error("ASR 接收循环异常: %s", exc)
