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
            content_str = msg.content or "{}"
            content = json.loads(content_str)
            text = content.get("text", "").strip()
            user_id = (data.event.sender.sender_id.user_id
                       if data.event.sender and data.event.sender.sender_id
                       else "")

            command = text
            if command.startswith("@"):
                parts = command.split(" ", 1)
                command = parts[1] if len(parts) > 1 else ""

            if not command:
                return

            logger.info(f"[{bot_key}] chat={chat_id} cmd={command[:80]}")
            msg_queue.put({
                "bot_key": bot_key,
                "chat_id": chat_id,
                "user_id": user_id,
                "command": command,
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


def _msg_consumer(msg_queue: multiprocessing.Queue, orchestrator: Any) -> None:
    """主进程中消费队列消息，转交 Orchestrator"""
    import asyncio as _asyncio

    while True:
        try:
            msg = msg_queue.get(timeout=2)
        except Exception:
            continue

        # 跨线程安全调度 async 任务
        try:
            loop = _asyncio.get_running_loop()
            _asyncio.run_coroutine_threadsafe(
                orchestrator.handle_command(
                    msg["bot_key"], msg["chat_id"],
                    msg["user_id"], msg["command"],
                ),
                loop,
            )
        except RuntimeError:
            loop = _asyncio.new_event_loop()
            loop.run_until_complete(
                orchestrator.handle_command(
                    msg["bot_key"], msg["chat_id"],
                    msg["user_id"], msg["command"],
                )
            )
            loop.close()


def start_all_bots(orchestrator: Any) -> tuple[multiprocessing.Queue, list[multiprocessing.Process]]:
    """启动所有 Bot 的 WebSocket 连接（各独立子进程）+ 消息消费线程。

    Returns:
        (消息队列, 子进程列表)
    """
    msg_queue = multiprocessing.Queue()

    # 消息消费线程（在主进程中，直接访问 Orchestrator）
    import threading
    consumer = threading.Thread(
        target=_msg_consumer,
        args=(msg_queue, orchestrator),
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
