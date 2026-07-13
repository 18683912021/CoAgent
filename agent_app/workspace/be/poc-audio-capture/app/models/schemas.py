from pydantic import BaseModel, Field


class AudioStreamConfig(BaseModel):
    """客户端握手时上报的音频流配置"""
    sample_rate: int = Field(default=16000, ge=8000, le=48000)
    bit_depth: int = Field(default=16, ge=8, le=32)
    channels: int = Field(default=1, ge=1, le=8)


class StreamStats(BaseModel):
    """单次采集会话的统计信息"""
    session_id: str
    config: AudioStreamConfig
    frames_received: int = 0
    bytes_received: int = 0
    duration_ms: float = 0.0
    started_at: str = ""
    ended_at: str = ""
