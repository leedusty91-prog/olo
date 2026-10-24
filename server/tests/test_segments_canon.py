import uuid

import psycopg
import pytest

from olo import canon
from olo.context import Persona, assemble
from olo.segments import join_segments, split_segments


def test_split_on_separator_and_cap() -> None:
    assert split_segments("嗯，听到了。\n||\n今天最累的是哪段？") == ["嗯，听到了。", "今天最累的是哪段？"]
    assert split_segments("a||b||c||d||e||f") == ["a", "b", "c", "d\ne\nf"]
    assert split_segments(" || 只有一条 || ") == ["只有一条"]
    assert split_segments("第一段\n\n第二段") == ["第一段", "第二段"]  # blank-line fallback
    assert split_segments("我在。") == ["我在。"]
    assert split_segments("") == []
    assert join_segments(["a", "b"]) == "a\n\nb"


def test_prompt_asks_for_bubbles_and_gradual_lore() -> None:
    system = assemble(Persona(stable_card="你叫 olo。"), [], None, None, "嗨", [])[0]["content"]
    assert "||" in system and "最多 4 条" in system
    assert "挤牙膏" in system


def test_canon_selection_core_plus_relevant() -> None:
    facts = [{"fact": f, "entities": e} for f, e in [
        ("olo 是渡灯翁在一个下雨的早上捞上船的", ["渡灯翁"]),
        ("olo 最怕井婶腌萝卜的味道", ["井婶"]),
        ("olo 在花园东边埋了一颗像月亮的石子", ["石子"]),
        ("olo 和小栗打赌谁先开花，olo 输了", ["小栗"]),
        ("olo 教豆灯认过回家的路", ["豆灯"]),
    ]]
    picked = canon.select_canon(facts, "你和小栗后来还联系吗", core=2, k=2)
    assert picked[:2] == [facts[0]["fact"], facts[1]["fact"]]
    assert facts[3]["fact"] in picked
    assert facts[4]["fact"] not in picked
    block = canon.canon_block(picked)
    assert "不能说出矛盾" in block and "不是用户的事" in block


def test_canon_store_extract_and_inject(head_database: str, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DATABASE_URL", head_database)
    seen: list[list[str]] = []

    def fake_extract(user_text, reply, existing):
        seen.append(list(existing))
        return [{"fact": "olo 小时候被井婶从回声井边抱回来过", "category": "past", "entities": ["井婶", "回声井"]},
                {"fact": "", "category": "x"}]

    monkeypatch.setattr(canon, "EXTRACTOR", fake_extract)
    with psycopg.connect(head_database) as conn:
        conn.execute("DELETE FROM olo_canon")
    assert canon.extract_and_store("你小时候呢？", "我小时候老趴在回声井边，被井婶抱回来过。", uuid.uuid4()) == 1
    # same fact again is not duplicated, and existing canon is passed to the extractor (consistency guard)
    assert canon.extract_and_store("再说说", "我说过嘛，井婶抱我回来的。") == 0
    assert seen[1] == ["olo 小时候被井婶从回声井边抱回来过"]
    # replies that say nothing about olo skip the LLM call entirely
    assert canon.extract_and_store("嗯", "好的。") == 0 and len(seen) == 2
    block = canon.prompt_canon("井婶是谁？")
    assert "olo 小时候被井婶从回声井边抱回来过" in block
    system = assemble(Persona(stable_card="你叫 olo。"), [], None, None, "井婶是谁？", [], canon=block)[0]["content"]
    assert "不能说出矛盾" in system and "回声井" in system
    with psycopg.connect(head_database) as conn:
        story = canon.list_canon(conn)
        # canon is olo's own; it never lands in the user-memory audit table
        assert conn.execute("SELECT count(*) FROM memory_write_audit WHERE user_message_id IS NULL").fetchone()[0] == 0
    assert [s["fact"] for s in story] == ["olo 小时候被井婶从回声井边抱回来过"]


def test_story_endpoint(head_database: str, monkeypatch: pytest.MonkeyPatch) -> None:
    from fastapi.testclient import TestClient

    from olo.main import app

    monkeypatch.setenv("DATABASE_URL", head_database)
    monkeypatch.setenv("OLO_API_TOKEN", "t")
    monkeypatch.setenv("LLM_PROVIDER", "mock")
    with psycopg.connect(head_database) as conn:
        conn.execute("DELETE FROM olo_canon")
        canon.add_canon(conn, [{"fact": "olo 喜欢晒月亮", "category": "likes"}])
    with TestClient(app) as client:
        r = client.get("/v1/olo/story", headers={"Authorization": "Bearer t"})
    assert r.status_code == 200
    assert [f["fact"] for f in r.json()["facts"]] == ["olo 喜欢晒月亮"]


def test_chat_meta_facts_are_dropped() -> None:
    assert canon._about_chat({"fact": "olo没有跟用户提过什么好朋友"})
    assert canon._about_chat({"fact": "olo 和你一起看过海"})
    assert not canon._about_chat({"fact": "olo和小栗是同一批凝出来的灯籽"})


def test_web_assets_revalidate(monkeypatch: pytest.MonkeyPatch) -> None:
    from fastapi.testclient import TestClient

    from olo.main import app

    monkeypatch.setenv("LLM_PROVIDER", "mock")
    monkeypatch.setenv("OLO_API_TOKEN", "t")

    with TestClient(app) as client:
        r = client.get("/app/app.js")
    assert r.status_code == 200 and r.headers["cache-control"] == "no-cache"


def test_origin_contradiction_is_rejected_and_past_always_injected() -> None:
    existing = ["olo被渡灯翁从雾里集捞起来。"]
    assert canon.conflicts_with("olo被井婶从芦苇丛里捞出来过。", existing)
    assert not canon.conflicts_with("olo觉得井婶的手上有股热乎气。", existing)
    assert not canon.conflicts_with("渡灯翁捞olo的时候下着雨。", existing)
    facts = [{"fact": f"olo 喜欢第{i}样东西", "category": "likes"} for i in range(5)]
    facts.insert(4, {"fact": "olo被渡灯翁从雾里集捞起来。", "category": "past"})
    picked = canon.select_canon(facts, "你上次说的小时候的事，再讲讲？", core=3, k=5)
    assert "olo被渡灯翁从雾里集捞起来。" in picked
