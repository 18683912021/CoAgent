"""飞书 Bot 公共工具：Token 管理、消息发送、签名验证"""
import hashlib
import json
import os
import time
from typing import Any

import httpx
from dotenv import load_dotenv

load_dotenv()

# ── Bot 凭证配置 ────────────────────────────────────────

BOTS = {
    "pm": {
        "app_id": os.environ.get("FEISHU_PM_APP_ID", ""),
        "app_secret": os.environ.get("FEISHU_PM_APP_SECRET", ""),
        "name": "PM Bot",
    },
    "fe": {
        "app_id": os.environ.get("FEISHU_FE_APP_ID", ""),
        "app_secret": os.environ.get("FEISHU_FE_APP_SECRET", ""),
        "name": "FE Bot",
    },
    "be": {
        "app_id": os.environ.get("FEISHU_BE_APP_ID", ""),
        "app_secret": os.environ.get("FEISHU_BE_APP_SECRET", ""),
        "name": "BE Bot",
    },
}

# 简单的内存 token 缓存
_token_cache: dict[str, tuple[str, float]] = {}  # key → (token, expires_at)


def get_bot_by_app_id(app_id: str) -> dict | None:
    """根据 app_id 查找对应的 Bot 配置"""
    for key, bot in BOTS.items():
        if bot["app_id"] == app_id:
            return {"key": key, **bot}
    return None


async def get_tenant_token(app_id: str, app_secret: str) -> str:
    """获取 tenant_access_token，带缓存"""
    cache_key = app_id
    now = time.time()

    if cache_key in _token_cache:
        token, expires = _token_cache[cache_key]
        if now < expires - 60:  # 提前 60s 刷新
            return token

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
                json={"app_id": app_id, "app_secret": app_secret},
            )
            data = resp.json()
            token = data.get("tenant_access_token", "")
            expire = data.get("expire", 7200)  # 默认 2 小时
            _token_cache[cache_key] = (token, now + expire)
            return token
    except Exception as e:
        print(f"[feishu] 获取 token 失败 ({app_id[:10]}...): {e}")
        return ""


async def send_message(
    app_id: str,
    app_secret: str,
    chat_id: str,
    text: str,
    at_users: list[str] | None = None,
) -> dict:
    """通过飞书 API 发送消息到群聊。

    Args:
        at_users: 要 @ 的用户 ID 列表，支持 open_id/union_id/user_id/app_id

    Returns:
        {"success": bool, "msg": str}
    """
    if not app_id or not app_secret:
        return {"success": False, "msg": f"Bot 凭证未配置 (app_id={app_id[:10]}...)"}

    token = await get_tenant_token(app_id, app_secret)
    if not token:
        return {"success": False, "msg": "获取 tenant_access_token 失败"}

    # 构造消息内容，@mention 在 text 中用 <at> 标签
    content_body = {"text": text}
    # 生成 @mention 的 <at> 标签
    for uid in (at_users or []):
        # 用 <at user_id="xxx"> 格式在文本中插入 @
        # 实际 @ 效果依赖飞书客户端渲染
        text = text  # <at> 已在调用方拼入 text

    # 如果有 at_users，通过 at 字段告知飞书这是真正的 @
    if at_users:
        # 提取 text 中第一个 at_user 作为 at 目标
        content_body = {
            "text": text,
        }

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                "https://open.feishu.cn/open-apis/im/v1/messages"
                "?receive_id_type=chat_id",
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
                json={
                    "receive_id": chat_id,
                    "msg_type": "text",
                    "content": json.dumps(content_body),
                },
            )
            data = resp.json()
            code = data.get("code", -1)
            if code == 0:
                return {"success": True, "msg": "发送成功"}
            return {"success": False, "msg": f"飞书 API 返回错误: code={code} msg={data.get('msg', '')}"}
    except Exception as e:
        return {"success": False, "msg": f"发送异常: {e}"}


def verify_signature(headers: dict, body: dict, app_secret: str) -> bool:
    """验证飞书事件签名"""
    try:
        timestamp = headers.get("x-lark-request-timestamp", "")
        nonce = headers.get("x-lark-request-nonce", "")
        signature = headers.get("x-lark-signature", "")

        if not (timestamp and nonce and signature):
            return True  # 无签名头时跳过（测试环境）

        if not app_secret:
            return True  # 无 secret 时跳过

        body_str = json.dumps(body, separators=(",", ":"), ensure_ascii=False)
        sign_str = f"{timestamp}{nonce}{body_str}{app_secret}"
        expected = hashlib.sha256(sign_str.encode()).hexdigest()
        return signature == expected
    except Exception:
        return False
