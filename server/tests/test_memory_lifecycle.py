from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from olo import consolidate
from olo.memory.fake import FakeMemory
from olo.memory.lifecycle import Lifecycle

NOW = datetime(2026, 10, 26, 12, tzinfo=timezone.utc)


def _mem(tmp_path):
    mem = FakeMemory()
    mem.lifecycle = Lifecycle(tmp_path / "lc.json")
    mem.memories = [
        {"id": "cat", "text": "用户的猫叫年糕", "created_at": ""},
        {"id": "lunch", "text": "用户今天午饭吃了鲈鱼", "created_at": ""},
        {"id": "tired", "text": "用户今天加班很累", "created_at": ""},
        {"id": "cold", "text": "用户以前提过一次周末爬山", "created_at": ""},
    ]
    mem.lifecycle.label(["cat"], "lasting", NOW - timedelta(days=60))
    mem.lifecycle.label(["lunch"], "one_day", NOW - timedelta(days=4))
    mem.lifecycle.label(["tired"], "one_day", NOW - timedelta(days=1))
    return mem


def test_one_day_memories_sink_in_recall_after_three_days(tmp_path):
    mem = _mem(tmp_path)
    hits = [SimpleNamespace(memory_id=i) for i in ("lunch", "tired", "cat")]
    assert [h.memory_id for h in mem.lifecycle.rerank(hits, NOW)] == ["tired", "cat", "lunch"]


def test_nightly_archives_cold_and_old_one_day_keeps_lasting(tmp_path):
    mem = _mem(tmp_path)
    mem.lifecycle.label(["lunch"], "one_day", NOW - timedelta(days=8))
    mem.cold = ["cat", "cold"]  # VoiceMem would archive the lasting cat too
    out = mem.lifecycle.nightly(mem, NOW)
    assert sorted(out["archived"]) == ["cold", "lunch"] and out["kept_lasting"] == ["cat"]
    assert {m["id"] for m in mem.memories} == {"cat", "tired"}
    assert set(mem.archived) == {"cold", "lunch"}  # archived, not deleted


def test_archived_memory_revives_when_user_brings_it_up(tmp_path):
    mem = _mem(tmp_path)
    mem.lifecycle.label(["lunch"], "one_day", NOW - timedelta(days=8))
    mem.lifecycle.nightly(mem, NOW)
    assert mem.lifecycle.revive(mem, "还记得我那天午饭吃了鲈鱼吗") == ["lunch"]
    assert "lunch" in {m["id"] for m in mem.memories} and "lunch" not in mem.lifecycle.archived()
    assert mem.lifecycle.revive(mem, "今天天气不错") == []


def test_consolidate_run_wires_forgetting(tmp_path):
    mem = _mem(tmp_path)
    mem.cold = ["cold"]
    assert consolidate.archive_forgotten(mem)["archived"] == ["cold"]
    assert consolidate.archive_forgotten(FakeMemory()) == {"skipped": "no_lifecycle"}
