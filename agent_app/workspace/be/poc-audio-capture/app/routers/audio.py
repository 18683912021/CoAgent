import json
import logging
import uuid
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.models.schemas import AudioStreamConfig
from app.services.audio_service import AudioSession, PCMValidator

logger = logging.getLogger("audio")
router = APIRouter()


@router.websocket("/ws/audio/stream")
async def audio_stream(ws: WebSocket):
    await ws.accept()
    logger.info("WebSocket 已连接")

    session: AudioSession | None = None
    validator: PCMValidator | None = None

    # ── 握手阶段 ──
    try:
        handshake = await ws.receive_json()
        config_data: dict[str, Any] = handshake.get("config", {})
        config = AudioStreamConfig(**config_data)
        session = AudioSession(
            session_id=handshake.get("session_id") or str(uuid.uuid4()),
            config=config,
        )
        validator = PCMValidator(config)
        await ws.send_json({
            "type": "ready",
            "session_id": session.session_id,
            "config": config.model_dump(),
        })
        logger.info(
            "会话 %s 就绪 | %dHz/%dbit/%dch",
            session.session_id,
            config.sample_rate,
            config.bit_depth,
            config.channels,
        )
    except Exception as e:
        await ws.send_json({"type": "error", "message": f"握手失败: {e}"})
        await ws.close(code=1008)
        return

    # ── 流接收阶段 ──
    try:
        while True:
            raw: bytes = await ws.receive_bytes()

            err = validator.validate(raw) if validator else "validator 未初始化"
            if err:
                session.errors.append(err)
                logger.warning("会话 %s 帧校验失败: %s", session.session_id, err)
                continue

            session.record_frame(len(raw))
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error("会话 %s 异常: %s", session.session_id, e)

    # ── 断开：输出统计 ──
    stats = session.to_stats()
    logger.info(
        "会话 %s 结束 | 帧数=%d 字节=%d 时长=%.1fms 错误=%d",
        stats.session_id,
        stats.frames_received,
        stats.bytes_received,
        stats.duration_ms,
        len(session.errors),
    )

    # 尝试发送最终统计（连接可能已断，忽略发送失败）
    try:
        await ws.send_json({
            "type": "stats",
            **stats.model_dump(),
        })
    except Exception:
        pass
