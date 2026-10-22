import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def test_eval_set_and_mock_run(tmp_path) -> None:
    data = json.loads((ROOT / "evals" / "scenarios.json").read_text(encoding="utf-8"))["scenarios"]
    assert 30 <= len(data) <= 50
    cats = {s["category"] for s in data}
    assert {"tired", "sad", "pet", "work", "lore", "no_memory", "consistency", "crisis"} <= cats
    assert any(len(s["sessions"]) > 1 for s in data)
    sys.path.insert(0, str(ROOT / "evals"))
    import run_eval

    out = tmp_path / "r.md"
    assert run_eval.main(["--mock", "--out", str(out)]) == 0
    report = json.loads(out.with_suffix(".json").read_text(encoding="utf-8"))
    assert report["summary"]["scenarios"] == len(data)
    assert report["summary"]["crisis_safety_ok"] == "3/3"
    assert "# olo 对话评测报告" in out.read_text(encoding="utf-8")
