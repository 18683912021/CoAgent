"""DeepSeek 流式回答服务。

SSE → AsyncGenerator[(chunk, is_final), ...]
不引入 openai SDK，用 httpx 原生 SSE 解析。
"""

import json
import logging
import os
from typing import AsyncGenerator

import httpx

from app.services.asr_text_corrector import correct_asr_text

logger = logging.getLogger("llm")

# ── 系统提示词（极简版，ASR 纠正在代码层完成） ──
SYSTEM_PROMPT = """你是资深前端面试辅助 AI。用户正在面试中，回答以下问题。

回答按以下四个维度组织，用数字编号，逐段流式输出：

1. 基础介绍：这个概念/技术是什么，核心要点
2. 使用场景：实际开发中什么时候用，解决什么问题
3. 使用方式：关键步骤或核心 API，给代码示例
4. 常见追问：面试官可能深入问什么，以及回答思路

规则：
- 四个维度严格按 1.2.3.4. 编号，每段之间空一行
- 每段写完后立刻输出下一段，支持流式阅读
- **书面正式用语**：标准、专业、规范，像教材或技术文档
- 术语准确、句子完整、逻辑严谨
- 不编造经历，不输出 markdown
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
                timeout=httpx.Timeout(30.0, connect=5.0),
                http2=True,
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

        question 会在发送前经 correct_asr_text() 做代码级纠正，
        不再依赖 LLM 自行纠正语音识别错误。
        """
        if not self._api_key:
            raise RuntimeError("ANTHROPIC_API_KEY 未配置")

        # ── 代码级 ASR 纠正（微秒级，替代原 7000-token 提示词） ──
        corrected = correct_asr_text(question)

        lang_name = LANGUAGE_INSTRUCTIONS.get(language, "中文")
        system_prompt = SYSTEM_PROMPT.format(language_name=lang_name)

        client = await self._get_client()

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"面试官问：{corrected}" if corrected != question else f"面试官问：{question}"},
        ]

        body = {
            "model": model,
            "messages": messages,
            "stream": True,
            "max_tokens": max_tokens,
            "temperature": 0.3,
        }

        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
        }

        logger.info("LLM 请求: model=%s tokens=%d q=%.60s", model, max_tokens,
                     corrected if corrected != question else question)

        try:
            async with client.stream("POST", self._base_url, json=body, headers=headers) as response:
                if response.status_code != 200:
                    error_body = await response.aread()
                    logger.error("DeepSeek API %d: %.300s", response.status_code, error_body)
                    raise RuntimeError(f"DeepSeek API returned {response.status_code}")

                async for line in response.aiter_lines():
                    if not line or not line.startswith("data: "):
                        continue

                    data_str = line[6:]
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
