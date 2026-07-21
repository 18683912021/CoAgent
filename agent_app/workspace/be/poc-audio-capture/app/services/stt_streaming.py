"""火山引擎实时流式语音识别会话。

基于官方 openspeech.bytedance.com bigmodel WebSocket 协议。
鉴权：X-Api-Key + X-Api-Resource-Id。
"""

import asyncio
import gzip
import json
import logging
import uuid
from io import BytesIO

import websockets

logger = logging.getLogger("stt_streaming")

WS_ENDPOINT = "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel"
RESOURCE_ID = "volc.seedasr.sauc.duration"

# 音频参数（固定）
SAMPLE_RATE = 16000
BITS = 16
CHANNELS = 1
CHUNK_BYTES = 320  # 20ms @ 16kHz 16bit mono = 640 bytes? No: 16000*2*1*20/1000 = 640
# 官方示例用 320 字节，按 16K/16bit 算是 10ms，先照抄


def _debug_dump_response(raw: bytes) -> None:
    """解码服务端响应帧内容（调试用）。"""
    if len(raw) < 8:
        return
    msg_type = (raw[0] >> 4) & 0x0F
    flags = raw[0] & 0x0F
    ser = (raw[1] >> 4) & 0x0F
    comp = raw[1] & 0x0F
    size = ((raw[6] & 0xFF) << 8) | (raw[7] & 0xFF)
    logger.info("  响应头: type=%s flags=%s ser=%s comp=%s payload=%d",
                bin(msg_type), bin(flags), ser, comp, size)
    try:
        payload = raw[8:8 + size]
        if comp == 1:
            payload = gzip.decompress(payload)
        text = payload.decode("utf-8", errors="replace")
        logger.info("  响应体: %s", text[:500])
    except Exception as e:
        logger.info("  响应体解码失败: %s", e)


def _build_header(message_type: int, flags: int, serialization: int, compression: int, payload_size: int) -> bytes:
    """8 字节二进制协议头。"""
    header = bytearray(8)
    header[0] = (message_type << 4) | flags
    header[1] = (serialization << 4) | compression
    header[2:6] = b'\x00\x00\x00\x00'
    header[6] = (payload_size >> 8) & 0xFF
    header[7] = payload_size & 0xFF
    return bytes(header)


def _gzip(data: bytes) -> bytes:
    buf = BytesIO()
    with gzip.GzipFile(fileobj=buf, mode='wb') as f:
        f.write(data)
    return buf.getvalue()


class StreamingASRSession:
    """管理一次实时 ASR 会话。"""

    def __init__(self, api_key: str, on_text: "callable | None" = None):
        self._api_key = api_key
        self._on_text = on_text
        self._ws: "websockets.WebSocketClientProtocol | None" = None
        self._recv_task: "asyncio.Task | None" = None
        self._running = False
        self._fed_once = False
        self._text_parts: list[str] = []
        self._connect_id = str(uuid.uuid4())

    async def connect(self) -> None:
        self._ws = await websockets.connect(
            WS_ENDPOINT,
            additional_headers={
                "X-Api-Key": self._api_key,
                "X-Api-Resource-Id": RESOURCE_ID,
                "X-Api-Connect-Id": self._connect_id,
                "X-Api-Request-Id": str(uuid.uuid4()),
            },
        )
        # 发送全量客户端请求（配置）
        config = {
            "audio_params": {
                "sample_rate": SAMPLE_RATE,
                "bits": BITS,
                "channels": CHANNELS,
            },
            "enable_vad": True,
            "enable_punctuation": True,
        }
        payload = _gzip(json.dumps(config).encode("utf-8"))
        header = _build_header(0b1001, 0b0000, 0b0001, 0b0001, len(payload))
        await self._ws.send(header + payload)

        self._running = True
        self._recv_task = asyncio.create_task(self._recv_loop())
        logger.info("ASR 实时会话已建立")

    async def feed(self, pcm: bytes) -> None:
        """喂入 PCM 原始数据，不压缩直接发送。"""
        if not self._ws or not self._running:
            return
        if not self._fed_once:
            logger.info("ASR 首帧 PCM: %d 字节", len(pcm))
            self._fed_once = True
        try:
            header = _build_header(0b1000, 0b0000, 0b0000, 0b0000, len(pcm))
            await self._ws.send(header + pcm)
        except websockets.exceptions.ConnectionClosed:
            logger.warning("ASR WebSocket 已断开，停止推流")
            self._running = False

    async def finish(self) -> str:
        """发送结束包，等待最终结果。"""
        if not self._ws or not self._running:
            return ""
        self._running = False

        # 发送最后一包（flags=0b0001 表示结束）
        header = _build_header(0b1000, 0b0001, 0b0000, 0b0000, 0)
        try:
            await self._ws.send(header)
        except Exception:
            pass

        if self._recv_task:
            try:
                await asyncio.wait_for(self._recv_task, timeout=8.0)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                self._recv_task.cancel()

        try:
            await self._ws.close()
        except Exception:
            pass
        self._ws = None
        return "".join(self._text_parts)

    async def _recv_loop(self) -> None:
        """接收识别结果。"""
        logger.info("ASR 接收循环已启动")
        try:
            async for raw in self._ws:
                if isinstance(raw, str):
                    logger.debug("ASR 收到文本: %s", raw[:100])
                    continue
                if len(raw) < 8:
                    logger.info("ASR 收到短帧: %d 字节, hex=%s", len(raw), raw.hex())
                    continue
                logger.info("ASR 收到二进制帧: %d 字节", len(raw))
                # 解码看看是什么
                _debug_dump_response(raw)
                # 解析响应头
                msg_type = (raw[0] >> 4) & 0x0F
                flags = raw[0] & 0x0F
                compression = raw[1] & 0x0F
                payload_size = ((raw[6] & 0xFF) << 8) | (raw[7] & 0xFF)
                payload = raw[8:8 + payload_size]

                if msg_type == 0b1011:  # Full Server Response
                    if compression == 0b0001:
                        payload = gzip.decompress(payload)
                    try:
                        response = json.loads(payload.decode("utf-8"))
                    except Exception:
                        continue
                    text = response.get("text", "")
                    if text:
                        if response.get("definite", False):
                            logger.info("ASR 最终: %s", text)
                            self._text_parts.append(text)
                            if self._on_text:
                                self._on_text(text, is_final=True)
                        else:
                            logger.info("ASR 中间: %s", text)
                            if text not in self._text_parts:
                                if self._on_text:
                                    self._on_text(text, is_final=False)

                    # flags=0b0011 表示所有结果返回完毕
                    if flags == 0b0011:
                        return
        except websockets.exceptions.ConnectionClosed:
            pass
        except Exception as exc:
            logger.error("ASR 接收循环异常: %s", exc)
