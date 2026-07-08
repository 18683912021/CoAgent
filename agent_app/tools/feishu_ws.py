"""飞书 WebSocket 长连接 —— 每个 Bot 独立子进程，通过 Queue 回传消息"""
import json
import logging
import multiprocessing
import time
from typing import Any

from tools.feishu_utils import BOTS

logger = logging.getLogger(__name__)


def _run_bot_process(bot_key: str, msg_queue, stop_event=None) -> None:
    """子进程入口：为一个 Bot 建立 WebSocket 长连接。收到消息 → queue → 主进程。"""
    import asyncio
    import logging as _logging
    import lark_oapi as lark
    from lark_oapi.api.im.v1 import P2ImMessageReceiveV1

    # 子进程独立配置日志（multiprocessing spawn 模式不继承主进程配置）
    _logging.basicConfig(level=_logging.INFO, format="%(asctime)s %(message)s")

    bot = BOTS.get(bot_key)
    if not bot or not bot["app_id"]:
        logger.warning(f"[{bot_key}] Bot 未配置")
        return

    app_id = bot["app_id"]
    app_secret = bot["app_secret"]

    def handle_message(data: P2ImMessageReceiveV1) -> None:
        # 打印原始消息结构用于调试
        msg = data.event.message
        raw_content = msg.content or "{}"
        raw_msg_type = getattr(msg, "msg_type", "text") or "text"
        logger.info(
            f"[{bot_key}] 收到 WebSocket 推送事件 msg_type={raw_msg_type} "
            f"content={raw_content[:200]}"
        )
        try:
            from tools.message_normalizer import normalize_feishu_message

            all_bot_ids = {b["app_id"] for b in BOTS.values() if b.get("app_id")}
            bot_name = bot.get("name", "")
            bot_short = bot.get("short_name", "")

            nm = normalize_feishu_message(
                bot_key=bot_key,
                bot_app_id=app_id,
                bot_name=bot_name,
                bot_short_name=bot_short,
                all_bot_app_ids=all_bot_ids,
                raw_event=data,
            )

            # 过滤：Bot 自己的消息（text 为空表示应跳过）
            if not nm.text and not nm.attachment_info:
                logger.info(
                    f"[{bot_key}] 消息被过滤: text='{nm.text}' attachment='{nm.attachment_info}' "
                    f"mentioned={nm.is_mentioned}"
                )
                return

            logger.info(
                f"[{bot_key}] chat={nm.chat_id} msg_id={nm.message_id[:16] if nm.message_id else 'EMPTY'} "
                f"type={nm.msg_type} mentioned={nm.is_mentioned} others={nm.mentioned_names} "
                f"cmd={nm.text[:80] if nm.text else '(empty)'}"
            )

            msg_queue.put({
                "bot_key": bot_key,
                "chat_id": nm.chat_id,
                "message_id": nm.message_id,
                "user_id": nm.sender_id,
                "command": nm.text,
                "is_mentioned": nm.is_mentioned,
                "sender_is_bot": nm.sender_is_bot,
                "mentioned_others": nm.mentioned_names,
                "msg_type": nm.msg_type,
                "content": nm.raw.get("content_str", "{}"),
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
        if stop_event and stop_event.is_set():
            logger.info(f"[{bot_key}] 收到停止信号，子进程退出")
            break
        try:
            logger.info(f"[{bot_key}] WebSocket 连接中 (PID={multiprocessing.current_process().pid})...")
            cli = lark.ws.Client(
                app_id, app_secret,
                event_handler=handler,
                log_level=lark.LogLevel.INFO,
            )
            cli.start()
        except Exception as e:
            if stop_event and stop_event.is_set():
                break
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

        logger.info(
            f"[consumer] 收到队列消息 bot={msg['bot_key']} sender_is_bot={msg.get('sender_is_bot',False)} "
            f"mentioned={msg.get('is_mentioned',True)} cmd={msg['command'][:60]}"
        )

        # 调度到主 event loop，非阻塞——三条消息同时入队，三个协程并发执行
        _asyncio.run_coroutine_threadsafe(
            orchestrator.handle_command(
                msg["bot_key"], msg["chat_id"],
                msg["user_id"], msg["command"],
                msg.get("is_mentioned", True),
                msg.get("mentioned_others", []),
                msg.get("message_id", ""),
                sender_is_bot=msg.get("sender_is_bot", False),
            ),
            main_loop,
        )


def start_all_bots(orchestrator: Any) -> tuple[multiprocessing.Queue, list[multiprocessing.Process], multiprocessing.Event]:
    """启动所有 Bot 的 WebSocket 连接（各独立子进程）+ 消息消费线程。

    Returns:
        (消息队列, 子进程列表, 停止信号)
    """
    msg_queue = multiprocessing.Queue()
    stop_event = multiprocessing.Event()

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
    processes: list[multiprocessing.Process] = []
    for bot_key in ["pm", "fe", "be"]:
        p = multiprocessing.Process(
            target=_run_bot_process,
            args=(bot_key, msg_queue, stop_event),
            name=f"ws-{bot_key}",
            daemon=True,
        )
        p.start()
        processes.append(p)

    logger.info(f"所有 Bot WebSocket 已启动 ({len(processes)} 个子进程)")
    return msg_queue, processes, stop_event
