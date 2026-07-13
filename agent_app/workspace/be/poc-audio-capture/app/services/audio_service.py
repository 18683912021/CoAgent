import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone

from app.models.schemas import AudioStreamConfig, StreamStats


@dataclass
class AudioSession:
    """一次 WebSocket 音频流的会话状态"""
    session_id: str
    config: AudioStreamConfig
    frames_received: int = 0
    bytes_received: int = 0
    _started_at: float = field(default_factory=time.monotonic)
    errors: list[str] = field(default_factory=list)

    @property
    def started_at_iso(self) -> str:
        dt = datetime.now(timezone.utc)
        return dt.isoformat()

    @property
    def duration_ms(self) -> float:
        return (time.monotonic() - self._started_at) * 1000

    def record_frame(self, nbytes: int):
        self.frames_received += 1
        self.bytes_received += nbytes

    def to_stats(self) -> StreamStats:
        return StreamStats(
            session_id=self.session_id,
            config=self.config,
            frames_received=self.frames_received,
            bytes_received=self.bytes_received,
            duration_ms=round(self.duration_ms, 1),
            started_at=self.started_at_iso,
            ended_at=datetime.now(timezone.utc).isoformat(),
        )


# ── PCM 校验 ────────────────────────────────────────────

class PCMValidator:
    """校验每帧 PCM 数据是否符合约定格式"""

    def __init__(self, expected: AudioStreamConfig):
        self.expected = expected
        # 每帧预期字节数 = 采样率 × 位深/8 × 声道数 × 帧时长
        # 允许帧长 10ms ~ 200ms，用 20ms 作为参考帧长
        self._bytes_per_sample = expected.bit_depth // 8
        self._bytes_per_frame_20ms = (
            expected.sample_rate * self._bytes_per_sample * expected.channels // 50
        )  # 50 = 1000ms / 20ms

    def validate(self, raw: bytes) -> str | None:
        """返回 None 表示通过；返回错误信息字符串表示格式不符"""
        if not raw:
            return "空帧"

        total_samples = len(raw) // (self._bytes_per_sample * self.expected.channels)

        if len(raw) % (self._bytes_per_sample * self.expected.channels) != 0:
            return (
                f"帧字节数 {len(raw)} 无法被 "
                f"{self._bytes_per_sample * self.expected.channels} "
                f"({self.expected.bit_depth}bit × {self.expected.channels}ch) 整除"
            )

        # 帧长合理性：PCM 帧通常 10ms~200ms，对应采样点数
        duration_ms = total_samples / self.expected.sample_rate * 1000
        if duration_ms < 5 or duration_ms > 500:
            return (
                f"帧时长 {duration_ms:.1f}ms 异常 "
                f"({total_samples} 采样点 @ {self.expected.sample_rate}Hz)，"
                f"合理范围 5~500ms"
            )

        return None
