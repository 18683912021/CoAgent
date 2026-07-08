"""FastAPI 入口 —— WebSocket 长连接 + HTTP 健康检查"""
import asyncio
import logging
import multiprocessing
import signal
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import JSONResponse

from orchestrator import Orchestrator
from monitor import metrics
from tools.feishu_ws import start_all_bots
from tools.feishu_utils import BOTS

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
logger = logging.getLogger(__name__)

_orchestrator: Orchestrator | None = None
_processes: list[multiprocessing.Process] = []
_stop_event = None  # multiprocessing.Event


def _shutdown_subprocesses() -> None:
    """优雅关闭所有子进程：先发停止信号 → 等最多 5s → 强杀 → 确保全死。"""
    global _processes, _stop_event

    if _stop_event:
        _stop_event.set()
        logger.info("已发送停止信号给所有 Bot 子进程")

    import time as _time
    _time.sleep(0.5)  # 给子进程一点时间检查 stop_event

    for i, p in enumerate(_processes):
        if p.is_alive():
            p.terminate()
            p.join(timeout=5)
            if p.is_alive():
                logger.warning(f"子进程 {p.name} (PID={p.pid}) 未响应 terminate，强制 kill")
                p.kill()
                p.join(timeout=2)
            logger.info(f"子进程 {p.name} (PID={p.pid}) 已退出")

    _processes = []
    logger.info("所有子进程已清理完毕")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """启动时建立 WebSocket，关闭时断开"""
    global _orchestrator, _processes, _stop_event
    _orchestrator = Orchestrator()
    logger.info("Orchestrator 初始化完成")

    # 启动所有 Bot 的 WebSocket 长连接（各独立子进程）
    _, _processes, _stop_event = start_all_bots(_orchestrator)
    logger.info("所有 Bot WebSocket 已启动，服务就绪")

    yield

    _shutdown_subprocesses()
    logger.info("服务关闭")


app = FastAPI(title="Multi-Agent Dev System", lifespan=lifespan)


@app.get("/health")
async def health():
    bots_status = {}
    for i, key in enumerate(["pm", "fe", "be"]):
        bot = BOTS.get(key, {})
        alive = i < len(_processes) and _processes[i].is_alive()
        bots_status[key] = "connected" if (bot.get("app_id") and alive) else ("configured" if bot.get("app_id") else "missing")
    return {
        "status": "ok",
        "orchestrator": _orchestrator is not None,
        "bots": bots_status,
        "metrics": metrics.to_dict(),
    }


@app.get("/task/{task_id}")
async def get_task(task_id: str):
    if _orchestrator is None:
        raise HTTPException(status_code=503, detail="not ready")
    state = _orchestrator.get_task_state(task_id)
    if state is None:
        raise HTTPException(status_code=404, detail="task not found")
    return state


# 保留 webhook 兼容端点（供有公网 IP 的场景使用）
@app.post("/webhook/feishu_event")
async def feishu_event(request: Request):
    """飞书 Webhook 回调（WebSocket 已覆盖主要场景，此端点备用）"""
    import json as _json
    from tools.feishu_utils import get_bot_by_app_id, verify_signature

    body = await request.json()
    header = body.get("header", {})
    event_type = header.get("event_type", "")

    if event_type == "url_verification":
        return JSONResponse({"challenge": body.get("challenge", "")})

    if event_type != "im.message.receive_v1":
        return JSONResponse({"code": 0, "msg": "ignored"})

    app_id = header.get("app_id", "")
    bot = get_bot_by_app_id(app_id)
    if not bot:
        return JSONResponse({"code": 0, "msg": "unknown bot"})

    try:
        event = body.get("event", {})
        message = event.get("message", {})
        chat_id = message.get("chat_id", "")
        content = _json.loads(message.get("content", "{}"))
        text = content.get("text", "").strip()
        user_id = event.get("sender", {}).get("sender_id", {}).get("user_id", "")

        command = text
        if command.startswith("@"):
            parts = command.split(" ", 1)
            command = parts[1] if len(parts) > 1 else ""

        if command and _orchestrator:
            asyncio.create_task(
                _orchestrator.handle_command(bot["key"], chat_id, user_id, command, mentioned_others=[], message_id="")
            )
    except Exception as e:
        logger.error(f"[webhook] 解析失败: {e}")

    return JSONResponse({"code": 0, "msg": "processing"})


# ── 信号处理：Ctrl+C 时确保子进程清理干净 ──

def _signal_handler(signum, frame):
    """收到 SIGINT/SIGTERM 时主动清理子进程并立即退出。"""
    import os as _os
    sig_name = signal.Signals(signum).name
    logger.info(f"收到 {sig_name} 信号，开始清理子进程...")
    _shutdown_subprocesses()
    logger.info("子进程已清理，立即退出（不等 agent 线程）")
    _os._exit(0)


signal.signal(signal.SIGINT, _signal_handler)
signal.signal(signal.SIGTERM, _signal_handler)


if __name__ == "__main__":
    import uvicorn
    logger.info("启动服务（WebSocket 长连接模式）...")
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
