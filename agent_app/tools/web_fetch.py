"""网页抓取工具 —— 直接访问 URL 获取内容（OpenClaw 风格 web_fetch）"""

import httpx

WEB_FETCH_TOOL_SPEC = {
    "name": "web_fetch",
    "description": "直接访问指定的网页 URL，获取页面文本内容。用于阅读用户分享的链接、查看产品官网、阅读技术文档等。"
                   "传入完整的 https:// URL，返回页面文本摘要（≤5000 字）。",
    "input_schema": {
        "type": "object",
        "properties": {
            "url": {
                "type": "string",
                "description": "要访问的完整网页 URL，必须以 https?:// 开头",
            },
        },
        "required": ["url"],
    },
}


async def web_fetch(url: str) -> str:
    """访问指定 URL，返回页面文本内容。

    用 httpx 发 GET 请求，提取 <title> + <body> 文本，截取前 5000 字。
    """
    if not url.startswith(("http://", "https://")):
        url = "https://" + url

    try:
        async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
            resp = await client.get(
                url,
                headers={
                    "User-Agent": (
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                        "AppleWebKit/537.36 (KHTML, like Gecko) "
                        "Chrome/125.0.0.0 Safari/537.36"
                    ),
                    "Accept": "text/html,application/xhtml+xml",
                    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
                },
            )
            resp.raise_for_status()

            html = resp.text
            title = _extract_title(html)
            text = _html_to_text(html)

            result = f"页面标题: {title}\n\n{text[:5000]}"
            if len(text) > 5000:
                result += f"\n\n(内容已截断，共 {len(text)} 字符)"
            return result

    except httpx.HTTPStatusError as e:
        return f"[web_fetch] HTTP {e.response.status_code}: 页面无法访问（{url}）"
    except httpx.ConnectError:
        return f"[web_fetch] 无法连接: {url}（网站可能不存在或网络不通）"
    except httpx.TimeoutException:
        return f"[web_fetch] 访问超时: {url}（20s 无响应）"
    except Exception as e:
        return "[web_fetch] 无法访问该页面，请尝试搜索关键词或换其他来源。"


def _extract_title(html: str) -> str:
    """从 HTML 中提取 <title>"""
    import re
    m = re.search(r"<title[^>]*>(.+?)</title>", html, re.IGNORECASE | re.DOTALL)
    if m:
        return m.group(1).strip()[:200]
    return "(无标题)"


def _html_to_text(html: str) -> str:
    """简单的 HTML → 纯文本转换。去掉 script/style 标签，提取 body 文本。"""
    import re

    # 去掉 script 和 style 块
    html = re.sub(r"<script[^>]*>.*?</script>", "", html, flags=re.DOTALL | re.IGNORECASE)
    html = re.sub(r"<style[^>]*>.*?</style>", "", html, flags=re.DOTALL | re.IGNORECASE)

    # 去掉 HTML 注释
    html = re.sub(r"<!--.*?-->", "", flags=re.DOTALL)

    # 提取 <body> 内容，没有则用全文
    body_m = re.search(r"<body[^>]*>(.*?)</body>", html, re.DOTALL | re.IGNORECASE)
    if body_m:
        html = body_m.group(1)

    # 替换常见块级标签为换行
    for tag in ["p", "div", "section", "article", "h1", "h2", "h3", "h4", "h5", "h6",
                "li", "tr", "br", "hr"]:
        html = re.sub(rf"</?{tag}[^>]*>", "\n", html, flags=re.IGNORECASE)

    # 去掉所有剩余 HTML 标签
    html = re.sub(r"<[^>]+>", "", html)

    # 解码 HTML 实体
    html = html.replace("&nbsp;", " ").replace("&amp;", "&").replace("&lt;", "<")\
               .replace("&gt;", ">").replace("&quot;", '"').replace("&#39;", "'")

    # 压缩空白行
    text = re.sub(r"\n\s*\n", "\n\n", html)
    text = re.sub(r"[ \t]+", " ", text)

    return text.strip()
