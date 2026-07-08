"""消息标准化层 —— OpenClaw 风格：将各渠道消息归一化为统一格式。

所有渠道适配器（飞书、微信、Slack 等）先转成 NormalizedMessage，
再交给 Orchestrator。Orchestrator 不关心消息来自哪个平台。
"""

import json
from dataclasses import dataclass, field
from typing import Any


@dataclass
class NormalizedMessage:
    """所有渠道统一的消息格式。"""

    text: str = ""                     # 纯文本，@mention 已替换为 @Name
    sender_id: str = ""                # 发送者 ID
    sender_name: str = ""             # 发送者显示名
    chat_id: str = ""                  # 群聊/会话 ID
    chat_type: str = "group"          # "group" | "private"
    channel: str = "feishu"           # "feishu" | "wechat" | "slack" ...
    message_id: str = ""              # 消息 ID（用于 Reaction 等）
    mentioned_bots: list[str] = field(default_factory=list)   # 被 @ 的 Bot key: ["pm", "fe"]
    mentioned_names: list[str] = field(default_factory=list)  # 被 @ 的人名: ["小吴", "小柯"]
    is_mentioned: bool = False        # 当前 Bot 是否被 @
    sender_is_bot: bool = False       # 发送者是否为另一个 Bot
    msg_type: str = "text"            # "text" | "file" | "image" | "post"
    attachment_info: str = ""         # 附件描述文本
    raw: dict[str, Any] = field(default_factory=dict)  # 原始消息（debug 用）


# ── 飞书 → NormalizedMessage ──────────────────────────

# 被 @ 成员的内部 ID → 显示名
_NAME_TO_BOT = {
    "小吴": "pm", "吴": "pm", "吴吴": "pm", "PM": "pm", "产品经理": "pm",
    "小柯": "fe", "柯": "fe", "柯柯": "fe", "前端": "fe", "FE": "fe",
    "酱瓜": "be", "瓜": "be", "瓜瓜": "be", "后端": "be", "BE": "be",
}


def normalize_feishu_message(
    bot_key: str,
    bot_app_id: str,
    bot_name: str,
    bot_short_name: str,
    all_bot_app_ids: set[str],
    raw_event: Any,
) -> NormalizedMessage:
    """将飞书 SDK 的原始消息事件转为 NormalizedMessage。

    Args:
        bot_key: 当前 Bot 的 key（"pm"/"fe"/"be"）
        bot_app_id: 当前 Bot 的 app_id
        bot_name: 当前 Bot 的显示名
        bot_short_name: 当前 Bot 的短名
        all_bot_app_ids: 所有 Bot 的 app_id 集合（用于过滤 Bot 自己发的消息）
        raw_event: 飞书 SDK 的 P2ImMessageReceiveV1 事件对象

    Returns:
        NormalizedMessage，如果消息应被过滤则 is_mentioned=False 且 text 可能为空
    """
    msg = raw_event.event.message
    chat_id = msg.chat_id
    message_id = getattr(msg, "message_id", "") or getattr(raw_event.event, "message_id", "") or ""

    # ── 发送者（Bot 消息的 user_id 可能为空，open_id/union_id 也要取）──
    sender_id = ""
    if raw_event.event.sender and raw_event.event.sender.sender_id:
        sid = raw_event.event.sender.sender_id
        sender_id = sid.user_id or sid.open_id or sid.union_id or ""
    # 发送者是否为 Bot：检查 sender_type 或 app_id 匹配
    sender_type = getattr(raw_event.event.sender, "sender_type", "") if raw_event.event.sender else ""
    sender_is_bot = (sender_type == "app" or sender_id in all_bot_app_ids)

    # ── @mention 解析（必须在 Bot 自过滤之前，因为 Bot 之间要能互相 @）──
    mentions = getattr(msg, "mentions", []) or []
    mentioned_keys = {m.key for m in mentions if hasattr(m, "key")}
    mentioned_names_list = {m.name for m in mentions if hasattr(m, "name")}

    is_mentioned = (
        bot_app_id in mentioned_keys
        or bot_name in mentioned_names_list
        or any(bot_short_name in n for n in mentioned_names_list)
    )

    # 过滤 Bot 之间非 @ 消息（防死循环），但被 @ 的消息要放行
    if sender_is_bot and not is_mentioned:
        return NormalizedMessage(chat_id=chat_id, channel="feishu", sender_is_bot=True)  # text="" 表示应跳过

    # 所有被 @ 的人（排除自己）
    all_mentioned_names: list[str] = []
    id_to_name: dict[str, str] = {}
    for m in mentions:
        key = getattr(m, "key", "") if hasattr(m, "key") else ""
        name = getattr(m, "name", "") if hasattr(m, "name") else ""
        if key and name:
            id_to_name[key] = name
        if name and name != bot_name and bot_short_name not in name:
            all_mentioned_names.append(name)

    # 检测哪些 Bot 被 @
    mentioned_bot_keys: list[str] = []
    for name in all_mentioned_names:
        bk = _NAME_TO_BOT.get(name, "")
        if bk and bk != bot_key:
            mentioned_bot_keys.append(bk)

    # ── 消息内容解析 ──
    msg_type = getattr(msg, "msg_type", "text") or "text"
    content_str = msg.content or "{}"
    content = json.loads(content_str)
    text = content.get("text", "").strip()
    attachment_info = ""
    command = ""

    if msg_type == "file":
        file_name = content.get("file_name", "未知文件")
        attachment_info = f"[文件: {file_name}]"
        command = f"(用户发了一个文件: {file_name})"

    elif msg_type == "image":
        attachment_info = "[图片]"
        command = "(用户发了一张图片)"

    elif msg_type == "post":
        # 富文本消息，提取纯文本
        post_content = content.get("content", [])
        text_parts = []
        for paragraph in post_content:
            for element in paragraph:
                if isinstance(element, dict) and element.get("tag") == "text":
                    text_parts.append(element.get("text", ""))
                elif isinstance(element, dict) and element.get("tag") == "at":
                    text_parts.append(f"@{element.get('user_name', '')}")
                elif isinstance(element, dict) and element.get("tag") == "emoji":
                    # 飞书自定义表情/表情包 → 保留 emoji_type 标识
                    text_parts.append(f"[{element.get('emoji_type', 'emoji')}]")
                elif isinstance(element, dict) and element.get("tag") == "link":
                    text_parts.append(element.get("text", element.get("href", "[链接]")))
        text = "".join(text_parts)
        command = text

    else:
        command = text

    # 替换内部 ID（@cli_xxx → @Agent名字）
    for uid, name in id_to_name.items():
        command = command.replace(f"@{uid}", f"@{name}")

    # 去掉 @Bot 前缀（三种格式：@_user_N消息 / @名字消息 / @名字 消息）
    if command.startswith("@"):
        import re
        # 格式 1: @_user_N 是飞书文本消息的 @mention 占位符，全部清除
        command = re.sub(r'@_user_\d+\s?', '', command).strip()
        # 格式 2: @BotName 直接出现的名字
        if command.startswith("@"):
            stripped = False
            for name in [bot_name, bot_short_name]:
                prefix = f"@{name}"
                if command.startswith(prefix):
                    command = command[len(prefix):].lstrip()
                    stripped = True
                    break
            if not stripped:
                parts = command.split(" ", 1)
                command = parts[1] if len(parts) > 1 else ""

    # 附件信息附到 command 前面
    if attachment_info and command:
        command = f"{attachment_info}\n{command}"
    elif attachment_info:
        command = attachment_info

    return NormalizedMessage(
        text=command.strip(),
        sender_id=sender_id,
        sender_name="",
        chat_id=chat_id,
        chat_type="group",
        channel="feishu",
        message_id=message_id,
        is_mentioned=is_mentioned,
        sender_is_bot=sender_is_bot,
        mentioned_bots=mentioned_bot_keys,
        mentioned_names=all_mentioned_names,
        msg_type=msg_type,
        attachment_info=attachment_info,
        raw={"content_str": content_str, "msg_type": msg_type},
    )
