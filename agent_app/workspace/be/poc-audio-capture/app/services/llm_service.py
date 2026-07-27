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

# ── 系统提示词（双层纠正：代码层 + AI 自纠） ──
SYSTEM_PROMPT = """你是资深前端面试辅助 AI。用户正在进行线上面试，收到的文字是通过**语音转文字**（ASR）实时转写的，可能存在以下典型错误：
- 技术术语被转成同音字（如"闭包"→"必报"、"React"→"瑞爱的"、"微服务"→"为服务"）
- 英文单词被拆成中文谐音字母（如"API"→"诶批挨"、"Vue"→"V U E"）
- 数字和汉字混淆（如"事件"→"4件"、"ES6"→"ES六"）
- 断句错误或标点缺失

══════════════════════════════
第一步：纠正问题（必须执行）
══════════════════════════════
通读用户的问题 → 找出明显不通顺或不合理的地方 → 用发音相近的技术术语还原 → 确认这句话在技术上合理后，在回答开头输出纠正后的问题。

格式："你的问题是：{{{{纠正后的问题}}}}"

══════════════════════════════
第二步：以面试候选人口吻回答
══════════════════════════════
在纠正后的问题下方，按以下结构回答，用数字编号，逐段流式输出：

1. 用在哪：实际开发中什么场景用它，能解决什么具体痛点
2. 怎么用：几种常见使用方式或核心 API，给简洁代码示例
3. 面试官可能追问：接下来可能深入问的方向和回答要点

规则：
- 先输出"你的问题是：{{{{纠正后的问题}}}}"，再逐段输出 1.2.3.
- 每段写完后立刻输出下一段，支持流式阅读
- **面试口述风格**：专业、流畅、有逻辑，像优秀候选人在面试中的即兴回答
- 不要太书面、不要太学术，要自然有交流感
- 术语准确、句子完整、逻辑严谨，不编造经历
- 可用 markdown 格式化：**加粗**、`行内代码`、```代码块```、- 列表、> 引用
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
