"""小工具接口 —— 文件格式转换。

前端通过 JSON 传 base64 文件数据。
Word→PDF：dxpdf（Rust 原生）
PDF→Word：pdf2docx
"""

import base64
import logging
import shutil
import tempfile
from io import BytesIO
from pathlib import Path

import dxpdf
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.routers.auth import get_current_user

logger = logging.getLogger("tools")
router = APIRouter()

_MAX_SIZE = 20 * 1024 * 1024
_WORD_EXTENSIONS = {'.doc', '.docx', '.wps', '.odt', '.rtf'}


class FileData(BaseModel):
    filename: str
    data: str  # base64


@router.post("/tools/word-to-pdf")
async def word_to_pdf(
    body: FileData,
    _email: str = Depends(get_current_user),
):
    """文档 → PDF"""
    ext = Path(body.filename).suffix.lower()
    if ext not in _WORD_EXTENSIONS:
        raise HTTPException(400, f"仅支持文档格式：{' / '.join(_WORD_EXTENSIONS)}")

    content = base64.b64decode(body.data)
    if len(content) > _MAX_SIZE:
        raise HTTPException(400, "文件过大（不超过 20MB）")
    if len(content) == 0:
        raise HTTPException(400, "文件为空")

    header = content[:4]
    if header[:2] != b'PK':
        if header == b'\xd0\xcf\x11\xe0':
            raise HTTPException(400, "暂不支持旧版 .doc 格式，请用 Word 另存为 .docx 后再试")
        raise HTTPException(400, "文件格式无法识别")

    try:
        pdf_bytes = dxpdf.convert(content)
        name = Path(body.filename).stem + ".pdf"
        return FileResponse(BytesIO(pdf_bytes), filename=name, media_type="application/pdf")
    except Exception as e:
        logger.exception("Word→PDF 失败")
        raise HTTPException(500, f"转换失败：{e}")


@router.post("/tools/pdf-to-word")
async def pdf_to_word(
    body: FileData,
    _email: str = Depends(get_current_user),
):
    """PDF → Word"""
    if not body.filename.lower().endswith('.pdf'):
        raise HTTPException(400, "仅支持 .pdf 格式")

    content = base64.b64decode(body.data)
    if len(content) > _MAX_SIZE:
        raise HTTPException(400, "文件过大（不超过 20MB）")

    try:
        from pdf2docx import Converter
    except ImportError:
        raise HTTPException(503, "pdf2docx 库未安装")

    tmp = Path(tempfile.mkdtemp())
    src = tmp / "input.pdf"
    src.write_bytes(content)
    out = tmp / "output.docx"
    cv = Converter(str(src))
    cv.convert(str(out))
    cv.close()

    # 先读到内存再返回，避免 FileResponse 异步流式时临时文件被删
    docx_bytes = out.read_bytes()
    shutil.rmtree(tmp, ignore_errors=True)

    name = Path(body.filename).stem + ".docx"
    return FileResponse(BytesIO(docx_bytes), filename=name, media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document")
