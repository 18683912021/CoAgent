"""后端开发 Agent"""
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

PROMPT_FILE = Path(__file__).parent.parent / "prompts" / "be_prompt.md"
MEMORY_FILE = Path(__file__).parent.parent / "memory" / "memory-be.md"
WORKSPACE = "be"  # 相对于 WORKSPACE_ROOT 的子目录


class BEAgent(BaseAgent):
    """后端开发 Agent —— 生成后端代码（FastAPI + SQLAlchemy）"""

    def __init__(self, model: str | None = None):
        system_prompt = PROMPT_FILE.read_text(encoding="utf-8")
        super().__init__(
            name="BE",
            system_prompt=system_prompt,
            memory_file=str(MEMORY_FILE),
            tools=[READ_FILE_TOOL_SPEC, WRITE_FILE_TOOL_SPEC, LIST_DIR_TOOL_SPEC],
            workspace=str(Path(__file__).parent.parent / "workspace" / "be"),
            model=model,
        )

    def _execute_tool(self, name: str, args: dict) -> str:
        """BE Agent 的工具实现 —— 仅在 workspace/be/ 内操作"""
        if name == "read_file":
            return read_file(WORKSPACE, args.get("path", ""))
        elif name == "write_file":
            return write_file(WORKSPACE, args.get("path", ""), args.get("content", ""))
        elif name == "list_dir":
            return list_dir(WORKSPACE, args.get("path", "."))
        return super()._execute_tool(name, args)
