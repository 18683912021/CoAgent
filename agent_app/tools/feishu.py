"""飞书消息发送工具"""
import hashlib
import hmac
import json
import os
import time

import httpx
from dotenv import load_dotenv

load_dotenv()

FEISHU_BOT_WEBHOOK = os.environ.get("FEISHU_BOT_WEBHOOK", "")
FEISHU_APP_ID = os.environ.get("FEISHU_APP_ID", "")
FEISHU_APP_SECRET = os.environ.get("FEISHU_APP_SECRET", "")

SEND_MESSAGE_TOOL_SPEC = {
    "name": "send_feishu_message",
    "description": "向飞书群发送消息，用于通知用户任务进展或结果",
    "input_schema": {
        "type": "object",
        "properties": {
            "chat_id": {"type": "string", "description": "目标群聊或用户ID"},
            "text": {"type": "string", "description": "要发送的消息文本"},
        },
        "required": ["chat_id", "text"],
    },
}


async def send_feishu_message(chat_id: str, text: str) -> str:
    """通过飞书机器人 Webhook 发送消息。

    原型阶段支持两种方式：
    1. 自定义机器人 Webhook（无需 tenant_access_token）
    2. 应用机器人消息 API（需先获取 tenant_access_token）
    """
    if FEISHU_BOT_WEBHOOK:
        # 方式 1：自定义机器人 Webhook
        return await _send_via_webhook(text)
    elif FEISHU_APP_ID and FEISHU_APP_SECRET:
        # 方式 2：应用机器人消息 API
        return await _send_via_api(chat_id, text)
    else:
        return "[send_feishu_message] 飞书凭证未配置，模拟发送：\n" + text


async def _send_via_webhook(text: str) -> str:
    """通过自定义机器人 Webhook 发送"""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                FEISHU_BOT_WEBHOOK,
                json={"msg_type": "text", "content": {"text": text}},
            )
            data = resp.json()
            if data.get("code") == 0:
                return "[send_feishu_message] 发送成功"
            return f"[send_feishu_message] 发送失败: {data}"
    except Exception as e:
        return f"[send_feishu_message] 发送异常: {e}"


async def _send_via_api(chat_id: str, text: str) -> str:
    """通过飞书开放平台消息 API 发送"""
    try:
        # 获取 tenant_access_token
        async with httpx.AsyncClient(timeout=10) as client:
            token_resp = await client.post(
                "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
                json={"app_id": FEISHU_APP_ID, "app_secret": FEISHU_APP_SECRET},
            )
            token_data = token_resp.json()
            token = token_data.get("tenant_access_token", "")

            if not token:
                return f"[send_feishu_message] 获取token失败: {token_data}"

            # 发送消息
            msg_resp = await client.post(
                "https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id",
                headers={"Authorization": f"Bearer {token}"},
                json={
                    "receive_id": chat_id,
                    "msg_type": "text",
                    "content": json.dumps({"text": text}),
                },
            )
            msg_data = msg_resp.json()
            if msg_data.get("code") == 0:
                return "[send_feishu_message] 发送成功"
            return f"[send_feishu_message] 发送失败: {msg_data}"
    except Exception as e:
        return f"[send_feishu_message] 发送异常: {e}"
