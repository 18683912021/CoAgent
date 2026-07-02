"""FastAPI 入口 —— 飞书多 Bot Webhook + Orchestrator 集成"""
import json
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import JSONResponse
from dotenv import load_dotenv

from orchestrator import Orchestrator
from tools.feishu_utils import get_bot_by_app_id, verify_signature

load_dotenv()

_orchestrator: Orchestrator | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _orchestrator
    _orchestrator = Orchestrator()
    print("[main] Orchestrator 初始化完成（多 Bot 模式）")
    yield
    _orchestrator = None


app = FastAPI(title="Multi-Agent Dev System", lifespan=lifespan)


# ── 健康检查 ──

@app.get("/health")
async def health():
    bots_status = {}
    if _orchestrator:
        for key in ["pm", "fe", "be"]:
            bot = _orchestrator._get_bot_config(key)
            bots_status[key] = "configured" if bot["app_id"] else "missing"
    return {"status": "ok", "bots": bots_status}


# ── 飞书 Webhook（多 Bot 共用）──

@app.post("/webhook/feishu_event")
async def feishu_event(request: Request):
    """接收飞书事件。三个 Bot 共用此端点，按 app_id 路由。"""
    body = await request.json()

    # 1. 判断是哪个 Bot 收到消息
    header = body.get("header", {})
    app_id = header.get("app_id", "")
    event_type = header.get("event_type", "")

    # URL 验证
    if event_type == "url_verification":
        return JSONResponse({"challenge": body.get("challenge", "")})

    bot = get_bot_by_app_id(app_id)
    if not bot:
        print(f"[feishu] 未知 app_id: {app_id}")
        return JSONResponse({"code": -1, "msg": f"unknown app_id: {app_id}"})

    # 签名验证
    if not verify_signature(request.headers, body, bot["app_secret"]):
        print(f"[feishu] 签名验证失败: {bot['key']}")

    # 非消息事件忽略
    if event_type != "im.message.receive_v1":
        return JSONResponse({"code": 0, "msg": "ignored"})

    # 2. 提取消息
    try:
        event = body.get("event", {})
        message = event.get("message", {})
        chat_id = message.get("chat_id", "")
        content_str = message.get("content", "{}")
        content = json.loads(content_str)
        text = content.get("text", "").strip()
        sender = event.get("sender", {})
        user_id = sender.get("sender_id", {}).get("user_id", "")

        # 去掉 @Bot 前缀（各种格式）
        command = text
        # 格式: @Bot Name command
        if command.startswith("@"):
            parts = command.split(" ", 1)
            if len(parts) > 1:
                command = parts[1]
            else:
                command = ""
    except Exception as e:
        print(f"[feishu] 解析消息失败: {e}")
        return JSONResponse({"code": -1, "msg": f"parse error: {e}"})

    if not command:
        return JSONResponse({"code": 0, "msg": "empty command"})

    print(f"[feishu] bot={bot['key']} chat={chat_id} user={user_id} cmd={command[:80]}")

    if _orchestrator is None:
        return JSONResponse({"code": -1, "msg": "orchestrator not ready"})

    # 3. 异步处理（飞书回调有 3s 超时限制）
    import asyncio
    asyncio.create_task(
        _orchestrator.handle_command(bot["key"], chat_id, user_id, command)
    )

    return JSONResponse({"code": 0, "msg": "processing"})


# ── 任务查询 ──

@app.get("/task/{task_id}")
async def get_task(task_id: str):
    if _orchestrator is None:
        return {"error": "orchestrator not ready"}
    state = _orchestrator.get_task_state(task_id)
    if state is None:
        raise HTTPException(status_code=404, detail="task not found")
    return state


# ── 启动入口 ──

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
