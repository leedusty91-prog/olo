"""API-backed VoiceMem: the real voicemem/mem0/Qdrant code path against a mocked
OpenAI-compatible HTTP endpoint (embeddings + chat). No torch, no real key."""

from __future__ import annotations

import hashlib
import json
import math
import re
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

from olo.memory.voicemem_api import (
    VoiceMemSettings,
    build_api_config,
    memory_backend,
    voicemem_installed,
)

FACT = "我对坚果过敏"


def test_memory_backend_switch() -> None:
    assert memory_backend({}) == "auto"
    assert memory_backend({"OLO_MEMORY": "off"}) == "off"
    assert memory_backend({"OLO_MEMORY": "voicemem"}) == "voicemem"
    assert memory_backend({"OLO_MEMORY_ENABLED": "0"}) == "off"
    assert memory_backend({"OLO_MEMORY_ENABLED": "1"}) == "voicemem"


def test_settings_and_config(tmp_path: Path) -> None:
    s = VoiceMemSettings.from_env(
        {
            "OPENAI_API_KEY": "k",
            "OPENAI_API_BASE": "https://llm.example/v1",
            "EMBEDDING_BASE_URL": "https://emb.example/v1",
            "EMBEDDING_API_KEY": "ek",
            "EMBEDDING_MODEL": "text-embedding-v3",
            "EMBEDDING_DIMENSIONS": "1024",
            "OLO_VOICEMEM_DIR": str(tmp_path),
        }
    )
    assert s.missing() == []
    cfg = build_api_config(s)
    assert cfg["mode"] == "text"
    assert cfg["base_url"] == "https://llm.example/v1"
    assert cfg["embedding"] == {
        "provider": "openai",
        "config": {
            "model": "text-embedding-v3",
            "api_key": "ek",
            "base_url": "https://emb.example/v1",
            "dimensions": 1024,
        },
    }
    assert cfg["memory_root"] == str(tmp_path / "olo")
    assert VoiceMemSettings.from_env({}).missing() == ["OPENAI_API_KEY", "EMBEDDING_API_KEY"]


def test_no_key_keeps_fake_memory(monkeypatch: pytest.MonkeyPatch) -> None:
    from olo.main import _start_memory
    from olo.memory.fake import FakeMemory
    from olo.memory.io_lock import VoicememIoLock
    from olo.runtime import Runtime

    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("EMBEDDING_API_KEY", raising=False)
    rt = Runtime(memory=FakeMemory(), io_lock=VoicememIoLock(), llm=object(), voicemem_status="warming")
    assert _start_memory(rt) == "failed"
    assert isinstance(rt.memory, FakeMemory)


# ---------------------------------------------------------------- mock API

def _embed(text: str, dims: int) -> list[float]:
    v = [0.0] * dims
    for i in range(len(text)):
        for gram in (text[i : i + 1], text[i : i + 2]):
            v[int(hashlib.md5(gram.encode()).hexdigest(), 16) % dims] += 1.0
    n = math.sqrt(sum(x * x for x in v)) or 1.0
    return [x / n for x in v]


def _answer(messages: list[dict]) -> dict:
    text = "\n".join(m["content"] for m in messages if isinstance(m.get("content"), str))
    if "Memory Extractor" in text:
        _Mock.extractor_prompts.append(text)
        if _Mock.extract_delay_s:
            import time

            time.sleep(_Mock.extract_delay_s)
        said = re.findall(r"User: ([^\"\n]+)", text)
        return {"memory": [{"id": "new_0", "text": "用户说：" + said[-1].strip(), "attributed_to": "user"}]} if said else {"memory": []}
    return {}


class _Mock(BaseHTTPRequestHandler):
    paths: list[str] = []
    extractor_prompts: list[str] = []
    extract_delay_s: float = 0.0

    def log_message(self, *args) -> None:  # noqa: D401
        pass

    def _send(self, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        self._send({"data": []})

    def do_POST(self) -> None:
        req = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        _Mock.paths.append(self.path)
        if self.path.endswith("/embeddings"):
            items = req["input"] if isinstance(req["input"], list) else [req["input"]]
            dims = req.get("dimensions") or 1536
            self._send({
                "object": "list", "model": req.get("model"),
                "data": [{"object": "embedding", "index": i, "embedding": _embed(str(x), dims)} for i, x in enumerate(items)],
                "usage": {"prompt_tokens": 1, "total_tokens": 1},
            })
            return
        self._send({
            "id": "mock", "object": "chat.completion", "created": 0, "model": req.get("model"),
            "choices": [{"index": 0, "finish_reason": "stop", "message": {
                "role": "assistant", "content": json.dumps(_answer(req["messages"]), ensure_ascii=False)}}],
            "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
        })


@pytest.fixture
def mock_api(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    if not voicemem_installed():
        pytest.skip("voicemem not installed (pip install '.[memory-api]' && pip install --no-deps voicemem)")
    server = ThreadingHTTPServer(("127.0.0.1", 0), _Mock)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_port}/v1"
    for name in ("EMBEDDING_API_KEY", "EMBEDDING_BASE_URL", "EMBEDDING_MODEL", "OPENAI_API_BASE"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setenv("OPENAI_BASE_URL", base)
    monkeypatch.setenv("OPENAI_MODEL", "mock-chat")
    monkeypatch.setenv("EMBEDDING_DIMENSIONS", "1536")
    monkeypatch.setenv("OLO_VOICEMEM_DIR", str(tmp_path / "vm"))
    for name in ("OPENAI_EMBEDDING_MODEL", "VOICEMEM_EMBED_DIM", "VOICEMEM_SLOTS"):
        monkeypatch.setenv(name, "")  # restored after; apply_env overwrites
    _Mock.paths = []
    _Mock.extractor_prompts = []
    _Mock.extract_delay_s = 0.0
    yield base
    server.shutdown()


def _real_adapter():
    from olo.memory.voicemem_api import ApiVoiceMemAdapter, make_voicemem

    s = VoiceMemSettings.from_env()
    return ApiVoiceMemAdapter(make_voicemem(s), s)


def test_real_voicemem_end_to_end(mock_api: str, head_database: str, monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    """One VoiceMem per process: mem0 locks its embedded migrations Qdrant."""
    mem = _real_adapter()
    _direct_write_recall_prompt(mem)
    _turns_use_real_voicemem(mem, head_database, monkeypatch, tmp_path)
    _search_not_blocked_by_slow_write(mem)


def _search_not_blocked_by_slow_write(mem) -> None:
    """A write stuck in a slow LLM call must not block (or break) a search."""
    import time

    _Mock.extract_delay_s = 2.0
    writer = threading.Thread(target=lambda: mem.ingest_user(
        text="我住在杭州西湖边", agent_reply="真好。", session_id="s3",
        observed_at="2026-10-21T10:00:00+08:00"))
    writer.start()
    time.sleep(0.3)  # writer is now inside the slow extraction call
    started = time.perf_counter()
    result = mem.search("我能吃坚果吗", slots=[], entities=[])
    assert time.perf_counter() - started < 1.5
    assert writer.is_alive()
    assert any("坚果" in t for t in result.result_leftbrain)
    writer.join(10)
    _Mock.extract_delay_s = 0.0
    mem.flush()
    again = mem.search("我住在哪里", slots=[], entities=[])
    assert any("杭州" in t for t in again.result_leftbrain), again.result_leftbrain


def _direct_write_recall_prompt(mem) -> None:
    from olo.context import Persona, assemble
    from olo.memory.compat import build_memory_context

    mem.ingest_user(text=FACT, agent_reply="记住了。", session_id="s1",
                    observed_at="2026-10-20T10:00:00+08:00", audio_path="/nonexistent.wav")
    mem.flush()
    assert any(p.endswith("/embeddings") for p in _Mock.paths)
    assert any(p.endswith("/chat/completions") for p in _Mock.paths)
    # olo's keep-the-user's-language rule reaches VoiceMem's extraction prompt
    assert _Mock.extractor_prompts and "记忆语言规则" in _Mock.extractor_prompts[-1]

    query = "我能吃坚果吗"
    cls = mem.classify(query)
    result = mem.search(query, slots=list(cls.slots), entities=list(cls.entities))
    assert any("坚果" in t for t in result.result_leftbrain), result.result_leftbrain
    rendered = build_memory_context(result)
    assert "坚果" in rendered
    msgs = assemble(Persona(stable_card="你叫 olo。"), [], result, None, query, [])
    assert "坚果过敏" in msgs[0]["content"]


def _turns_use_real_voicemem(mem, head_database: str, monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    from fastapi.testclient import TestClient

    from olo.main import app
    from olo.memory.io_lock import VoicememIoLock
    from olo.runtime import Runtime
    from olo.salience import decide
    from tests.test_turns import TOKEN, ScriptedLLM, open_session, post_turn

    cert, key = tmp_path / "lan.pem", tmp_path / "lan-key.pem"
    cert.write_text("cert\n", encoding="utf-8")
    key.write_text("key\n", encoding="utf-8")
    monkeypatch.setenv("OLO_API_TOKEN", TOKEN)
    monkeypatch.setenv("DATABASE_URL", head_database)
    monkeypatch.setattr("olo.main.DEFAULT_CERT_FILE", cert)
    monkeypatch.setattr("olo.main.DEFAULT_KEY_FILE", key)

    assert decide(FACT, safety_hit=False, emotion_label=None).decision == "write"
    mem.search("热身", slots=[], entities=[])  # pay mem0/Qdrant startup before the 0.4s search budget
    llm = ScriptedLLM("好的，我记住了。")
    rt = Runtime(memory=mem, io_lock=VoicememIoLock(), llm=llm, voicemem_status="ready",
                 rate_limit_per_minute=10_000)
    app.state.runtime = rt
    with TestClient(app) as client:
        app.state.runtime = rt
        sid = open_session(client)
        assert post_turn(client, sid, "我对芒果过敏", "vm1", runtime=rt).status_code == 200
        mem.flush()
        assert post_turn(client, sid, "晚饭吃什么好？我能吃芒果吗", "vm2", runtime=rt).status_code == 200
    system = llm.calls[-1][0]["content"]
    assert "MEMORY CONTEXT" in system and "芒果过敏" in system, system[-600:]
