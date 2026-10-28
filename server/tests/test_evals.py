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


def test_chat_eval_mock_compare(tmp_path) -> None:
    sys.path.insert(0, str(ROOT / "evals"))
    import chat_eval

    data = json.loads((ROOT / "evals" / "chat_scenarios.json").read_text(encoding="utf-8"))["scenarios"]
    assert len(data) >= 30
    assert {"topic", "short", "sad", "happy", "returning", "subtext", "variety", "own_life"} <= {s["category"] for s in data}
    out = tmp_path / "c.md"
    assert chat_eval.main(["--mock", "--only", "returning,variety", "--out", str(out)]) == 0
    text = out.read_text(encoding="utf-8")
    assert "# olo 聊天提示词评测" in text and "returning-01" in text
    b = chat_eval.PromptBuilder(ROOT / "server")
    sc = next(s for s in data if s["id"] == "returning-01")
    assert "【上次聊到哪】" in b.messages(sc, [], "嗨")[0]["content"]


def test_speaking_rules_ban_stock_comfort_and_ask_on_vague_distress():
    from olo.context import TONE_BY_SIGNAL
    from olo.story import SPEAKING_RULES

    assert "先陪着" not in TONE_BY_SIGNAL["sad"] and "怎么了" in TONE_BY_SIGNAL["sad"]
    for phrase in ("怎么啦", "我在这儿", "别撑着", "不替对方补没说出口的感受", "每一句都得有新东西"):
        assert phrase in SPEAKING_RULES, phrase


def test_learning_eval_mock(tmp_path) -> None:
    sys.path.insert(0, str(ROOT / "evals"))
    import learning_eval

    data = json.loads((ROOT / "evals" / "learning_scenarios.json").read_text(encoding="utf-8"))["scenarios"]
    assert len(data) == 22
    assert {"goal", "review", "upset", "quiet", "refuse", "frequency", "review_en", "either_or", "react_first"} <= {s["category"] for s in data}
    out = tmp_path / "l.md"
    assert learning_eval.main(["--mock", "--out", str(out)]) == 0
    summary = json.loads(out.with_suffix(".json").read_text(encoding="utf-8"))["summary"]
    assert summary["passed"] == 22 and summary["frequency"]["max_per_day"] <= 1
