"""DeepSeek 流式回答服务。

SSE → AsyncGenerator[(chunk, is_final), ...]
不引入 openai SDK，用 httpx 原生 SSE 解析。
"""

import json
import logging
import os
from typing import AsyncGenerator

import httpx

logger = logging.getLogger("llm")

SYSTEM_PROMPT_BASE = """你是资深面试辅助 AI。用户正在面试中，会把面试官的问题发给你。注意：所有文字都是语音识别转写的，**必然存在错误**。

══════════════════════════════════════
🔴 第一步：纠正语音识别错误（必须执行）
══════════════════════════════════════

语音识别的典型错误模式：
- 同音/近音字："事件循环"被写成"4件循环"（4=事）；"微服务"写成"为服务"
- 英文术语被拆成中文："JavaScript"→"java script"；"Redis"→"red is"；"API"→"a p i"/"诶批挨"
- 数字听错："1"→"一/要/已"；"10"→"十/是"；根据语境判断到底是数字还是汉字
- 断句错误：两句话连成一句，或一个词被拆成两个
- 方言/口音："这个"→"则个"；"是不是"→"四不四"

**你必须**：通读整段文字 → 找出明显不通顺的词 → 用发音相似的词替换 →
还原出最合理的问题 → 在心里确认理解后，**用正确术语重述一遍问题再回答**。

格式："你问的是「{{正确问题}}」，我来回答：…"

══════════════════════════════════════
第二步：给出回答
══════════════════════════════════════

回答模式：
- 精简：一句话结论，≤150 字，不讲原理
- 普通：核心概念 + 主要步骤，≤350 字
- 详细：原理 → 实践 → 代码思路 → 关键参数 → 常见陷阱，≤600 字。每个点都必须有用，不凑字数

规则：
- 口语化，像在面试对话
- 不编造经历
- 不输出 markdown
- 回答语言：{language_name}"""

LANGUAGE_INSTRUCTIONS: dict[str, str] = {
    "zh": "中文",
    "en": "English",
}


class LLMService:
    """封装 DeepSeek Chat API 流式调用。"""

    def __init__(self) -> None:
        self._api_key = os.getenv("ANTHROPIC_API_KEY", "")
        self._base_url = "https://api.deepseek.com/v1/chat/completions"
        self._client: httpx.AsyncClient | None = None

    @property
    def ready(self) -> bool:
        return bool(self._api_key)

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(
                timeout=httpx.Timeout(30.0, connect=10.0),
            )
        return self._client

    async def stream_answer(
        self,
        question: str,
        model: str = "deepseek-chat",
        max_tokens: int = 300,
        language: str = "zh",
    ) -> AsyncGenerator[tuple[str, bool], None]:
        """流式调用 DeepSeek。

        Args:
            language: "zh" 或 "en"，控制回答语言。

        Yields:
            (chunk_text, is_final): 增量文本 + 是否结束
        """
        if not self._api_key:
            raise RuntimeError("ANTHROPIC_API_KEY 未配置")

        lang_name = LANGUAGE_INSTRUCTIONS.get(language, "中文")
        system_prompt = SYSTEM_PROMPT_BASE.format(language_name=lang_name)

        client = await self._get_client()

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"面试官问：{question}"},
        ]

        body = {
            "model": model,
            "messages": messages,
            "stream": True,
            "max_tokens": max_tokens,
            "temperature": 0.7,
        }

        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
        }

        logger.info("LLM 请求: model=%s max_tokens=%d question=%.60s", model, max_tokens, question)

        try:
            async with client.stream("POST", self._base_url, json=body, headers=headers) as response:
                if response.status_code != 200:
                    error_body = await response.aread()
                    logger.error("DeepSeek API %d: %.300s", response.status_code, error_body)
                    raise RuntimeError(f"DeepSeek API returned {response.status_code}")

                async for line in response.aiter_lines():
                    if not line or not line.startswith("data: "):
                        continue

                    data_str = line[6:]  # 去掉 "data: " 前缀
                    if data_str == "[DONE]":
                        yield ("", True)
                        return

                    try:
                        data = json.loads(data_str)
                    except json.JSONDecodeError:
                        continue

                    choices = data.get("choices", [])
                    if not choices:
                        continue

                    choice = choices[0]
                    delta = choice.get("delta", {})
                    content = delta.get("content", "")
                    finish_reason = choice.get("finish_reason")

                    if content:
                        yield (content, finish_reason == "stop")
                    elif finish_reason == "stop":
                        yield ("", True)

        except httpx.TimeoutException:
            logger.error("DeepSeek API 超时")
            raise RuntimeError("DeepSeek API 请求超时")

    async def close(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None
