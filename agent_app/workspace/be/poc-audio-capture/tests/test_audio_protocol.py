import hashlib
from datetime import datetime, timezone
from uuid import UUID

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models.schemas import AudioFormat, AudioStreamConfig
from app.services.audio_service import (
    AudioPacketHeader,
    AudioSession,
    PACKET_HEADER,
    ProtocolError,
    SequenceTracker,
    V1AudioSession,
    safe_session_directory,
)

SESSION_ID = UUID("123e4567-e89b-12d3-a456-426614174000")


def encode_packet(
    payload: bytes,
    *,
    kind: int = 1,
    source: int = 1,
    sequence: int = 0,
    offset_us: int = 0,
) -> bytes:
    return PACKET_HEADER.pack(
        b"ACP1",
        1,
        kind,
        source,
        0,
        SESSION_ID.bytes,
        sequence,
        offset_us,
        len(payload),
    ) + payload


def test_binary_header_round_trip():
    payload = bytes(range(128)) * 10
    header, decoded = AudioPacketHeader.decode(encode_packet(payload, source=2, sequence=42))

    assert PACKET_HEADER.size == 44
    assert header.session_id == SESSION_ID
    assert header.source == "system"
    assert header.kind == "realtime"
    assert header.sequence == 42
    assert decoded == payload


def test_binary_header_rejects_invalid_payload_length():
    packet = bytearray(encode_packet(b"pcm"))
    packet[40:44] = (999).to_bytes(4, "big")
    with pytest.raises(ProtocolError, match="payload length"):
        AudioPacketHeader.decode(bytes(packet))


def test_sequence_tracker_records_gap_and_rejects_reversal():
    tracker = SequenceTracker()
    tracker.accept(0, 1280)
    tracker.accept(2, 1280)

    assert tracker.gaps == [(1, 1)]
    assert tracker.bytes_received == 2560
    with pytest.raises(ProtocolError, match="behind expected"):
        tracker.accept(1, 1280)


def test_backfill_becomes_canonical_only_after_sha_validation(tmp_path):
    session = V1AudioSession(
        session_id=SESSION_ID,
        source_mode="mic",
        storage_root=tmp_path,
    )
    track = session.start_track("mic", AudioFormat())
    pcm = b"\x01\x02" * 640
    sha256 = hashlib.sha256(pcm).hexdigest()

    track.start_backfill(len(pcm), sha256)
    header, payload = AudioPacketHeader.decode(encode_packet(pcm, kind=2))
    track.write_packet(header, payload)
    track.finish_backfill(len(pcm), sha256)

    assert track.complete is True
    assert track.canonical_path.read_bytes() == pcm
    assert not track.backfill_path.exists()


def test_backfill_rejects_wrong_sha(tmp_path):
    session = V1AudioSession(
        session_id=SESSION_ID,
        source_mode="mic",
        storage_root=tmp_path,
    )
    track = session.start_track("mic", AudioFormat())
    pcm = b"\x01\x02" * 640

    track.start_backfill(len(pcm), "0" * 64)
    header, payload = AudioPacketHeader.decode(encode_packet(pcm, kind=2))
    track.write_packet(header, payload)
    with pytest.raises(ProtocolError, match="sha256"):
        track.finish_backfill(len(pcm), "0" * 64)


def test_session_directory_is_server_generated(tmp_path):
    directory = safe_session_directory(tmp_path, SESSION_ID)
    assert directory.parent == tmp_path.resolve()
    assert directory.name == str(SESSION_ID)


def test_legacy_started_at_is_real_start_time():
    session = AudioSession("legacy", AudioStreamConfig())
    stats = session.to_stats()

    started = datetime.fromisoformat(stats.started_at)
    ended = datetime.fromisoformat(stats.ended_at)
    assert started.tzinfo == timezone.utc
    assert started <= ended


def test_v1_websocket_realtime_and_backfill(tmp_path, monkeypatch):
    monkeypatch.setenv("AUDIO_CAPTURE_STORAGE_DIR", str(tmp_path))
    pcm = b"\x01\x02" * 640
    sha256 = hashlib.sha256(pcm).hexdigest()
    client = TestClient(app)

    with client.websocket_connect("/api/ws/audio/stream") as websocket:
        websocket.send_json(
            {"type": "client_hello", "protocol": "audio.capture.v1"}
        )
        assert websocket.receive_json()["type"] == "ready"

        websocket.send_json(
            {
                "type": "session_start",
                "session_id": str(SESSION_ID),
                "source_mode": "mic",
            }
        )
        assert websocket.receive_json()["type"] == "session_ready"

        websocket.send_json(
            {
                "type": "track_start",
                "session_id": str(SESSION_ID),
                "source": "mic",
                "format": {
                    "sample_rate": 16000,
                    "channels": 1,
                    "bit_depth": 16,
                    "encoding": "pcm_s16le",
                    "chunk_duration_ms": 40,
                },
            }
        )
        assert websocket.receive_json()["type"] == "track_ready"

        websocket.send_bytes(encode_packet(pcm))
        realtime_ack = websocket.receive_json()
        assert realtime_ack["type"] == "chunk_ack"
        assert realtime_ack["kind"] == "realtime"

        websocket.send_json(
            {
                "type": "session_stopped",
                "session_id": str(SESSION_ID),
                "reason": "test",
            }
        )
        websocket.send_json(
            {
                "type": "file_start",
                "session_id": str(SESSION_ID),
                "source": "mic",
                "bytes": len(pcm),
                "sha256": sha256,
            }
        )
        websocket.send_bytes(encode_packet(pcm, kind=2))
        backfill_ack = websocket.receive_json()
        assert backfill_ack["kind"] == "backfill"

        websocket.send_json(
            {
                "type": "file_end",
                "session_id": str(SESSION_ID),
                "source": "mic",
                "bytes": len(pcm),
                "sha256": sha256,
            }
        )
        assert websocket.receive_json()["type"] == "file_complete"

        websocket.send_json(
            {"type": "session_complete", "session_id": str(SESSION_ID)}
        )
        completed = websocket.receive_json()
        assert completed["type"] == "session_complete"
        assert completed["status"] == "complete"

    canonical = tmp_path / str(SESSION_ID) / "mic.pcm"
    assert canonical.read_bytes() == pcm


def test_legacy_websocket_remains_compatible():
    client = TestClient(app)
    with client.websocket_connect("/api/ws/audio/stream") as websocket:
        websocket.send_json(
            {
                "session_id": "legacy-session",
                "config": {"sample_rate": 16000, "bit_depth": 16, "channels": 1},
            }
        )
        ready = websocket.receive_json()
        assert ready["type"] == "ready"
        assert ready["legacy"] is True
        websocket.send_bytes(b"\x00\x00" * 320)
