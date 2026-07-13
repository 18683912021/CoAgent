"""Agent 基类：Anthropic SDK 封装 + 记忆管理 + 工具调用循环"""
import asyncio
import json
import os
import re
import threading
from datetime import datetime
from pathlib import Path
from typing import Any, Callable

from anthropic import Anthropic
from dotenv import load_dotenv

load_dotenv()

_client = Anthropic(
    base_url=os.environ["ANTHROPIC_BASE_URL"],
    api_key=os.environ["ANTHROPIC_API_KEY"],
    timeout=1440.0,     # 单次 HTTP 请求超时：24 分钟
    max_retries=4,       # SDK 层重试 4 次
)
DEFAULT_MODEL = os.environ.get("ANTHROPIC_MODEL", "deepseek-v4-pro")
AGENT_TIMEOUT = 1440     # Agent 整体执行超时（秒）

# 线程安全的事件循环：在 ThreadPoolExecutor 子线程中复用同一个 loop，
# 避免 asyncio.run() 反复创建/销毁 kqueue（macOS）导致 fd 耗尽。
_thread_loops = threading.local()


def _get_thread_loop() -> asyncio.AbstractEventLoop:
    """获取当前线程的事件循环。每线程只创建一次，后续复用。"""
    if not hasattr(_thread_loops, "loop") or _thread_loops.loop.is_closed():
        _thread_loops.loop = asyncio.new_event_loop()
        asyncio.set_event_loop(_thread_loops.loop)
    return _thread_loops.loop


def run_async(coro):
    """在同步上下文中安全运行异步协程。线程安全，兼容 ThreadPoolExecutor。"""
    loop = _get_thread_loop()
    return loop.run_until_complete(coro)
# 共享记忆已移除——Agent 之间通过 workspace/shared/ 目录通信更可靠


class BaseAgent:
    """所有 Agent 的基类。封装 LLM 调用、记忆管理和工具循环。"""

    # ── Prompt Cache 开关 ─────────────────────────────
    # 设为 False 可关闭 cache_control（兼容不支持缓存的 API 端点）
    ENABLE_PROMPT_CACHE = True

    def __init__(
        self,
        name: str,
        system_prompt: str,
        memory_file: str,
        tools: list[dict] | None = None,
        workspace: str | None = None,
        model: str | None = None,
        core_system_prompt: str | None = None,
    ):
        self.name = name
        self.system_prompt = system_prompt              # 完整 prompt（backward compat）
        self._core_system_prompt = core_system_prompt or system_prompt  # 裁剪版（chat 用）
        self._full_system_prompt = system_prompt        # 完整版（work/plan/read 用）
        self._static_system_prompt = system_prompt      # 当前生效的静态 prompt（run 时根据 intent 切换）
        self.memory_file = Path(memory_file)
        self.tools = tools or []
        self.workspace = Path(workspace) if workspace else None
        self.model = model or DEFAULT_MODEL
        self._memory: list[dict] = []
        self._facts: list[str] = []

        # 初始化工作目录
        if self.workspace:
            self.workspace.mkdir(parents=True, exist_ok=True)

        # 加载历史记忆
        self._load_memory()

    # ── 记忆管理 ───────────────────────────────────────

    def _load_memory(self) -> None:
        """从文件加载历史上下文"""
        if self.memory_file.exists():
            try:
                data = json.loads(self.memory_file.read_text(encoding="utf-8"))
                if isinstance(data, dict):
                    self._memory = data.get("messages", [])
                    self._facts = data.get("facts", [])
                elif isinstance(data, list):
                    self._memory = data
            except (json.JSONDecodeError, ValueError):
                self._memory = []

    def _save_memory(self) -> None:
        """将当前上下文持久化到文件"""
        self.memory_file.parent.mkdir(parents=True, exist_ok=True)
        self.memory_file.write_text(
            json.dumps({
                "messages": self._memory,
                "facts": self._facts,
            }, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def _add_to_memory(self, role: str, content: str) -> None:
        """追加一条记录到记忆"""
        self._memory.append({"role": role, "content": content})
        # 从用户消息中提取关键事实
        if role == "user" and isinstance(content, str):
            self._extract_facts_from(content)
        # 从 Agent 产出中提取技术决策（work 模式的长回复）
        if role == "assistant" and isinstance(content, str) and len(content) > 200:
            for dec in self._extract_decisions(content):
                if dec not in self._facts:
                    self._facts.append(dec)
                self.write_notes(dec)  # 每轮写 notes，不等到压缩
        # 上下文压缩：超 30 条时调 LLM 做语义摘要（OpenClaw 风格）
        if len(self._memory) > 30:
            self._compact_memory()
        self._save_memory()

    def _compact_memory(self) -> None:
        """上下文压缩：文本拼接立即生效 + 后台 LLM 摘要异步升级。

        1. 提取旧消息中的文本内容（工具调用转为简短描述）
        2. 当前轮：纯文本拼接（瞬时，不阻塞 Agent）
        3. 后台：daemon 线程跑 LLM 摘要，完成后替换（下一轮受益）
        """
        old_entries = self._memory[:15]

        # ── 1. 构建摘要材料（含 tool_result，之前只取 tool_use）──
        text_entries: list[str] = []
        for entry in old_entries:
            c = entry.get("content", "")
            role = entry.get("role", "")
            if isinstance(c, list):
                tools = [t.get("name", "") for t in c if isinstance(t, dict) and t.get("type") == "tool_use"]
                if tools:
                    text_entries.append(f"[{role}] 调用: {', '.join(tools[:5])}")
                # 也收集 tool_result（其中常含文件列表、环境信息）
                for t in c:
                    if isinstance(t, dict) and t.get("type") == "tool_result":
                        r = t.get("content", "")
                        if isinstance(r, str) and len(r) > 10:
                            text_entries.append(f"[tool_result] {r[:400]}")
                continue
            if isinstance(c, str) and len(c.strip()) >= 3:
                clean = c.replace("[群呼上下文]", "").replace("[长期记忆]", "")\
                          .replace("[系统提示]", "").replace("[个人记忆]", "")\
                          .replace("[Chat Budget]", "").replace("[上下文压缩]", "")\
                          .replace("[任务延续]", "").strip()
                if clean:
                    text_entries.append(f"[{role}] {clean[:400]}")

        # ── 2. 压缩前锚点写入 notes（即使压缩后忘了，下次启动也能记起）──
        anchor = self._extract_anchor_facts(text_entries)
        anchor_note = self._format_anchor_summary(anchor)
        if anchor_note and not anchor_note.startswith("；"):
            self.write_notes(f"[压缩锚点] {anchor_note}")

        if len(text_entries) < 3:
            self._memory = self._memory[15:]
            return

        # ── 3. 结构化摘要替代纯文本拼接 ──
        summary = anchor_note if anchor_note else self._summarize_messages(text_entries)
        compacted = {
            "role": "system",
            "content": f"[上下文压缩] {summary}",
        }
        self._memory = [compacted] + self._memory[15:]

        # ── 后台：LLM 语义摘要，完成后自动替换（下一轮受益）──
        threading.Thread(
            target=self._async_upgrade_compact,
            args=(text_entries,),
            daemon=True,
        ).start()

    def _async_upgrade_compact(self, entries: list[str]) -> None:
        """后台线程：用 LLM 摘要升级已压缩的条目。线程安全（只改一条记录）。"""
        llm_summary = self._compact_memory_with_llm(entries)
        if llm_summary is None:
            return
        try:
            for m in self._memory:
                if m.get("role") == "system" and "[上下文压缩]" in str(m.get("content", "")):
                    m["content"] = f"[上下文压缩] {llm_summary}"
                    self._save_memory()
                    return
        except Exception:
            pass  # 后台任务失败静默忽略

    def _summarize_messages(self, entries: list[str]) -> str:
        """结构化摘要——从待压缩消息中提取锚点事实，保证关键信息不丢失。

        不再做盲目的文本拼接，而是识别消息里的实体（文件路径、端口、
        工具调用结果、关键决策），输出人类可读的结构化摘要。
        """
        anchor = self._extract_anchor_facts(entries)
        return self._format_anchor_summary(anchor)

    # ── 锚点事实提取（防失忆核心）──────────────────────

    def _extract_anchor_facts(self, entries: list[str]) -> dict:
        """从一批消息中提取不会过期的锚点事实。

        这些事实在压缩后仍然保留，防止 agent 忘记：
        - 自己写过/改过哪些文件
        - 启动了哪些服务、用了什么端口
        - 环境里有什么（Python/Docker/npm 版本等）
        - boss 的关键指令
        - 其他 agent 的动态
        """
        anchor: dict[str, set[str]] = {
            "files": set(),       # 文件路径
            "ports": set(),       # 端口
            "services": set(),    # 服务
            "env": set(),         # 环境信息
            "commands": set(),    # boss 关键指令
            "teammates": set(),   # 队友动态
            "decisions": set(),   # 技术决策
        }

        for entry_text in entries:
            # ── 文件路径提取 ──
            # 匹配: workspace/fe/xxx, workspace/be/xxx, src/xxx, modules/xxx
            for m in re.finditer(
                r"(?:workspace/)?(?:fe|be|shared|pm)/[\w/\-\.]+|"
                r"(?:src|modules|app|components|hooks|services)/[\w/\-\.]+",
                entry_text,
            ):
                path = m.group(0)
                if len(path) > 8 and not path.endswith((".", ",")):
                    anchor["files"].add(path)

            # ── 端口提取 ──
            for m in re.finditer(r"(?:port|端口)\s*[：:=]\s*(\d{4,5})", entry_text, re.IGNORECASE):
                anchor["ports"].add(m.group(1))
            for m in re.finditer(r"(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{4,5})", entry_text):
                anchor["ports"].add(m.group(1))

            # ── 服务启动检测 ──
            for kw in ["uvicorn", "gunicorn", "flask", "fastapi", "expo", "docker", "npm run"]:
                if kw in entry_text.lower():
                    anchor["services"].add(kw)

            # ── 环境信息 ──
            for m in re.finditer(
                r"(?:Python|python|Python3)\s*[\d.]+|"
                r"(?:Node|node)(?:\.js)?\s*v?[\d.]+|"
                r"(?:npm|pip|yarn)\s*[\d.]+|"
                r"Docker\s*(?:version\s*)?[\d.]+|"
                r"(?:已安装|已装|已就绪|not found|未安装|没装|不可用)",
                entry_text,
            ):
                anchor["env"].add(m.group(0))

            # ── boss 指令 ──
            for m in re.finditer(
                r"(?:boss|用户|老板)\s*[：:]\s*(.{10,80}?)(?:$|\n)",
                entry_text,
            ):
                anchor["commands"].add(m.group(1)[:80])

            # ── 队友动态 ──
            if "[队友动态]" in entry_text:
                for m in re.finditer(r"(?:小柯|小吴|酱瓜).{5,60}", entry_text):
                    anchor["teammates"].add(m.group(0)[:60])

            # ── 关键决策 ──
            for kw in ["决定", "选型", "确认", "锁定", "拍板", "约定", "铁律"]:
                if kw in entry_text:
                    # 取包含关键词的片段
                    idx = entry_text.find(kw)
                    snippet = entry_text[max(0, idx - 10):idx + 60].strip()
                    if len(snippet) > 10:
                        anchor["decisions"].add(snippet)

        return anchor

    def _format_anchor_summary(self, anchor: dict) -> str:
        """将锚点事实格式化为紧凑摘要。"""
        parts: list[str] = []

        if anchor["files"]:
            files_list = "、".join(sorted(anchor["files"])[:12])
            parts.append(f"📁 文件: {files_list}")
        if anchor["ports"]:
            parts.append(f"🔌 端口: {', '.join(sorted(anchor['ports']))}")
        if anchor["services"]:
            parts.append(f"⚙️ 服务: {', '.join(sorted(anchor['services']))}")
        if anchor["env"]:
            env_list = "、".join(sorted(anchor["env"])[:6])
            parts.append(f"🖥 环境: {env_list}")
        if anchor["commands"]:
            cmd_list = "；".join(sorted(anchor["commands"])[:5])
            parts.append(f"👤 boss: {cmd_list}")
        if anchor["teammates"]:
            tm_list = "；".join(sorted(anchor["teammates"])[:5])
            parts.append(f"👥 队友: {tm_list}")
        if anchor["decisions"]:
            dec_list = "；".join(sorted(anchor["decisions"])[:5])
            parts.append(f"✍️ 决策: {dec_list}")

        if not parts:
            # fallback：没有任何锚点时用旧逻辑
            return "；".join(
                e.split("] ", 1)[-1][:100] for e in
                [f"[fallback] {e[:100]}" for e in
                 sorted([str(v) for vs in anchor.values() for v in vs])[:8]]
            )

        return "\n".join(parts)

    # ── Honcho 风格事实提取 ──────────────────────────

    def _extract_facts_from(self, text: str) -> None:
        """从用户消息中提取关键事实（决策/偏好/命名/需求）。"""
        _skip_prefixes = [
            "[群呼上下文]", "[长期记忆]", "[系统提示]", "[团队共享记忆]",
            "[个人记忆]", "[Chat Budget]", "[上下文压缩]", "[来自",
            "[系统验证]", "[编译检查]", "[结构检查]", "[任务延续]",
        ]
        fact_signals = [
            "决定", "选", "偏好", "要求", "需要", "叫", "名字是",
            "用 ", "做", "写", "改用", "换成", "确认", "约定",
            "规定", "规范", "标准", "习惯", "喜欢", "不喜欢",
            "改成", "修改为", "命名为", "定义为",
        ]
        for line in text.split("\n"):
            line = line.strip()
            if any(line.startswith(p) for p in _skip_prefixes):
                continue
            if 5 < len(line) < 200 and any(s in line for s in fact_signals):
                if line not in self._facts:
                    self._facts.append(line)
        # 最多保留 15 条，旧 fact 归档到 notes 再删除
        if len(self._facts) > 15:
            for old_fact in self._facts[:-15]:
                self.write_notes(f"[归档] {old_fact}")
            self._facts = self._facts[-15:]

        self._save_memory()

    def _build_facts_preamble(self) -> str:
        """构建记忆注入：个人长期记忆 + 最近锚点事实。"""
        parts: list[str] = []

        # ── 个人事实 ──
        if self._facts:
            facts_text = "\n".join(f"- {f}" for f in self._facts[-8:])
            parts.append(f"[个人记忆] 你记得以下关于用户的事：\n{facts_text}")

        # ── 最近锚点（从 notes 文件尾部提取压缩锚点，防跨轮遗忘）──
        if self._notes_file.exists():
            notes = self._notes_file.read_text(encoding="utf-8")
            anchor_lines = [l for l in notes.split("\n") if "[压缩锚点]" in l]
            if anchor_lines:
                recent = anchor_lines[-3:]  # 最近 3 条锚点
                anchor_text = "\n".join(l.strip("- []") for l in recent)
                parts.append(f"[项目锚点] 你最近做过的关键操作：\n{anchor_text}")

        return "\n\n".join(parts) + "\n" if parts else ""

    # ── OpenClaw 风格：Markdown 记忆文件 ─────────────────

    @property
    def _notes_file(self) -> Path:
        """精选长期记忆（Markdown，人类可读，Agent 自主维护）。"""
        return self.memory_file.parent / f"notes-{self.name.lower()}.md"

    @property
    def _daily_dir(self) -> Path:
        return self.memory_file.parent / "daily"

    def write_notes(self, content: str) -> None:
        """追加一条精选记忆到 Markdown 文件。Agent 在 prompt 里被教导何时调用此方法。"""
        self._notes_file.parent.mkdir(parents=True, exist_ok=True)
        ts = datetime.now().strftime("%m-%d %H:%M")
        entry = f"- **[{ts}]** {content.strip()}\n"
        existing = self._notes_file.read_text(encoding="utf-8") if self._notes_file.exists() else ""
        lines = existing.split("\n") if existing else []
        # 简单去重：检查最近 3 条笔记是否已含相同内容（前 30 字匹配则跳过）
        content_prefix = content.strip()[:30]
        recent_entries = [l for l in lines[-6:] if l.startswith("- **[")]
        if any(content_prefix in l for l in recent_entries):
            return
        # 超过 60 行时裁剪旧条目
        if len(lines) > 60:
            lines = lines[:2] + lines[-58:]  # 保留标题 + 最近 58 行
        lines.append(entry)
        self._notes_file.write_text("\n".join(lines), encoding="utf-8")

    def write_daily_log(self, summary: str) -> None:
        """追加今日工作摘要。每天自动加载今天+昨天的日志。"""
        self._daily_dir.mkdir(parents=True, exist_ok=True)
        today = datetime.now().strftime("%Y-%m-%d")
        log_file = self._daily_dir / f"{today}-{self.name.lower()}.md"
        ts = datetime.now().strftime("%H:%M")
        entry = f"## {ts}\n\n{summary.strip()}\n\n"
        existing = log_file.read_text(encoding="utf-8") if log_file.exists() else f"# {self.name} 工作日志 — {today}\n\n"
        log_file.write_text(existing + entry, encoding="utf-8")

    def _build_daily_preamble(self) -> str:
        """加载今天 + 昨天的日志，注入到上下文中。"""
        today = datetime.now().strftime("%Y-%m-%d")
        yesterday = (datetime.now().replace(day=datetime.now().day - 1) if datetime.now().day > 1
                     else datetime.now()).strftime("%Y-%m-%d")  # 简化处理
        parts = []
        for date_str in (yesterday, today):
            log_file = self._daily_dir / f"{date_str}-{self.name.lower()}.md"
            if log_file.exists():
                content = log_file.read_text(encoding="utf-8")
                parts.append(content[-1500:])  # 只取最近 1500 字
        if parts:
            return "[今日日志] 最近的工作记录：\n" + "\n---\n".join(parts) + "\n"
        return ""

    def _build_notes_preamble(self) -> str:
        """加载精选笔记到上下文。和 _build_daily_preamble 相同模式。"""
        if self._notes_file.exists():
            content = self._notes_file.read_text(encoding="utf-8")
            recent = content[-2000:] if len(content) > 2000 else content
            return f"[长期记忆] 你之前记录的重要事项：\n{recent}\n"
        return ""

    def _extract_decisions(self, text: str) -> list[str]:
        """从 Agent 回复中提取关键信息，写入精选记忆。

        覆盖两类：技术决策（选型/架构）+ 调研发现（产品/竞品/行业洞察）。
        """
        decisions: list[str] = []
        _signals = [
            "选型", "决定", "技术栈", "架构", "数据库",
            "定位", "竞品", "核心功能", "产品概况", "商业模式",
            "用户量", "行业趋势", "定价",
        ]
        for line in text.split("\n"):
            line = line.strip()
            if not (10 < len(line) < 200):
                continue
            if line.startswith("#") or line.startswith("[") or line.startswith("|"):
                continue
            if any(s in line for s in _signals):
                decisions.append(line)
        deduped: list[str] = []
        for d in decisions:
            if not deduped or not any(d[:30] in prev[:30] for prev in deduped):
                deduped.append(d)
        return deduped[:3]

    # ── Lazy Context: 按意图切换 prompt ───────────────

    def _set_intent(self, intent: str) -> None:
        """根据意图选择 system prompt：chat 用裁剪版（省 token），其余用完整版。

        这是 Claude Code Lazy Context 策略的体现：不需要的时候不加载全部技能表。
        """
        if intent == "chat" and self._core_system_prompt != self._full_system_prompt:
            self._static_system_prompt = self._core_system_prompt
        else:
            self._static_system_prompt = self._full_system_prompt

    # ── Prompt Cache: 构建带 cache_control 的 system blocks ──

    def _build_system_blocks(self) -> list[dict]:
        """构建 system prompt blocks，最后一个 block 带 cache_control 断点。

        Anthropic API 的 cache 对前缀生效：system 最后一个 block 标记 cache_control
        → 整个 system prompt 被缓存。后续调用只要 system 不变，API 自动复用缓存，
        不需要重新计算这部分 token。
        """
        blocks = [{"type": "text", "text": self._static_system_prompt}]
        if self.ENABLE_PROMPT_CACHE:
            blocks[-1]["cache_control"] = {"type": "ephemeral"}
        return blocks

    @staticmethod
    def _build_ephemeral_prefix(intent: str) -> str:
        """构建动态前缀（mode_reminder），作为 ephemeral user 消息注入。

        为什么放在 user 消息而不是 system prompt？
        - System prompt 必须完全不变，cache 才有效
        - mode_reminder 按 intent 动态变化（chat/read/plan/work 各不同）
        - 放在 user 消息末尾不破坏前缀缓存
        """
        if intent == "chat":
            return "[Chat Budget] 闲聊模式。回复控制在3句话以内，不要展开分析或追问需求。"
        elif intent == "read":
            return ("[Read 模式] 先判断用户要你读什么："
                    "1) 用户提到了具体文件/文件夹路径 → 用 list_dir + read_file 直接读本地文件，不要搜索"
                    "2) 用户发了飞书文档链接 → 用 read_feishu_wiki / read_feishu_doc 读，不要搜索"
                    "3) 用户想了解某个话题/产品（无具体文件）→ 用 search_web 搜索 + web_fetch 读全文"
                    "读完给摘要，不要写代码。")
        elif intent == "plan":
            return "[Plan 模式] 只出分析和方案，不要写代码。说明思路、架构、选型理由即可。"
        return ""

    # ── Token 估算 ─────────────────────────────────────

    def _estimate_tokens(self) -> int:
        """估算当前上下文的 token 数（粗略：4 char ≈ 1 token）。

        用于日志监控和压缩阈值判断，不需要精确。
        """
        total = len(self._static_system_prompt) // 4
        for m in self._memory:
            content = m.get("content", "")
            if isinstance(content, str):
                total += len(content) // 4
            elif isinstance(content, list):
                total += sum(len(str(c)) // 4 for c in content)
        return total

    # ── 上下文压缩（升级：LLM 语义摘要 + 文本 fallback）──

    def _compact_memory_with_llm(self, entries: list[str]) -> str | None:
        """用 LLM 生成高质量上下文摘要。失败/超时返回 None，调用方 fallback 到文本拼接。

        使用独立短超时（15s），不阻塞 Agent 主流程。
        """
        if len(entries) < 3:
            return None
        joined = "\n".join(f"- {e[:300]}" for e in entries[:12])
        prompt = (
            "将以下对话历史总结为 ≤200 字的结构化中文摘要。"
            "保留：关键决策、文件变更、用户偏好、未完成事项。"
            "去掉：问候寒暄、工具调用细节、重复内容。\n\n"
            f"{joined}"
        )
        try:
            response = _client.messages.create(
                model=self.model,
                max_tokens=512,
                messages=[{"role": "user", "content": prompt}],
                timeout=15.0,
            )
            text = response.content[0].text if response.content else ""
            return text[:300] if text else None
        except Exception:
            return None

    # ── 缓存友好的 Prompt 构建 ────────────────────────

    def _build_mode_reminder(self, intent: str) -> str:
        """模式提示：按意图类型返回对应的行为约束。"""
        if intent == "chat":
            return "\n\n[Chat Budget] 闲聊模式。回复控制在3句话以内，不要展开分析或追问需求。"
        elif intent == "read":
            return ("\n\n[Read 模式] 先判断用户要你读什么："
                    "1) 用户提到了具体文件/文件夹路径 → 用 list_dir + read_file 直接读本地文件，不要搜索"
                    "2) 用户发了飞书文档链接 → 用 read_feishu_wiki / read_feishu_doc 读，不要搜索"
                    "3) 用户想了解某个话题/产品（无具体文件）→ 用 search_web 搜索 + web_fetch 读全文"
                    "读完给摘要，不要写代码。")
        elif intent == "plan":
            return "\n\n[Plan 模式] 只出分析和方案，不要写代码。说明思路、架构、选型理由即可。"
        return ""

    def _auto_log(self, result_text: str) -> None:
        """工作完成后自动写日志：技术决策 → notes，摘要 → daily。"""
        try:
            # 技术决策 → 精选记忆
            for dec in self._extract_decisions(result_text):
                self.write_notes(dec)
            # 摘要 → 每日日志
            summary = result_text[:300].replace("\n", " ").strip()
            self.write_daily_log(summary)
        except Exception:
            pass  # 记忆写入失败不影响主流程

    # ── LLM 调用 ───────────────────────────────────────

    def _build_messages(self, user_message: str) -> list[dict]:
        """构建消息列表：记忆上下文 + 当前用户消息"""
        messages = list(self._memory)
        messages.append({"role": "user", "content": user_message})
        return messages

    def _call_llm(
        self,
        user_message: str,
        tools: list[dict] | None = None,
        max_tokens: int = 4096,
    ) -> Any:
        """调用 Anthropic API，处理 thinking 和 tool_use"""
        tool_list = tools or self.tools

        # Anthropic SDK 需要的工具格式
        anthropic_tools = None
        if tool_list:
            anthropic_tools = [
                {
                    "name": t["name"],
                    "description": t.get("description", ""),
                    "input_schema": t.get("input_schema", {
                        "type": "object",
                        "properties": {},
                    }),
                }
                for t in tool_list
            ]
            if self.ENABLE_PROMPT_CACHE and anthropic_tools:
                anthropic_tools[-1]["cache_control"] = {"type": "ephemeral"}

        # ── Honcho 风格：注入长期记忆 ──
        facts_preamble = self._build_facts_preamble()
        augmented_message = f"{facts_preamble}\n{user_message}" if facts_preamble else user_message

        response = _client.messages.create(
            model=self.model,
            max_tokens=max_tokens,
            system=self._build_system_blocks(),
            tools=anthropic_tools,
            messages=self._build_messages(augmented_message),
        )

        self._add_to_memory("user", user_message)

        # 收集响应中的文本和工具调用
        text_parts = []
        tool_uses = []

        for block in response.content:
            if block.type == "text":
                text_parts.append(block.text)
            elif block.type == "tool_use":
                tool_uses.append({
                    "id": block.id,
                    "name": block.name,
                    "input": block.input,
                })

        result_text = "\n".join(text_parts)
        if result_text:
            self._add_to_memory("assistant", result_text)

        return {
            "text": result_text,
            "tool_uses": tool_uses,
        }

    # ── 工具执行循环 ──────────────────────────────────

    def run(self, user_message: str, max_rounds: int = 20, max_tokens: int = 16384,
            on_progress: Callable[[str, str, str], None] | None = None,
            intent: str = "work") -> dict:
        """执行一次 Agent 对话。支持多轮工具调用循环。

        Args:
            user_message: 用户指令
            max_rounds: 最大工具调用轮次，防止无限循环
            max_tokens: 最大输出 token 数
            on_progress: 进度回调 (event_type, tool_name, detail)，线程安全
            intent: 意图类型 (chat/read/plan/work)，影响模式提示词

        Returns:
            {"success": bool, "result": str, "error": str|None}
        """
        # ── 清理上次对话遗留的工具交互块（防 tool_use_id 不匹配）──
        self._memory = [
            m for m in self._memory
            if not (isinstance(m.get("content"), list) and len(m.get("content", [])) > 0
                    and m["content"][0].get("type") in ("tool_use", "tool_result"))
        ]

        # ── 工具死循环熔断：同工具同错误连续 3 次 → 中断 ──
        self._stuck_count = 0
        self._last_stuck_key = ""

        # ── Lazy Context：按意图选择 prompt 大小 ──
        self._set_intent(intent)

        # ── 注入个人记忆 + 今日日志 + 模式提示到用户消息（不破坏 system cache）──
        facts_preamble = self._build_facts_preamble()
        daily_preamble = self._build_daily_preamble()
        notes_preamble = self._build_notes_preamble()
        ephemeral = self._build_ephemeral_prefix(intent)
        preamble_parts = [p for p in [ephemeral, facts_preamble, daily_preamble, notes_preamble] if p]
        preamble = "\n\n".join(preamble_parts).strip()
        augmented_message = f"{preamble}\n\n---\n用户指令: {user_message}" if preamble else user_message

        # 添加用户消息到记忆
        self._add_to_memory("user", user_message)

        # ── System blocks（带 cache_control 断点）──
        system_blocks = self._build_system_blocks()

        # ── Token 估算（日志用）──
        est_tokens = self._estimate_tokens()
        if est_tokens > 8000:
            print(f"[{self.name}] ⚠️ 上下文较大：约 {est_tokens} tokens")

        for _round in range(max_rounds):
            # ── 进度：开始第 N 轮思考 ──
            if on_progress and _round > 0:
                on_progress("thinking", "", f"第{_round + 1}轮")

            # 从记忆构建消息，调用 LLM
            messages = list(self._memory)
            tool_list = self.tools
            anthropic_tools = None
            if tool_list:
                anthropic_tools = [
                    {
                        "name": t["name"],
                        "description": t.get("description", ""),
                        "input_schema": t.get("input_schema", {"type": "object", "properties": {}}),
                    }
                    for t in tool_list
                ]
                # 最后一个 tool 标记 cache_control：system + tools 前缀被缓存
                if self.ENABLE_PROMPT_CACHE and anthropic_tools:
                    anthropic_tools[-1]["cache_control"] = {"type": "ephemeral"}

            response = _client.messages.create(
                model=self.model,
                max_tokens=max_tokens,
                system=system_blocks,
                tools=anthropic_tools,
                messages=messages,
            )

            # 收集响应
            text_parts = []
            tool_uses = []
            for block in response.content:
                if block.type == "text":
                    text_parts.append(block.text)
                elif block.type == "tool_use":
                    tool_uses.append({
                        "id": block.id,
                        "name": block.name,
                        "input": block.input,
                    })

            result_text = "\n".join(text_parts)

            # 没有工具调用 → 完成
            if not tool_uses:
                if result_text:
                    self._add_to_memory("assistant", result_text)
                # ── 工作模式自动写日志 ──
                if max_tokens >= 4096 and len(result_text) > 200:
                    self._auto_log(result_text)
                return {
                    "success": True,
                    "result": result_text,
                    "error": None,
                }

            # 有工具调用 → 执行工具 → 追加到记忆
            assistant_content = []
            for tu in tool_uses:
                assistant_content.append({
                    "type": "tool_use",
                    "id": tu["id"],
                    "name": tu["name"],
                    "input": tu["input"],
                })
            self._memory.append({"role": "assistant", "content": assistant_content})

            tool_results = []
            stuck_tool = ""
            for tu in tool_uses:
                # ── 进度：工具开始 ──
                detail = self._progress_detail(tu["name"], tu["input"])
                if on_progress:
                    on_progress("tool_start", tu["name"], detail)

                output = self._execute_tool(tu["name"], tu["input"])

                # ── 熔断：同一工具同一错误连续 9 次 → 中断，防止死循环 ──
                stuck_key = f"{tu['name']}|{output[:120]}"
                if stuck_key == self._last_stuck_key:
                    self._stuck_count += 1
                else:
                    self._stuck_count = 1
                    self._last_stuck_key = stuck_key

                if self._stuck_count >= 9:
                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": tu["id"],
                        "content": output,
                    })
                    stuck_tool = tu["name"]
                    break

                # ── 进度：工具完成 ──
                if on_progress and tu["name"] in _PROGRESS_WORTH_TOOLS:
                    brief = output[:100].replace("\n", " ") if output else "(空)"
                    on_progress("tool_end", tu["name"], brief)

                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": tu["id"],
                    "content": output,
                })
            self._memory.append({"role": "user", "content": tool_results})

            if stuck_tool:
                return {
                    "success": False,
                    "result": "",
                    "error": f"工具 {stuck_tool} 连续失败 9 次，已中断防止死循环。请检查参数或换一种方式。",
                }

            self._save_memory()

        return {
            "success": False,
            "result": "",
            "error": f"超过最大工具调用轮次 ({max_rounds})",
        }

    def _execute_tool(self, name: str, args: dict) -> str:
        """执行工具调用。子类可重写以扩展工具。"""
        # 子类重写此方法实现具体工具逻辑
        return json.dumps({"error": f"Unknown tool: {name}"})

    @staticmethod
    def _progress_detail(tool_name: str, args: dict) -> str:
        """从工具参数中提取人类可读的进度描述。"""
        if tool_name == "search_web":
            return str(args.get("query", ""))[:80]
        elif tool_name == "web_fetch":
            return str(args.get("url", ""))[:60]
        elif tool_name == "read_feishu_doc":
            return str(args.get("doc_id", ""))[:40]
        elif tool_name == "read_feishu_wiki":
            return str(args.get("wiki_token", ""))[:40]
        elif tool_name == "search_feishu_wiki":
            return str(args.get("query", ""))[:80]
        elif tool_name == "read_feishu_bitable":
            return str(args.get("app_token", ""))[:40]
        elif tool_name == "write_file":
            return str(args.get("path", ""))[:80]
        elif tool_name == "edit_file":
            old = str(args.get("old_string", ""))[:30].replace("\n", " ")
            return f"{str(args.get('path', ''))[:60]} | -{old}..."
        elif tool_name == "read_file":
            return str(args.get("path", ""))[:80]
        elif tool_name == "list_dir":
            return str(args.get("path", "."))[:60]
        return ""


# ── 进度事件配置 ────────────────────────────────────────

# 工具完成事件只对"有副作用的工具"发送，纯读操作不发完成事件，减少噪音
_PROGRESS_WORTH_TOOLS = {"search_web", "web_fetch", "read_feishu_doc", "read_feishu_wiki",
                          "search_feishu_wiki", "read_feishu_bitable", "write_file", "edit_file"}
