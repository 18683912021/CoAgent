"""Agent 基类：Anthropic SDK 封装 + 记忆管理 + 工具调用循环"""
import os
import json
from datetime import datetime
from pathlib import Path
from typing import Any, Callable

from anthropic import Anthropic
from dotenv import load_dotenv

load_dotenv()

_client = Anthropic(
    base_url=os.environ["ANTHROPIC_BASE_URL"],
    api_key=os.environ["ANTHROPIC_API_KEY"],
    timeout=360.0,      # 单次 HTTP 请求超时：6 分钟
    max_retries=2,       # SDK 层重试 2 次
)
DEFAULT_MODEL = os.environ.get("ANTHROPIC_MODEL", "deepseek-v4-pro")
AGENT_TIMEOUT = 360      # Agent 整体执行超时（秒）
# 共享记忆已移除——Agent 之间通过 workspace/shared/ 目录通信更可靠


class BaseAgent:
    """所有 Agent 的基类。封装 LLM 调用、记忆管理和工具循环。"""

    def __init__(
        self,
        name: str,
        system_prompt: str,
        memory_file: str,
        tools: list[dict] | None = None,
        workspace: str | None = None,
        model: str | None = None,
    ):
        self.name = name
        self.system_prompt = system_prompt
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
        # 上下文压缩：超 20 条时压缩旧消息为摘要
        if len(self._memory) > 20:
            self._compact_memory()
        self._save_memory()

    def _compact_memory(self) -> None:
        """OpenClaw 风格分阶段压缩：按重要性分权重，保护关键信息。

        - 关键技术内容（代码、决策、API）→ 保留 500 字
        - 重要对话（工具调用、长回复）→ 保留 200 字
        - 普通闲聊 → 保留 80 字
        """
        old_entries = self._memory[:10]

        critical: list[str] = []
        important: list[str] = []
        routine: list[str] = []

        _CRITICAL_SIGNALS = [
            "```", "API", "接口", "数据库", "选型", "架构", "数据模型",
            "技术决策", "DECISION", "PRD", "契约", "表结构", "索引",
            "write_file", "创建了", "生成了",
        ]
        _IMPORTANT_SIGNALS = [
            "search_web", "read_file", "list_dir", "竞品", "调研",
            "需求", "功能", "方案", "实现", "write_file",
        ]

        for entry in old_entries:
            c = entry.get("content", "")
            if isinstance(c, list):
                # 工具调用列表 → 提取工具名
                tools = [t.get("name", "") for t in c if isinstance(t, dict)]
                c = "调用工具: " + ", ".join(tools)
            if not isinstance(c, str) or len(c.strip()) < 3:
                continue

            clean = c.replace("[群呼上下文]", "").replace("[长期记忆]", "")\
                      .replace("[系统提示]", "").replace("[个人记忆]", "")\
                      .replace("[Chat Budget]", "").replace("[上下文压缩]", "").strip()

            if any(s in clean for s in _CRITICAL_SIGNALS):
                critical.append(clean[:500])
            elif any(s in clean for s in _IMPORTANT_SIGNALS):
                important.append(clean[:200])
            else:
                routine.append(clean[:80])

        # 合并：关键 → 重要 → 普通（最多 10 条）
        all_snippets = critical + important + routine
        if not all_snippets:
            self._memory = self._memory[10:]
            return

        summary_text = " | ".join(all_snippets[:10])
        compacted = {
            "role": "system",
            "content": f"[上下文压缩] {summary_text}",
        }
        self._memory = [compacted] + self._memory[10:]

    # ── Honcho 风格事实提取 ──────────────────────────

    def _extract_facts_from(self, text: str) -> None:
        """从用户消息中提取关键事实（决策/偏好/命名/需求）。"""
        _skip_prefixes = [
            "[群呼上下文]", "[长期记忆]", "[系统提示]", "[团队共享记忆]",
            "[个人记忆]", "[Chat Budget]", "[上下文压缩]", "[来自",
            "[系统验证]", "[编译检查]", "[结构检查]",
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
        # 最多保留 15 条
        if len(self._facts) > 15:
            self._facts = self._facts[-15:]

        self._save_memory()

    def _build_facts_preamble(self) -> str:
        """构建记忆注入：个人长期记忆。"""
        if not self._facts:
            return ""
        facts_text = "\n".join(f"- {f}" for f in self._facts[-8:])
        return f"[个人记忆] 你记得以下关于用户的事：\n{facts_text}\n"

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
        # 超过 60 行时裁剪旧条目
        lines = existing.split("\n") if existing else []
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

    def _extract_decisions(self, text: str) -> list[str]:
        """从 Agent 回复中提取技术决策，写入精选记忆。"""
        decisions: list[str] = []
        _decision_signals = [
            "选型", "决定", "技术栈", "架构", "数据库", "用 ", "采用",
            "方案是", "最终方案", "确认使用", "选了", "定为",
        ]
        for line in text.split("\n"):
            line = line.strip()
            if 10 < len(line) < 200 and any(s in line for s in _decision_signals):
                if not line.startswith("#") and not line.startswith("["):
                    decisions.append(line)
        # 去重：相邻相似条目只保留第一个
        deduped: list[str] = []
        for d in decisions:
            if not deduped or not any(d[:30] in prev[:30] for prev in deduped):
                deduped.append(d)
        return deduped[:2]

    # ── 缓存友好的 Prompt 构建 ────────────────────────

    def _build_mode_reminder(self, intent: str) -> str:
        """模式提示：按意图类型返回对应的行为约束。"""
        if intent == "chat":
            return "\n\n[Chat Budget] 闲聊模式。回复控制在3句话以内，不要展开分析或追问需求。"
        elif intent == "read":
            return "\n\n[Read 模式] 用户发了文档/链接让你看。先读内容，然后给2-3句简要摘要。不要展开分析、不要写代码、不要追问需求——除非用户明确让你基于文档做具体的事。读完告诉用户你看了什么、大概是什么内容，表示你已了解。有活跃任务时可以提一句这个文档和当前任务的关系。"
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

        # ── Honcho 风格：注入长期记忆 ──
        facts_preamble = self._build_facts_preamble()
        augmented_message = f"{facts_preamble}\n{user_message}" if facts_preamble else user_message

        response = _client.messages.create(
            model=self.model,
            max_tokens=max_tokens,
            system=self.system_prompt,
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

    def run(self, user_message: str, max_rounds: int = 5, max_tokens: int = 8192,
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

        # ── 注入个人记忆 + 今日日志 ──
        facts_preamble = self._build_facts_preamble()
        daily_preamble = self._build_daily_preamble()
        preamble = (facts_preamble + daily_preamble).strip()
        augmented_message = f"{preamble}\n\n{user_message}" if preamble else user_message

        # 添加用户消息到记忆
        self._add_to_memory("user", user_message)

        # 模式提示（动态区，每次可能不同）
        mode_reminder = self._build_mode_reminder(intent)

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

            response = _client.messages.create(
                model=self.model,
                max_tokens=max_tokens,
                system=self.system_prompt + mode_reminder,
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
            for tu in tool_uses:
                # ── 进度：工具开始 ──
                detail = self._progress_detail(tu["name"], tu["input"])
                if on_progress:
                    on_progress("tool_start", tu["name"], detail)

                output = self._execute_tool(tu["name"], tu["input"])

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
        elif tool_name == "read_file":
            return str(args.get("path", ""))[:80]
        elif tool_name == "list_dir":
            return str(args.get("path", "."))[:60]
        return ""


# ── 进度事件配置 ────────────────────────────────────────

# 工具完成事件只对"有副作用的工具"发送，纯读操作不发完成事件，减少噪音
_PROGRESS_WORTH_TOOLS = {"search_web", "read_feishu_doc", "read_feishu_wiki",
                          "search_feishu_wiki", "read_feishu_bitable", "write_file"}
