"""Orchestrator —— 任务调度器，管理三 Agent 协作流程"""
import asyncio
import json
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Any

from agents.pm import PMAgent
from agents.fe import FEAgent
from agents.be import BEAgent
from tools.feishu import send_feishu_message

# 日志目录
LOGS_DIR = Path(__file__).parent / "logs"
LOGS_DIR.mkdir(parents=True, exist_ok=True)
FAILED_TASKS_LOG = LOGS_DIR / "failed_tasks.jsonl"


class State(Enum):
    """任务状态枚举"""
    IDLE = "idle"
    PLANNING = "planning"           # PM 分析中
    WAITING_USER = "waiting_user"   # 需用户补充信息
    DISPATCHING = "dispatching"     # 分发子任务
    FE_RUNNING = "fe_running"
    BE_RUNNING = "be_running"
    FE_RETRYING = "fe_retrying"
    BE_RETRYING = "be_retrying"
    MERGING = "merging"
    COMPLETED = "completed"
    FAILED = "failed"


@dataclass
class TaskState:
    """任务实例状态"""
    task_id: str
    state: State = State.IDLE
    chat_id: str = ""
    user_id: str = ""
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
            "command": self.command,
            "error": self.error,
            "created_at": self.created_at,
            "completed_at": self.completed_at,
        }


class Orchestrator:
    """任务调度器。

    职责：
    1. 接收飞书命令 → PM Agent 分析需求
    2. PM 产出 PRD → 信息过滤 → 拆分为 FE/BE 子任务
    3. 并行派发 FE/BE Agent
    4. 收集结果、重试、熔断、通知
    """

    def __init__(self):
        self.pm = PMAgent()
        self.fe = FEAgent()
        self.be = BEAgent()
        self._tasks: dict[str, TaskState] = {}

    # ── 入口 ────────────────────────────────────────────

    async def handle_command(self, chat_id: str, user_id: str, command: str) -> str:
        """处理飞书命令的主入口。

        Returns:
            结果消息文本（发送到飞书）
        """
        task = TaskState(
            task_id=str(uuid.uuid4())[:8],
            state=State.PLANNING,
            chat_id=chat_id,
            user_id=user_id,
            command=command,
            created_at=datetime.now().isoformat(),
        )
        self._tasks[task.task_id] = task

        await self._notify(chat_id, f"[任务 {task.task_id}] 收到指令：{command}\nPM Agent 正在分析需求...")

        # ── Phase 1: PM 分析 ──
        task.state = State.PLANNING
        pm_result = self.pm.run(
            f"用户需求：{command}\n请分析需求，按PRD格式输出。如果需要更多信息，请明确提问。"
        )

        if not pm_result["success"]:
            task.state = State.FAILED
            task.error = pm_result["error"] or "PM Agent 分析失败"
            await self._notify(chat_id, f"[任务 {task.task_id}] PM 分析失败：{task.error}")
            self._log_failure(task)
            return f"任务失败：{task.error}"

        task.prd = pm_result["result"]

        # 检查是否需要追问用户
        if self._needs_clarification(task.prd):
            task.state = State.WAITING_USER
            await self._notify(chat_id, f"[任务 {task.task_id}] PM 需要更多信息：\n{task.prd}")
            return "需要用户补充信息，请查看飞书消息。"

        # ── Phase 2: 信息过滤 + 任务拆分 ──
        task.state = State.DISPATCHING
        task.fe_task, task.be_task = self._filter_and_split(task.prd)

        await self._notify(chat_id, f"[任务 {task.task_id}] PRD 完成，FE/BE Agent 并行开发中...")

        # ── Phase 3: 并行执行 FE/BE ──
        task.state = State.FE_RUNNING
        fe_state = State.FE_RUNNING
        be_state = State.BE_RUNNING

        fe_future = self._run_with_retry(
            self.fe, task.fe_task, "FE", task.task_id
        )
        be_future = self._run_with_retry(
            self.be, task.be_task, "BE", task.task_id
        )

        fe_result, be_result = await asyncio.gather(fe_future, be_future)

        task.fe_result = fe_result.get("result", "") if fe_result["success"] else ""
        task.be_result = be_result.get("result", "") if be_result["success"] else ""

        # ── Phase 4: 合并 ──
        task.state = State.MERGING
        summary = self._build_summary(task)
        task.state = State.COMPLETED
        task.completed_at = datetime.now().isoformat()

        await self._notify(chat_id, summary)
        return summary

    # ── 信息过滤 ─────────────────────────────────────────

    def _needs_clarification(self, prd: str) -> bool:
        """判断 PM 输出是否需要追问用户（简单启发式）"""
        lines = prd.strip().split("\n")
        # 如果前几行包含问号或"请确认"/"请问"，认为需要追问
        head = "\n".join(lines[:5])
        return ("?" in head or "？" in head or
                "请确认" in head or "请问" in head or
                "需要更多" in head or "不明确" in head)

    def _filter_and_split(self, prd: str) -> tuple[str, str]:
        """将 PM 的完整 PRD 拆分为 FE 子任务和 BE 子任务。

        信息过滤原则：
        - FE 收到：项目概述 + 前端任务 + API 契约（接口签名，不含实现细节）
        - BE 收到：项目概述 + 后端任务 + API 契约（接口签名，含数据模型要求）
        - FE/BE 不互相看到对方的任务细节
        """
        fe_parts = [
            "以下是你需要完成的前端子任务。你只需要关注前端部分。\n",
            self._extract_section(prd, ["项目概述", "功能需求"]),
            "\n--- 前端任务 ---\n",
            self._extract_section(prd, ["前端任务", "前端"]),
            "\n--- API 接口契约（你只需要消费这些接口）---\n",
            self._extract_section(prd, ["API", "接口契约", "接口"]),
        ]

        be_parts = [
            "以下是你需要完成的后端子任务。你只需要关注后端部分。\n",
            self._extract_section(prd, ["项目概述", "功能需求"]),
            "\n--- 后端任务 ---\n",
            self._extract_section(prd, ["后端任务", "后端"]),
            "\n--- API 接口契约（你必须实现这些接口）---\n",
            self._extract_section(prd, ["API", "接口契约", "接口"]),
        ]

        return "\n".join(fe_parts), "\n".join(be_parts)

    def _extract_section(self, text: str, keywords: list[str]) -> str:
        """从 PRD 中提取相关章节（简单实现）"""
        lines = text.split("\n")
        result = []
        capturing = False

        for line in lines:
            stripped = line.strip()
            # 检测标题行（以数字或 ## 开头）
            is_heading = (stripped.startswith("#") or
                         (stripped and stripped[0].isdigit() and "." in stripped[:4]))

            if is_heading:
                capturing = any(kw in stripped for kw in keywords)
            if capturing:
                result.append(line)

        return "\n".join(result) if result else "(PRD 中未明确此部分，请基于项目概述自行判断)"

    # ── 重试与执行 ──────────────────────────────────────

    async def _run_with_retry(
        self,
        agent: Any,
        task_description: str,
        agent_name: str,
        task_id: str,
    ) -> dict:
        """执行 Agent 任务，带指数退避重试"""
        backoff = 1  # 秒

        for attempt in range(1, self._tasks[task_id].max_retries + 2):
            if attempt > 1:
                await asyncio.sleep(backoff)
                backoff *= 2

            result = agent.run(task_description)

            if result["success"]:
                return result

            # 重试前记录
            if attempt <= self._tasks[task_id].max_retries:
                print(f"[{task_id}] {agent_name} 第 {attempt} 次失败，{backoff}s 后重试: {result.get('error')}")

        # 全部失败
        self._log_failure(self._tasks[task_id])
        return {"success": False, "result": "", "error": f"{agent_name} 重试耗尽"}

    # ── 结果汇总 ────────────────────────────────────────

    def _build_summary(self, task: TaskState) -> str:
        """构建任务完成摘要"""
        lines = [
            f"[任务 {task.task_id}] 完成",
            f"",
            f"--- PRD ---",
            task.prd[:500] + ("..." if len(task.prd) > 500 else ""),
            f"",
            f"--- 前端产出 (workspace/fe/) ---",
            task.fe_result[:300] + ("..." if len(task.fe_result) > 300 else "") if task.fe_result else "(无)",
            f"",
            f"--- 后端产出 (workspace/be/) ---",
            task.be_result[:300] + ("..." if len(task.be_result) > 300 else "") if task.be_result else "(无)",
        ]
        return "\n".join(lines)

    # ── 辅助 ────────────────────────────────────────────

    async def _notify(self, chat_id: str, text: str) -> None:
        """发送飞书通知（失败不阻塞主流程）"""
        try:
            await send_feishu_message(chat_id, text)
        except Exception as e:
            print(f"[Orchestrator] 飞书通知失败: {e}")

    def _log_failure(self, task: TaskState) -> None:
        """失败任务写入日志"""
        FAILED_TASKS_LOG.parent.mkdir(parents=True, exist_ok=True)
        with open(FAILED_TASKS_LOG, "a", encoding="utf-8") as f:
            f.write(json.dumps(task.to_dict(), ensure_ascii=False) + "\n")

    def get_task_state(self, task_id: str) -> dict | None:
        """查询任务状态"""
        task = self._tasks.get(task_id)
        return task.to_dict() if task else None
