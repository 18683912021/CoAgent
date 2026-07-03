"""飞书云文档工具 —— 让 Agent 能读飞书文档/表格/知识库"""

from tools.feishu_utils import (
    get_doc_content,
    get_bitable_records,
    search_wiki,
    get_wiki_node_content,
)

# ── Tool Specs ─────────────────────────────────────────

READ_DOC_TOOL_SPEC = {
    "name": "read_feishu_doc",
    "description": "读取飞书文档的完整内容。传入文档链接或文档ID，返回文档标题和正文。"
                   "例如用户说'参考这个文档'并发了飞书文档链接，就可以用这个工具读取。",
    "input_schema": {
        "type": "object",
        "properties": {
            "doc_id": {
                "type": "string",
                "description": "飞书文档ID。从文档URL中提取，如 https://xxx.feishu.cn/docx/ABCD1234 中的 ABCD1234",
            },
        },
        "required": ["doc_id"],
    },
}

READ_BITABLE_TOOL_SPEC = {
    "name": "read_feishu_bitable",
    "description": "读取飞书多维表格（Bitable）的数据记录。用于查看结构化的表格数据，如需求清单、任务列表等。",
    "input_schema": {
        "type": "object",
        "properties": {
            "app_token": {
                "type": "string",
                "description": "多维表格的 app_token，从 URL 中提取",
            },
            "table_id": {
                "type": "string",
                "description": "数据表 ID，从 URL 中提取",
            },
        },
        "required": ["app_token", "table_id"],
    },
}

SEARCH_WIKI_TOOL_SPEC = {
    "name": "search_feishu_wiki",
    "description": "搜索飞书知识库（Wiki）中的文章。用于查找团队文档、技术规范、历史决策记录等。",
    "input_schema": {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "搜索关键词",
            },
        },
        "required": ["query"],
    },
}

READ_WIKI_TOOL_SPEC = {
    "name": "read_feishu_wiki",
    "description": "读取飞书知识库（Wiki）中的一篇文档。传入 Wiki 链接或节点 token，返回文档标题和正文。"
                   "支持 docx 文档、多维表格等类型。用户分享 feishu.cn/wiki/XXX 链接时使用此工具。",
    "input_schema": {
        "type": "object",
        "properties": {
            "wiki_token": {
                "type": "string",
                "description": "Wiki 节点 token。从 URL 提取：https://xxx.feishu.cn/wiki/ABCD1234 中的 ABCD1234",
            },
        },
        "required": ["wiki_token"],
    },
}

# ── Tool Implementations ────────────────────────────────


async def read_feishu_doc(doc_id: str) -> str:
    """Agent 可调用的飞书文档读取工具。"""
    import os
    app_id = os.environ.get("FEISHU_PM_APP_ID", "")
    app_secret = os.environ.get("FEISHU_PM_APP_SECRET", "")
    if not app_id:
        return "[read_feishu_doc] 飞书凭证未配置"

    # 如果传入的是完整 URL，提取 doc_id
    if "/" in doc_id:
        doc_id = doc_id.rstrip("/").split("/")[-1]

    result = await get_doc_content(app_id, app_secret, doc_id)
    if result["success"]:
        title = result["title"]
        content = result["content"]
        return f"文档《{title}》：\n{content}"
    return f"[read_feishu_doc] 读取失败: {result['msg']}"


async def read_feishu_bitable(app_token: str, table_id: str) -> str:
    """Agent 可调用的飞书多维表格读取工具。"""
    import os
    app_id = os.environ.get("FEISHU_PM_APP_ID", "")
    app_secret = os.environ.get("FEISHU_PM_APP_SECRET", "")
    if not app_id:
        return "[read_feishu_bitable] 飞书凭证未配置"

    # 如果传入的是完整 URL，提取参数
    if "/" in app_token:
        parts = app_token.rstrip("/").split("/")
        # URL 格式: .../base/XXX?table=YYY
        for i, p in enumerate(parts):
            if p == "base" and i + 1 < len(parts):
                app_token = parts[i + 1].split("?")[0]
                break

    result = await get_bitable_records(app_id, app_secret, app_token, table_id)
    if result["success"]:
        records = result["records"]
        lines = [f"多维表格记录（{len(records)} 条）："]
        for r in records[:20]:
            lines.append(f"  - {r['fields']}")
        return "\n".join(lines)
    return f"[read_feishu_bitable] 读取失败: {result['msg']}"


async def search_feishu_wiki(query: str) -> str:
    """Agent 可调用的飞书知识库搜索工具。"""
    import os
    app_id = os.environ.get("FEISHU_PM_APP_ID", "")
    app_secret = os.environ.get("FEISHU_PM_APP_SECRET", "")
    if not app_id:
        return "[search_feishu_wiki] 飞书凭证未配置"

    result = await search_wiki(app_id, app_secret, query)
    if result["success"]:
        items = result["results"]
        if not items:
            return f"[search_feishu_wiki] 未找到与 '{query}' 相关的结果"
        lines = [f"Wiki 搜索结果（{len(items)} 条）："]
        for item in items:
            lines.append(f"  - 《{item['title']}》")
            lines.append(f"    {item['snippet'][:120]}")
        return "\n".join(lines)
    return f"[search_feishu_wiki] 搜索失败: {result['msg']}"


async def read_feishu_wiki(wiki_token: str) -> str:
    """Agent 可调用的飞书 Wiki 文档读取工具。

    自动识别 docx 文档、多维表格等节点类型并读取内容。
    用户分享 feishu.cn/wiki/XXX 链接时使用此工具。
    """
    import os
    app_id = os.environ.get("FEISHU_PM_APP_ID", "")
    app_secret = os.environ.get("FEISHU_PM_APP_SECRET", "")
    if not app_id:
        return "[read_feishu_wiki] 飞书凭证未配置"

    # 如果传入完整 URL，提取 node_token
    if "/" in wiki_token or "feishu" in wiki_token:
        wiki_token = wiki_token.rstrip("/").split("/")[-1].split("?")[0]

    result = await get_wiki_node_content(app_id, app_secret, wiki_token)
    if result["success"]:
        title = result["title"]
        content = result["content"]
        return f"Wiki《{title}》：\n{content}"
    return f"[read_feishu_wiki] 读取失败: {result['msg']}"
