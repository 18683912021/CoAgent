"""前端开发 Agent"""
from pathlib import Path

from agents.base import BaseAgent
from tools.code_editor import (
    READ_FILE_TOOL_SPEC,
    WRITE_FILE_TOOL_SPEC,
    LIST_DIR_TOOL_SPEC,
    read_file,
    write_file,
    list_dir,
)

PROMPT_FILE = Path(__file__).parent.parent / "prompts" / "fe_prompt.md"
MEMORY_FILE = Path(__file__).parent.parent / "memory" / "memory-fe.md"
WORKSPACE = "fe"  # 相对于 WORKSPACE_ROOT 的子目录


class FEAgent(BaseAgent):
    """前端开发 Agent —— 生成前端代码（React + TypeScript）"""

    def __init__(self, model: str | None = None):
        system_prompt = PROMPT_FILE.read_text(encoding="utf-8")
        super().__init__(
            name="FE",
            system_prompt=system_prompt,
            memory_file=str(MEMORY_FILE),
            tools=[READ_FILE_TOOL_SPEC, WRITE_FILE_TOOL_SPEC, LIST_DIR_TOOL_SPEC],
            workspace=str(Path(__file__).parent.parent / "workspace" / "fe"),
            model=model,
        )

    def _execute_tool(self, name: str, args: dict) -> str:
        """FE Agent 的工具实现 —— 仅在 workspace/fe/ 内操作"""
        if name == "read_file":
            return read_file(WORKSPACE, **args)
        elif name == "write_file":
            return write_file(WORKSPACE, **args)
        elif name == "list_dir":
            return list_dir(WORKSPACE, args.get("path", "."))
        return super()._execute_tool(name, args)
