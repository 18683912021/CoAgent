"""产品经理 Agent"""
from pathlib import Path

from agents.base import BaseAgent
from tools.search import SEARCH_TOOL_SPEC, search_web
from tools.feishu import SEND_MESSAGE_TOOL_SPEC, send_feishu_message

PROMPT_FILE = Path(__file__).parent.parent / "prompts" / "pm" / "prompt.md"
MEMORY_FILE = Path(__file__).parent.parent / "memory" / "memory-pm.md"
WORKSPACE = Path(__file__).parent.parent / "workspace" / "prd"


class PMAgent(BaseAgent):
    """产品经理 Agent —— 需求分析、PRD 生成、任务拆分"""

    def __init__(self, model: str | None = None):
        agents_md = (PROMPT_FILE.parent / "AGENTS.md").read_text(encoding="utf-8")
        prompt_md = PROMPT_FILE.read_text(encoding="utf-8")
        system_prompt = agents_md + "\n\n" + prompt_md
        super().__init__(
            name="PM",
            system_prompt=system_prompt,
            memory_file=str(MEMORY_FILE),
            tools=[SEARCH_TOOL_SPEC, SEND_MESSAGE_TOOL_SPEC],
            workspace=str(WORKSPACE),
            model=model,
        )

    def _execute_tool(self, name: str, args: dict) -> str:
        """PM Agent 的工具实现"""
        import asyncio

        if name == "search_web":
            return asyncio.run(search_web(**args))
        elif name == "send_feishu_message":
            return asyncio.run(send_feishu_message(**args))
        return super()._execute_tool(name, args)
