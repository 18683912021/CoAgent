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
                self._memory = data if isinstance(data, list) else []
            except (json.JSONDecodeError, ValueError):
                self._memory = []

    def _save_memory(self) -> None:
        """将当前上下文持久化到文件"""
        self.memory_file.parent.mkdir(parents=True, exist_ok=True)
        self.memory_file.write_text(
            json.dumps(self._memory, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def _add_to_memory(self, role: str, content: str) -> None:
        """追加一条记录到记忆"""
        self._memory.append({"role": role, "content": content})
        # 保留最近 20 轮，避免记忆膨胀
        if len(self._memory) > 20:
            self._memory = self._memory[-20:]
        self._save_memory()

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

        response = _client.messages.create(
            model=self.model,
            max_tokens=max_tokens,
            system=self.system_prompt,
            tools=anthropic_tools,
            messages=self._build_messages(user_message),
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

    def run(self, user_message: str, max_rounds: int = 5) -> dict:
        """执行一次 Agent 对话。支持多轮工具调用循环。

        Args:
            user_message: 用户指令
            max_rounds: 最大工具调用轮次，防止无限循环

        Returns:
            {"success": bool, "result": str, "error": str|None}
        """
        current_message = user_message

        for _round in range(max_rounds):
            response = self._call_llm(current_message)

            # 没有工具调用 → 直接返回文本
            if not response["tool_uses"]:
                return {
                    "success": True,
                    "result": response["text"],
                    "error": None,
                }

            # 有工具调用 → 执行工具 → 将结果反馈给模型
            tool_results = []
            for tu in response["tool_uses"]:
                output = self._execute_tool(tu["name"], tu["input"])
                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": tu["id"],
                    "content": output,
                })

            # 构造下一轮消息
            assistant_content = []
            for tu in response["tool_uses"]:
                assistant_content.append({
                    "type": "tool_use",
                    "id": tu["id"],
                    "name": tu["name"],
                    "input": tu["input"],
                })

            self._memory.append({"role": "assistant", "content": assistant_content})
            self._memory.append({"role": "user", "content": tool_results})
            current_message = "(工具执行结果见上一条消息，请基于结果继续)"

        return {
            "success": False,
            "result": "",
            "error": f"超过最大工具调用轮次 ({max_rounds})",
        }

    def _execute_tool(self, name: str, args: dict) -> str:
        """执行工具调用。子类可重写以扩展工具。"""
        # 子类重写此方法实现具体工具逻辑
        return json.dumps({"error": f"Unknown tool: {name}"})
