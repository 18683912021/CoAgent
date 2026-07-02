"""Orchestrator —— 多 Bot 任务调度器"""
import asyncio
import json
import uuid
from dataclasses import dataclass
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Any

from agents.pm import PMAgent
from agents.fe import FEAgent
from agents.be import BEAgent
from tools.feishu_utils import BOTS, send_message

LOGS_DIR = Path(__file__).parent / "logs"
LOGS_DIR.mkdir(parents=True, exist_ok=True)
FAILED_TASKS_LOG = LOGS_DIR / "failed_tasks.jsonl"


class State(Enum):
    IDLE = "idle"
    PLANNING = "planning"
    DISPATCHING = "dispatching"
    FE_RUNNING = "fe_running"
    BE_RUNNING = "be_running"
    MERGING = "merging"
    COMPLETED = "completed"
    FAILED = "failed"


@dataclass
class TaskState:
    task_id: str
    state: State = State.IDLE
    chat_id: str = ""
    initiator_bot: str = ""  # pm / fe / be
    command: str = ""
    prd: str = ""
    fe_task: str = ""
    be_task: str = ""
    fe_result: str = ""
    be_result: str = ""
    fe_retries: int = 0
    be_retries: int = 0
    max_retries: int = 3
    error: str = ""
    created_at: str = ""
    completed_at: str = ""

    def to_dict(self) -> dict:
        return {
            "task_id": self.task_id,
            "state": self.state.value,
            "initiator": self.initiator_bot,
            "command": self.command,
            "error": self.error,
        }


class Orchestrator:
    """多 Bot 任务调度器。

    三类入口：
    - PM Bot 被 @  → PM分析 → 内部调用FE/BE → 各自Bot发言
    - FE Bot 被 @  → 直接执行前端任务 → FE Bot 发言
    - BE Bot 被 @  → 直接执行后端任务 → BE Bot 发言
    """

    def __init__(self):
        self.pm = PMAgent()
        self.fe = FEAgent()
        self.be = BEAgent()
        self._tasks: dict[str, TaskState] = {}

    def _get_bot_config(self, key: str) -> dict:
        """获取 Bot 配置"""
        return BOTS.get(key, {})

    # ── 入口：飞书消息分发 ──────────────────────────────

    async def handle_command(
        self, bot_key: str, chat_id: str, user_id: str, command: str
    ) -> None:
        """根据被 @ 的 Bot 分发任务。

        Args:
            bot_key: 被 @ 的 Bot (pm/fe/be)
            chat_id: 群聊 ID
            user_id: 发送者 ID
            command: 去掉 @Bot 前缀后的指令文本
        """
        if bot_key == "pm":
            await self._route_pm(chat_id, user_id, command)
        elif bot_key == "fe":
            await self._route_single("fe", chat_id, command)
        elif bot_key == "be":
            await self._route_single("be", chat_id, command)
        else:
            await self._notify(chat_id, "unknown", f"未识别的 Bot: {bot_key}")

    # ── PM 入口：Agent @Agent 事件驱动 ────────────────────

    async def _route_pm(self, chat_id: str, user_id: str, command: str) -> None:
        """PM Bot 被 @：分析需求 → 拆分 → @FE @BE 派发任务（事件驱动）"""
        task = TaskState(
            task_id=str(uuid.uuid4())[:8],
            state=State.PLANNING,
            chat_id=chat_id,
            initiator_bot="pm",
            command=command,
            created_at=datetime.now().isoformat(),
        )
        self._tasks[task.task_id] = task

        await self._notify(chat_id, "pm",
            f"收到需求：{command}\n正在分析并生成 PRD..."
        )

        pm_result = self.pm.run(
            f"用户需求：{command}\n请按PRD格式输出完整的需求文档。"
        )

        if not pm_result["success"]:
            task.state = State.FAILED
            task.error = pm_result.get("error") or "PM 分析失败"
            await self._notify(chat_id, "pm", f"PM 分析失败：{task.error}")
            self._log_failure(task)
            return

        task.prd = pm_result["result"]
        task.fe_task, task.be_task = self._filter_and_split(task.prd)

        # PM 在群里发通知（视觉上的 Agent @Agent）
        await self._notify(chat_id, "pm",
            f"PRD 完成，已拆分为前端和后端子任务。\n@FE Bot 请完成前端，@BE Bot 请完成后端。"
        )

        # 内部并行执行 FE/BE（保证可靠）
        task.state = State.FE_RUNNING
        fe_future = self._run_with_retry(self.fe, task.fe_task, "fe", task.task_id)
        be_future = self._run_with_retry(self.be, task.be_task, "be", task.task_id)

        fe_result, be_result = await asyncio.gather(fe_future, be_future)

        task.fe_result = fe_result.get("result", "") if fe_result["success"] else ""
        task.be_result = be_result.get("result", "") if be_result["success"] else ""

        # FE 和 BE 各自用自己 Bot 身份在群里发言
        if task.fe_result:
            await self._notify(chat_id, "fe",
                f"收到 PM 的前端任务，已完成。\n{task.fe_result[:800]}"
                + ("..." if len(task.fe_result) > 800 else "")
            )
        else:
            await self._notify(chat_id, "fe", "前端任务执行失败，请查看日志。")

        if task.be_result:
            await self._notify(chat_id, "be",
                f"收到 PM 的后端任务，已完成。\n{task.be_result[:800]}"
                + ("..." if len(task.be_result) > 800 else "")
            )
        else:
            await self._notify(chat_id, "be", "后端任务执行失败，请查看日志。")

        # 完成
        task.state = State.COMPLETED
        task.completed_at = datetime.now().isoformat()
        self._tasks[task.task_id] = task

        await self._notify(chat_id, "pm",
            f"任务 {task.task_id} 完成。FE/BE 代码已生成。"
        )

    # ── FE/BE 直接入口：单 Agent 任务 ────────────────────

    async def _route_single(self, bot_key: str, chat_id: str, command: str) -> None:
        """FE 或 BE Bot 被直接 @：执行单项任务"""
        agent = self.fe if bot_key == "fe" else self.be

        await self._notify(chat_id, bot_key, f"收到任务，开始处理...")

        result = agent.run(command)

        if result["success"]:
            await self._notify(chat_id, bot_key,
                result["result"][:800]
                + ("..." if len(result["result"]) > 800 else "")
            )
        else:
            await self._notify(chat_id, bot_key,
                f"执行失败：{result.get('error', 'unknown error')}"
            )

    # ── 信息过滤 ─────────────────────────────────────────

    def _filter_and_split(self, prd: str) -> tuple[str, str]:
        """PM 的 PRD → FE 子任务 + BE 子任务（信息过滤）"""
        fe_parts = [
            "以下是你需要完成的前端子任务（仅前端部分）：\n",
            self._extract_section(prd, ["项目概述", "功能需求"]),
            "\n--- 前端任务 ---\n",
            self._extract_section(prd, ["前端任务", "前端"]),
            "\n--- API 接口契约（消费方）---\n",
            self._extract_section(prd, ["API", "接口契约", "接口"]),
        ]
        be_parts = [
            "以下是你需要完成的后端子任务（仅后端部分）：\n",
            self._extract_section(prd, ["项目概述", "功能需求"]),
            "\n--- 后端任务 ---\n",
            self._extract_section(prd, ["后端任务", "后端"]),
            "\n--- API 接口契约（实现方）---\n",
            self._extract_section(prd, ["API", "接口契约", "接口"]),
        ]
        return "\n".join(fe_parts), "\n".join(be_parts)

    def _extract_section(self, text: str, keywords: list[str]) -> str:
        lines = text.split("\n")
        result = []
        capturing = False
        for line in lines:
            stripped = line.strip()
            is_heading = (
                stripped.startswith("#")
                or (stripped and stripped[0].isdigit() and "." in stripped[:4])
            )
            if is_heading:
                capturing = any(kw in stripped for kw in keywords)
            if capturing:
                result.append(line)
        return "\n".join(result) if result else "(此部分未明确，请基于项目概述自行判断)"

    # ── 重试 ─────────────────────────────────────────────

    _RETRY_STRATEGIES = [
        # L0: 正常
        "",
        # L1: 强迫换方案
        "上一次的方法失败了。请换一个完全不同的技术方案重新实现，不要重复同样的错误。",
        # L2: 搜索 + 列出假设
        "又失败了。请先用 search_web 搜索类似问题方案，列出3个可能的失败原因，逐一验证后重新实现。",
        # L3: 5 步强制清单
        "最后一次机会。重新实现前必须完成：(1)读上次失败代码找具体问题 (2)搜索至少2个参考方案 (3)验证前置假设(版本/路径/依赖) (4)换个角度重新设计 (5)完成后自检：能跑通吗？所有状态覆盖了吗？",
    ]

    async def _run_with_retry(
        self, agent: Any, task: str, bot_key: str, task_id: str
    ) -> dict:
        """带分级策略注入的 Agent 执行（对标 PUA L0-L3）"""
        backoff = 1
        max_retries = self._tasks[task_id].max_retries

        for attempt in range(1, max_retries + 2):
            if attempt > 1:
                await asyncio.sleep(backoff)
                backoff *= 2

            # 注入对应级别的策略提示
            si = min(attempt - 1, len(self._RETRY_STRATEGIES) - 1)
            hint = self._RETRY_STRATEGIES[si]
            task_with_hint = f"{task}\n\n[系统提示] {hint}" if hint else task

            result = agent.run(task_with_hint)
            if result["success"]:
                return result

            if attempt <= max_retries:
                level = ["L0","L1","L2","L3"][min(attempt,3)]
                print(f"[{task_id}] {bot_key} {level} 失败 重试{attempt}/{max_retries}")

        self._log_failure(self._tasks[task_id])
        return {"success": False, "result": "", "error": f"{bot_key} 重试耗尽(L0-L3)"}

    # ── 消息发送 ─────────────────────────────────────────

    async def _notify(self, chat_id: str, bot_key: str, text: str, at_users: list[str] | None = None) -> None:
        """用指定 Bot 的身份向群聊发消息。at_users 为要 @ 的用户 ID 列表。"""
        bot = self._get_bot_config(bot_key)
        if not bot.get("app_id"):
            print(f"[orchestrator] {bot_key} Bot 未配置，模拟发送: {text[:80]}...")
            return

        result = await send_message(
            app_id=bot["app_id"],
            app_secret=bot["app_secret"],
            chat_id=chat_id,
            text=text,
            at_users=at_users,
        )
        if not result["success"]:
            print(f"[orchestrator] {bot_key} Bot 发送失败: {result['msg']}")

    # ── 日志 ─────────────────────────────────────────────

    def _log_failure(self, task: TaskState) -> None:
        FAILED_TASKS_LOG.parent.mkdir(parents=True, exist_ok=True)
        with open(FAILED_TASKS_LOG, "a", encoding="utf-8") as f:
            f.write(json.dumps(task.to_dict(), ensure_ascii=False) + "\n")

    def get_task_state(self, task_id: str) -> dict | None:
        task = self._tasks.get(task_id)
        return task.to_dict() if task else None
