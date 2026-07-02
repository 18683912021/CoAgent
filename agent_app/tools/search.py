"""Web 搜索工具"""
import httpx

SEARCH_TOOL_SPEC = {
    "name": "search_web",
    "description": "搜索互联网获取相关信息，返回结果摘要列表",
    "input_schema": {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "搜索关键词"},
        },
        "required": ["query"],
    },
}


async def search_web(query: str, max_results: int = 5) -> str:
    """执行 Web 搜索并返回格式化结果。

    原型阶段使用 DuckDuckGo 免费 API，无需 API Key。
    远期可替换为 Google/Bing Search API。
    """
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                "https://api.duckduckgo.com/",
                params={"q": query, "format": "json", "no_html": 1},
            )
            data = resp.json()

            results = []
            for item in data.get("RelatedTopics", [])[:max_results]:
                if isinstance(item, dict):
                    results.append({
                        "title": item.get("Text", "").split(" - ")[0][:100],
                        "snippet": item.get("Text", "")[:300],
                        "url": item.get("FirstURL", ""),
                    })

            if not results:
                # 兜底：返回纯文本搜索结果
                abstract = data.get("AbstractText", "")
                if abstract:
                    results.append({
                        "title": "DuckDuckGo Abstract",
                        "snippet": abstract[:300],
                        "url": data.get("AbstractURL", ""),
                    })

            if not results:
                return f"[search_web] 未找到与 '{query}' 相关的结果。"

            # 格式化为 LLM 友好的文本
            lines = [f"搜索 '{query}' 的结果 ({len(results)} 条):"]
            for i, r in enumerate(results, 1):
                lines.append(f"{i}. {r['title']}")
                lines.append(f"   {r['snippet']}")
                lines.append(f"   URL: {r['url']}")
            return "\n".join(lines)

    except Exception as e:
        return f"[search_web] 搜索失败: {e}"
