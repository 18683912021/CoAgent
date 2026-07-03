"""Orchestrator —— 多 Bot 任务调度器（路由/社交上下文/共享状态/消息发送）"""
import asyncio
import uuid
from dataclasses import dataclass
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Any

from agents.pm import PMAgent
from agents.fe import FEAgent
from agents.be import BEAgent
from agents.base import AGENT_TIMEOUT
from task_runner import (
    TaskRunner, CHAT_TIMEOUT, WORK_TIMEOUT, PM_TIMEOUT, RETRY_TIMEOUT,
)
from monitor import metrics, log_event

from tools.feishu_utils import BOTS, send_message, add_reaction, delete_reaction

SHARED_DIR = Path(__file__).parent / "workspace" / "shared"
SHARED_DIR.mkdir(parents=True, exist_ok=True)


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
        self.runner = TaskRunner()
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

    # ── 共享上下文文件操作 ─────────────────────────────

    def _write_api_contract(self, prd: str) -> None:
        """从 PRD 中提取 API 契约部分，写入共享目录。"""
        api_section = self._extract_section(prd, ["API", "接口契约", "接口"])
        if "此部分未明确" in api_section:
            return  # PRD 中无 API 契约，不写

        contract_path = SHARED_DIR / "API_CONTRACT.md"
        contract_path.write_text(
            f"# API 契约\n\n> 自动提取自 PM 的最新 PRD。FE 消费方 / BE 实现方，以此为准。\n\n{api_section}",
            encoding="utf-8",
        )

    def _update_status(self, bot_key: str, status: str, output_summary: str = "") -> None:
        """更新共享任务状态表。"""
        from datetime import datetime as dt
        status_path = SHARED_DIR / "STATUS.md"
        label = {"pm": "PM", "fe": "FE", "be": "BE"}.get(bot_key, bot_key)
        summary = output_summary[:80] if output_summary else "-"

        status_path.write_text(
            f"# 任务状态\n\n"
            f"> 每个 Agent 完成后自动更新。所有人读此文件了解进度。\n\n"
            f"| Agent | 状态 | 最近产出 | 更新时间 |\n"
            f"|-------|------|---------|----------|\n"
            f"| PM | {'工作中' if bot_key == 'pm' else '空闲'} | "
            f"{summary if bot_key == 'pm' else '-'} | "
            f"{dt.now().strftime('%H:%M') if bot_key == 'pm' else '-'} |\n"
            f"| FE | {'工作中' if bot_key == 'fe' else '空闲'} | "
            f"{summary if bot_key == 'fe' else '-'} | "
            f"{dt.now().strftime('%H:%M') if bot_key == 'fe' else '-'} |\n"
            f"| BE | {'工作中' if bot_key == 'be' else '空闲'} | "
            f"{summary if bot_key == 'be' else '-'} | "
            f"{dt.now().strftime('%H:%M') if bot_key == 'be' else '-'} |\n",
            encoding="utf-8",
        )

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

    # ── Agent 间委派 ────────────────────────────────────

    _HANDOFF_KEYWORDS = [
        # 动作词
        "加", "改", "修", "做", "写", "补充", "更新", "删", "增加", "添加",
        "加个", "改下", "修下", "做个", "写个", "删掉", "实现",
        # 调整/完善
        "完善", "升级", "调整", "修改", "修复", "重构",
        # 新增/扩展
        "新增", "扩展", "封装", "拆分", "合并", "替换", "迁移",
        # 请求
        "帮忙", "需要", "能不能", "帮我", "请", "麻烦",
        "加一下", "改一下", "弄一下", "看一下", "处理一下",
        # 确认
        "确认", "检查", "核对",
        # 英文
        "please", "need to", "should", "fix", "update", "add",
    ]
    _NAME_TO_BOT = {
        "小柯": "fe", "柯": "fe", "柯柯": "fe", "前端": "fe", "FE": "fe",
        "酱瓜": "be", "瓜": "be", "瓜瓜": "be", "后端": "be", "BE": "be",
        "小吴": "pm", "吴": "pm", "吴吴": "pm", "PM": "pm", "产品经理": "pm",
    }

    def _detect_handoff(self, text: str, source_key: str) -> list[dict]:
        """检测回复中是否有对队友的可执行委派（@队友 + 行动词）。

        例如 FE 说 "@酱瓜 需要加个 /api/avatar 接口" → 自动委派给 BE。

        Returns:
            [{"target": "be", "command": "需要加个 /api/avatar 接口"}, ...]
        """
        handoffs: list[dict] = []
        for name, target_key in self._NAME_TO_BOT.items():
            if target_key == source_key:
                continue  # 不给自己派活
            idx = text.find(f"@{name}")
            if idx == -1:
                continue
            # 提取 @name 附近的文本作为任务描述
            snippet = text[max(0, idx - 10):idx + 200].strip()
            # 去掉 @name 本身
            snippet = snippet.replace(f"@{name}", "", 1).strip()
            # 检查是否有行动关键词
            has_action = any(kw in snippet for kw in self._HANDOFF_KEYWORDS)
            if has_action and len(snippet) > 3:
                handoffs.append({
                    "target": target_key,
                    "command": snippet,
                    "caller_name": {"fe": "小柯", "be": "酱瓜", "pm": "小吴"}.get(source_key, source_key),
                })
        return handoffs

    async def _dispatch_handoffs(self, chat_id: str, text: str, source_key: str,
                                  message_id: str = "") -> None:
        """执行跨 Agent 委派：检测到 actionable @mention 后，异步委派给目标 Agent。

        只触发一级委派（被委派的 Agent 回复中的 @mention 不再触发委派），防止死循环。
        """
        handoffs = self._detect_handoff(text, source_key)
        for h in handoffs:
            caller = h["caller_name"]
            command = f"[来自 {caller} 的委派] {h['command']}"
            # 异步后台执行，不阻塞当前回复。allow_handoff=False 防死循环
            asyncio.create_task(
                self._route_single(h["target"], chat_id, command,
                    mentioned_others=[], message_id=message_id, allow_handoff=False)
            )

    # ── 意图预分类 ─────────────────────────────────────

    _WORK_KEYWORDS = [
        # 中文 — 写代码
        "做", "写", "开发", "设计", "实现", "创建", "生成",
        "帮我", "给我", "写个", "做个", "开发个", "实现个",
        "改", "修", "加", "添加", "增加", "删除", "去掉",
        "搭建", "新建", "初始化", "构建", "配置", "安装", "集成",
        "脚手架", "模板", "样板", "框架",
        # 中文 — 修改/调整
        "调整", "修改", "完善", "升级", "迁移", "扩展", "封装",
        "抽象", "拆分", "合并", "替换", "接入", "对接", "联调",
        "调试", "排查", "定位", "修复", "优化",
        # 中文 — 部署/运维
        "部署", "上线", "发布", "回滚", "重启",
        # 中文 — 通用
        "搞", "弄", "整", "重构", "测试",
        # 英文
        "build", "create", "make", "develop", "implement",
        "setup", "scaffold", "init", "deploy", "fix", "update",
        "remove", "enhance", "upgrade", "refactor",
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

    # ── 进度通知 ───────────────────────────────────────

    async def _notify_progress(self, chat_id: str, bot_key: str, text: str) -> None:
        """发送轻量进度通知——让用户知道系统在干什么，不盯 ✍️ 干等。"""
        await self._notify(chat_id, bot_key, f"🔄 {text}")

    # ── 打字指示器 ─────────────────────────────────────

    async def _show_typing(self, bot_key: str, message_id: str,
                           chat_id: str = "") -> tuple[asyncio.Task | None, str]:
        """在用户消息上添加 ✍️ Reaction + 每 6s 刷新，模拟"正在输入"动画。

        message_id 为空时，发送文字"正在输入..."作为兜底。
        Returns:
            (typing_task, initial_reaction_id)
        """
        bot = self._get_bot_config(bot_key)
        app_id = bot.get("app_id", "")
        app_secret = bot.get("app_secret", "")

        # ── 兜底：没有 message_id 时，发文字"正在输入..." ──
        if not message_id or not app_id:
            if chat_id:
                await self._notify(chat_id, bot_key, "正在输入...")
            return None, ""

        # ── 正常路径：Reaction ✍️ ──
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
        typing_task, reaction_id = await self._show_typing("pm", message_id, chat_id)

        # 注入群呼上下文
        full_command = self._build_social_context(command, mentioned_others)

        # ── 意图预分类：闲聊用短 token，工作用完整 pipeline ──
        intent = self._classify_intent(command)
        max_tokens = 512 if intent == "chat" else 4096
        timeout = CHAT_TIMEOUT if intent == "chat" else PM_TIMEOUT

        # ── 状态机检查 ──
        task = TaskState(
            task_id=str(uuid.uuid4())[:8],
            state=State.PLANNING,
            chat_id=chat_id,
            initiator_bot="pm",
            command=command,
            created_at=datetime.now().isoformat(),
        )
        self._tasks[task.task_id] = task
        metrics.task_started()
        start_ts = datetime.now()

        # ── LLM 调用（带超时保护）──
        pm_result = await self.runner.run_with_timeout(
            self.pm, full_command, max_tokens=max_tokens, timeout=timeout,
        )

        # ── 停止打字指示器 ──
        await self._hide_typing("pm", message_id, typing_task, reaction_id)

        if not pm_result["success"]:
            task.state = State.FAILED
            task.error = pm_result.get("error") or "PM 分析失败"
            await self._notify(chat_id, "pm", f"分析失败：{task.error}")
            self.runner._log_failure(task.task_id, "pm", task.error)
            metrics.task_failed()
            if pm_result.get("timed_out"):
                metrics.task_timed_out()
            log_event("ERROR", "pm_task_failed", task_id=task.task_id, error=task.error[:80])
            return

        task.prd = pm_result["result"]

        # PM 的回复先发到群里（聊天回复 or PRD）
        await self._notify(chat_id, "pm", task.prd)

        # 如果 PM 回复是聊天（短回复，不含 PRD 结构），不触发 FE/BE
        if len(task.prd) < 200 and "##" not in task.prd:
            task.state = State.COMPLETED
            task.completed_at = datetime.now().isoformat()
            return

        # 验证 PRD 有效性
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
            self.runner._log_failure(task.task_id, "pm", task.error)
            return

        # ── 写入共享上下文 + 拆分任务 ──
        self._write_api_contract(task.prd)
        task.fe_task, task.be_task = self._filter_and_split(task.prd)

        # ── 状态转换：PLANNING → DISPATCHING → FE/BE_RUNNING ──
        task.state = State.DISPATCHING

        # 进度通知
        await self._notify_progress(chat_id, "pm", "需求分析完成，小柯和酱瓜开始并行开发...")

        # 快照 workspace
        fe_snapshot = self.runner.snapshot_workspace("fe")
        be_snapshot = self.runner.snapshot_workspace("be")

        # 并行执行 FE/BE（带超时 + 重试）
        task.state = State.FE_RUNNING
        fe_future = self.runner.run_with_retry(self.fe, task.fe_task, "fe", task.task_id)
        be_future = self.runner.run_with_retry(self.be, task.be_task, "be", task.task_id)
        fe_result, be_result = await asyncio.gather(fe_future, be_future)

        # 统一产出验证
        task.fe_result, fe_valid = self.runner.validate_output("fe", fe_result, fe_snapshot)
        task.be_result, be_valid = self.runner.validate_output("be", be_result, be_snapshot)

        # 进度通知
        status_parts = []
        if fe_valid: status_parts.append("前端✅")
        else: status_parts.append("前端❌")
        if be_valid: status_parts.append("后端✅")
        else: status_parts.append("后端❌")
        await self._notify_progress(chat_id, "pm", f"开发完成：{' '.join(status_parts)}")

        # ── 更新共享状态 ──
        self._update_status("fe", "完成" if fe_valid else "失败",
            task.fe_result[:80] if fe_valid else "产出无效")
        self._update_status("be", "完成" if be_valid else "失败",
            task.be_result[:80] if be_valid else "产出无效")

        # FE 和 BE 各自用自己 Bot 身份在群里发言
        if fe_valid:
            await self._notify(chat_id, "fe", task.fe_result)
        else:
            await self._notify(chat_id, "fe",
                "PRD 信息不够，写不了代码。让小吴补充一下具体功能。"
            )

        if be_valid:
            await self._notify(chat_id, "be", task.be_result)
        else:
            await self._notify(chat_id, "be",
                "PM 分配的后端任务信息不足，无法开始开发。请 PM 提供具体的功能描述。"
            )

        # ── 跨 Agent 委派：FE/BE 回复中如果 @队友+行动词，自动递任务 ──
        if fe_valid:
            await self._dispatch_handoffs(chat_id, task.fe_result, "fe", message_id)
        if be_valid:
            await self._dispatch_handoffs(chat_id, task.be_result, "be", message_id)

        task.state = State.COMPLETED
        task.completed_at = datetime.now().isoformat()
        self._tasks[task.task_id] = task
        metrics.task_succeeded()
        metrics.record_response_time((datetime.now() - start_ts).total_seconds())
        log_event("INFO", "pm_task_complete",
            task_id=task.task_id, intent=intent,
            fe_valid=fe_valid, be_valid=be_valid)

    # ── FE/BE 直接入口：单 Agent 任务 ────────────────────

    async def _route_single(self, bot_key: str, chat_id: str, command: str,
                            mentioned_others: list[str] | None = None,
                            message_id: str = "",
                            allow_handoff: bool = True) -> None:
        """FE 或 BE Bot 被 @"""
        mentioned_others = mentioned_others or []

        if not command or not command.strip():
            await self._notify(chat_id, bot_key, "嗯？")
            return

        # ── 打字指示器 ──
        typing_task, reaction_id = await self._show_typing(bot_key, message_id, chat_id)

        agent = self.fe if bot_key == "fe" else self.be

        # 注入群呼上下文
        full_command = self._build_social_context(command, mentioned_others)

        # ── 意图预分类 ──
        intent = self._classify_intent(command)
        max_tokens = 512 if intent == "chat" else 4096
        timeout = CHAT_TIMEOUT if intent == "chat" else WORK_TIMEOUT

        # ── 快照 workspace（工作模式）──
        snapshot_before = self.runner.snapshot_workspace(bot_key) if intent == "work" else set()

        # ── 进度通知（工作模式）──
        if intent == "work":
            label = {"fe": "小柯", "be": "酱瓜"}.get(bot_key, bot_key)
            await self._notify_progress(chat_id, bot_key, f"{label} 正在生成代码...")

        # ── LLM 调用（带超时保护）──
        metrics.task_started()
        metrics.agent_request(bot_key)
        start_ts = datetime.now()

        result = await self.runner.run_with_timeout(
            agent, full_command, max_tokens=max_tokens, timeout=timeout,
        )
        metrics.record_response_time((datetime.now() - start_ts).total_seconds())

        # ── 停止打字指示器 ──
        await self._hide_typing(bot_key, message_id, typing_task, reaction_id)

        # ── 产出验证 ──
        reply, is_valid = self.runner.validate_output(bot_key, result, snapshot_before)

        # ── 更新共享状态 ──
        self._update_status(bot_key, "完成" if is_valid else "失败",
            reply[:80] if is_valid else "产出无效")

        if is_valid:
            metrics.task_succeeded()
            await self._notify(chat_id, bot_key, reply)
            # ── 跨 Agent 委派：检测回复中的 @队友+行动词 ──
            if allow_handoff:
                await self._dispatch_handoffs(chat_id, reply, bot_key, message_id)
        else:
            metrics.task_failed()
            if result.get("timed_out"):
                metrics.task_timed_out()
            await self._notify(chat_id, bot_key,
                f"执行失败：{reply}"
            )

    # ── 信息过滤 ─────────────────────────────────────────

    def _filter_and_split(self, prd: str) -> tuple[str, str]:
        """PM 的 PRD → FE 子任务 + BE 子任务（信息过滤）"""
        shared_note = (
            "## ⚠️ 开工前必读\n"
            "- API 契约在 `workspace/shared/API_CONTRACT.md`，这是你和队友的接口真相源\n"
            "- 任务状态在 `workspace/shared/STATUS.md`，看一眼队友进度\n"
            "- 做了技术决策写到 `workspace/shared/DECISIONS.md`，让队友知道\n\n"
            "---\n\n"
        )
        fe_parts = [
            shared_note,
            "以下是你需要完成的前端子任务（仅前端部分）：\n",
            self._extract_section(prd, ["项目概述", "功能需求"]),
            "\n--- 前端任务 ---\n",
            self._extract_section(prd, ["前端任务", "前端"]),
            "\n--- API 接口契约（消费方）---\n",
            self._extract_section(prd, ["API", "接口契约", "接口"]),
        ]
        be_parts = [
            shared_note,
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

    # ── 消息发送 ─────────────────────────────────────────

    @staticmethod
    def _md_to_plain(text: str) -> str:
        """将 Markdown 转为飞书可读的纯文本。"""
        import re
        # 去粗体/斜体标记
        text = re.sub(r'\*\*(.+?)\*\*', r'\1', text)
        text = re.sub(r'\*(.+?)\*', r'\1', text)
        # 去行内代码标记
        text = re.sub(r'`([^`]+)`', r'\1', text)
        # 表格分隔线 → 保留为分隔线
        text = re.sub(r'^\|[-:\|\s]+\|$', '---', text, flags=re.MULTILINE)
        # 表格行 → 空格分隔
        text = re.sub(r'^\|(.+)\|$', lambda m: '  ' + ' | '.join(c.strip() for c in m.group(1).split('|')), text, flags=re.MULTILINE)
        # 标题 → 加粗
        text = re.sub(r'^### (.+)$', r'【\1】', text, flags=re.MULTILINE)
        text = re.sub(r'^## (.+)$', r'【\1】', text, flags=re.MULTILINE)
        text = re.sub(r'^# (.+)$', r'【\1】', text, flags=re.MULTILINE)
        # 代码块标记 → 删除
        text = re.sub(r'```[a-z]*\n', '', text)
        text = text.replace('```', '')
        # 水平线
        text = re.sub(r'^---+$', '—————————————', text, flags=re.MULTILINE)
        # 多余空行
        text = re.sub(r'\n{3,}', '\n\n', text)
        return text.strip()

    async def _send_long_message(self, chat_id: str, bot_key: str, text: str,
                                  at_users: list[str] | None = None) -> None:
        """发送消息，长内容自动分片（每片 ≤ 2000 字），Markdown 转纯文本。"""
        # Markdown → 纯文本
        text = self._md_to_plain(text)

        bot = self._get_bot_config(bot_key)
        if not bot.get("app_id"):
            print(f"[orchestrator] {bot_key} Bot 未配置，模拟发送: {text[:80]}...")
            return

        # ── 自动检测文本中的 @队友名 ──
        _NAME_TO_BOT_KEY = {
            "小柯": "fe", "柯": "fe", "前端": "fe",
            "酱瓜": "be", "瓜": "be", "后端": "be",
            "小吴": "pm", "吴": "pm", "产品经理": "pm",
        }
        auto_at = list(at_users) if at_users else []
        for name, key in _NAME_TO_BOT_KEY.items():
            if f"@{name}" in text and key != bot_key:
                target_bot = BOTS.get(key, {})
                target_id = target_bot.get("app_id", "")
                if target_id and target_id not in auto_at:
                    auto_at.append(target_id)

        # ── 分片发送 ──
        max_len = 2000
        if len(text) <= max_len:
            result = await send_message(
                app_id=bot["app_id"], app_secret=bot["app_secret"],
                chat_id=chat_id, text=text,
                at_users=auto_at if auto_at else None,
            )
            if not result["success"]:
                print(f"[orchestrator] {bot_key} Bot 发送失败: {result['msg']}")
            return

        # 按段落分片
        paragraphs = text.split("\n")
        chunks: list[str] = []
        current = ""
        for p in paragraphs:
            if len(current) + len(p) + 1 <= max_len:
                current = (current + "\n" + p).strip()
            else:
                if current:
                    chunks.append(current)
                current = p if len(p) <= max_len else p[:max_len]
        if current:
            chunks.append(current)

        total = len(chunks)
        for i, chunk in enumerate(chunks, 1):
            prefix = f"({i}/{total})\n" if total > 1 else ""
            result = await send_message(
                app_id=bot["app_id"], app_secret=bot["app_secret"],
                chat_id=chat_id, text=prefix + chunk,
                at_users=auto_at if i == 1 and auto_at else None,
            )
            if not result["success"]:
                print(f"[orchestrator] {bot_key} Bot 分片{i}发送失败: {result['msg']}")

    async def _notify(self, chat_id: str, bot_key: str, text: str, at_users: list[str] | None = None) -> None:
        """用指定 Bot 的身份向群聊发消息。长消息自动分片，Markdown 自动转纯文本。"""
        await self._send_long_message(chat_id, bot_key, text, at_users)

    def get_task_state(self, task_id: str) -> dict | None:
        task = self._tasks.get(task_id)
        return task.to_dict() if task else None
