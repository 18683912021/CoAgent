"""火山引擎实时流式语音识别会话。

与 stt_service.py 不同，本模块用于实时场景：
音频数据分块到达 → 即时转发到火山引擎 → 即时取回识别结果。
"""

import asyncio
import gzip
import json
import logging
import struct
import uuid

import websockets

from app.services.stt_service import (
    RESOURCE_ID,
    WS_ENDPOINT,
    decode_server_response,
    encode_audio_frame,
    encode_client_request,
)

logger = logging.getLogger("stt_streaming")

CHUNK_MS = 200  # 包大小（毫秒）


class StreamingASRSession:
    """管理一次实时 ASR 会话：维持火山引擎 WebSocket 连接，逐块收发。"""

    def __init__(
        self,
        app_id: str,
        access_key_id: str,
        secret_access_key: str,
        on_text: "callable | None" = None,
    ):
        self._app_id = app_id
        self._ak = access_key_id
        self._sk = secret_access_key
        self._on_text = on_text
        self._ws: "websockets.WebSocketClientProtocol | None" = None
        self._recv_task: "asyncio.Task | None" = None
        self._buffer = bytearray()
        self._running = False

    async def connect(self) -> None:
        self._ws = await websockets.connect(
            WS_ENDPOINT,
            additional_headers={
                "X-Api-App-Key": self._app_id,
                "X-Api-Access-Key": self._ak,
                "X-Api-Resource-Id": RESOURCE_ID,
                "X-Api-Connect-Id": str(uuid.uuid4()),
            },
        )
        await self._ws.send(encode_client_request({
            "audio_format": "pcm",
            "sample_rate": 16000,
            "bits": 16,
            "channel": 1,
            "language": "zh-CN",
            "model_name": "bigmodel",
            "enable_punctuation": True,
            "enable_itn": True,
        }))
        self._running = True
        self._recv_task = asyncio.create_task(self._recv_loop())
        logger.info("ASR 实时会话已建立")

    async def feed(self, pcm: bytes) -> None:
        """喂入一块 PCM 数据。内部缓冲到 200ms 再发送。"""
        if not self._ws or not self._running:
            return
        self._buffer.extend(pcm)
        chunk = 16000 * 2 * 1 * CHUNK_MS // 1000  # 6400 bytes
        while len(self._buffer) >= chunk:
            frame = bytes(self._buffer[:chunk])
            self._buffer = self._buffer[chunk:]
            await self._ws.send(encode_audio_frame(frame, is_last=False))

    async def finish(self) -> str:
        """发送剩余数据 + 结束标志，等待最终结果，返回完整文本。"""
        if not self._ws or not self._running:
            return ""
        # 发送缓冲区剩余
        if self._buffer:
            await self._ws.send(encode_audio_frame(bytes(self._buffer), is_last=False))
            self._buffer = bytearray()
        # 发送结束帧
        await self._ws.send(encode_audio_frame(b"", is_last=True))
        self._running = False

        # 等待接收循环结束
        if self._recv_task:
            try:
                await asyncio.wait_for(self._recv_task, timeout=5.0)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                self._recv_task.cancel()

        # 关闭 WebSocket
        try:
            await self._ws.close()
        except Exception:
            pass
        self._ws = None
        return ""

    async def _recv_loop(self) -> None:
        """后台任务：持续接收 ASR 结果，通过 on_text 回调输出。"""
        accumulated: list[str] = []
        try:
            while self._running:
                try:
                    raw = await asyncio.wait_for(self._ws.recv(), timeout=1.0)
                except asyncio.TimeoutError:
                    continue
                result = decode_server_response(raw)
                if not result:
                    continue
                text = _extract_text(result)
                if text and text not in accumulated:
                    accumulated.append(text)
                    if self._on_text:
                        self._on_text(text, is_final=False)
        except websockets.exceptions.ConnectionClosed:
            pass
        except Exception as exc:
            logger.error("ASR 接收循环异常: %s", exc)
        finally:
            # 最后回调一次完整文本
            full = "".join(accumulated)
            if full and self._on_text:
                self._on_text(full, is_final=True)


def _extract_text(result: dict) -> str:
    """从服务端 JSON 响应中提取识别文本。"""
    try:
        utterances = result.get("payload_msg", {}).get("result", [])
        parts = []
        for utterance in utterances:
            for word in utterance.get("words", []):
                t = word.get("text", "")
                if t:
                    parts.append(t)
        return "".join(parts)
    except Exception:
        return ""
