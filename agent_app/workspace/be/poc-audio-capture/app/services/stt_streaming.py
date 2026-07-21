"""火山引擎实时流式语音识别会话 — Realtime API（新版）。

使用 ai-gateway.vei.volces.com 的 JSON 事件协议，
鉴权简单：Authorization: Bearer <API_KEY>。
"""

import asyncio
import base64
import json
import logging
import uuid

import websockets

logger = logging.getLogger("stt_streaming")

# Realtime API 端点
WS_ENDPOINT = "wss://ai-gateway.vei.volces.com/v1/realtime?model=bigmodel"

CHUNK_MS = 200  # 每包 200ms 音频


class StreamingASRSession:
    """管理一次实时 ASR 会话。"""

    def __init__(
        self,
        api_key: str,
        on_text: "callable | None" = None,
    ):
        self._api_key = api_key
        self._on_text = on_text
        self._ws: "websockets.WebSocketClientProtocol | None" = None
        self._recv_task: "asyncio.Task | None" = None
        self._running = False
        self._text_parts: list[str] = []
        self._seen: set[str] = set()

    async def connect(self) -> None:
        self._ws = await websockets.connect(
            WS_ENDPOINT,
            additional_headers={
                "Authorization": f"Bearer {self._api_key}",
            },
        )
        # 发送会话配置
        await self._ws.send(json.dumps({
            "type": "transcription_session.update",
            "session": {
                "input_audio_format": "pcm",
                "input_audio_sample_rate": 16000,
                "input_audio_bits": 16,
                "input_audio_channel": 1,
                "input_audio_transcription": {
                    "model": "bigmodel",
                },
            },
        }))
        self._running = True
        self._recv_task = asyncio.create_task(self._recv_loop())
        logger.info("ASR 实时会话已建立（Realtime API）")

    async def feed(self, pcm: bytes) -> None:
        """喂入 PCM 数据，Base64 编码后用 input_audio_buffer.append 发送。"""
        if not self._ws or not self._running:
            return
        b64 = base64.b64encode(pcm).decode("ascii")
        await self._ws.send(json.dumps({
            "type": "input_audio_buffer.append",
            "audio": b64,
        }))

    async def finish(self) -> str:
        """发送 commit，等待最终结果。"""
        if not self._ws or not self._running:
            return ""
        self._running = False

        try:
            await self._ws.send(json.dumps({"type": "input_audio_buffer.commit"}))
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
        """接收 ASR 结果。"""
        try:
            async for raw in self._ws:
                try:
                    event = json.loads(raw)
                except json.JSONDecodeError:
                    continue

                etype = event.get("type", "")
                if etype == "conversation.item.input_audio_transcription.completed":
                    transcript = event.get("transcript", "")
                    if transcript:
                        self._text_parts.append(transcript)
                        if self._on_text:
                            self._on_text(transcript, is_final=True)
                elif etype == "conversation.item.input_audio_transcription.result":
                    transcript = event.get("transcript", "")
                    if transcript and transcript not in self._seen:
                        self._seen.add(transcript)
                        if self._on_text:
                            self._on_text(transcript, is_final=False)
        except websockets.exceptions.ConnectionClosed:
            pass
        except Exception as exc:
            logger.error("ASR 接收循环异常: %s", exc)
