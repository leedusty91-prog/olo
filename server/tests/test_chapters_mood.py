"""雾里集章节解锁 + 心情曲线。"""

import os
from datetime import datetime
from zoneinfo import ZoneInfo

import psycopg
import pytest
from fastapi.testclient import TestClient

from olo import canon, chapters, mood
from olo.main import app

TOKEN = "test-api-token"
AUTH = {"Authorization": f"Bearer {TOKEN}"}
SH = ZoneInfo("Asia/Shanghai")


@pytest.fixture
def client(head_database: str, monkeypatch: pytest.MonkeyPatch, tmp_path):
    cert, key = tmp_path / "c.pem", tmp_path / "k.pem"
    cert.write_text("c\n"), key.write_text("k\n")
    monkeypatch.setenv("OPENAI_API_KEY", "test-openai-key")
    monkeypatch.setenv("OLO_API_TOKEN", TOKEN)
    monkeypatch.setenv("DATABASE_URL", head_database)
    monkeypatch.setattr("olo.main.DEFAULT_CERT_FILE", cert)
    monkeypatch.setattr("olo.main.DEFAULT_KEY_FILE", key)
    with psycopg.connect(head_database) as conn:
        conn.execute("DELETE FROM olo_chapters"), conn.execute("DELETE FROM olo_canon"), conn.execute("DELETE FROM mood_daily")
    with TestClient(app) as c:
        yield c


def test_mood_scoring() -> None:
    assert mood.score_text("今天好开心，面试过了！") > 0
    assert mood.score_text("加班到九点好累") < 0
    assert mood.score_text("我不开心") < 0  # negation flips
    assert mood.score_text("吃了碗面") == 0.0
    assert mood.score_text("   ") is None
    assert mood.score_text("嗯", "sad") < 0  # acoustic label wins for voice


def test_mood_daily_aggregate_shanghai_day(client) -> None:
    late = datetime(2026, 10, 21, 23, 30, tzinfo=SH)  # 15:30 UTC, still the 21st in Shanghai
    mood.record("好开心", now=late)
    mood.record("好累", now=late)
    mood.record("好开心哈哈", now=datetime(2026, 10, 22, 0, 30, tzinfo=SH))
    with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
        days = mood.curve(conn, 14, now=datetime(2026, 10, 22, 12, tzinfo=SH))
    assert len(days) == 14 and days[-1]["day"] == "2026-10-22"
    assert days[-2] == {"day": "2026-10-21", "mood": 0.0, "turns": 2}
    assert days[-1]["mood"] == 1.0 and days[0]["mood"] is None
    r = client.get("/v1/mood?days=14", headers=AUTH)
    assert r.status_code == 200 and len(r.json()["days"]) == 14


def test_chapters_unlock_in_order_and_narrate_once(client, monkeypatch) -> None:
    calls: list[tuple[str, list[str]]] = []

    def fake(place, theme, facts, previous):
        calls.append((place, list(facts)))
        return {"title": f"{place}小记", "narration": "我记得那天雾很轻。\n\n" + "；".join(facts)}

    monkeypatch.setattr(chapters, "NARRATOR", fake)
    b = client.get("/v1/olo/chapters", headers=AUTH).json()
    assert b["unlocked"] == 0 and b["total"] == len(chapters.CHAPTERS) and not b["chapters"][0]["unlocked"]
    assert "title" not in b["chapters"][0] and b["chapters"][0]["hint"]

    with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
        canon.add_canon(conn, [
            {"fact": "olo 最早是落雾滩上的一小团雾", "category": "past"},
            {"fact": "olo 和小栗是同一批凝出来的灯籽", "category": "friends"},
            {"fact": "olo 被声控灯吓过一跳", "category": "past"},
        ])
    b = client.get("/v1/olo/chapters", headers=AUTH).json()
    assert b["unlocked"] == 2  # ch1 needs 1 fact, ch2 needs 3; ch3 also needs garden stage 2
    assert b["chapters"][0]["title"] == "落雾滩小记" and "落雾滩" in b["chapters"][0]["narration"]
    assert not b["chapters"][2]["unlocked"]
    # each fact goes into at most one chapter; stored text is never regenerated
    used = [f for _, fs in calls for f in fs]
    assert len(used) == len(set(used))
    client.get("/v1/olo/chapters", headers=AUTH)
    assert len(calls) == 2


def test_chapter_narration_failure_is_retried_later(client, monkeypatch) -> None:
    def boom(*a):
        raise RuntimeError("down")

    monkeypatch.setattr(chapters, "NARRATOR", boom)
    with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
        canon.add_canon(conn, [{"fact": "olo 最早是一小团雾", "category": "past"}])
    assert client.get("/v1/olo/chapters", headers=AUTH).json()["unlocked"] == 0
    monkeypatch.setattr(chapters, "NARRATOR", lambda *a: {"title": "雾", "narration": "我。"})
    assert client.get("/v1/olo/chapters", headers=AUTH).json()["unlocked"] == 1


def test_stray_characters_trigger_retry_then_fallback(monkeypatch) -> None:
    facts = ["olo 最早是落雾滩上的一小团雾"]
    assert chapters.stray_names("井婶笑了，小栗也来了", facts) == ["井婶", "小栗"]
    outs = iter([{"title": "a", "narration": "井婶来了"}, {"title": "b", "narration": "我在雾里。"}])
    monkeypatch.setattr(chapters, "NARRATOR", lambda *a: next(outs))
    assert chapters.narrate_checked("落雾滩", "t", facts, [])["title"] == "b"
    monkeypatch.setattr(chapters, "NARRATOR", lambda *a: {"title": "x", "narration": "阿蒲在"})
    assert "阿蒲" not in chapters.narrate_checked("落雾滩", "t", facts, [])["narration"]
    long = "我在落雾滩上飘着，风很软，水汽凉凉地贴着芦苇根，我一点点变得清楚起来。阿蒲跑过来了。\n\n雾一层层落下，像有人轻轻呼出一口气，我就这样醒了。"
    monkeypatch.setattr(chapters, "NARRATOR", lambda *a: {"title": "x", "narration": long})
    out = chapters.narrate_checked("落雾滩", "t", facts, [])
    assert out["title"] == "x" and "阿蒲" not in out["narration"] and "我就这样醒了" in out["narration"]
