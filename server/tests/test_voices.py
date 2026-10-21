"""TTS 端点：合成、落盘、鉴权取回。生成器用替身，不发真实请求。"""

import pytest
from fastapi.testclient import TestClient

from olo.main import app
from olo.memory.fake import FakeMemory
from olo.memory.io_lock import VoicememIoLock
from olo.runtime import Runtime

TOKEN = "test-api-token"
AUTH = {"Authorization": f"Bearer {TOKEN}"}

MP3_BYTES = b"ID3\x04\x00\x00\x00\x00\x00\x00" + b"fake-mp3-payload"


class FakeTTS:
    def __init__(self, result=(MP3_BYTES, "audio/mpeg")) -> None:
        self.result = result
        self.texts: list[str] = []
        self.tones: list[str] = []
        self.voices: list[str] = []
        self.forms: list[str] = []

    def __call__(
        self, text: str, tone: str = "curious", voice: str = "voice1", form: str = "buddy"
    ):
        self.texts.append(text)
        self.tones.append(tone)
        self.voices.append(voice)
        self.forms.append(form)
        return self.result


class ScriptedLLM:
    def stream(self, messages):
        yield "在。"


@pytest.fixture
def runtime(tmp_path, head_database: str, monkeypatch: pytest.MonkeyPatch) -> Runtime:
    cert = tmp_path / "lan.pem"
    key = tmp_path / "lan-key.pem"
    cert.write_text("cert\n", encoding="utf-8")
    key.write_text("key\n", encoding="utf-8")
    monkeypatch.setenv("OPENAI_API_KEY", "test-openai-key")
    monkeypatch.setenv("OLO_API_TOKEN", TOKEN)
    monkeypatch.setenv("DATABASE_URL", head_database)
    monkeypatch.setenv("OLO_TTS_DIR", str(tmp_path / "tts"))
    monkeypatch.setattr("olo.main.DEFAULT_CERT_FILE", cert)
    monkeypatch.setattr("olo.main.DEFAULT_KEY_FILE", key)
    runtime = Runtime(
        memory=FakeMemory(),
        io_lock=VoicememIoLock(),
        llm=ScriptedLLM(),
        tts_generator=FakeTTS(),
        voicemem_status="ready",
        rate_limit_per_minute=10_000,
    )
    app.state.runtime = runtime
    return runtime


@pytest.fixture
def client(runtime: Runtime) -> object:
    with TestClient(app) as test_client:
        yield test_client


def test_speech_synthesizes_and_serves_audio(client, runtime) -> None:
    response = client.post("/v1/speech", headers=AUTH, json={"text": "我在呢。"})
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["media_type"] == "audio/mpeg"
    assert body["url"] == f"/v1/speech/{body['id']}"
    assert runtime.tts_generator.texts == ["我在呢。"]

    audio = client.get(body["url"], headers=AUTH)
    assert audio.status_code == 200
    assert audio.headers["content-type"] == "audio/mpeg"
    assert audio.content == MP3_BYTES


def test_speech_uses_persona_tone(client, runtime) -> None:
    client.put("/v1/persona", headers=AUTH, json={"tone": "calm"})
    response = client.post("/v1/speech", headers=AUTH, json={"text": "慢慢来。"})
    assert response.status_code == 201, response.text
    assert runtime.tts_generator.tones == ["calm"]


def test_speech_uses_appearance_voice(client, runtime) -> None:
    client.post("/v1/shop/buy", headers=AUTH, json={"item_id": "voice:voice2"})
    client.put("/v1/persona", headers=AUTH, json={"appearance": {"voice": "voice2"}})
    response = client.post("/v1/speech", headers=AUTH, json={"text": "你好呀。"})
    assert response.status_code == 201, response.text
    assert runtime.tts_generator.voices == ["voice2"]


def test_speech_uses_appearance_form(client, runtime) -> None:
    client.post("/v1/shop/buy", headers=AUTH, json={"item_id": "form:glow"})
    client.put("/v1/persona", headers=AUTH, json={"appearance": {"form": "glow"}})
    response = client.post("/v1/speech", headers=AUTH, json={"text": "嗯。"})
    assert response.status_code == 201, response.text
    assert runtime.tts_generator.forms == ["glow"]


def test_speech_unavailable_returns_service_unavailable(client, runtime) -> None:
    runtime.tts_generator.result = None
    response = client.post("/v1/speech", headers=AUTH, json={"text": "你好"})
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "TTS_UNAVAILABLE"


def test_speech_rejects_empty_text(client) -> None:
    assert client.post("/v1/speech", headers=AUTH, json={"text": ""}).status_code == 422


def test_speech_requires_bearer_token(client) -> None:
    assert client.post("/v1/speech", json={"text": "你好"}).status_code == 401
    assert client.get("/v1/speech/" + "0" * 32).status_code == 401


def test_unknown_audio_id_is_not_found(client) -> None:
    assert client.get("/v1/speech/" + "a" * 32, headers=AUTH).status_code == 404
    assert client.get("/v1/speech/not-an-id", headers=AUTH).status_code == 404


def test_audio_media_detection() -> None:
    from olo.speech import _detect_media

    assert _detect_media(b"ID3\x04rest", "") == "audio/mpeg"
    assert _detect_media(b"RIFF\x00\x00rest", "") == "audio/wav"
    assert _detect_media(b"not-audio", "image/png") is None
    assert _detect_media(b"\x00\x01", "audio/ogg") == "audio/ogg"
