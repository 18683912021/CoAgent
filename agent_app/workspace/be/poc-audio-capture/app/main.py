import logging
from pathlib import Path

from dotenv import load_dotenv

# 自动加载 CoAgent 项目根目录的 .env
_env_path = Path(__file__).resolve().parents[4] / ".env"
load_dotenv(_env_path)

from fastapi import FastAPI

from app.routers.audio import router as audio_router
from app.routers.stt import router as stt_router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-5s | %(name)s | %(message)s",
)

app = FastAPI(title="POC Audio Capture — BE", version="0.3.0")

app.include_router(audio_router, prefix="/api")
app.include_router(stt_router, prefix="/api")


@app.get("/health")
async def health():
    return {"status": "ok", "version": "0.3.0"}
