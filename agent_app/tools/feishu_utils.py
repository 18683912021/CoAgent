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
        "name": "AI小吴（产品经理）",
        "short_name": "小吴",
    },
    "fe": {
        "app_id": os.environ.get("FEISHU_FE_APP_ID", ""),
        "app_secret": os.environ.get("FEISHU_FE_APP_SECRET", ""),
        "name": "AI小柯（前端）",
        "short_name": "小柯",
    },
    "be": {
        "app_id": os.environ.get("FEISHU_BE_APP_ID", ""),
        "app_secret": os.environ.get("FEISHU_BE_APP_SECRET", ""),
        "name": "AI酱瓜（后端开发工程师）",
        "short_name": "酱瓜",
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

    # 构造消息内容
    # 如果有 at_users，在 text 末尾追加 <at> 标签实现真正的 @mention
    msg_text = text
    if at_users:
        at_tags = " ".join(f'<at user_id="{uid}"></at>' for uid in at_users)
        msg_text = f"{text} {at_tags}"

    content_body = {"text": msg_text}

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


async def add_reaction(app_id: str, app_secret: str, message_id: str, emoji_type: str = "WRITING_HAND") -> dict:
    """给消息添加表情回应（用于模拟"正在输入"状态）。

    Args:
        message_id: 飞书消息 ID
        emoji_type: 表情类型，默认 WRITING_HAND（✍️）

    Returns:
        {"success": bool, "reaction_id": str, "msg": str}
    """
    if not app_id or not app_secret:
        return {"success": False, "reaction_id": "", "msg": "Bot 凭证未配置"}
    if not message_id:
        return {"success": False, "reaction_id": "", "msg": "message_id 为空"}

    token = await get_tenant_token(app_id, app_secret)
    if not token:
        return {"success": False, "reaction_id": "", "msg": "获取 token 失败"}

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                f"https://open.feishu.cn/open-apis/im/v1/messages/{message_id}/reactions",
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
                json={"reaction_type": {"emoji_type": emoji_type}},
            )
            data = resp.json()
            code = data.get("code", -1)
            if code == 0:
                reaction_id = data.get("data", {}).get("reaction_id", "")
                return {"success": True, "reaction_id": reaction_id, "msg": "ok"}
            return {"success": False, "reaction_id": "", "msg": f"code={code} {data.get('msg', '')}"}
    except Exception as e:
        return {"success": False, "reaction_id": "", "msg": f"异常: {e}"}


async def delete_reaction(app_id: str, app_secret: str, message_id: str, reaction_id: str) -> dict:
    """删除消息的表情回应。

    Returns:
        {"success": bool, "msg": str}
    """
    if not reaction_id:
        return {"success": False, "msg": "reaction_id 为空"}

    token = await get_tenant_token(app_id, app_secret)
    if not token:
        return {"success": False, "msg": "获取 token 失败"}

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.delete(
                f"https://open.feishu.cn/open-apis/im/v1/messages/{message_id}/reactions/{reaction_id}",
                headers={"Authorization": f"Bearer {token}"},
            )
            data = resp.json()
            code = data.get("code", -1)
            if code == 0:
                return {"success": True, "msg": "ok"}
            return {"success": False, "msg": f"code={code} {data.get('msg', '')}"}
    except Exception as e:
        return {"success": False, "msg": f"异常: {e}"}


async def download_file(app_id: str, app_secret: str, file_key: str) -> dict:
    """下载飞书群聊中的文件内容。

    Args:
        file_key: 消息中的 file_key

    Returns:
        {"success": bool, "content": str, "file_name": str, "msg": str}
    """
    token = await get_tenant_token(app_id, app_secret)
    if not token:
        return {"success": False, "content": "", "file_name": "", "msg": "获取 token 失败"}

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(
                f"https://open.feishu.cn/open-apis/im/v1/messages/{file_key}/resources/{file_key}?type=file",
                headers={"Authorization": f"Bearer {token}"},
            )
            if resp.status_code == 200:
                content_type = resp.headers.get("content-type", "")
                if "text" in content_type or "json" in content_type or "xml" in content_type:
                    return {"success": True, "content": resp.text[:5000], "file_name": "", "msg": "ok"}
                else:
                    return {"success": True, "content": f"[二进制文件，大小: {len(resp.content)} 字节]", "file_name": "", "msg": "ok"}
            data = resp.json()
            return {"success": False, "content": "", "file_name": "", "msg": f"下载失败: {data}"}
    except Exception as e:
        return {"success": False, "content": "", "file_name": "", "msg": f"下载异常: {e}"}


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
