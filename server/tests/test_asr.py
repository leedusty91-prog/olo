"""流式 ASR（WebSocket）：partial/final、错误、鉴权与未配置。"""

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from olo.asr import FakeStreamingAsr
from olo.demo import make_demo_runtime
from olo.main import app
from olo.memory.fake import FakeMemory
from olo.memory.io_lock import VoicememIoLock
from olo.runtime import Runtime

TOKEN = "test-api-token"
AUTH = {"Authorization": f"Bearer {TOKEN}"}


class BrokenAsr:
    def feed(self, chunk: bytes):
        raise RuntimeError("decoder down")

    def finish(self):
        return ""


class ScriptedLLM:
    def stream(self, messages):
        yield "在。"


@pytest.fixture
def runtime(head_database: str, monkeypatch: pytest.MonkeyPatch, tmp_path) -> Runtime:
    cert = tmp_path / "lan.pem"
    key = tmp_path / "lan-key.pem"
    cert.write_text("cert\n", encoding="utf-8")
    key.write_text("key\n", encoding="utf-8")
    monkeypatch.setenv("OPENAI_API_KEY", "test-openai-key")
    monkeypatch.setenv("OLO_API_TOKEN", TOKEN)
    monkeypatch.setenv("DATABASE_URL", head_database)
    monkeypatch.setattr("olo.main.DEFAULT_CERT_FILE", cert)
    monkeypatch.setattr("olo.main.DEFAULT_KEY_FILE", key)
    runtime = Runtime(
        memory=FakeMemory(),
        io_lock=VoicememIoLock(),
        llm=ScriptedLLM(),
        voicemem_status="ready",
        rate_limit_per_minute=10_000,
        asr_factory=FakeStreamingAsr,
    )
    app.state.runtime = runtime
    return runtime


@pytest.fixture
def client(runtime: Runtime) -> object:
    with TestClient(app) as test_client:
        yield test_client


def test_stream_asr_emits_partials_and_final(client) -> None:
    with client.websocket_connect("/v1/asr/stream", headers=AUTH) as ws:
        ws.send_bytes(b"ni hao ")
        assert ws.receive_json() == {"type": "partial", "text": "ni hao "}
        ws.send_bytes(b"shi jie")
        assert ws.receive_json() == {"type": "partial", "text": "ni hao shi jie"}
        ws.send_text("end")
        assert ws.receive_json() == {"type": "final", "text": "ni hao shi jie"}


def test_stream_asr_ignores_unknown_text_frames(client) -> None:
    with client.websocket_connect("/v1/asr/stream", headers=AUTH) as ws:
        ws.send_text("ping")
        ws.send_bytes(b"ni")
        assert ws.receive_json() == {"type": "partial", "text": "ni"}
        ws.send_text("end")
        assert ws.receive_json() == {"type": "final", "text": "ni"}


def test_stream_asr_failure_is_reported_as_event(client, runtime: Runtime) -> None:
    runtime.asr_factory = BrokenAsr
    with client.websocket_connect("/v1/asr/stream", headers=AUTH) as ws:
        ws.send_bytes(b"x")
        message = ws.receive_json()
    assert message["type"] == "error"
    assert message["code"] == "ASR_FAILED"


def test_stream_asr_rejects_oversized_audio(
    client, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("olo.asr.MAX_AUDIO_BYTES", 4)
    with client.websocket_connect("/v1/asr/stream", headers=AUTH) as ws:
        ws.send_bytes(b"12345")
        message = ws.receive_json()
    assert message == {"type": "error", "code": "AUDIO_TOO_LARGE", "message": "语音太长了"}


def test_stream_asr_unavailable_without_provider(client, runtime: Runtime) -> None:
    runtime.asr_factory = None
    with client.websocket_connect("/v1/asr/stream", headers=AUTH) as ws:
        message = ws.receive_json()
    assert message == {"type": "error", "code": "ASR_UNAVAILABLE"}


def test_stream_asr_requires_bearer_token(client) -> None:
    with client.websocket_connect("/v1/asr/stream") as ws:
        message = ws.receive_json()
        assert message == {"type": "error", "code": "UNAUTHORIZED"}
        with pytest.raises(WebSocketDisconnect):
            ws.receive_json()


def test_demo_runtime_provides_streaming_asr() -> None:
    runtime = make_demo_runtime()
    provider = runtime.asr_factory()
    assert provider.feed(b"ni hao") == "ni hao"
    assert provider.finish() == "ni hao"
