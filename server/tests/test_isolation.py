"""Per-user isolation: one user's messages, canon, diary inputs and memory config never reach another."""

import uuid
from datetime import date

import psycopg
import pytest

from olo import canon
from olo.garden import garden_state
from olo.memory.voicemem_api import VoiceMemSettings, build_api_config
from olo.notebook import recent_messages, todays_user_messages
from olo.sessions import SEEDED_USER_ID

OTHER = uuid.UUID("00000000-0000-4000-8000-0000000000b2")


def _say(conn, user_id, text) -> uuid.UUID:
    sid = uuid.uuid4()
    conn.execute("INSERT INTO sessions (id, user_id) VALUES (%s, %s)", (sid, user_id))
    conn.execute(
        "INSERT INTO messages (id, session_id, role, modality, body) VALUES (%s, %s, 'user', 'text', %s)",
        (uuid.uuid4(), sid, text),
    )
    return sid


@pytest.fixture
def two_users(head_database: str, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("DATABASE_URL", head_database)
    with psycopg.connect(head_database) as conn:
        conn.execute("DELETE FROM olo_canon")
        conn.execute(
            "INSERT INTO users (id, display_name) VALUES (%s, 'other') ON CONFLICT DO NOTHING", (OTHER,)
        )
        mine = _say(conn, SEEDED_USER_ID, "我今天去面试了，有点紧张。")
        theirs = _say(conn, OTHER, "我的猫叫年糕，今年两岁。")
        canon.add_canon(conn, [{"fact": "olo 在回声井边捡过一颗石子", "category": "past"}], user_id=SEEDED_USER_ID)
        canon.add_canon(conn, [{"fact": "olo 给年糕讲过回声井的事", "category": "friends"}], user_id=OTHER)
        conn.commit()
        yield conn, mine, theirs


def test_messages_and_diary_inputs_are_per_user(two_users) -> None:
    conn, mine, theirs = two_users
    bodies = [m["body"] for m in recent_messages(conn, None, user_id=SEEDED_USER_ID)]
    assert "我今天去面试了，有点紧张。" in bodies and not any("年糕" in b for b in bodies)
    # another user's session id gives nothing, even if guessed
    assert recent_messages(conn, theirs, user_id=SEEDED_USER_ID) == []
    quotes = [m["body"] for m in todays_user_messages(conn, date.today(), user_id=SEEDED_USER_ID)]
    assert not any("年糕" in q for q in quotes)
    assert [m["body"] for m in todays_user_messages(conn, date.today(), user_id=OTHER)] == ["我的猫叫年糕，今年两岁。"]


def test_canon_is_per_user(two_users) -> None:
    conn, *_ = two_users
    assert [c["fact"] for c in canon.list_canon(conn, SEEDED_USER_ID)] == ["olo 在回声井边捡过一颗石子"]
    assert "年糕" not in canon.prompt_canon("年糕最近好吗", user_id=SEEDED_USER_ID)
    assert "年糕" in canon.prompt_canon("年糕最近好吗", user_id=OTHER)


def test_garden_counts_only_own_messages(two_users) -> None:
    conn, *_ = two_users
    before = garden_state(conn)["messages"] if "messages" in garden_state(conn) else None
    _say(conn, OTHER, "别人的又一句话")
    conn.commit()
    after = garden_state(conn)["messages"] if before is not None else None
    assert before == after


def test_voicemem_config_is_keyed_by_user() -> None:
    a = build_api_config(VoiceMemSettings.from_env({"OPENAI_API_KEY": "k", "OLO_VOICEMEM_USER": "u-a"}))
    b = build_api_config(VoiceMemSettings.from_env({"OPENAI_API_KEY": "k", "OLO_VOICEMEM_USER": "u-b"}))
    assert a["user_id"] == "u-a" and b["user_id"] == "u-b"
    assert build_api_config(VoiceMemSettings.from_env({"OPENAI_API_KEY": "k"}))["user_id"] == str(SEEDED_USER_ID)
