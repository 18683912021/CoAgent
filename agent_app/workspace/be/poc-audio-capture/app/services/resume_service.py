"""简历服务：PDF 解析 → LLM 生成自我介绍 → 持久化存储。

存储位置：workspace/shared/resume_intro.json
"""

import json
import logging
import os
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from typing import Optional

import pdfplumber

from app.services.llm_service import LLMService

logger = logging.getLogger("resume")

# 存储路径
_STORAGE_DIR = Path(__file__).resolve().parents[3] / "shared" / "resume"
_STORAGE_DIR.mkdir(parents=True, exist_ok=True)
_INTRO_FILE = _STORAGE_DIR / "intro.json"


def _build_self_intro_prompt(resume_text: str) -> str:
    """生成自我介绍的 LLM 提示词。"""
    return f"""你是一位资深面试辅导专家。请根据以下简历内容，为候选人撰写一段面试开场用的自我介绍。

要求：
1. 时长约 1-2 分钟（200-350 字）
2. 采用标准书面正式用语，专业、流畅
3. 结构：基本信息 → 教育背景 → 核心技术栈 → 主要项目/工作经验亮点 → 求职意向与优势
4. 语言精炼，突出与应聘方向相关的关键技能和成果
5. 自然口语化但不失专业性，像真实的面试自我介绍
6. 不要编造简历中没有的内容
7. 不要使用 markdown 格式

简历内容：
{resume_text}

请直接输出自我介绍文本，不需要任何前缀说明。"""


def parse_pdf(file_bytes: bytes) -> str:
    """解析 PDF 文件，返回纯文本。"""
    text_parts: list[str] = []
    with pdfplumber.open(BytesIO(file_bytes)) as pdf:
        for page in pdf.pages:
            page_text = page.extract_text()
            if page_text:
                text_parts.append(page_text)
    return "\n\n".join(text_parts).strip()


async def generate_intro(resume_text: str) -> str:
    """调用 LLM 生成自我介绍。"""
    llm = LLMService()
    if not llm.ready:
        raise RuntimeError("LLM API Key 未配置，无法生成自我介绍")

    prompt = _build_self_intro_prompt(resume_text)
    full_text: str = ""

    async for chunk, is_final in llm.stream_answer(
        prompt, model="deepseek-chat", max_tokens=800, language="zh",
    ):
        full_text += chunk

    return full_text.strip()


def save_intro(intro: str, filename: str = "") -> dict:
    """保存自我介绍到持久化存储，返回存储的数据。"""
    data = {
        "intro": intro,
        "filename": filename,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "resume_hash": "",  # 后续可用于检测简历变更
    }
    _INTRO_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    logger.info("自我介绍已保存: %s", _INTRO_FILE)
    return data


def load_intro() -> Optional[dict]:
    """加载已存储的自我介绍，无数据返回 None。"""
    if not _INTRO_FILE.exists():
        return None
    try:
        return json.loads(_INTRO_FILE.read_text(encoding="utf-8"))
    except Exception:
        return None


def has_intro() -> bool:
    """是否有已生成的自我介绍。"""
    return _INTRO_FILE.exists()
