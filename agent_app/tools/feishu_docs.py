"""飞书云文档工具 —— 让 Agent 能读飞书文档/表格/知识库"""

import os

from tools.feishu_utils import (
    get_doc_content,
    get_bitable_records,
    search_wiki,
    get_wiki_node_content,
)


def _get_credentials() -> list[tuple[str, str, str]]:
    """返回所有已配置的 Bot 凭证列表 [(app_id, app_secret, label), ...]"""
    result = []
    for prefix, label in [("FEISHU_PM", "PM应用"), ("FEISHU_FE", "FE应用"), ("FEISHU_BE", "BE应用")]:
        aid = os.environ.get(f"{prefix}_APP_ID", "")
        secret = os.environ.get(f"{prefix}_APP_SECRET", "")
        if aid and secret:
            result.append((aid, secret, label))
    return result

async def _try_all_apps(action_name: str, api_call) -> str:
    """用所有已配置应用的凭证依次尝试调用 API。

    权限错误自动换下一个应用，其他错误直接返回。
    全部失败时给出明确的排查建议。
    """
    creds = _get_credentials()
    if not creds:
        return f"[{action_name}] 飞书凭证未配置，无法执行"

    permission_fails = []
    for app_id, app_secret, label in creds:
        result = await api_call(app_id, app_secret)
        if result["success"]:
            return result  # 成功，由外层函数继续处理

        msg = result.get("msg", "")
        if "Access denied" in msg or "permission" in msg.lower() or "scope" in msg.lower():
            permission_fails.append(f"  ❌ {label} — 未开通所需权限")
        else:
            return f"[{action_name}] 失败: {result['msg']}"  # 非权限错误，直接返回

    # 全部权限不足
    lines = [f"[{action_name}] 所有应用均无此权限："]
    lines.extend(permission_fails)
    lines.append("请在飞书开放平台 → 应用 → 权限管理 → 搜索对应权限 → 勾选 → 创建版本发布")
    return "\n".join(lines)

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
    """Agent 可调用的飞书文档读取工具。自动轮询三个应用凭证。"""
    if "/" in doc_id:
        doc_id = doc_id.rstrip("/").split("/")[-1]

    async def try_call(aid, sec):
        return await get_doc_content(aid, sec, doc_id)

    result = await _try_all_apps("read_feishu_doc", try_call)
    if isinstance(result, str):
        return result
    if result["success"]:
        return f"文档《{result['title']}》：\n{result['content']}"
    return f"[read_feishu_doc] 失败: {result['msg']}"


async def read_feishu_bitable(app_token: str, table_id: str) -> str:
    """Agent 可调用的飞书多维表格读取工具。自动轮询三个应用凭证。"""
    if "/" in app_token:
        parts = app_token.rstrip("/").split("/")
        for i, p in enumerate(parts):
            if p == "base" and i + 1 < len(parts):
                app_token = parts[i + 1].split("?")[0]
                break

    async def try_call(aid, sec):
        return await get_bitable_records(aid, sec, app_token, table_id)

    result = await _try_all_apps("read_feishu_bitable", try_call)
    if isinstance(result, str):
        return result
    if result["success"]:
        records = result["records"]
        lines = [f"多维表格记录（{len(records)} 条）："]
        for r in records[:20]:
            lines.append(f"  - {r['fields']}")
        return "\n".join(lines)
    return f"[read_feishu_bitable] 失败: {result['msg']}"


async def search_feishu_wiki(query: str) -> str:
    """Agent 可调用的飞书知识库搜索工具。自动轮询三个应用凭证。"""

    async def try_call(aid, sec):
        return await search_wiki(aid, sec, query)

    result = await _try_all_apps("search_feishu_wiki", try_call)
    if isinstance(result, str):
        return result
    if result["success"]:
        items = result["results"]
        if not items:
            return f"[search_feishu_wiki] 未找到与 '{query}' 相关的结果"
        lines = [f"Wiki 搜索结果（{len(items)} 条）："]
        for item in items:
            lines.append(f"  - 《{item['title']}》")
            lines.append(f"    {item['snippet'][:120]}")
        return "\n".join(lines)
    return f"[search_feishu_wiki] 失败: {result['msg']}"


async def read_feishu_wiki(wiki_token: str) -> str:
    """Agent 可调用的飞书 Wiki 文档读取工具。自动轮询三个应用凭证。"""
    if "/" in wiki_token or "feishu" in wiki_token:
        wiki_token = wiki_token.rstrip("/").split("/")[-1].split("?")[0]

    async def try_call(aid, sec):
        return await get_wiki_node_content(aid, sec, wiki_token)

    result = await _try_all_apps("read_feishu_wiki", try_call)
    if isinstance(result, str):
        return result
    if result["success"]:
        return f"Wiki《{result['title']}》：\n{result['content']}"
    return f"[read_feishu_wiki] 失败: {result['msg']}"
