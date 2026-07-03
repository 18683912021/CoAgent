"""飞书 WebSocket 长连接 —— 每个 Bot 独立子进程，通过 Queue 回传消息"""
import json
import logging
import multiprocessing
import time
from typing import Any

from tools.feishu_utils import BOTS

logger = logging.getLogger(__name__)


def _run_bot_process(bot_key: str, msg_queue: multiprocessing.Queue) -> None:
    """子进程入口：为一个 Bot 建立 WebSocket 长连接。收到消息 → queue → 主进程。"""
    import asyncio
    import lark_oapi as lark
    from lark_oapi.api.im.v1 import P2ImMessageReceiveV1

    bot = BOTS.get(bot_key)
    if not bot or not bot["app_id"]:
        logger.warning(f"[{bot_key}] Bot 未配置")
        return

    app_id = bot["app_id"]
    app_secret = bot["app_secret"]

    def handle_message(data: P2ImMessageReceiveV1) -> None:
        try:
            msg = data.event.message
            chat_id = msg.chat_id
            message_id = getattr(msg, "message_id", "") or ""

            # ── 过滤：忽略 Bot 自己发的消息（防止死循环）──
            sender_id = ""
            if data.event.sender and data.event.sender.sender_id:
                sender_id = data.event.sender.sender_id.user_id or ""
            all_bot_ids = {b["app_id"] for b in BOTS.values() if b.get("app_id")}
            if sender_id in all_bot_ids:
                return

            # ── 判断是否被 @，同时提取所有被 @ 的人 ──
            mentions = getattr(msg, "mentions", []) or []
            mentioned_keys = {m.key for m in mentions if hasattr(m, "key")}
            mentioned_names = {m.name for m in mentions if hasattr(m, "name")}
            bot_name = bot.get("name", "")
            bot_short = bot.get("short_name", "")
            is_mentioned = (
                app_id in mentioned_keys
                or bot_name in mentioned_names
                or any(bot_short in n for n in mentioned_names)
            )

            # 提取所有被 @ 的人（排除自己），用于群呼上下文
            # 同时建立 内部ID → 显示名 映射，用于替换 command 中的 @_user_X
            all_mentioned_names: list[str] = []
            id_to_name: dict[str, str] = {}
            for m in mentions:
                key = getattr(m, "key", "") if hasattr(m, "key") else ""
                name = getattr(m, "name", "") if hasattr(m, "name") else ""
                if key and name:
                    id_to_name[key] = name
                if name and name != bot_name and bot_short not in name:
                    all_mentioned_names.append(name)
            mentioned_others = all_mentioned_names

            msg_type = getattr(msg, "msg_type", "text") or "text"
            content_str = msg.content or "{}"
            content = json.loads(content_str)
            text = content.get("text", "").strip()
            user_id = sender_id

            # ── 解析消息内容（支持文件/文档/图片）──
            command = ""
            attachment_info = ""

            if msg_type == "file":
                file_name = content.get("file_name", "未知文件")
                file_key = content.get("file_key", "")
                attachment_info = f"[文件: {file_name}]"
                # 把文件信息附到指令里，Agent 可以通过 file_key 读取
                command = f"(用户发了一个文件: {file_name})"

            elif msg_type == "image":
                image_key = content.get("image_key", "")
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
                text = "".join(text_parts)
                command = text

            else:
                # 普通文本消息
                command = text

            # 去掉 @Bot 前缀
            if command.startswith("@"):
                parts = command.split(" ", 1)
                command = parts[1] if len(parts) > 1 else ""
            if not command and not attachment_info:
                command = ""

            # 如果有附件信息，附到 command 前面
            if attachment_info and command:
                command = f"{attachment_info}\n{command}"
            elif attachment_info:
                command = attachment_info

            # ── 替换 command 中的内部 ID（@_user_X → @Agent名字）──
            for uid, name in id_to_name.items():
                command = command.replace(f"@{uid}", f"@{name}")

            logger.info(f"[{bot_key}] chat={chat_id} type={msg_type} mentioned={is_mentioned} others={mentioned_others} cmd={command[:80] if command else '(empty)'}")
            msg_queue.put({
                "bot_key": bot_key,
                "chat_id": chat_id,
                "message_id": message_id,
                "user_id": user_id,
                "command": command,
                "is_mentioned": is_mentioned,
                "mentioned_others": mentioned_others,
                "msg_type": msg_type,
                "content": content_str,
            })
        except Exception as e:
            logger.error(f"[{bot_key}] 解析失败: {e}")

    handler = (
        lark.EventDispatcherHandler.builder("", "")
        .register_p2_im_message_receive_v1(handle_message)
        .build()
    )

    delay = 1
    while True:
        try:
            logger.info(f"[{bot_key}] WebSocket 连接中 (PID={multiprocessing.current_process().pid})...")
            cli = lark.ws.Client(
                app_id, app_secret,
                event_handler=handler,
                log_level=lark.LogLevel.INFO,
            )
            cli.start()
        except Exception as e:
            logger.error(f"[{bot_key}] 断开: {e}，{delay}s 重连...")
            time.sleep(delay)
            delay = min(delay * 2, 60)


def _msg_consumer(msg_queue: multiprocessing.Queue, orchestrator: Any, main_loop: Any) -> None:
    """主进程中消费队列消息，转交 Orchestrator。

    使用 run_coroutine_threadsafe 将协程调度到主 event loop，
    多个消息的 handle_command 可在主 loop 上并发执行。
    """
    import asyncio as _asyncio

    while True:
        try:
            msg = msg_queue.get(timeout=2)
        except Exception:
            continue

        # 调度到主 event loop，非阻塞——三条消息同时入队，三个协程并发执行
        _asyncio.run_coroutine_threadsafe(
            orchestrator.handle_command(
                msg["bot_key"], msg["chat_id"],
                msg["user_id"], msg["command"],
                msg.get("is_mentioned", True),
                msg.get("mentioned_others", []),
                msg.get("message_id", ""),
            ),
            main_loop,
        )


def start_all_bots(orchestrator: Any) -> tuple[multiprocessing.Queue, list[multiprocessing.Process]]:
    """启动所有 Bot 的 WebSocket 连接（各独立子进程）+ 消息消费线程。

    Returns:
        (消息队列, 子进程列表)
    """
    msg_queue = multiprocessing.Queue()

    # 获取主 event loop（调用方处于 async 上下文中）
    import asyncio as _asyncio
    main_loop = _asyncio.get_running_loop()

    # 消息消费线程（在主进程中，直接访问 Orchestrator）
    import threading
    consumer = threading.Thread(
        target=_msg_consumer,
        args=(msg_queue, orchestrator, main_loop),
        name="msg-consumer",
        daemon=True,
    )
    consumer.start()

    # 三个 Bot 子进程
    processes = []
    for bot_key in ["pm", "fe", "be"]:
        p = multiprocessing.Process(
            target=_run_bot_process,
            args=(bot_key, msg_queue),
            name=f"ws-{bot_key}",
            daemon=True,
        )
        p.start()
        processes.append(p)

    logger.info(f"所有 Bot WebSocket 已启动 ({len(processes)} 个子进程)")
    return msg_queue, processes
