"""Agent 基类：Anthropic SDK 封装 + 记忆管理 + 工具调用循环"""
import os
import json
from pathlib import Path
from typing import Any

from anthropic import Anthropic
from dotenv import load_dotenv

load_dotenv()

_client = Anthropic(
    base_url=os.environ["ANTHROPIC_BASE_URL"],
    api_key=os.environ["ANTHROPIC_API_KEY"],
)
DEFAULT_MODEL = os.environ.get("ANTHROPIC_MODEL", "deepseek-v4-pro")


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
        # 自动从用户消息中提取关键事实
        if role == "user" and isinstance(content, str):
            self._extract_facts_from(content)
        # 上下文压缩：超 20 条时压缩旧消息为摘要，而非直接丢弃
        if len(self._memory) > 20:
            self._compact_memory()
        self._save_memory()

    def _compact_memory(self) -> None:
        """压缩旧消息：取最旧 10 条 + 累积的 facts，生成一条摘要替代它们。

        OpenClaw 风格：保留历史的"轮廓"，不丢失关键上下文。
        """
        old_entries = self._memory[:10]

        # 收集旧消息中的关键片段
        snippets: list[str] = []
        for entry in old_entries:
            c = entry.get("content", "")
            if isinstance(c, str) and len(c.strip()) > 5:
                # 去掉系统前缀，取前 120 字
                clean = c.replace("[群呼上下文]", "").replace("[长期记忆]", "").replace("[系统提示]", "").strip()
                snippets.append(clean[:120])

        # 合并累积的 facts
        all_snippets = snippets + [f for f in self._facts[-5:] if f not in snippets]

        if not all_snippets:
            self._memory = self._memory[10:]
            return

        summary_text = "；".join(all_snippets[:6])
        compacted = {
            "role": "system",
            "content": f"[上下文压缩] 较早对话要点：{summary_text}",
        }

        # 保留摘要 + 最近 10 条
        self._memory = [compacted] + self._memory[10:]

    # ── Honcho 风格事实提取 ──────────────────────────

    def _extract_facts_from(self, text: str) -> None:
        """从用户消息中提取关键事实（决策/偏好/命名/需求）。"""
        fact_signals = ["决定", "选", "偏好", "要求", "需要", "叫", "名字是", "用 ", "做", "写"]
        for line in text.split("\n"):
            line = line.strip()
            if 5 < len(line) < 200 and any(s in line for s in fact_signals):
                # 去重
                if line not in self._facts:
                    self._facts.append(line)
        # 最多保留 15 条
        if len(self._facts) > 15:
            self._facts = self._facts[-15:]
        self._save_memory()

    def _build_facts_preamble(self) -> str:
        """构建记忆注入：从历史事实中生成'你记得'上下文。"""
        if not self._facts:
            return ""
        facts_text = "\n".join(f"- {f}" for f in self._facts[-8:])
        return f"[长期记忆] 你记得以下关于用户和项目的事：\n{facts_text}\n"

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

    def run(self, user_message: str, max_rounds: int = 5, max_tokens: int = 4096) -> dict:
        """执行一次 Agent 对话。支持多轮工具调用循环。

        Args:
            user_message: 用户指令
            max_rounds: 最大工具调用轮次，防止无限循环
            max_tokens: 最大输出 token 数，闲聊用 512，工作用 4096

        Returns:
            {"success": bool, "result": str, "error": str|None}
        """
        # ── Honcho 风格：注入长期记忆到用户消息前面 ──
        facts_preamble = self._build_facts_preamble()
        augmented_message = f"{facts_preamble}\n{user_message}" if facts_preamble else user_message

        # 添加用户消息到记忆
        self._add_to_memory("user", user_message)

        # 系统指令追加：Chat Budget 提醒
        budget_reminder = ""
        if max_tokens <= 512:
            budget_reminder = "\n\n[Chat Budget] 这是闲聊模式。回复控制在3句话以内，不要展开分析或追问需求。"

        for _round in range(max_rounds):
            # 从记忆构建消息，调用 LLM（不再重复添加 user 消息）
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
                system=self.system_prompt + budget_reminder,
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
                output = self._execute_tool(tu["name"], tu["input"])
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
