import json
import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import ValidationError

from app.models.schemas import (
    AudioStreamConfig,
    ClientHello,
    FileEnd,
    FileStart,
    PROTOCOL_NAME,
    SessionComplete,
    SessionStart,
    SessionStopped,
    TrackEnd,
    TrackStart,
)
from app.services.audio_service import (
    AudioPacketHeader,
    AudioSession,
    PCMValidator,
    ProtocolError,
    V1AudioSession,
    storage_root,
)
from app.services.stt_streaming import StreamingASRSession

logger = logging.getLogger("audio")
router = APIRouter()

# 火山引擎 API Key（新版控制台，Realtime API）
_VOLC_API_KEY = os.getenv("VOLC_API_KEY", "")
_ASR_READY = bool(_VOLC_API_KEY)


@router.websocket("/ws/audio/stream")
async def audio_stream(ws: WebSocket):
    await ws.accept()
    logger.info("WebSocket 已连接")

    legacy_session: AudioSession | None = None
    legacy_validator: PCMValidator | None = None
    v1_session: V1AudioSession | None = None
    asr_session: StreamingASRSession | None = None

    try:
        first_message = await ws.receive()
        if first_message["type"] == "websocket.disconnect":
            return
        first_text = first_message.get("text")
        if first_text is None:
            await send_error(ws, "E_HANDSHAKE", "first WebSocket message must be JSON")
            await ws.close(code=1008)
            return

        handshake = json.loads(first_text)
        if "config" in handshake and not handshake.get("type"):
            legacy_session, legacy_validator = await start_legacy_session(ws, handshake)
        else:
            hello = ClientHello.model_validate(handshake)
            await ws.send_json(
                {
                    "type": "ready",
                    "protocol": PROTOCOL_NAME,
                    "session_id": str(hello.session_id) if hello.session_id else None,
                }
            )

        while True:
            message = await ws.receive()
            if message["type"] == "websocket.disconnect":
                break

            raw = message.get("bytes")
            text = message.get("text")

            if legacy_session is not None:
                if raw is None:
                    continue
                error = legacy_validator.validate(raw) if legacy_validator else "validator 未初始化"
                if error:
                    legacy_session.errors.append(error)
                    await send_error(ws, "E_LEGACY_FRAME", error)
                    continue
                legacy_session.record_frame(len(raw))
                continue

            if text is not None:
                try:
                    payload = json.loads(text)
                    v1_session = await handle_control_message(ws, payload, v1_session)
                except (ProtocolError, ValidationError, ValueError, json.JSONDecodeError) as error:
                    code = error.code if isinstance(error, ProtocolError) else "E_CONTROL_MESSAGE"
                    await send_error(ws, code, str(error))
                continue

            if raw is not None:
                try:
                    if v1_session is None:
                        raise ProtocolError("E_SESSION_STATE", "session_start is required before binary packets")
                    header, pcm_payload = AudioPacketHeader.decode(raw)
                    if header.session_id != v1_session.session_id:
                        raise ProtocolError("E_SESSION_ID", "binary packet session does not match active session")
                    track = v1_session.require_track(header.source)
                    ack = track.write_packet(header, pcm_payload)
                    await ws.send_json(ack.model_dump())
                    # 实时 ASR：把 PCM 喂给火山引擎
                    if asr_session is not None:
                        await asr_session.feed(pcm_payload)
                except ProtocolError as error:
                    await send_error(ws, error.code, str(error))

    except WebSocketDisconnect:
        pass
    except Exception as error:
        logger.exception("音频 WebSocket 异常")
        await safe_send_error(ws, "E_WEBSOCKET", str(error))
    finally:
        if asr_session is not None:
            try:
                await asr_session.finish()
            except Exception:
                pass
        if v1_session is not None:
            v1_session.close_incomplete()
            logger.info(
                "v1 会话 %s 结束 | 状态=%s",
                v1_session.session_id,
                v1_session.status,
            )
        if legacy_session is not None:
            stats = legacy_session.to_stats()
            logger.info(
                "legacy 会话 %s 结束 | 帧数=%d 字节=%d 时长=%.1fms 错误=%d",
                stats.session_id,
                stats.frames_received,
                stats.bytes_received,
                stats.duration_ms,
                len(legacy_session.errors),
            )
            try:
                await ws.send_json({"type": "stats", **stats.model_dump()})
            except Exception:
                pass


async def start_legacy_session(
    ws: WebSocket,
    handshake: dict[str, Any],
) -> tuple[AudioSession, PCMValidator]:
    config = AudioStreamConfig(**handshake.get("config", {}))
    session = AudioSession(
        session_id=handshake.get("session_id") or str(uuid.uuid4()),
        config=config,
    )
    validator = PCMValidator(config)
    await ws.send_json(
        {
            "type": "ready",
            "session_id": session.session_id,
            "config": config.model_dump(),
            "legacy": True,
        }
    )
    return session, validator


async def handle_control_message(
    ws: WebSocket,
    payload: dict[str, Any],
    session: V1AudioSession | None,
) -> V1AudioSession | None:
    message_type = payload.get("type")

    if message_type == "client_hello":
        ClientHello.model_validate(payload)
        await ws.send_json({"type": "ready", "protocol": PROTOCOL_NAME})
        return session

    if message_type == "session_start":
        message = SessionStart.model_validate(payload)
        if session is not None:
            raise ProtocolError("E_SESSION_STATE", "a session is already active on this WebSocket")
        session = V1AudioSession(
            session_id=message.session_id,
            source_mode=message.source_mode,
            storage_root=storage_root(),
            started_at=message.started_at or datetime.now(timezone.utc),
        )
        # 如果有 ASR 凭据，自动启动实时语音识别
        # ASR 失败不影响主流程——音频照样采集和存储
        if _ASR_READY:
            try:
                asr_session = StreamingASRSession(
                    api_key=_VOLC_API_KEY,
                    on_text=lambda text, is_final: _enqueue_asr_result(text, is_final, ws),
                )
                await asr_session.connect()
                logger.info("实时 ASR 已随会话启动")
            except Exception:
                logger.exception("ASR 连接失败，本次会话无实时识别")
                asr_session = None
        await ws.send_json(
            {
                "type": "session_ready",
                "session_id": str(session.session_id),
            }
        )
        return session

    if session is None:
        raise ProtocolError("E_SESSION_STATE", "session_start is required")

    if message_type == "track_start":
        message = TrackStart.model_validate(payload)
        require_session(message.session_id, session)
        session.start_track(message.source, message.audio_format)
        await ws.send_json(
            {
                "type": "track_ready",
                "session_id": str(session.session_id),
                "source": message.source,
            }
        )
    elif message_type == "track_end":
        message = TrackEnd.model_validate(payload)
        require_session(message.session_id, session)
        session.require_track(message.source).close_realtime()
    elif message_type == "session_stopped":
        message = SessionStopped.model_validate(payload)
        require_session(message.session_id, session)
        session.stop(message.stop_reason)
    elif message_type == "file_start":
        message = FileStart.model_validate(payload)
        require_session(message.session_id, session)
        session.require_track(message.source).start_backfill(message.total_bytes, message.sha256)
    elif message_type == "file_end":
        message = FileEnd.model_validate(payload)
        require_session(message.session_id, session)
        track = session.require_track(message.source)
        track.finish_backfill(message.total_bytes, message.sha256)
        await ws.send_json(
            {
                "type": "file_complete",
                "session_id": str(session.session_id),
                "source": message.source,
                "bytes": track.canonical_path.stat().st_size,
            }
        )
    elif message_type == "session_complete":
        message = SessionComplete.model_validate(payload)
        require_session(message.session_id, session)
        session.complete()
        await ws.send_json(
            {
                "type": "session_complete",
                **session.to_dict(),
            }
        )
    else:
        raise ProtocolError("E_CONTROL_TYPE", f"unknown control message type: {message_type}")

    session.persist_metadata()
    return session


def require_session(session_id: uuid.UUID, session: V1AudioSession) -> None:
    if session_id != session.session_id:
        raise ProtocolError("E_SESSION_ID", "control message session does not match active session")


async def send_error(ws: WebSocket, code: str, message: str) -> None:
    await ws.send_json({"type": "error", "code": code, "message": message})


async def safe_send_error(ws: WebSocket, code: str, message: str) -> None:
    try:
        await send_error(ws, code, message)
    except Exception:
        pass


def _enqueue_asr_result(text: str, is_final: bool, ws: WebSocket) -> None:
    """将 ASR 识别结果异步发送到客户端。"""
    import asyncio

    async def send():
        try:
            await ws.send_json({
                "type": "transcription",
                "text": text,
                "is_final": is_final,
            })
        except Exception:
            pass

    try:
        loop = asyncio.get_running_loop()
        loop.create_task(send())
    except RuntimeError:
        pass
