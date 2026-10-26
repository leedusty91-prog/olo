from types import SimpleNamespace

from olo.memory.compat import build_memory_context


def test_slot_summaries_ride_along_with_hits_capped():
    hit = SimpleNamespace(memory_id="a", text="用户的猫叫年糕", observed_at="2026-10-20")
    r = SimpleNamespace(hits=[hit], rb_hits=[], related_summaries={"pet": "养了一只叫年糕的猫" * 20, "work": "在咖啡豆公司", "x": "第三条"})
    out = build_memory_context(r)
    assert "年糕" in out and "OVERALL" in out and "第三条" not in out
    assert max(len(l) for l in out.splitlines() if l.startswith("- 养")) <= 82


def test_no_summaries_without_hits():
    r = SimpleNamespace(hits=[], rb_hits=[], related_summaries={"pet": "养猫"})
    assert "OVERALL" not in build_memory_context(r)
