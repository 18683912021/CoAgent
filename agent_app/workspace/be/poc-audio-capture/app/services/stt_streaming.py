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
        self._send_task = None
        self._send_queue: "asyncio.Queue[bytes]" = asyncio.Queue(maxsize=32)
        self._running = False
        self._seq = 1
        self._last_sent = ""
        self._last_finalized = ""  # 上一句最终文本，用于断句后裁掉旧内容
        self._text_parts: list[str] = []
        self._on_text = None  # 旧协议回调占位，避免 AttributeError

    async def connect(self) -> None:
        self._seq = 2  # 配置帧占序列 1，音频帧从 2 开始
        self._last_sent = ""
        self._last_finalized = ""
        self._ws = await websockets.connect(
            WS_ENDPOINT,
            ping_interval=30,     # 每 30 秒心跳，防止长会话被代理断开
            ping_timeout=10,      # 心跳 10 秒无响应断开
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
            "request": {
                "model_name": "bigmodel",
                "enable_itn": True,
                "enable_punc": True,
                "enable_vad": True,
                # ── 识别优化 ──
                "enable_first_char_accel": True,
                "context_history_length": 5,
            },
        }
        payload = _gzip(json.dumps(config).encode("utf-8"))
        # 配置帧: Header + PayloadSize + Payload（无序列号，flags=0）
        await self._ws.send(_header(0b0001, 0, 0b0001, 0b0001) + struct.pack(">I", len(payload)) + payload)

        self._running = True
        self._recv_task = asyncio.create_task(self._recv_loop())
        self._send_task = asyncio.create_task(self._send_loop())
        logger.info("ASR 实时会话已建立")

    def _enqueue(self, txt: str, is_final: bool) -> None:
        """入队前裁剪已完结的旧句，保证断句后不再串入旧内容。

        火山引擎 BigModel 极少发 definite=true，因此自己启发式断句：
        文本以 。！？结尾 → 记录当前完整文本为断句锚点。
        后续累积文本以此锚点开头**且更长** → 裁掉前缀，只入队新增内容。
        """
        stripped = txt.rstrip()
        # 以句号/感叹号/问号结尾 → 视为一句完结，通知前端立即标记 done
        if stripped and stripped[-1] in '。！？':
            self._last_finalized = stripped
            is_final = True  # 告诉前端可以断句了，不等 3 秒超时

        # 仅当新文本**比锚点长**时裁前缀（> 而非 >=，避免把自己裁成空串）
        if self._last_finalized and len(txt) > len(self._last_finalized) and txt.startswith(self._last_finalized):
            txt = txt[len(self._last_finalized):].lstrip()

        if not txt:
            return
        if txt == self._last_sent:
            return
        self._last_sent = txt
        self._text_parts.append(txt)
        if len(self._text_parts) > 200:  # 防止长会话内存膨胀
            self._text_parts = self._text_parts[-100:]
        if is_final:
            self._last_finalized = txt
        if self._tx_queue is not None:
            try:
                self._tx_queue.put_nowait((txt, is_final, self._source))
                logger.info("转录入队[%s]: %s", self._source, txt[:50])
            except Exception:
                pass

    async def _send_loop(self) -> None:
        """后台任务：从队列取音频帧发送，不阻塞主音频接收链路。"""
        while self._running:
            try:
                frame = await self._send_queue.get()
            except asyncio.CancelledError:
                break
            try:
                await self._ws.send(frame)
            except (websockets.exceptions.ConnectionClosed, Exception):
                self._running = False
                break

    def feed(self, pcm: bytes) -> None:
        """音频帧非阻塞入队——告别 await send() 导致的串行延迟。"""
        if not self._ws or not self._running:
            return
        try:
            seq_bytes = struct.pack(">I", self._seq)
            self._seq += 1
            frame = _header(0b0010, 0b0001, 0, 0) + seq_bytes + struct.pack(">I", len(pcm)) + pcm
            self._send_queue.put_nowait(frame)
            if self._seq == 3:
                logger.info("ASR 音频帧已开始推送 (seq=2+)")
        except asyncio.QueueFull:
            logger.debug("ASR 发送队列满，丢弃一帧")
        except websockets.exceptions.ConnectionClosed:
            self._running = False

    async def finish(self) -> str:
        """结束帧: Header + 负序列号 + PayloadSize=0。"""
        if not self._ws or not self._running:
            return ""
        self._running = False

        # 先取消发送和接收循环
        if self._send_task and not self._send_task.done():
            self._send_task.cancel()
        if self._recv_task and not self._recv_task.done():
            self._recv_task.cancel()

        try:
            await self._ws.send(
                _header(0b0010, 0b0011, 0, 0) + struct.pack(">i", -self._seq) + struct.pack(">I", 0)
            )
        except Exception:
            pass

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
                                is_final = result.get("definite", False)
                                logger.info("ASR[%s]%s: %s", self._source, " 最终" if is_final else "", txt)
                                self._enqueue(txt, is_final)
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
                        logger.debug("ASR 错误: %s", resp.get("error", "")[:200])
                        continue

                    result = resp.get("result", {})
                    txt = result.get("text", "")
                    if txt:
                        is_final = result.get("definite", False)
                        logger.info("ASR[%s]%s: %s", self._source, " 最终" if is_final else "", txt)
                        self._enqueue(txt, is_final)

                    if flags == 0b0011:
                        return

        except websockets.exceptions.ConnectionClosed:
            pass
        except Exception as exc:
            logger.error("ASR 接收循环异常: %s", exc)
