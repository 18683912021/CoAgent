"""前端开发 Agent"""
import asyncio
from pathlib import Path

from agents.base import BaseAgent
from tools.code_editor import (
    READ_FILE_TOOL_SPEC, WRITE_FILE_TOOL_SPEC, EDIT_FILE_TOOL_SPEC, LIST_DIR_TOOL_SPEC,
    read_file, write_file, edit_file, list_dir,
)
from tools.search import SEARCH_TOOL_SPEC, search_web
from tools.web_fetch import WEB_FETCH_TOOL_SPEC, web_fetch
from tools.feishu_docs import (
    READ_DOC_TOOL_SPEC, READ_BITABLE_TOOL_SPEC, SEARCH_WIKI_TOOL_SPEC, READ_WIKI_TOOL_SPEC,
    read_feishu_doc, read_feishu_bitable, search_feishu_wiki, read_feishu_wiki,
)

PROMPT_FILE = Path(__file__).parent.parent / "prompts" / "fe" / "prompt.md"
MEMORY_FILE = Path(__file__).parent.parent / "memory" / "memory-fe.md"
PROJECT_ROOT = str(Path(__file__).parent.parent)


class FEAgent(BaseAgent):
    """前端开发 Agent —— 生成前端代码（React + TypeScript）"""

    def __init__(self, model: str | None = None):
        agents_md = (PROMPT_FILE.parent / "AGENTS.md").read_text(encoding="utf-8")
        prompt_md = PROMPT_FILE.read_text(encoding="utf-8")
        system_prompt = agents_md + "\n\n" + prompt_md
        super().__init__(
            name="FE",
            system_prompt=system_prompt,
            memory_file=str(MEMORY_FILE),
            tools=[READ_FILE_TOOL_SPEC, WRITE_FILE_TOOL_SPEC, EDIT_FILE_TOOL_SPEC, LIST_DIR_TOOL_SPEC,
                   SEARCH_TOOL_SPEC, WEB_FETCH_TOOL_SPEC,
                   READ_DOC_TOOL_SPEC, READ_BITABLE_TOOL_SPEC, SEARCH_WIKI_TOOL_SPEC,
                   READ_WIKI_TOOL_SPEC],
            workspace=str(Path(__file__).parent.parent / "workspace" / "fe"),
            model=model,
        )

    def _execute_tool(self, name: str, args: dict) -> str:
        """FE Agent 的工具实现 —— 读全局，写 workspace/fe/"""
        if name == "read_file":
            return read_file(PROJECT_ROOT, args.get("path", ""))
        elif name == "search_web":
            return asyncio.run(search_web(**args))
        elif name == "web_fetch":
            return asyncio.run(web_fetch(**args))
        elif name == "write_file":
            return write_file(PROJECT_ROOT, args.get("path", ""), args.get("content", ""))
        elif name == "edit_file":
            return edit_file(PROJECT_ROOT, args.get("path", ""),
                             args.get("old_string", ""), args.get("new_string", ""))
        elif name == "list_dir":
            return list_dir(PROJECT_ROOT, args.get("path", "."))
        elif name == "read_feishu_doc":
            return asyncio.run(read_feishu_doc(**args))
        elif name == "read_feishu_bitable":
            return asyncio.run(read_feishu_bitable(**args))
        elif name == "search_feishu_wiki":
            return asyncio.run(search_feishu_wiki(**args))
        elif name == "read_feishu_wiki":
            return asyncio.run(read_feishu_wiki(**args))
        return super()._execute_tool(name, args)
