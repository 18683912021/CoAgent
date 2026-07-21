import logging

from fastapi import FastAPI

from app.routers.audio import router as audio_router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-5s | %(name)s | %(message)s",
)

app = FastAPI(title="POC Audio Capture — BE", version="0.3.0")

app.include_router(audio_router, prefix="/api")


@app.get("/health")
async def health():
    return {"status": "ok", "version": "0.3.0"}
