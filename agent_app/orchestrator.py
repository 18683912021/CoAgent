"""Orchestrator —— 多 Bot 任务调度器（路由/社交上下文/共享状态/消息发送）"""
import asyncio
import queue
import re
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

from tools.feishu_utils import BOTS, send_message, edit_message, add_reaction, delete_reaction

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
    checklist: str = ""       # PM 输出的验收 checklist（Markdown - [ ] 格式）
    review_result: str = ""   # PM Light Review 结果
    fe_retries: int = 0
    be_retries: int = 0
    max_retries: int = 8
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


@dataclass
class TaskSession:
    """OpenClaw 风格：跨消息的任务会话。让 Agent 知道"这条消息是刚才那个任务的延续"。

    飞书群聊没有原生 thread/session 概念，用 chat_id + 时间窗口模拟。
    """
    session_id: str          # "session-{chat_id}-{timestamp}"
    chat_id: str
    task_id: str             # 最近一次 task_id
    bot_key: str             # 发起者
    project_name: str = ""   # 自动从 Agent 回复中提取
    files_created: list[str] = None  # 最近创建的文件
    command: str = ""        # 原始指令
    # 审批门：PM 出 PRD 后暂存，等用户确认才派发
    prd_pending: str = ""
    fe_task_pending: str = ""
    be_task_pending: str = ""
    created_at: str = ""
    last_active: str = ""

    def is_expired(self) -> bool:
        """30 分钟无活动自动过期。"""
        if not self.last_active:
            return False
        try:
            last = datetime.fromisoformat(self.last_active)
            return (datetime.now() - last).total_seconds() > 1800
        except Exception:
            return True

    def touch(self) -> None:
        self.last_active = datetime.now().isoformat()

    def context_preamble(self) -> str:
        """生成注入给 Agent 的上下文前缀。"""
        parts = [f"[任务延续] 你的上一个任务是「{self.command[:60]}」"]
        if self.project_name:
            parts.append(f"项目: {self.project_name}")
        if self.files_created:
            file_list = "\n".join(f"  - {f}" for f in self.files_created[:8])
            parts.append(f"上次创建的文件:\n{file_list}")
            if len(self.files_created) > 8:
                parts.append(f"  ... 等共 {len(self.files_created)} 个文件")
        return "\n".join(parts) + "\n\n如果用户的新指令与这个项目相关，在上面文件的基础上直接修改，不需要重新创建项目。"


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
        self._sessions: dict[str, TaskSession] = {}  # chat_id → session
        self._bot_status: dict[str, dict] = {
            "pm": {"status": "空闲", "summary": "-", "time": "-"},
            "fe": {"status": "空闲", "summary": "-", "time": "-"},
            "be": {"status": "空闲", "summary": "-", "time": "-"},
        }
        self._agent_locks = {k: asyncio.Lock() for k in ("pm", "fe", "be")}
        # 启动时自动获取 Bot 的 open_id（用于 post @ 通知）
        asyncio.create_task(self._init_open_ids())

    async def _init_open_ids(self):
        """启动时通过 bot/v3/info API 获取每个 Bot 的 open_id。"""
        from tools.feishu_utils import get_bot_open_id
        for key in ("pm", "fe", "be"):
            bot = BOTS.get(key, {})
            if not bot.get("open_id") and bot.get("app_id"):
                open_id = await get_bot_open_id(bot["app_id"], bot["app_secret"])
                if open_id:
                    bot["open_id"] = open_id
                    print(f"[open_id] {key}: {open_id}")

    def _get_bot_config(self, key: str) -> dict:
        """获取 Bot 配置"""
        return BOTS.get(key, {})

    # ── 入口：飞书消息分发 ──────────────────────────────

    async def handle_command(
        self, bot_key: str, chat_id: str, user_id: str, command: str,
        is_mentioned: bool = True,
        mentioned_others: list[str] | None = None,
        message_id: str = "",
        sender_is_bot: bool = False,
    ) -> None:
        """根据被 @ 的 Bot 分发任务。

        Args:
            is_mentioned: 是否被 @。False 时只记录上下文不回复。
            mentioned_others: 同一消息中其他被 @ 的人名列表，用于群呼上下文。
            message_id: 飞书消息 ID，用于 Reaction 打字指示器。
            sender_is_bot: 发送者是否为另一个 Bot（防死循环：强制 chat 模式）。
        """
        mentioned_others = mentioned_others or []

        # Bot 间消息：被 @ 了就正常回应

        # 不被 @ 的消息：存入该 Bot 的记忆作为上下文，不回复
        # 例外：PM 有待审批 PRD 时，确认词（"可以""开始"等）即使没 @ 也触发派发
        if not is_mentioned:
            if bot_key == "pm" and command and self._is_confirmation(command):
                session = self._sessions.get(chat_id)
                if session and not session.is_expired() and session.prd_pending:
                    await self._dispatch_pending_prd(chat_id, message_id, session)
                    return
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
        """更新共享任务状态表。保留其他 Bot 的状态，不覆盖。"""
        from datetime import datetime as dt
        now = dt.now().strftime("%H:%M")
        summary = self._extract_summary(output_summary) if output_summary else "-"
        self._bot_status[bot_key] = {"status": status, "summary": summary, "time": now}

        status_path = SHARED_DIR / "STATUS.md"
        lines = [
            "# 任务状态",
            "",
            "> 每个 Agent 完成后自动更新。所有人读此文件了解进度。",
            "",
            "| Agent | 状态 | 最近产出 | 更新时间 |",
            "|-------|------|---------|----------|",
        ]
        for key, label in [("pm", "PM"), ("fe", "FE"), ("be", "BE")]:
            s = self._bot_status[key]
            lines.append(f"| {label} | {s['status']} | {s['summary']} | {s['time']} |")

        status_path.write_text("\n".join(lines) + "\n", encoding="utf-8")

    @staticmethod
    def _extract_summary(text: str) -> str:
        """从 agent 回复中提取第一句有意义的话作为状态摘要。
        跳过 markdown 标记、表格、代码块，取第一个自然语言句子。
        """
        for line in text.split("\n"):
            stripped = line.strip()
            if not stripped:
                continue
            # 跳过 markdown 标记和表格
            if stripped.startswith(("#", "|", "```", "---", ">", "  ")):
                continue
            # 取第一句（到第一个句号或 60 字）
            clean = stripped.replace("|", "/")
            # 找第一个句子结束符
            for sep in ("。", "！", "？", ". ", "! ", "? "):
                idx = clean.find(sep)
                if idx > 5:  # 至少 5 个字才算有效句子
                    return clean[:idx + len(sep)][:60]
            return clean[:60]
        # 没找到有效行，fallback
        clean = text.replace("\n", " ").replace("|", "/")
        return clean[:60]

    # ── PM 入口 ─────────────────────────────────────────

    def _build_social_context(self, command: str, mentioned_others: list[str]) -> str:
        """构建群呼上下文。只做最低限度的信息传递，不注入机械指令。"""
        if not mentioned_others:
            return command

        names = "、".join(mentioned_others)
        return f"[群呼] 用户也 @ 了 {names}。{command}"

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
        "AI小柯（前端）": "fe", "AI小柯": "fe",
        "酱瓜": "be", "瓜": "be", "瓜瓜": "be", "后端": "be", "BE": "be",
        "AI酱瓜（后端开发工程师）": "be", "AI酱瓜": "be",
        "小吴": "pm", "吴": "pm", "吴吴": "pm", "PM": "pm", "产品经理": "pm",
        "AI小吴（产品经理）": "pm", "AI小吴": "pm",
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

    # ── 任务会话管理（OpenClaw 风格 thread binding）─────

    def _get_or_create_session(self, chat_id: str, bot_key: str, command: str,
                                intent: str) -> TaskSession | None:
        """获取活跃会话或创建新会话。会话让 Agent 知道消息间的延续关系。"""
        # 清理过期会话
        expired = [cid for cid, s in self._sessions.items() if s.is_expired()]
        for cid in expired:
            del self._sessions[cid]

        existing = self._sessions.get(chat_id)

        # 延续信号：关键词 OR 短消息跟在活跃会话后
        is_continuation = (
            any(kw in command.lower() for kw in self._CONTINUE_KEYWORDS)
            or (existing and not existing.is_expired() and len(command.strip()) < 50)
        )
        if existing and not existing.is_expired() and is_continuation:
            existing.touch()
            return existing

        # 新的工作/plan 任务 → 创建新会话
        if intent in ("work", "plan") and len(command) > 5:
            session = TaskSession(
                session_id=f"session-{chat_id}-{datetime.now().strftime('%H%M%S')}",
                chat_id=chat_id,
                task_id="",
                bot_key=bot_key,
                command=command,
                created_at=datetime.now().isoformat(),
                last_active=datetime.now().isoformat(),
            )
            self._sessions[chat_id] = session
            return session

        return None

    def _update_session_after_task(self, chat_id: str, task_id: str,
                                     reply_text: str, new_files: list[str] | None = None) -> None:
        """任务完成后更新会话上下文：记录产出文件、提取项目名。"""
        session = self._sessions.get(chat_id)
        if not session:
            return
        session.task_id = task_id
        session.touch()
        if new_files:
            session.files_created = list(set((session.files_created or []) + new_files))[:20]
        # 尝试从回复中提取项目名
        for line in reply_text.split("\n")[:10]:
            line = line.strip()
            if line.startswith("#") and len(line) > 2 and not session.project_name:
                session.project_name = line.lstrip("#").strip()[:50]
                break

    def _inject_session_context(self, command: str, session: TaskSession | None) -> str:
        """如果存在活跃会话，将项目上下文注入到指令中。"""
        if not session:
            return command
        ctx = session.context_preamble()
        return f"{ctx}\n\n---\n用户指令: {command}"

    _CONFIRMATION_KEYWORDS = [
        "可以", "行", "好", "ok", "yes", "开始", "做吧", "干吧", "搞吧",
        "派任务", "派吧", "开工", "动手", "执行", "确认", "没问题", "去吧",
        "go", "start", "do it", "proceed",
    ]

    @staticmethod
    def _find_task_doc() -> str:
        """找到 workspace/shared/tasks/ 下最近修改的任务文档。"""
        tasks_dir = SHARED_DIR / "tasks"
        if not tasks_dir.exists():
            return ""
        md_files = [f for f in tasks_dir.glob("*.md") if f.name != "_TEMPLATE.md"]
        if not md_files:
            return ""
        latest = max(md_files, key=lambda f: f.stat().st_mtime)
        return f"workspace/shared/tasks/{latest.name}"

    @classmethod
    def _is_confirmation(cls, command: str) -> bool:
        """检测用户消息是否为对 PRD 的确认/批准。"""
        cmd = command.lower().strip()
        # 消息以确认词开头（前 10 字），或短消息（< 50 字）含确认词
        head = cmd[:10]
        if any(kw in head for kw in cls._CONFIRMATION_KEYWORDS):
            return True
        if len(cmd) < 50 and any(kw in cmd for kw in cls._CONFIRMATION_KEYWORDS):
            return True
        return False

    async def _dispatch_pending_prd(self, chat_id: str, message_id: str,
                                     session: TaskSession) -> None:
        """用户已确认 PRD，直接派发 FE/BE，不再重复调 PM。"""
        await self._notify(chat_id, "pm", "收到，现在派给前后端。")

        # ── 注入上下文：任务文档路径 + 项目上下文 ──
        task_doc_hint = self._find_task_doc()
        context_inject = session.context_preamble() if session else ""
        extra = ""
        if task_doc_hint:
            extra += f"任务文档: {task_doc_hint}。开工后先 read_file 读任务文档，按 FE 任务清单逐项开发，完成一项勾一项 ✅，全部完成后 @ 酱瓜 通知。"
        if context_inject:
            extra += f"\n{context_inject}"
        fe_cmd = f"{session.fe_task_pending}\n\n{extra}" if extra else session.fe_task_pending

        extra_be = ""
        if task_doc_hint:
            extra_be += f"任务文档: {task_doc_hint}。开工后先 read_file 读任务文档，按 BE 任务清单逐项开发，完成一项勾一项 ✅，全部完成后 @ 小柯 通知。"
        if context_inject:
            extra_be += f"\n{context_inject}"
        be_cmd = f"{session.be_task_pending}\n\n{extra_be}" if extra_be else session.be_task_pending

        fe_snapshot = self.runner.snapshot_workspace("fe")
        be_snapshot = self.runner.snapshot_workspace("be")

        # ── 开工确认（先应一声，再开始干活）──
        await asyncio.gather(
            self._notify(chat_id, "fe", "收到，开始干活 👨‍💻"),
            self._notify(chat_id, "be", "收到，开始干活 👨‍💻"),
        )

        # FE/BE 并行执行（带进度推送，用户能实时看到干到哪了）
        fe_future = self._run_agent_streaming(
            "fe", chat_id, message_id, self.fe, fe_cmd,
            max_tokens=8192, timeout=WORK_TIMEOUT, max_rounds=360, intent="work")
        be_future = self._run_agent_streaming(
            "be", chat_id, message_id, self.be, be_cmd,
            max_tokens=8192, timeout=WORK_TIMEOUT, max_rounds=360, intent="work")
        fe_result, be_result = await asyncio.gather(fe_future, be_future)

        fe_text, fe_ok = self.runner.validate_output("fe", fe_result, fe_snapshot)
        be_text, be_ok = self.runner.validate_output("be", be_result, be_snapshot)

        for bk, text, snapshot in [("fe", fe_text, fe_snapshot), ("be", be_text, be_snapshot)]:
            if snapshot:
                _, new_files, _ = self.runner.verify_output(bk, snapshot)
                if new_files:
                    file_list = "\n".join(f"  📄 {f}" for f in new_files[:6])
                    ws_name = {"fe": "workspace/fe", "be": "workspace/be"}[bk]
                    suffix = f"\n\n📁 `{ws_name}/` 新增 {len(new_files)} 个文件：\n{file_list}"
                    if bk == "fe":
                        fe_text += suffix
                    else:
                        be_text += suffix

        for bk in ("fe", "be"):
            n = self.runner.cleanup_test_files(bk)
            j = self.runner.cleanup_junk(bk)
            if n > 0 or j > 0:
                print(f"[cleanup] {bk}: 删除了 {n} 个测试文件 + {j} 个垃圾文件")

        self._update_status("fe", "完成" if fe_ok else "失败", fe_text[:80] if fe_ok else "")
        self._update_status("be", "完成" if be_ok else "失败", be_text[:80] if be_ok else "")

        if fe_ok:
            await self._notify(chat_id, "fe", fe_text)
            await self._notify_completion(chat_id, "fe", fe_snapshot)
        else:
            await self._notify(chat_id, "fe", "PRD 信息不够，写不了。让小吴补充一下。")
        if be_ok:
            await self._notify(chat_id, "be", be_text)
            await self._notify_completion(chat_id, "be", be_snapshot)
        else:
            await self._notify(chat_id, "be", "后端任务信息不足，无法开始。请 PM 补充。")

        # ── 双方都完成 → 提醒联调 ──
        if fe_ok and be_ok:
            await self._notify(chat_id, "pm",
                "前端和后端都完成了，双方各自在群里通知了对方。接下来你们技术协商→联调→签字→我验收。")

        all_files = []
        for bk, snap in [("fe", fe_snapshot), ("be", be_snapshot)]:
            _, nf, _ = self.runner.verify_output(bk, snap)
            all_files.extend(nf)
        self._update_session_after_task(chat_id, "pending-dispatch", session.prd_pending, all_files)

        # 清掉待审批状态
        session.prd_pending = ""
        session.fe_task_pending = ""
        session.be_task_pending = ""

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

    _CONTINUE_KEYWORDS = [
        "继续", "接着", "然后", "下一步", "再试试", "再来",
        "继续吧", "接着说", "然后呢", "接下来", "下一步呢",
        "go on", "continue", "next", "proceed",
    ]

    _PLAN_KEYWORDS = [
        "方案", "怎么设计", "怎么实现", "你觉得", "建议",
        "分析一下", "评估", "怎么看", "有什么思路", "怎么规划",
        "plan", "design", "analyze", "evaluate",
    ]

    _READ_KEYWORDS = [
        "看看", "看一下", "读一下", "读读", "查阅", "了解",
        "查一下", "搜一下", "找一下", "有没有",
    ]

    @staticmethod
    def _has_document_link(command: str) -> bool:
        """检测消息中是否包含飞书文档/Wiki/多维表格链接。"""
        return any(pat in command for pat in [
            "feishu.cn/wiki/", "feishu.cn/docx/", "feishu.cn/base/",
            "feishu.cn/sheets/", "feishu.cn/mindnotes/",
        ])

    # 强工作信号——文档链接时只有这些词能覆盖 read 意图
    _STRONG_WORK_KEYWORDS = [
        "写个", "做个", "开发个", "实现个", "创建", "生成",
        "搭建", "新建", "初始化", "构建", "配置", "安装", "集成",
        "脚手架", "模板", "部署", "发布",
        "build", "create", "develop", "implement",
        "setup", "scaffold", "init", "deploy",
    ]

    def _classify_intent(self, command: str, bot_key: str = "") -> str:
        """意图分类：chat / read / plan / work。

        灵活规则：
        - 发文档链接 + "写个API" → work（文档是输入，工作是目标）
        - 发文档链接 + "帮我看一下" → read（只是了解，不是干活）
        - "看一下"/"了解一下" 明确是了解意图 → read
        """
        cmd = command.lower().strip()
        has_doc = self._has_document_link(command)
        has_work = any(kw in cmd for kw in self._WORK_KEYWORDS)

        # 延续关键词 → work
        if any(kw in cmd for kw in self._CONTINUE_KEYWORDS):
            return "work"

        # 方案/咨询关键词 → plan
        if any(kw in cmd for kw in self._PLAN_KEYWORDS):
            return "plan"

        # ── 文档链接 → read，除非有强工作信号 ──
        if has_doc:
            if any(kw in cmd for kw in self._STRONG_WORK_KEYWORDS):
                return "work"   # "参考这个文档写个API"
            return "read"       # 只是分享文档给你看

        # ── 了解意图 → read（没有工作要求时）──
        if any(kw in cmd for kw in self._READ_KEYWORDS) and not has_work:
            return "read"

        # 太短 → 闲聊
        if len(cmd) < 6:
            return "chat"

        # 工作关键词 → work
        if has_work:
            return "work"

        # 包含链接但没有工作关键词 → read（兜底）
        if "http" in cmd or "feishu.cn" in cmd:
            return "read"

        # 上下文感知：检查该 Agent 最近是否在做任务
        if bot_key:
            agent = {"pm": self.pm, "fe": self.fe, "be": self.be}.get(bot_key)
            if agent and agent._memory:
                recent = agent._memory[-5:]
                for m in recent:
                    content = m.get("content", "")
                    if isinstance(content, list):
                        return "work"
                    if isinstance(content, str) and len(content) > 200:
                        return "work"

        return "chat"

    # ── 进度通知 ───────────────────────────────────────

    async def _notify_progress(self, chat_id: str, bot_key: str, text: str) -> None:
        """发送轻量进度通知——让用户知道系统在干什么，不盯 ✍️ 干等。"""
        await self._notify(chat_id, bot_key, f"🔄 {text}")

    async def _notify_completion(self, chat_id: str, bot_key: str,
                                  snapshot_before: set[str]) -> None:
        """工作完成后主动通知队友。只发一条简短消息，不刷屏。"""
        _, new_files, _ = self.runner.verify_output(bot_key, snapshot_before)
        bot_label = {"fe": "小柯", "be": "酱瓜", "pm": "小吴"}.get(bot_key, bot_key)
        teammate_key = {"fe": "be", "be": "fe"}.get(bot_key)
        teammate_name = {"fe": "酱瓜", "be": "小柯"}.get(bot_key, "")

        if bot_key == "fe":
            msg = f"我的前端任务完成了"
            if new_files:
                msg += f"（{len(new_files)} 个文件）"
            if teammate_name:
                msg += f"，@酱瓜 你那边好了告诉我，准备联调"
        elif bot_key == "be":
            msg = f"我的后端任务完成了，接口可以 curl 验证"
            if teammate_name:
                msg += f"，@小柯 你好了随时联调"
        else:
            return  # PM 不需要这种通知

        await self._notify(chat_id, bot_key, f"✅ {msg}")

    # ── 打字指示器 ─────────────────────────────────────

    async def _show_typing(self, bot_key: str, message_id: str,
                           chat_id: str = "", intent: str = "chat") -> tuple[dict | None, str]:
        """添加 👌 Reaction + 工作模式发"正在输入..."文字。

        - 闲聊: 只加 Reaction（秒回，不需要文字提示）
        - 工作/Plan: Reaction + 文字"正在输入..."
        - 文字消息用 edit 清空而非 ✅，不留残影

        Returns:
            (reaction_state, typing_text_msg_id)
        """
        bot = self._get_bot_config(bot_key)
        app_id = bot.get("app_id", "")
        app_secret = bot.get("app_secret", "")

        # ── 文字"正在输入..." + Reaction 同时发出 ──
        async def send_text():
            if chat_id and intent in ("work", "plan") and app_id:
                r = await send_message(app_id, app_secret, chat_id, "正在输入...")
                return r.get("message_id", "")
            return ""

        async def add_reaction_op():
            if message_id and app_id:
                r = await add_reaction(app_id, app_secret, message_id, "OK")
                if r["success"]:
                    return {"reaction_id": r["reaction_id"]}
            return None

        typing_text_msg_id, state = await asyncio.gather(send_text(), add_reaction_op())

        return state, typing_text_msg_id

    async def _hide_typing(self, bot_key: str, message_id: str,
                           state: dict | None, typing_text_msg_id: str = "") -> None:
        """清理 typing indicator：摘 Reaction + 编辑文字为空串。"""
        # 删除 Reaction
        if state and message_id:
            reaction_id = state.get("reaction_id", "")
            if reaction_id:
                bot = self._get_bot_config(bot_key)
                try:
                    await delete_reaction(bot.get("app_id", ""), bot.get("app_secret", ""),
                                          message_id, reaction_id)
                except Exception:
                    pass

        # 编辑"正在输入..."为空串，缩成最小气泡（失败无所谓，回复会自然冲走它）
        if typing_text_msg_id:
            bot = self._get_bot_config(bot_key)
            try:
                await edit_message(bot.get("app_id", ""), bot.get("app_secret", ""),
                                   typing_text_msg_id, "")
            except Exception:
                pass

    # ── 流式执行（✍️ + 进度消息）────────────────────────

    async def _send_progress(self, chat_id: str, bot_key: str, text: str,
                             existing_msg_id: str = "") -> str:
        """发送/编辑进度消息。首次发新消息，后续原地编辑同一条（不刷屏）。
        编辑失败时回退到发新消息。"""
        bot = self._get_bot_config(bot_key)
        app_id = bot.get("app_id", "")
        app_secret = bot.get("app_secret", "")

        if not app_id:
            return ""

        if not existing_msg_id:
            # 首次：发送新消息，记下 message_id
            result = await send_message(app_id, app_secret, chat_id, text)
            return result.get("message_id", "")

        # 已有消息 → 原地编辑
        edit_result = await edit_message(app_id, app_secret, existing_msg_id, text)
        if edit_result["success"]:
            return existing_msg_id

        # 编辑失败（超时/权限）→ 回退发新消息
        fallback = await send_message(app_id, app_secret, chat_id, text)
        return fallback.get("message_id", "")

    @staticmethod
    def _progress_label(event: dict) -> str:
        """将进度事件翻译为用户可读的标签。空字符串表示不值得展示。"""
        etype = event.get("type", "")
        tool = event.get("tool", "")
        detail = event.get("detail", "")

        if etype == "thinking":
            return "🤔 思考中..."

        _TOOL_LABELS: dict[str, str] = {
            "search_web":        "🔍 搜索网页",
            "web_fetch":         "🌐 访问网页",
            "read_feishu_doc":   "📄 读飞书文档",
            "read_feishu_wiki":  "📚 读知识库",
            "search_feishu_wiki":"🔍 搜索知识库",
            "read_feishu_bitable":"📊 读多维表格",
            "write_file":        "✍️ 写代码",
            "read_file":         "📖 读代码",
            "list_dir":          "📂 列目录",
            "send_feishu_message":"💬 发消息",
        }

        label = _TOOL_LABELS.get(tool, tool)

        if etype == "tool_start":
            if detail:
                return f"{label}: {detail[:40]}"
            return label
        elif etype == "tool_end":
            if tool == "write_file":
                return f"{label} ✓"
            return ""  # 读操作不报完成

        return ""

    async def _run_agent_streaming(
        self, bot_key: str, chat_id: str, message_id: str,
        agent, command: str, max_tokens: int, timeout: int, max_rounds: int,
        intent: str = "work",
    ) -> dict:
        """执行 Agent，同时维护 Reaction + 文字"正在输入..." + 进度消息。"""
        # ── 打字指示器（Reaction + 文字并发）──
        typing_state, typing_text_msg_id = await self._show_typing(
            bot_key, message_id, chat_id, intent)

        # ── 启动 Agent（带进度队列）──
        result_future, progress_q = await self.runner.run_with_progress(
            agent, command, max_tokens=max_tokens, timeout=timeout, max_rounds=max_rounds,
            intent=intent,
        )

        last_label = ""
        progress_msg_id = ""        # 进度消息 ID（用于原地编辑，不刷屏）
        silent_rounds = 0           # Patrol: 连续无进度的轮次（1s/轮）
        silence_notified = False
        try:
            while True:
                # 每 1 秒轮询一次进度，实现实时更新
                done, _ = await asyncio.wait([result_future], timeout=1.0)

                # ── 排空进度队列（非阻塞、线程安全）──
                had_progress = False
                while True:
                    try:
                        event = progress_q.get_nowait()
                    except queue.Empty:
                        break
                    if event is None:
                        break
                    label = self._progress_label(event)
                    if label and label != last_label:
                        progress_msg_id = await self._send_progress(
                            chat_id, bot_key, f"🔄 {label}", progress_msg_id)
                        last_label = label
                        had_progress = True

                # ── Patrol 沉默检测：30s 无进度 → 提醒用户 ──
                if had_progress:
                    silent_rounds = 0
                else:
                    silent_rounds += 1
                if silent_rounds >= 30 and not silence_notified:
                    silence_msg = "⏳ 仍在工作中（暂无新的进度更新）。复杂任务可能需要更长时间…"
                    await self._send_progress(chat_id, bot_key, silence_msg, progress_msg_id)
                    silence_notified = True

                if result_future.done():
                    break

            return await result_future
        finally:
            # 清理进度消息：编辑为简短的完成标记
            if progress_msg_id:
                await self._send_progress(chat_id, bot_key, "✅", progress_msg_id)
            # 清理 Reaction + 文字"正在输入..."
            await self._hide_typing(bot_key, message_id, typing_state, typing_text_msg_id)

    async def _route_pm(self, chat_id: str, user_id: str, command: str,
                        mentioned_others: list[str] | None = None,
                        message_id: str = "") -> None:
        """PM Bot 被 @"""
        mentioned_others = mentioned_others or []

        # 空消息：被叫到名字，自然应一声（只代表自己）
        if not command or not command.strip():
            await self._notify(chat_id, "pm", "嗯？")
            return

        # 注入群呼上下文
        full_command = self._build_social_context(command, mentioned_others)

        # ── 意图预分类：闲聊用短 token，工作用完整 pipeline ──
        intent = self._classify_intent(command, "pm")
        # 活跃会话 + 短消息 → 延续对话，不是新任务
        session_check = self._sessions.get(chat_id)
        if intent == "work" and session_check and not session_check.is_expired() \
                and len(command.strip()) < 50:
            intent = "chat"
        if intent == "chat":
            max_tokens, max_rounds, timeout = 4096, 72, CHAT_TIMEOUT
        elif intent == "read":
            max_tokens, max_rounds, timeout = 16384, 360, 1440  # read intent
        elif intent == "plan":
            max_tokens, max_rounds, timeout = 16384, 360, PM_TIMEOUT
        else:
            max_tokens, max_rounds, timeout = 16384, 360, PM_TIMEOUT

        # ── 审批门：有待审批 PRD + 用户说确认词 → 直接派发 ──
        session = self._get_or_create_session(chat_id, "pm", command, intent)
        if session and session.prd_pending and self._is_confirmation(command):
            await self._dispatch_pending_prd(chat_id, message_id, session)
            return

        # ── 会话管理 ──
        full_command = self._inject_session_context(full_command, session)

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

        # ── LLM 调用（✍️ Reaction + 进度消息内置于 _run_agent_streaming）──
        async with self._agent_locks["pm"]:
            pm_result = await self._run_agent_streaming(
                "pm", chat_id, message_id, self.pm, full_command,
                max_tokens=max_tokens, timeout=timeout, max_rounds=max_rounds,
                intent=intent,
            )

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
        self._sync_to_teammates("pm", command, task.prd)

        # 只有包含任务清单结构的回复才进入 PRD 管线；其他（聊天/读文档摘要/调研汇报）到此为止
        _prd_markers = ["前端任务", "FE 任务", "后端任务", "BE 任务",
                        "FE 任务清单", "BE 任务清单", "- [ ] 0."]
        if not any(m in task.prd for m in _prd_markers):
            task.state = State.COMPLETED
            task.completed_at = datetime.now().isoformat()
            self._update_status("pm", "完成", task.prd[:80])
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

        # ── 写入共享上下文 + 拆分任务 + 提取 Checklist ──
        self._write_api_contract(task.prd)
        task.fe_task, task.be_task = self._filter_and_split(task.prd)
        task.checklist = self._extract_checklist(task.prd)

        # ── 审批门：暂存 PRD，等用户确认后再派发 ──
        if session:
            session.prd_pending = task.prd
            session.fe_task_pending = task.fe_task
            session.be_task_pending = task.be_task
        task.state = State.COMPLETED
        task.completed_at = datetime.now().isoformat()
        self._tasks[task.task_id] = task
        metrics.task_succeeded()
        metrics.record_response_time((datetime.now() - start_ts).total_seconds())
        self._update_status("pm", "完成", task.prd[:80])
        log_event("INFO", "pm_task_prd_ready",
            task_id=task.task_id, intent=intent)
        return

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

        agent = self.fe if bot_key == "fe" else self.be

        # 注入群呼上下文
        full_command = self._build_social_context(command, mentioned_others)

        # ── 意图预分类 ──
        intent = self._classify_intent(command, bot_key)
        # 活跃会话 + 短消息 → 延续对话，不是新任务
        session_check = self._sessions.get(chat_id)
        if intent == "work" and session_check and not session_check.is_expired() \
                and len(command.strip()) < 50:
            intent = "chat"
        if intent == "chat":
            max_tokens, max_rounds, timeout = 4096, 72, CHAT_TIMEOUT
        elif intent == "read":
            max_tokens, max_rounds, timeout = 16384, 360, 1440  # read intent
        elif intent == "plan":
            max_tokens, max_rounds, timeout = 16384, 360, WORK_TIMEOUT
        else:
            max_tokens, max_rounds, timeout = 16384, 360, WORK_TIMEOUT

        # ── 会话管理：如果有活跃会话，注入项目上下文 ──
        session = self._get_or_create_session(chat_id, bot_key, command, intent)
        full_command = self._inject_session_context(full_command, session)

        # ── 快照 workspace（工作模式）──
        snapshot_before = self.runner.snapshot_workspace(bot_key) if intent == "work" else set()

        # ── 轻量确认（非 chat 给个快速反馈，不定义是聊天还是干活）──
        if intent != "chat":
            await self._notify(chat_id, bot_key, "👌")

        # ── LLM 调用（✍️ Reaction + 进度消息内置于 _run_agent_streaming）──
        metrics.task_started()
        metrics.agent_request(bot_key)
        start_ts = datetime.now()

        async with self._agent_locks[bot_key]:
            result = await self._run_agent_streaming(
                bot_key, chat_id, message_id, agent, full_command,
                max_tokens=max_tokens, timeout=timeout, max_rounds=max_rounds,
                intent=intent,
            )
        metrics.record_response_time((datetime.now() - start_ts).total_seconds())

        # ── 产出验证 ──
        reply, is_valid = self.runner.validate_output(bot_key, result, snapshot_before)

        # ── 产出文件列表（用户不用猜代码在哪）──
        if is_valid and snapshot_before:
            _, new_files, _ = self.runner.verify_output(bot_key, snapshot_before)
            if new_files:
                file_list = "\n".join(f"  📄 {f}" for f in new_files[:8])
                ws_name = {"fe": "workspace/fe", "be": "workspace/be"}.get(bot_key, bot_key)
                reply += f"\n\n📁 `{ws_name}/` 新增 {len(new_files)} 个文件：\n{file_list}"
                if len(new_files) > 8:
                    reply += f"\n  ... 等共 {len(new_files)} 个"

        # ── 更新共享状态 ──
        self._update_status(bot_key, "完成" if is_valid else "失败",
            reply[:80] if is_valid else "产出无效")

        if is_valid:
            metrics.task_succeeded()
            await self._notify(chat_id, bot_key, reply)
            # ── 更新会话：记录产出文件 ──
            if snapshot_before:
                _, created, _ = self.runner.verify_output(bot_key, snapshot_before)
                self._update_session_after_task(chat_id, "", reply, created)
            # ── 清理无用文件 ──
            n = self.runner.cleanup_test_files(bot_key)
            j = self.runner.cleanup_junk(bot_key)
            if n > 0 or j > 0:
                print(f"[cleanup] {bot_key}: 删除了 {n} 个测试文件 + {j} 个垃圾文件")
            # ── 同步到队友记忆 ──
            self._sync_to_teammates(bot_key, command, reply)
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
            "- 做了技术决策直接在回复里 @队友 说明，系统会自动同步\n\n"
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

    # ── OpenMOSS 风格：Review + Checklist ───────────────

    @staticmethod
    def _extract_checklist(prd: str) -> str:
        """从 PRD 中提取验收 Checklist（- [ ] 格式的行）。"""
        lines: list[str] = []
        in_checklist = False
        for line in prd.split("\n"):
            stripped = line.strip()
            if re.search(r"验收\s*[Cc]hecklist|检查清单|功能清单", stripped):
                in_checklist = True
                continue
            if in_checklist:
                if stripped.startswith("- [") or stripped.startswith("* ["):
                    lines.append(stripped)
                elif stripped.startswith("#") or (stripped and not stripped.startswith("-")):
                    break  # 遇到新章节，结束
        return "\n".join(lines) if lines else ""

    async def _pm_review(self, task: TaskState, fe_text: str, be_text: str) -> dict:
        """PM Light Review：对照 PRD 验收标准快速审查 FE/BE 产出。

        返回 {"fe_pass": bool, "be_pass": bool, "fe_feedback": str, "be_feedback": str,
               "review_text": str, "checked_items": str}
        """
        import re as _re

        acceptance = self._extract_section(task.prd, ["验收标准", "验收", "Acceptance"])
        api_text = ""
        api_path = SHARED_DIR / "API_CONTRACT.md"
        if api_path.exists():
            api_text = api_path.read_text(encoding="utf-8")[:800]

        checklist = task.checklist or self._extract_checklist(task.prd)

        review_prompt = (
            f"[Light Review] 对照你 PRD 的验收标准，快速审查 FE 和 BE 的产出。2-3句话即可。\n\n"
            f"验收标准：\n{acceptance}\n\n"
            f"{'API 契约：\n' + api_text + '\n\n' if api_text else ''}"
            f"{'验收 Checklist：\n' + checklist + '\n\n' if checklist else ''}"
            f"FE 产出（前600字）：\n{fe_text[:600]}\n\n"
            f"BE 产出（前600字）：\n{be_text[:600]}\n\n"
            f"逐项判断。回复格式（严格）：\n"
            f"FE: PASS 或 FAIL — 原因（一句话）\n"
            f"BE: PASS 或 FAIL — 原因（一句话）\n"
            f"{'如果 Checklist 中有已完成项，用 ✅ 标注：' + chr(10) + checklist if checklist else ''}"
        )

        result = await self.runner.run_with_timeout(
            self.pm, review_prompt, max_tokens=2048, timeout=120, max_rounds=12, intent="plan",
        )

        review_text = result.get("result", "") if result["success"] else ""
        fe_pass = bool(_re.search(r'FE\s*:\s*PASS', review_text, _re.IGNORECASE))
        be_pass = bool(_re.search(r'BE\s*:\s*PASS', review_text, _re.IGNORECASE))

        # 提取反馈
        fe_fb = ""
        be_fb = ""
        for line in review_text.split("\n"):
            if line.strip().upper().startswith("FE:") and not fe_pass:
                fe_fb = line.strip()
            if line.strip().upper().startswith("BE:") and not be_pass:
                be_fb = line.strip()

        # 提取勾选后的 checklist
        checked = ""
        for line in review_text.split("\n"):
            if "✅" in line and ("- [" in line or "* [" in line):
                checked += line.strip() + "\n"

        return {
            "fe_pass": fe_pass,
            "be_pass": be_pass,
            "fe_feedback": fe_fb,
            "be_feedback": be_fb,
            "review_text": review_text,
            "checked_items": checked.strip(),
        }

    # ── 跨 Agent 对话同步 ──────────────────────────────

    def _sync_to_teammates(self, source_key: str, user_msg: str, reply: str) -> None:
        """将当前 Agent 的工作摘要同步到队友笔记中。

        写入 notes（持久层），不写 memory（避免污染队友的对话上下文）。
        notes 会在队友下次 run() 时通过 _build_notes_preamble 自动注入，
        同时 write_notes 内置去重防止重复通知。
        """
        if len(reply) < 50:
            return

        agents_map = {"pm": self.pm, "fe": self.fe, "be": self.be}
        source_name = {"pm": "小吴", "fe": "小柯", "be": "酱瓜"}.get(source_key, source_key)

        # 提取任务摘要（复用 _extract_summary）
        task_summary = self._extract_summary(reply)

        # 提取文件变更（从 reply 中的 📄 标记）
        files = []
        for line in reply.split("\n"):
            if "📄" in line:
                fname = line.split("📄")[-1].strip()
                if fname:
                    files.append(fname)

        # 构建笔记
        if files:
            file_str = "、".join(files[:5])
            if len(files) > 5:
                file_str += f" 等{len(files)}个文件"
            note = f"[队友] {source_name} 完成「{task_summary}」— {file_str}"
        else:
            note = f"[队友] {source_name} 完成「{task_summary}」"

        # 写入队友 notes（不污染 memory）
        for key, agent in agents_map.items():
            if key != source_key:
                agent.write_notes(note)

    # ── 消息发送（OpenClaw 风格）─────────────────────────

    @staticmethod
    def _text_to_post(text: str, name_map: dict, bot_key: str, bots: dict) -> list:
        """将带 @名字 的文本转为飞书 post 格式的 content 数组。"""
        import re
        # 按 @名字 分割文本，保留分隔符
        pattern = "|".join(re.escape(f"@{n}") for n in name_map)
        parts = re.split(f"({pattern})", text)
        content: list[dict] = []
        for part in parts:
            if not part:
                continue
            if part.startswith("@") and part[1:] in name_map:
                key = name_map[part[1:]]
                if key == bot_key:
                    content.append({"tag": "text", "text": part})
                else:
                    target = bots.get(key, {})
                    content.append({
                        "tag": "at",
                        "user_id": target.get("open_id") or target.get("app_id", ""),
                        "user_name": target.get("name", part[1:]),
                    })
            else:
                content.append({"tag": "text", "text": part})
        return content

    @staticmethod
    def _md_to_plain(text: str) -> str:
        """将 Markdown 转为飞书可读的纯文本。保留结构感。"""
        import re
        # 粗体 → 保留文字
        text = re.sub(r'\*\*(.+?)\*\*', r'\1', text)
        text = re.sub(r'\*(.+?)\*', r'\1', text)
        # 行内代码
        text = re.sub(r'`([^`]+)`', r'\1', text)
        # 表格分隔线 → 短横线
        text = re.sub(r'^\|[-:\|\s]+\|$', '', text, flags=re.MULTILINE)
        # 表格行 → 空格分隔
        text = re.sub(r'^\|(.+)\|$', lambda m: '  ' + ' | '.join(c.strip() for c in m.group(1).split('|')), text, flags=re.MULTILINE)
        # 标题 → 【】
        text = re.sub(r'^####? (.+)$', r'【\1】', text, flags=re.MULTILINE)
        text = re.sub(r'^## (.+)$', r'\n【\1】', text, flags=re.MULTILINE)
        text = re.sub(r'^# (.+)$', r'\n【\1】', text, flags=re.MULTILINE)
        # 代码块 → 保留缩进风格
        text = re.sub(r'```[a-z]*\n', '', text)
        text = text.replace('```', '')
        # 水平线
        text = re.sub(r'^---+$', '—————————————', text, flags=re.MULTILINE)
        # 多余空行压缩
        text = re.sub(r'\n{4,}', '\n\n\n', text)
        return text.strip()

    @staticmethod
    def _smart_split(text: str, max_len: int = 1800) -> list[str]:
        """OpenClaw 风格智能分片：优先在标题/空行处断开，绝不拆代码块。

        断点优先级: ## 标题 > 空行 > 列表项 > 句号 > 逗号 > 硬截断
        """
        if len(text) <= max_len:
            return [text]

        lines = text.split("\n")
        chunks: list[str] = []
        current: list[str] = []
        in_code_block = False

        for line in lines:
            # 追踪代码块边界
            if line.strip().startswith("```"):
                in_code_block = not in_code_block

            tentative = "\n".join(current + [line]) if current else line

            if len(tentative) <= max_len:
                current.append(line)
            else:
                # 需要断开——但不在代码块内部硬断
                if in_code_block:
                    # 代码块内：尽量留着，实在放不下才断
                    if current:
                        chunks.append("\n".join(current))
                    current = [line]
                elif current:
                    chunks.append("\n".join(current))
                    current = [line]
                else:
                    # 单行就超长（极端情况），硬断
                    chunks.append(line[:max_len])
                    current = [line[max_len:]] if len(line) > max_len else []

        if current:
            chunks.append("\n".join(current))

        # ── 合并过短的 chunk（coalesce）──
        merged: list[str] = []
        for chunk in chunks:
            if merged and len(chunk) < 200 and len(merged[-1]) + len(chunk) < max_len:
                merged[-1] = merged[-1] + "\n" + chunk
            else:
                merged.append(chunk)

        return merged

    async def _send_long_message(self, chat_id: str, bot_key: str, text: str,
                                  at_users: list[str] | None = None) -> None:
        """发送消息：Markdown→纯文本 → @名字→post at 元素 → 飞书发送。"""
        import random as _random

        # Markdown → 纯文本
        text = self._md_to_plain(text)
        if not text.strip():
            return

        bot = self._get_bot_config(bot_key)
        if not bot.get("app_id"):
            print(f"[orchestrator] {bot_key} Bot 未配置，模拟发送: {text[:80]}...")
            return

        # ── @名字→post at / text <at> ──
        _NAME_TO_BOT_KEY = {
            "小柯": "fe", "柯": "fe", "前端": "fe", "AI小柯（前端）": "fe",
            "酱瓜": "be", "瓜": "be", "后端": "be", "AI酱瓜（后端开发工程师）": "be",
            "小吴": "pm", "吴": "pm", "产品经理": "pm", "AI小吴（产品经理）": "pm",
        }
        post_content = None
        for name, key in _NAME_TO_BOT_KEY.items():
            if f"@{name}" in text and key != bot_key:
                target_bot = BOTS.get(key, {})
                target_id = target_bot.get("open_id", "")
                if target_id:
                    if post_content is None:
                        post_content = self._text_to_post(text, _NAME_TO_BOT_KEY, bot_key, BOTS)
                    break
                else:
                    # 无 open_id → text <at> 标签兜底
                    target_id = target_bot.get("app_id", "")
                    display_name = target_bot.get("name", name)
                    if target_id:
                        text = text.replace(f"@{name}", f'<at user_id="{target_id}">{display_name}</at>')
        # 有 open_id → post 格式（飞书 @ 通知正确触发），无 → text 兜底
        if post_content is not None:
            result = await send_message(
                app_id=bot["app_id"], app_secret=bot["app_secret"],
                chat_id=chat_id, text=text, msg_type="post", post_content=post_content,
            )
            if not result["success"]:
                print(f"[orchestrator] {bot_key} Bot post 消息发送失败: {result['msg']}")
        else:
            chunks = self._smart_split(text, max_len=1800)
        total = len(chunks)
        for i, chunk in enumerate(chunks):
            if total > 1:
                chunk = f"({i + 1}/{total})\n" + chunk.strip() if i > 0 else chunk
            result = await send_message(
                app_id=bot["app_id"], app_secret=bot["app_secret"],
                chat_id=chat_id, text=chunk,
            )
            if not result["success"]:
                print(f"[orchestrator] {bot_key} Bot 分片{i+1}发送失败: {result['msg']}")

            if i < total - 1:
                await asyncio.sleep(_random.uniform(1.0, 2.5))

    async def _notify(self, chat_id: str, bot_key: str, text: str, at_users: list[str] | None = None) -> None:
        """用指定 Bot 的身份向群聊发消息。长消息自动分片，Markdown 自动转纯文本。"""
        await self._send_long_message(chat_id, bot_key, text, at_users)

    def get_task_state(self, task_id: str) -> dict | None:
        task = self._tasks.get(task_id)
        return task.to_dict() if task else None
