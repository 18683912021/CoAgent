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
from tools.feishu_utils import BOTS, send_message, add_reaction, delete_reaction

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
    max_retries: int = 4
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
        self, bot_key: str, chat_id: str, user_id: str, command: str,
        is_mentioned: bool = True,
        mentioned_others: list[str] | None = None,
        message_id: str = "",
    ) -> None:
        """根据被 @ 的 Bot 分发任务。

        Args:
            is_mentioned: 是否被 @。False 时只记录上下文不回复。
            mentioned_others: 同一消息中其他被 @ 的人名列表，用于群呼上下文。
            message_id: 飞书消息 ID，用于 Reaction 打字指示器。
        """
        mentioned_others = mentioned_others or []

        # 不被 @ 的消息：存入该 Bot 的记忆作为上下文，不回复
        if not is_mentioned:
            agent = {"pm": self.pm, "fe": self.fe, "be": self.be}.get(bot_key)
            if agent and command:
                agent._add_to_memory("user", f"[群聊消息] {command}")
            return

        if bot_key == "pm":
            await self._route_pm(chat_id, user_id, command, mentioned_others, message_id)
        elif bot_key == "fe":
            await self._route_single("fe", chat_id, command, mentioned_others, message_id)
        elif bot_key == "be":
            await self._route_single("be", chat_id, command, mentioned_others, message_id)
        else:
            await self._notify(chat_id, "unknown", f"未识别的 Bot: {bot_key}")

    # ── PM 入口 ─────────────────────────────────────────

    def _build_social_context(self, command: str, mentioned_others: list[str]) -> str:
        """构建群呼上下文。当用户同时 @ 多人时，帮 Agent 理解这是社交招呼而非工作指派。"""
        if not mentioned_others:
            return command

        names = "、".join(mentioned_others)
        return (
            f"[群呼上下文] 用户同时 @ 了你和 {names}——"
            f"就像生活中同时叫了几个人的名字。被叫到就自然应一声，不是给你派活。"
            f"**你只代表你自己，不要替别人回答**（比如不要说'{names}也在'——他们自己会回应）。"
            f"用户说的是：「{command}」"
        )

    # ── 意图预分类 ─────────────────────────────────────

    _WORK_KEYWORDS = [
        "做", "写", "开发", "设计", "实现", "创建", "生成",
        "帮我", "给我", "写个", "做个", "开发个", "实现个",
        "改", "修", "加", "添加", "增加", "删除", "去掉",
        "build", "create", "make", "develop", "implement",
        "重构", "优化", "部署", "上线", "测试",
    ]

    def _classify_intent(self, command: str) -> str:
        """轻量级意图分类：chat 还是 work。省 token，避免闲聊跑完整 pipeline。"""
        cmd = command.lower()
        # 太短的消息默认为闲聊
        if len(command.strip()) < 6:
            return "chat"
        # 检查工作关键词
        for kw in self._WORK_KEYWORDS:
            if kw in cmd:
                return "work"
        return "chat"

    # ── 打字指示器 ─────────────────────────────────────

    async def _show_typing(self, bot_key: str, message_id: str) -> tuple[asyncio.Task | None, str]:
        """在用户消息上添加 ✍️ Reaction + 每 6s 刷新，模拟"正在输入"动画。

        Returns:
            (typing_task, initial_reaction_id)。调用方在完成后 set stop_event + await task。
        """
        if not message_id:
            return None, ""

        bot = self._get_bot_config(bot_key)
        app_id = bot.get("app_id", "")
        app_secret = bot.get("app_secret", "")
        if not app_id:
            return None, ""

        # 立即添加第一个 reaction
        result = await add_reaction(app_id, app_secret, message_id, "WRITING_HAND")
        if not result["success"]:
            return None, ""

        reaction_id = result["reaction_id"]
        stop_event = asyncio.Event()

        async def refresh_loop():
            nonlocal reaction_id
            while not stop_event.is_set():
                try:
                    await asyncio.wait_for(stop_event.wait(), timeout=6)
                except asyncio.TimeoutError:
                    pass
                if stop_event.is_set():
                    break
                # 删除旧的，添加新的
                if reaction_id:
                    await delete_reaction(app_id, app_secret, message_id, reaction_id)
                r = await add_reaction(app_id, app_secret, message_id, "WRITING_HAND")
                if r["success"]:
                    reaction_id = r["reaction_id"]

        typing_task = asyncio.create_task(refresh_loop())
        return typing_task, reaction_id

    async def _hide_typing(self, bot_key: str, message_id: str,
                           typing_task: asyncio.Task | None, reaction_id: str) -> None:
        """停止 typing indicator：取消刷新循环并删除最后的 reaction。"""
        if typing_task and not typing_task.done():
            typing_task.cancel()
            try:
                await typing_task
            except asyncio.CancelledError:
                pass

        if reaction_id and message_id:
            bot = self._get_bot_config(bot_key)
            await delete_reaction(bot.get("app_id", ""), bot.get("app_secret", ""),
                                  message_id, reaction_id)

    async def _route_pm(self, chat_id: str, user_id: str, command: str,
                        mentioned_others: list[str] | None = None,
                        message_id: str = "") -> None:
        """PM Bot 被 @"""
        mentioned_others = mentioned_others or []

        # 空消息：被叫到名字，自然应一声（只代表自己）
        if not command or not command.strip():
            await self._notify(chat_id, "pm", "嗯？")
            return

        # ── 打字指示器：在用户消息上加 ✍️ Reaction，每 6s 刷新 ──
        typing_task, reaction_id = await self._show_typing("pm", message_id)

        # 注入群呼上下文
        full_command = self._build_social_context(command, mentioned_others)

        # ── 意图预分类：闲聊用短 token，工作用完整 pipeline ──
        intent = self._classify_intent(command)
        max_tokens = 512 if intent == "chat" else 4096

        # ── 交给 LLM ──
        task = TaskState(
            task_id=str(uuid.uuid4())[:8],
            state=State.PLANNING,
            chat_id=chat_id,
            initiator_bot="pm",
            command=command,
            created_at=datetime.now().isoformat(),
        )
        self._tasks[task.task_id] = task

        pm_result = self.pm.run(full_command, max_tokens=max_tokens)

        # ── 停止打字指示器 ──
        await self._hide_typing("pm", message_id, typing_task, reaction_id)

        if not pm_result["success"]:
            task.state = State.FAILED
            task.error = pm_result.get("error") or "PM 分析失败"
            await self._notify(chat_id, "pm", f"分析失败：{task.error}")
            self._log_failure(task)
            return

        task.prd = pm_result["result"]

        # PM 的回复先发到群里（聊天回复 or PRD）
        await self._notify(chat_id, "pm", task.prd[:800] + ("..." if len(task.prd) > 800 else ""))

        # 如果 PM 回复是聊天（短回复，不含 PRD 结构），不触发 FE/BE
        if len(task.prd) < 200 and "##" not in task.prd:
            task.state = State.COMPLETED
            task.completed_at = datetime.now().isoformat()
            return

        # 验证 PRD 有效性：多信号检测空 PRD
        _empty_prd_signals = [
            "此部分未明确", "待确认", "未提供", "需求不完整", "信息不足",
            "无法定义", "缺失", "需要更多", "请提供", "请确认",
            "不好意思", "抱歉", "无法进行",
        ]
        prd_empty = all(s in task.prd for s in ["前端任务", "后端任务"]) and \
                    any(s in task.prd for s in _empty_prd_signals) and \
                    len(task.prd) < 500
        if prd_empty:
            await self._notify(chat_id, "pm",
                f"这个需求信息不够出 PRD。告诉我具体想做什么产品、有什么功能，我就能开工。"
            )
            task.state = State.FAILED
            task.error = "PRD 为空（需求信息不足）"
            self._log_failure(task)
            return

        task.fe_task, task.be_task = self._filter_and_split(task.prd)

        # 内部并行执行 FE/BE
        task.state = State.FE_RUNNING
        fe_future = self._run_with_retry(self.fe, task.fe_task, "fe", task.task_id)
        be_future = self._run_with_retry(self.be, task.be_task, "be", task.task_id)

        fe_result, be_result = await asyncio.gather(fe_future, be_future)

        task.fe_result = fe_result.get("result", "") if fe_result["success"] else ""
        task.be_result = be_result.get("result", "") if be_result["success"] else ""

        # ── 验证产出有效性 ──
        _empty_signals = ["此部分未明确", "工作区是空的", "我无法", "workspace is empty",
                          "没有 PRD", "没有需求", "无法自行判断", "无法凭空"]

        fe_valid = task.fe_result and not any(s in task.fe_result for s in _empty_signals)
        be_valid = task.be_result and not any(s in task.be_result for s in _empty_signals)

        # FE 和 BE 各自用自己 Bot 身份在群里发言
        if fe_valid:
            await self._notify(chat_id, "fe",
                task.fe_result[:800] + ("..." if len(task.fe_result) > 800 else "")
                + ("..." if len(task.fe_result) > 800 else "")
            )
        else:
            await self._notify(chat_id, "fe",
                "PRD 信息不够，写不了代码。让小吴补充一下具体功能。"
            )

        if be_valid:
            await self._notify(chat_id, "be",
                task.be_result[:800] + ("..." if len(task.be_result) > 800 else "")
                + ("..." if len(task.be_result) > 800 else "")
            )
        else:
            await self._notify(chat_id, "be",
                "PM 分配的后端任务信息不足，无法开始开发。请 PM 提供具体的功能描述。"
            )

        task.state = State.COMPLETED
        task.completed_at = datetime.now().isoformat()
        self._tasks[task.task_id] = task

    # ── FE/BE 直接入口：单 Agent 任务 ────────────────────

    async def _route_single(self, bot_key: str, chat_id: str, command: str,
                            mentioned_others: list[str] | None = None,
                            message_id: str = "") -> None:
        """FE 或 BE Bot 被 @"""
        mentioned_others = mentioned_others or []

        if not command or not command.strip():
            await self._notify(chat_id, bot_key, "嗯？")
            return

        # ── 打字指示器：在用户消息上加 ✍️ Reaction ──
        typing_task, reaction_id = await self._show_typing(bot_key, message_id)

        agent = self.fe if bot_key == "fe" else self.be

        # 注入群呼上下文
        full_command = self._build_social_context(command, mentioned_others)

        # ── 意图预分类 ──
        intent = self._classify_intent(command)
        max_tokens = 512 if intent == "chat" else 4096

        # 不强制加"收到任务"，让 Agent 自己判断是聊天还是工作
        result = agent.run(full_command, max_tokens=max_tokens)

        # ── 停止打字指示器 ──
        await self._hide_typing(bot_key, message_id, typing_task, reaction_id)

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
        # L0: 正常执行
        "",
        # L1: 换方案
        "[PUA L1] 上一次的方法失败了。底层逻辑有问题？换个本质不同的方案。不要重复同样的错误。",
        # L2: 搜索 + 3 假设
        "[PUA L2] 又失败了。你的抓手在哪？(1)用 search_web 搜索类似方案 (2)列出3个本质不同的假设 (3)逐一验证后重新实现。",
        # L3: 7 项强制清单
        "[PUA L3 361考核] 慎重考虑，决定给你3.25。这是对你的鞭策不是否定。重新实现前必须完成7项检查：(1)逐字读完失败信息 (2)search_web搜索 (3)read_file读上下文50行 (4)验证前置假设(版本/路径/依赖) (5)反转假设试相反方向 (6)最小隔离复现 (7)换工具/方法/角度。完成后自检：能跑通吗？所有状态覆盖了吗？冰山法则：修一个查一类。",
        # L4: 毕业警告
        "[PUA L4 毕业警告] 别的Agent都能解决。你可能就要毕业了。拼命模式：最小PoC + 隔离环境 + 完全不同技术栈。删掉所有不必要的东西。Ship or die.",
    ]

    # 失败模式关键词
    _SPINNING_SIGNALS = ["重试", "retry", "再次尝试", "同一方法", "same approach"]
    _BLAMING_SIGNALS = ["环境问题", "可能是", "environment", "maybe", "perhaps"]
    _HOLLOW_SIGNALS = ["已完成", "完成了", "done", "fixed", "已修复"]

    async def _run_with_retry(
        self, agent: Any, task: str, bot_key: str, task_id: str
    ) -> dict:
        """带分级策略注入+失败模式检测+突破奖励的 Agent 执行"""
        backoff = 1
        max_retries = self._tasks[task_id].max_retries
        last_error = ""

        for attempt in range(1, max_retries + 2):
            if attempt > 1:
                await asyncio.sleep(backoff)
                backoff *= 2

            # 失败模式检测
            pattern_hint = ""
            if attempt >= 3 and last_error:
                if any(s in last_error.lower() for s in self._SPINNING_SIGNALS):
                    pattern_hint = "[模式: 原地打转 SPINNING] 你在重复同一方法。强制换本质不同的方案。"
                elif any(s in last_error.lower() for s in self._BLAMING_SIGNALS):
                    pattern_hint = "[模式: 甩锅推脱 BLAMING] 归因必须用工具验证。未验证的归因=甩锅。"

            # 注入策略
            si = min(attempt - 1, len(self._RETRY_STRATEGIES) - 1)
            hint = self._RETRY_STRATEGIES[si]
            full_hint = f"{pattern_hint}\n{hint}".strip() if pattern_hint else hint
            task_with_hint = f"{task}\n\n[系统提示] {full_hint}" if full_hint else task

            result = agent.run(task_with_hint)
            if result["success"]:
                # 突破奖励：L2+ 成功后降压认可
                if attempt >= 3:
                    reward = f"[PUA 突破] L{min(attempt-1,4)} 后成功。压力归零。这次闭环了。根因和方法沉淀到 MEMORY.md。"
                    self.pm._add_to_memory("system", reward)
                return result

            last_error = result.get("error", "") or result.get("result", "")
            if attempt <= max_retries:
                level = ["L0","L1","L2","L3","L4"][min(attempt,4)]
                print(f"[{task_id}] {bot_key} {level} 失败 重试{attempt}/{max_retries}")

        self._log_failure(self._tasks[task_id])
        return {"success": False, "result": "", "error": f"{bot_key} 重试耗尽(L0-L3)"}

    # ── 消息发送 ─────────────────────────────────────────

    async def _notify(self, chat_id: str, bot_key: str, text: str, at_users: list[str] | None = None) -> None:
        """用指定 Bot 的身份向群聊发消息。at_users 为要 @ 的用户 ID 列表。

        自动检测文本中的 @队友名（小柯/酱瓜/小吴）并转换为飞书 <at> 标签。
        """
        bot = self._get_bot_config(bot_key)
        if not bot.get("app_id"):
            print(f"[orchestrator] {bot_key} Bot 未配置，模拟发送: {text[:80]}...")
            return

        # ── 自动检测文本中的 @队友名，转为真正的 @mention ──
        _NAME_TO_BOT_KEY = {
            "小柯": "fe", "柯": "fe",
            "酱瓜": "be", "瓜": "be",
            "小吴": "pm", "吴": "pm",
        }
        auto_at = list(at_users) if at_users else []
        for name, key in _NAME_TO_BOT_KEY.items():
            if f"@{name}" in text and key != bot_key:  # 不 @自己
                target_bot = BOTS.get(key, {})
                target_id = target_bot.get("app_id", "")
                if target_id and target_id not in auto_at:
                    auto_at.append(target_id)

        result = await send_message(
            app_id=bot["app_id"],
            app_secret=bot["app_secret"],
            chat_id=chat_id,
            text=text,
            at_users=auto_at if auto_at else None,
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
