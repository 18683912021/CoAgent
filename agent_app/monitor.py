"""监控模块 —— 指标收集 + 结构化日志"""
import time
from collections import defaultdict
from datetime import datetime


class Metrics:
    """轻量级指标收集器（线程安全）。"""

    def __init__(self):
        self._start_time = time.time()
        self._tasks: dict[str, int] = defaultdict(int)  # total / succeeded / failed / timed_out
        self._agent_requests: dict[str, int] = defaultdict(int)  # per-agent request count
        self._agent_errors: dict[str, int] = defaultdict(int)   # per-agent error count
        self._response_times: list[float] = []  # 最近 100 次响应时间

    # ── 计数 ─────────────────────────────────────────

    def task_started(self) -> None:
        self._tasks["total"] += 1

    def task_succeeded(self) -> None:
        self._tasks["succeeded"] += 1

    def task_failed(self) -> None:
        self._tasks["failed"] += 1

    def task_timed_out(self) -> None:
        self._tasks["timed_out"] += 1

    def agent_request(self, bot_key: str) -> None:
        self._agent_requests[bot_key] += 1

    def agent_error(self, bot_key: str) -> None:
        self._agent_errors[bot_key] += 1

    def record_response_time(self, seconds: float) -> None:
        self._response_times.append(seconds)
        if len(self._response_times) > 100:
            self._response_times = self._response_times[-100:]

    # ── 查询 ─────────────────────────────────────────

    @property
    def uptime_seconds(self) -> float:
        return time.time() - self._start_time

    @property
    def avg_response_time(self) -> float:
        if not self._response_times:
            return 0.0
        return sum(self._response_times) / len(self._response_times)

    @property
    def success_rate(self) -> float:
        total = self._tasks["succeeded"] + self._tasks["failed"]
        if total == 0:
            return 1.0
        return self._tasks["succeeded"] / total

    def to_dict(self) -> dict:
        return {
            "uptime_seconds": round(self.uptime_seconds, 1),
            "tasks": dict(self._tasks),
            "success_rate": round(self.success_rate, 3),
            "avg_response_ms": round(self.avg_response_time * 1000, 0),
            "agent_requests": dict(self._agent_requests),
            "agent_errors": dict(self._agent_errors),
        }


# 全局单例
metrics = Metrics()


def log_event(level: str, event: str, **kwargs) -> None:
    """结构化日志——统一格式输出。"""
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    extra = " ".join(f"{k}={v}" for k, v in kwargs.items())
    print(f"[{ts}] {level:5s} {event:30s} {extra}")
