"""Real VoiceMem (Apache-2.0) per-user isolation, against a local fake OpenAI
endpoint (no network, no spend). Skipped when voicemem isn't installed."""
import os
import uuid
from pathlib import Path

import pytest

pytest.importorskip("voicemem")


@pytest.fixture
def env(tmp_path, monkeypatch):
    monkeypatch.setenv("MEM0_DIR", str(tmp_path / "mem0"))
    import fake_openai

    base, srv = fake_openai.start()
    from olo.memory.voicemem_api import ApiVoiceMemAdapter, VoiceMemSettings, make_voicemem

    s = VoiceMemSettings(api_key="k", base_url=base, embedding_api_key="k", embedding_base_url=base,
                         embedding_model="e", embedding_dims=64, root=tmp_path / "root", space="olo",
                         user_id="00000000-0000-4000-8000-000000000001")
    yield s, ApiVoiceMemAdapter(make_voicemem(s), s), tmp_path
    srv.shutdown()


def _put(mem, text):
    from voicemem.leftbrain.extract_facts_openai import ExtractedAdditiveMemory

    mem._repo().append_extracted([ExtractedAdditiveMemory(local_id="0", text=text, attributed_to="user")], user_id=mem._s.user_id)


def test_each_user_gets_own_space_and_wipe_drops_only_theirs(env):
    from olo.main import _user_settings, _user_voicemem, _wipe_voicemem
    from olo.memory.per_user import PerUserMemory
    from olo.userctx import SEEDED_USER_ID, reset_current_user, set_current_user

    s, seeded, tmp = env
    pm = PerUserMemory(seeded, _user_voicemem(s), wipe=_wipe_voicemem(s))
    a, b = uuid.uuid4(), uuid.uuid4()
    for uid, text in ((SEEDED_USER_ID, "User likes steamed buns"), (a, "User has a cat named Mochi"), (b, "User runs at dawn")):
        tok = set_current_user(uid)
        try:
            _put(pm.for_user(uid), text)
        finally:
            reset_current_user(tok)

    def texts(uid):
        tok = set_current_user(uid)
        try:
            return [m["text"] for m in pm.list_memories()]  # routed by the current user
        finally:
            reset_current_user(tok)

    assert "steamed buns" in " ".join(texts(SEEDED_USER_ID)) and "Mochi" not in " ".join(texts(SEEDED_USER_ID))
    assert "Mochi" in " ".join(texts(a)) and "dawn" not in " ".join(texts(a))
    assert "dawn" in " ".join(texts(b)) and "Mochi" not in " ".join(texts(b))
    b_root = Path(_user_settings(s, b).memory_root)
    assert b_root.exists() and b_root != Path(_user_settings(s, a).memory_root)

    pm.wipe_user(b)
    assert not b_root.exists()
    assert texts(b) == []
    assert "Mochi" in " ".join(texts(a)) and "steamed buns" in " ".join(texts(SEEDED_USER_ID))
    # MEM0_DIR is shared, but holds only mem0's own config, never memories.
    assert set(os.listdir(tmp / "mem0")) <= {"config.json"}
