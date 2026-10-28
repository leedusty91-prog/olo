"""陪你学 Phase 0 (docs/learning.md). OLO_LEARNING defaults off; tests switch it on explicitly."""

import json
import random
import uuid
from datetime import UTC, datetime, timedelta

import psycopg
import pytest

from olo import learning as L
from olo.sessions import SEEDED_USER_ID
from tests.test_turns import (  # noqa: F401
    AUTH,
    _client,
    make_runtime,
    open_session,
    post_turn,
    runtime,
)

NOW = datetime(2026, 10, 28, 6, 0, tzinfo=UTC)  # 14:00 Shanghai, outside quiet hours
CHAT = [{"role": "user", "content": "嗯嗯"}, {"role": "assistant", "content": "然后呢"}] * 3


class Always(random.Random):
    def random(self):
        return 0.0


class Never(random.Random):
    def random(self):
        return 0.99


# ------------------------------------------------------------- pure helpers


def test_switch_defaults_off(monkeypatch):
    monkeypatch.delenv("OLO_LEARNING", raising=False)
    assert not L.enabled()
    monkeypatch.setenv("OLO_LEARNING", "1")
    assert L.enabled()
    monkeypatch.setenv("OLO_LEARNING", "0")
    assert not L.enabled()


def test_sm2_schedule():
    assert L.sm2("right", 2.5, 2, 0.0) == (2.5, 5.0, 0.25)
    e, i, _ = L.sm2("fuzzy", 2.5, 4, 0.5)
    assert i == 4 and abs(e - 2.35) < 1e-9
    assert L.sm2("wrong", 2.5, 10, 0.5)[1] == 1.0
    assert L.sm2("skipped", 2.5, 3, 0.4) == (2.5, 3, 0.4)
    assert L.sm2("fuzzy", 1.3, 1, 0)[0] == 1.3  # ease floor


@pytest.mark.parametrize("text,topic", [
    ("我打算下个月去大阪，想学点日语", "点日语"),
    ("最近在学吉他", "吉他"),
    ("我要考雅思了", "雅思"),
    ("I want to learn Python decorators", "Python decorators"),
    ("I'm studying for the GRE", "the GRE"),
])
def test_detect_goal_explicit_only(text, topic):
    assert L.detect_goal(text) == topic


@pytest.mark.parametrize("text", ["今天中午吃了拉面", "我不想学了", "以前学过钢琴", "学校门口新开了家店", "I don't want to learn that"])
def test_detect_goal_ignores_non_goals(text):
    assert L.detect_goal(text) is None


def test_upset_uses_mood_and_emotion_signals():
    assert L.is_upset("今天好烦")                      # mood lexicon
    assert L.is_upset("工作压力好大")                  # mood lexicon
    assert L.is_upset("嗯", emotion_label="sad")       # acoustic label (voice)
    assert L.is_upset("这事怎么办啊")                  # help-seeking
    assert L.is_upset("I'm so stressed today")
    assert not L.is_upset("今天中午吃了拉面")
    assert not L.is_upset("哈哈今天挺开心")
    assert not L.is_upset("I had ramen for lunch")


def test_refusal_zh_en():
    assert L.is_refusal("别考我了今天好烦") and L.is_refusal("Don't quiz me")
    assert not L.is_refusal("ikura desu ka")


def test_hint_is_one_casual_question_both_languages():
    r = L.Review(uuid.uuid4(), uuid.uuid4(), "日语", "这个多少钱怎么说", "ikura desu ka", "zh")
    zh, en = L.hint(r, "zh"), L.hint(r, "en")
    assert "只问一句" in zh and "不讲课" in zh and "ikura desu ka" in zh
    assert "ONE short" in en and "no lecture" in en and "great job" in en


def test_asked_detects_question_in_reply():
    r = L.Review(uuid.uuid4(), uuid.uuid4(), "日语", "这个多少钱怎么说", "ikura desu ka", "zh")
    assert L.asked(r, "哪家？对了，“这个多少钱”你还记得怎么说吗？")
    assert not L.asked(r, "哪家拉面？")              # question, but not the review
    assert not L.asked(r, "拉面不错。")


# ------------------------------------------------------------- DB


@pytest.fixture
def db(head_database, monkeypatch):
    monkeypatch.setenv("OLO_LEARNING", "1")
    monkeypatch.setenv("OLO_QUIET_HOURS", "23:00-08:00")
    return head_database


def seed(url, *, due=NOW - timedelta(hours=1), n=1, topic="日语"):
    gid = uuid.uuid4()
    items = []
    with psycopg.connect(url, autocommit=True) as conn:
        conn.execute("INSERT INTO learning_goals (id, user_id, topic) VALUES (%s,%s,%s)", (gid, SEEDED_USER_ID, topic))
        for k in range(n):
            iid = uuid.uuid4()
            conn.execute("INSERT INTO learning_items (id, goal_id, prompt, answer, due_at) VALUES (%s,%s,%s,%s,%s)",
                         (iid, gid, f"这个多少钱{k}", "ikura desu ka", due))
            items.append(iid)
    return gid, items


def pick(url, text="今天中午吃了拉面", recent=CHAT, now=NOW, rng=None, emotion=None):
    with psycopg.connect(url, autocommit=True) as conn:
        return L.pick_review(conn, now, text, recent, emotion=emotion, rng=rng or Always())


def test_pick_review_gates(db):
    assert pick(db)[1] == "nothing_due"
    gid, items = seed(db)
    assert pick(db)[1] == "pick"
    assert pick(db, rng=Never())[1] == "random_gate"
    assert pick(db, text="今天好烦")[1] == "upset"
    assert pick(db, emotion="sad", text="嗯")[1] == "upset"
    assert pick(db, recent=CHAT[:2])[1] == "too_early"
    assert pick(db, now=NOW.replace(hour=16))[1] == "quiet_hours"  # 00:00 Shanghai
    with psycopg.connect(db, autocommit=True) as conn:
        conn.execute("UPDATE learning_goals SET paused_until = %s WHERE id = %s", (NOW + timedelta(days=1), gid))
    assert pick(db)[1] == "nothing_due"


def test_pick_review_off_when_switch_off(db, monkeypatch):
    seed(db)
    monkeypatch.setenv("OLO_LEARNING", "0")
    assert pick(db) == (None, "off")


def test_daily_cap_and_goal_gap(db):
    gid, items = seed(db, n=2)
    plan = L.TurnPlan(review=pick(db)[0])
    sid = uuid.uuid4()
    with psycopg.connect(db, autocommit=True) as conn:
        conn.execute("INSERT INTO sessions (id, user_id) VALUES (%s,%s)", (sid, SEEDED_USER_ID))
    assert L.after_reply(None, plan, sid, "x", "对了，这个多少钱0你还记得吗？", uuid.uuid4(), now=NOW, background=False)
    assert pick(db, now=NOW + timedelta(hours=2))[1] == "daily_cap"
    assert pick(db, now=NOW + timedelta(days=1))[1] == "nothing_due"  # same goal < 2 days
    assert pick(db, now=NOW + timedelta(days=2, hours=1))[1] == "pick"


class GradingLLM:
    def __init__(self, result):
        self.result = result
        outer = self

        class Aux:
            def stream(self, messages):
                yield json.dumps({"result": outer.result})

        self.aux = Aux()


class RT:
    def __init__(self, llm):
        self.llm = llm


def _asked_review(url):
    gid, (iid,) = seed(url)
    sid, mid = uuid.uuid4(), uuid.uuid4()
    with psycopg.connect(url, autocommit=True) as conn:
        conn.execute("INSERT INTO sessions (id, user_id) VALUES (%s,%s)", (sid, SEEDED_USER_ID))
        conn.execute("INSERT INTO messages (id, session_id, role, modality, body) VALUES (%s,%s,'assistant','text','还记得吗？')", (mid, sid))
        conn.execute("INSERT INTO learning_reviews (id, item_id, session_id, asked_message_id, result) VALUES (%s,%s,%s,%s,'asked')",
                     (uuid.uuid4(), iid, sid, mid))
    return gid, iid, sid


@pytest.mark.parametrize("result,interval,res", [("right", 2.5, "right"), ("wrong", 1.0, "wrong"), ("fuzzy", 1.0, "fuzzy")])
def test_next_turn_grades_answer(db, result, interval, res):
    gid, iid, sid = _asked_review(db)
    plan = L.before_reply(RT(GradingLLM(result)), sid, "kore hitotsu kudasai", CHAT, now=NOW)
    assert plan.graded == res and plan.review is None and "别讲课" in plan.note
    with psycopg.connect(db) as conn:
        row = conn.execute("SELECT interval_days, last_result, reviews FROM learning_items WHERE id = %s", (iid,)).fetchone()
    assert row == (interval, res, 1)


def test_refusal_pauses_goal_then_second_refusal_parks_it(db):
    gid, iid, sid = _asked_review(db)
    plan = L.before_reply(RT(GradingLLM("right")), sid, "别考我了今天好烦", CHAT, now=NOW)
    assert plan.graded == "refused" and plan.note == ""
    with psycopg.connect(db) as conn:
        st = conn.execute("SELECT status, refusals, paused_until FROM learning_goals WHERE id = %s", (gid,)).fetchone()
    assert st[0] == "active" and st[1] == 1 and st[2] == NOW + timedelta(days=3)
    with psycopg.connect(db, autocommit=True) as conn:
        conn.execute("INSERT INTO learning_reviews (id, item_id, session_id, asked_message_id, result) "
                     "VALUES (%s,%s,%s,(SELECT id FROM messages WHERE session_id=%s LIMIT 1),'asked')", (uuid.uuid4(), iid, sid, sid))
    L.before_reply(RT(GradingLLM("right")), sid, "don't quiz me", CHAT, now=NOW)
    with psycopg.connect(db) as conn:
        assert conn.execute("SELECT status, refusals FROM learning_goals WHERE id = %s", (gid,)).fetchone() == ("paused", 2)


def test_grader_failure_is_skipped_not_scored(db):
    class Broken:
        class aux:
            @staticmethod
            def stream(messages):
                raise RuntimeError("down")
    gid, iid, sid = _asked_review(db)
    plan = L.before_reply(RT(Broken()), sid, "ikura?", CHAT, now=NOW)
    assert plan.graded == "skipped"
    with psycopg.connect(db) as conn:
        assert conn.execute("SELECT reviews, last_result FROM learning_items WHERE id = %s", (iid,)).fetchone() == (0, "skipped")


class GoalLLM:
    def __init__(self, payload):
        outer = self
        outer.payload = payload

        class Aux:
            def stream(self, messages):
                yield json.dumps(outer.payload, ensure_ascii=False)

        self.aux = Aux()


def test_goal_creation_seeds_items_and_caps_in_flight(db):
    items = [{"prompt": f"p{k}", "answer": "a"} for k in range(8)]
    out = L.learn_from_turn(RT(GoalLLM({"topic": "日语-旅行会话", "why": "下个月去大阪", "items": items})),
                            "我打算下个月去大阪，想学点日语", "去大阪好啊！", None, NOW)
    assert out == {"action": "goal", "topic": "日语-旅行会话", "items": 5}
    again = L.learn_from_turn(RT(GoalLLM({"topic": "日语-旅行会话", "items": items})), "想学日语", "好", None, NOW)
    assert again["action"] == "goal_exists"
    with psycopg.connect(db) as conn:
        assert conn.execute("SELECT count(*) FROM learning_goals").fetchone()[0] == 1
        gid = conn.execute("SELECT id FROM learning_goals").fetchone()[0]
        conn.execute("INSERT INTO learning_items (id, goal_id, prompt, answer, due_at) "
                     "SELECT gen_random_uuid(), %s, 'x'||g, 'a', now() FROM generate_series(1,20) g", (gid,))
        n = L._add_items(conn, gid, [("new", "a")], NOW)
    assert n == 0  # already >= 20 in flight


def test_model_can_decline_goal_and_no_goal_from_casual_question(db):
    out = L.learn_from_turn(RT(GoalLLM({"topic": ""})), "想学点做饭", "好啊", None, NOW)
    assert out["action"] == "none"
    out = L.learn_from_turn(RT(GoalLLM({"items": [{"prompt": "p", "answer": "a"}]})), "这个怎么说？", "就这么说", None, NOW)
    assert out == {"action": "none", "reason": "no_goal"}


# ------------------------------------------------------------- turn integration


class ChatLLM:
    """Chat model whose reply carries the review question; aux grades 'right'."""

    def __init__(self):
        self.calls = []
        outer = self

        class Aux:
            def stream(self, messages):
                sys = messages[0]["content"]
                if "判断对方是否答对" in sys:
                    yield json.dumps({"result": "right"})
                elif "准备发出去的微信回复" in sys:
                    outer.guard_systems.append(sys)
                    yield json.dumps({"bad": []})
                else:
                    yield json.dumps({})

        self.aux = Aux()
        self.guard_systems = []

    def stream(self, messages):
        self.calls.append(messages)
        yield "哪家？对了，这个多少钱0你还记得怎么说吗？"


def _turns(client, sid, runtime, n, prefix):
    for k in range(n):
        assert post_turn(client, sid, f"今天中午吃了拉面{k}", f"{prefix}-{k}", runtime=runtime).status_code == 200


def test_turn_hook_off_by_default_leaves_prompt_and_tables_untouched(runtime, head_database, monkeypatch):
    monkeypatch.delenv("OLO_LEARNING", raising=False)
    seed(head_database, due=datetime.now(UTC) - timedelta(days=1))
    runtime.llm = ChatLLM()
    with _client() as client:
        sid = open_session(client)
        _turns(client, sid, runtime, 5, "off")
    assert all("对方在学" not in c[0]["content"] for c in runtime.llm.calls)
    assert all("随口问对方" not in s for s in runtime.llm.guard_systems)
    with psycopg.connect(head_database) as conn:
        assert conn.execute("SELECT count(*) FROM learning_reviews").fetchone()[0] == 0


def test_turn_hook_on_hints_logs_and_grades(runtime, head_database, monkeypatch):
    monkeypatch.setenv("OLO_LEARNING", "1")
    monkeypatch.setenv("OLO_LEARNING_RATE", "1")
    monkeypatch.setenv("OLO_QUIET_HOURS", "00:00-00:00")
    gid, (iid,) = seed(head_database, due=datetime.now(UTC) - timedelta(days=1))
    runtime.llm = ChatLLM()
    with _client() as client:
        sid = open_session(client)
        _turns(client, sid, runtime, 3, "on")
        hinted = [c for c in runtime.llm.calls if "对方在学「日语」" in c[0]["content"]]
        assert len(hinted) == 0  # first 3 turns: too early
        _turns(client, sid, runtime, 1, "on4")
        assert "对方在学「日语」" in runtime.llm.calls[-1][0]["content"]
        assert any("随口问对方" in s for s in runtime.llm.guard_systems)  # guard got the learning note
        assert post_turn(client, sid, "ikura desu ka", "ans", runtime=runtime).status_code == 200
        assert "别讲课" in runtime.llm.calls[-1][0]["content"]
        _turns(client, sid, runtime, 2, "after")
    hinted = [c for c in runtime.llm.calls if "对方在学「日语」" in c[0]["content"]]
    assert len(hinted) == 1  # once a day
    with psycopg.connect(head_database) as conn:
        assert conn.execute("SELECT result FROM learning_reviews").fetchall() == [("right",)]
        assert conn.execute("SELECT reviews, last_result FROM learning_items WHERE id = %s", (iid,)).fetchone() == (1, "right")
