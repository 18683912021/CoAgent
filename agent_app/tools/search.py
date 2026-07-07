"""Web 搜索工具 —— Tavily（主）+ DuckDuckGo（兜底）

Tavily 专为 AI Agent 设计，返回结构化搜索结果，包含内容摘要和原始文本。
"""

import os
import httpx
from dotenv import load_dotenv

load_dotenv()

SEARCH_TOOL_SPEC = {
    "name": "search_web",
    "description": "搜索互联网获取最新信息。返回结果列表（标题+摘要+URL+内容），最多 8 条。",
    "input_schema": {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "搜索关键词"},
        },
        "required": ["query"],
    },
}

TAVILY_API_KEY = os.environ.get("TAVILY_API_KEY", "")


async def search_web(query: str, max_results: int = 8) -> str:
    """搜索互联网。优先用 Tavily，未配置时回退 DuckDuckGo。"""
    if TAVILY_API_KEY:
        return await _search_tavily(query, max_results)
    else:
        return await _search_duckduckgo(query, max_results)


async def _search_tavily(query: str, max_results: int) -> str:
    """Tavily Search API —— 专为 AI Agent 设计的搜索。"""
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.post(
                "https://api.tavily.com/search",
                json={
                    "api_key": TAVILY_API_KEY,
                    "query": query,
                    "max_results": min(max_results, 10),
                    "search_depth": "basic",
                    "include_answer": True,
                },
            )
            data = resp.json()

            results = data.get("results", [])
            if not results:
                return f"[search_web] 未找到与 '{query}' 相关的结果。"

            lines = [f"搜索 '{query}' 的结果 ({len(results)} 条):"]

            # Tavily 的 AI 摘要
            answer = data.get("answer", "")
            if answer:
                lines.append(f"[摘要] {answer}")

            for i, r in enumerate(results, 1):
                title = r.get("title", "")[:120]
                content = r.get("content", "")[:300]
                url = r.get("url", "")
                lines.append(f"{i}. {title}")
                lines.append(f"   {content}")
                lines.append(f"   {url}")

            return "\n".join(lines)

    except Exception:
        return await _search_duckduckgo(query, max_results)


async def _search_duckduckgo(query: str, max_results: int) -> str:
    """DuckDuckGo Instant Answer API —— 免费兜底。"""
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
                    text = item.get("Text", "")
                    if " - " in text:
                        title, snippet = text.split(" - ", 1)
                    else:
                        title, snippet = text[:100], text
                    results.append({
                        "title": title[:100],
                        "snippet": snippet[:300],
                        "url": item.get("FirstURL", ""),
                    })

            if not results:
                abstract = data.get("AbstractText", "")
                if abstract:
                    results.append({
                        "title": data.get("AbstractSource", "DuckDuckGo"),
                        "snippet": abstract[:300],
                        "url": data.get("AbstractURL", ""),
                    })

            if not results:
                return f"[search_web] 未找到与 '{query}' 相关的结果。"

            lines = [f"搜索 '{query}' 的结果 ({len(results)} 条):"]
            for i, r in enumerate(results, 1):
                lines.append(f"{i}. {r['title']}")
                lines.append(f"   {r['snippet']}")
                lines.append(f"   {r['url']}")
            return "\n".join(lines)

    except Exception:
        return f"[search_web] 搜索暂时不可用，请换其他方式获取信息。"
