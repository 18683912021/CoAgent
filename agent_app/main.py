"""FastAPI 入口 —— 飞书 Webhook + Orchestrator 集成"""
import hashlib
import json
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import JSONResponse
from dotenv import load_dotenv

from orchestrator import Orchestrator

load_dotenv()

# ── 全局 Orchestrator 实例 ──
_orchestrator: Orchestrator | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期"""
    global _orchestrator
    _orchestrator = Orchestrator()
    print("[main] Orchestrator 初始化完成")
    yield
    _orchestrator = None


app = FastAPI(title="Multi-Agent Dev System", lifespan=lifespan)

# ── 健康检查 ──


@app.get("/health")
async def health():
    return {"status": "ok", "orchestrator": _orchestrator is not None}


# ── 飞书 Webhook ──


@app.post("/webhook/feishu_event")
async def feishu_event(request: Request):
    """接收飞书事件回调。

    飞书开放平台在用户@机器人时，POST 事件 JSON 到此端点。
    """
    body = await request.json()

    # 1. 验证签名（原型阶段宽松处理，记录日志）
    if not _verify_feishu_signature(request.headers, body):
        print("[feishu] 签名验证失败，仍处理（原型模式）")

    # 2. 解析事件类型
    header = body.get("header", {})
    event_type = header.get("event_type", "")

    # URL 验证（飞书开放平台配置回调地址时发送）
    if event_type == "url_verification":
        challenge = body.get("challenge", "")
        return JSONResponse({"challenge": challenge})

    # 消息接收事件
    if event_type != "im.message.receive_v1":
        return JSONResponse({"code": 0, "msg": "ignored"})

    # 3. 提取消息内容
    try:
        event = body.get("event", {})
        message = event.get("message", {})
        chat_id = message.get("chat_id", "")
        content_str = message.get("content", "{}")
        content = json.loads(content_str)
        text = content.get("text", "")
        sender = event.get("sender", {})
        user_id = sender.get("sender_id", {}).get("user_id", "")

        # 去掉 @Bot 前缀
        command = text.strip()
        # 常见的 @Bot 格式
        if command.startswith("@") and " " in command:
            command = command.split(" ", 1)[1]
    except Exception as e:
        print(f"[feishu] 解析消息失败: {e}")
        return JSONResponse({"code": -1, "msg": f"parse error: {e}"})

    if not command or not chat_id:
        return JSONResponse({"code": 0, "msg": "empty command"})

    # 4. 交给 Orchestrator 处理
    print(f"[feishu] chat={chat_id} user={user_id} cmd={command}")

    if _orchestrator is None:
        return JSONResponse({"code": -1, "msg": "orchestrator not ready"})

    # 异步执行，不阻塞飞书回调（飞书有 3s 超时限制）
    import asyncio
    asyncio.create_task(_orchestrator.handle_command(chat_id, user_id, command))

    return JSONResponse({"code": 0, "msg": "processing"})


# ── 任务查询 ──


@app.get("/task/{task_id}")
async def get_task(task_id: str):
    """查询任务状态"""
    if _orchestrator is None:
        return {"error": "orchestrator not ready"}
    state = _orchestrator.get_task_state(task_id)
    if state is None:
        raise HTTPException(status_code=404, detail="task not found")
    return state


# ── 签名验证 ──


def _verify_feishu_signature(headers: dict, body: dict) -> bool:
    """验证飞书事件签名。

    飞书签名机制：将 timestamp + nonce + body(JSON字符串) + app_secret 拼接，
    计算 SHA256，与 header 中的 X-Lark-Signature 对比。
    """
    try:
        timestamp = headers.get("x-lark-request-timestamp", "")
        nonce = headers.get("x-lark-request-nonce", "")
        signature = headers.get("x-lark-signature", "")

        if not (timestamp and nonce and signature):
            # 原型模式：没有签名头时跳过（可能是测试/代理环境）
            return True

        app_secret = os.environ.get("FEISHU_APP_SECRET", "")
        if not app_secret:
            return True  # 未配置 secret，跳过验证

        body_str = json.dumps(body, separators=(",", ":"), ensure_ascii=False)
        sign_str = f"{timestamp}{nonce}{body_str}{app_secret}"
        expected = hashlib.sha256(sign_str.encode()).hexdigest()

        return signature == expected
    except Exception:
        return False


# ── 启动入口 ──

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
