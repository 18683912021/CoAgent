import logging
import sys
import traceback
from pathlib import Path

from dotenv import load_dotenv

# 自动加载 CoAgent 项目根目录的 .env
_env_path = Path(__file__).resolve().parents[4] / ".env"
load_dotenv(_env_path)

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.routers.audio import router as audio_router
from app.routers.resume import router as resume_router
from app.routers.stt import router as stt_router

# 日志：DEBUG 级别，打印到 stderr，方便在终端直接看到
logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s | %(levelname)-5s | %(name)s | %(message)s",
    stream=sys.stderr,
)

# 抑制过于啰嗦的第三方库日志
logging.getLogger("websockets").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("hpack").setLevel(logging.WARNING)
logging.getLogger("stt_streaming").setLevel(logging.INFO)

logger = logging.getLogger("main")

# 全局未捕获异常处理
def _global_exception_handler(exc_type, exc_value, exc_tb):
    if issubclass(exc_type, KeyboardInterrupt):
        sys.__excepthook__(exc_type, exc_value, exc_tb)
        return
    logging.critical(
        "未捕获异常:\n%s",
        "".join(traceback.format_exception(exc_type, exc_value, exc_tb)),
    )

sys.excepthook = _global_exception_handler

app = FastAPI(title="POC Audio Capture — BE", version="0.3.0")


@app.exception_handler(Exception)
async def _unhandled_error(request: Request, exc: Exception):
    logger.exception("请求异常: %s %s", request.method, request.url)
    return JSONResponse(
        status_code=500,
        content={"detail": str(exc)},
    )


app.include_router(audio_router, prefix="/api")
app.include_router(resume_router, prefix="/api")
app.include_router(stt_router, prefix="/api")


@app.get("/health")
async def health():
    return {"status": "ok", "version": "0.3.0"}
