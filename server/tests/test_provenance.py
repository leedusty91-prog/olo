import json
from datetime import datetime, timedelta, timezone

from olo import capture, provenance
from olo.provenance import SEED_SESSION_ID, classify, source_of

T0 = datetime(2026, 10, 22, 8, 0, tzinfo=timezone.utc)


def _m(role, body, sid="s1", cid=None, source=None, n=0):
    return {"id": f"{role}{n}", "role": role, "body": body, "session_id": sid, "client_msg_id": cid,
            "source": source, "created_at": T0 + timedelta(minutes=n), "safety_hit": False,
            "at": (T0 + timedelta(minutes=n)).strftime("%m-%d %H:%M")}


def test_source_of_header_then_prefix_then_app():
    assert source_of("abc", None, "test") == "test"
    assert source_of("mac-test-1", None, None) == "test"
    assert source_of("flash-1729-0", None, None) == "test"
    assert source_of("smoke-1", None, None) == "test"
    assert source_of("8f3c2a1b-0000-4000-8000-000000000000", None, None) == "app"
    assert source_of("V1StGXR8_Z5jdHi6", None, None) == "app"  # mobile nanoid
    assert source_of("x", None, "bogus") == "app"


def test_classify_old_rows_by_seed_session_and_prefix_and_replies_inherit():
    rows = classify([
        _m("user", "赶论文", sid=SEED_SESSION_ID, n=0),
        _m("assistant", "加油", sid=SEED_SESSION_ID, n=1),
        _m("user", "我在咖啡豆公司上班", cid="mac-test-1", n=2),
        _m("assistant", "记住了", n=3),
        _m("user", "我养了只猫", cid="8f3c2a1b-0000-4000-8000-000000000000", n=4),
        _m("assistant", "好可爱", n=5),
        _m("user", "explicit", cid="whatever", source="seed", n=6),
    ])
    assert [r["source"] for r in rows] == ["seed", "seed", "test", "test", "app", "app", "seed"]
    assert [r["body"] for r in provenance.app_only(rows)] == ["我养了只猫", "好可爱"]


def test_add_and_update_must_cite_a_real_user_line():
    existing = [{"id": "e1", "text": "用户养了一只猫", "created_at": T0}]
    _, keyed = capture.render_existing(existing)
    window = ["我养的猫叫年糕", "今天好累"]
    ops = [
        {"op": "add", "text": "用户的猫叫年糕", "kind": "fact"},                         # no cite
        {"op": "add", "text": "用户在咖啡豆公司上班", "cite": "我在咖啡豆公司上班"},      # cite not in app lines
        {"op": "add", "text": "用户喜欢喝咖啡", "cite": "今天好累"},                      # cite unrelated to text
        {"op": "add", "text": "用户的猫叫年糕", "cite": "我养的猫叫年糕"},
        {"op": "update", "ids": ["m1"], "text": "用户养了一只叫年糕的猫"},                # no cite
        {"op": "update", "ids": ["m1"], "text": "用户养了一只叫年糕的猫", "cite": "我养的猫叫年糕！"},
    ]
    plan = capture.parse_ops(json.dumps({"ops": ops}, ensure_ascii=False), keyed, window_user_lines=window)
    kept = [(o.op, o.text) for o in plan.ops]
    assert kept == [("add", "用户的猫叫年糕"), ("update", "用户养了一只叫年糕的猫")]
    assert plan.ops[0].cite == "我养的猫叫年糕"
    assert len(plan.rejected) == 4


def test_plan_capture_never_shows_seed_or_test_lines_to_the_planner():
    rows = classify([
        _m("user", "我在咖啡豆公司上班", cid="mac-test-1", n=0),
        _m("assistant", "记住啦", n=1),
        _m("user", "我养的猫叫年糕", cid="8f3c2a1b-0000-4000-8000-000000000000", n=2),
    ])
    seen = []

    def planner(prompt):
        seen.append(prompt)
        return json.dumps({"ops": [{"op": "add", "text": "用户在咖啡豆公司上班", "cite": "我在咖啡豆公司上班"}]},
                          ensure_ascii=False), {"prompt_tokens": 1, "completion_tokens": 1}

    plan, _ = capture.plan_capture(capture._app(rows), [], [], planner=planner, judge=lambda p: ('{"verdicts": []}', {}))
    assert "咖啡豆" not in seen[0]
    assert plan.ops == []  # the planner cannot launder a test line into memory


class _Conn:
    def __init__(self, rows):
        self.rows = rows

    def execute(self, sql, params=()):
        rows = self.rows

        class R:
            def fetchall(self):
                return rows

            def fetchone(self):
                return rows[0] if rows else None
        return R()


def test_visible_existing_hides_tainted_and_fails_open(monkeypatch):
    items = [{"id": "a", "text": "x"}, {"id": "b", "text": "y"}]
    monkeypatch.setattr(provenance, "tainted_memory_ids", lambda conn: {"b"})
    assert [i["id"] for i in capture.visible_existing(None, items)] == ["a"]

    def boom(conn):
        raise RuntimeError("no audit table")
    monkeypatch.setattr(provenance, "tainted_memory_ids", boom)
    assert [i["id"] for i in capture.visible_existing(None, items)] == ["a", "b"]
