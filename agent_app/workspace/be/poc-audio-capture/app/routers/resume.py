"""简历相关接口。"""

import logging
from typing import Optional

from fastapi import APIRouter, File, HTTPException, UploadFile

from app.services.resume_service import (
    generate_intro,
    has_intro,
    load_intro,
    parse_pdf,
    save_intro,
)

logger = logging.getLogger("resume")
router = APIRouter()


@router.post("/resume/upload")
async def upload_resume(file: UploadFile = File(...)):
    """上传 PDF 简历，解析并生成自我介绍。"""
    # 校验文件类型——优先看 content_type，文件名可能不含 .pdf 后缀
    content_type = file.content_type or ""
    filename = (file.filename or "").lower()
    if not ("pdf" in content_type or filename.endswith(".pdf")):
        raise HTTPException(400, "仅支持 PDF 格式")

    # 读取文件
    content = await file.read()
    if len(content) == 0:
        raise HTTPException(400, "文件为空")
    if len(content) > 10 * 1024 * 1024:  # 10MB
        raise HTTPException(400, "文件过大（不超过 10MB）")

    # 解析 PDF
    try:
        resume_text = parse_pdf(content)
    except Exception as e:
        logger.exception("PDF 解析失败")
        raise HTTPException(422, f"PDF 解析失败：{e}")

    if not resume_text.strip():
        raise HTTPException(422, "PDF 中未提取到文字，请确保不是扫描版图片")

    logger.info("PDF 解析成功，文本长度: %d", len(resume_text))

    # 调用 LLM 生成自我介绍
    try:
        intro = await generate_intro(resume_text)
    except Exception as e:
        logger.exception("自我介绍生成失败")
        raise HTTPException(500, f"自我介绍生成失败：{e}")

    # 持久化
    data = save_intro(intro, file.filename)

    return {
        "ok": True,
        "intro": intro,
        "generated_at": data["generated_at"],
        "filename": file.filename,
    }


@router.get("/resume/intro")
async def get_intro():
    """获取已生成的自我介绍。"""
    if not has_intro():
        return {"ok": True, "intro": None}
    data = load_intro()
    return {
        "ok": True,
        "intro": data["intro"],
        "filename": data.get("filename", ""),
        "generated_at": data.get("generated_at", ""),
    }


@router.get("/resume/has")
async def check_intro():
    """检查是否已上传简历。"""
    return {"ok": True, "has_intro": has_intro()}
