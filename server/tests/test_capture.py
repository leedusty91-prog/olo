import json
import uuid
from datetime import datetime, timedelta, timezone

import psycopg

from olo import capture
from olo.memory.fake import FakeMemory
from olo.sessions import SEEDED_USER_ID

EXISTING = [
    {"id": "a", "text": "用户在2026年10月22日感到难过", "created_at": "2026-10-22"},
    {"id": "b", "text": "用户在2026年10月22日感到难过", "created_at": "2026-10-22"},
    {"id": "c", "text": "尼爸爸自称是宇航员", "created_at": "2026-10-22"},
]


def _msg(role, body, minutes=0, safety=False):
    return {"role": role, "body": body, "safety_hit": safety, "at": f"10-22 08:{minutes:02d}"}


def _planner(ops, seen=None):
    def run(prompt):
        if seen is not None:
            seen.append(prompt)
        return json.dumps({"ops": ops}, ensure_ascii=False), {"prompt_tokens": 100, "completion_tokens": 20}
    return run


def test_parse_ops_validates_shapes_and_ids():
    _, keyed = capture.render_existing(EXISTING)
    content = json.dumps({"ops": [
        {"op": "add", "text": "用户的外婆住院了", "kind": "life_event"},
        {"op": "merge", "ids": ["m1", "m2"], "text": "用户10月22日感到难过"},
        {"op": "delete", "ids": ["m3"], "why": "玩笑"},
        {"op": "update", "ids": ["m9"], "text": "不存在的 id"},
        {"op": "add", "text": ""},
        {"op": "explode"},
    ]}, ensure_ascii=False)
    plan = capture.parse_ops("好的：" + content, keyed)
    assert [o.op for o in plan.ops] == ["add", "merge", "delete"]
    assert len(plan.rejected) == 3
    assert capture.parse_ops("not json", keyed).ops == []


def test_delete_is_capped():
    items = [{"id": str(i), "text": f"x{i}"} for i in range(6)]
    _, keyed = capture.render_existing(items)
    plan = capture.parse_ops(json.dumps({"ops": [{"op": "delete", "ids": [k]} for k in keyed]}), keyed)
    assert len(plan.ops) == capture.MAX_DELETES


def test_safety_and_empty_messages_never_reach_the_model():
    seen = []
    window = [_msg("user", "我站在天台边上不想活了", 1, safety=True), _msg("user", "😀", 2), _msg("user", "外婆住院了", 3)]
    capture.plan_capture(window, [], [], planner=_planner([], seen))
    assert "天台" not in seen[0] and "外婆住院了" in seen[0]
    seen.clear()
    plan, _ = capture.plan_capture([_msg("user", "  ", 1), _msg("assistant", "嗨", 2)], [], [], planner=_planner([], seen))
    assert seen == [] and plan.ops == []


def test_prompt_carries_existing_memories_and_context():
    seen = []
    capture.plan_capture([_msg("user", "我也想结婚，但是我没钱")], [_msg("assistant", "早呀")], EXISTING, planner=_planner([], seen))
    assert "m3 [2026-10-22] 尼爸爸自称是宇航员" in seen[0]
    assert "早呀" in seen[0] and "我也想结婚" in seen[0]


def test_apply_plan_add_merge_delete():
    mem = FakeMemory()
    mem.memories = [dict(m) for m in EXISTING]
    plan, keyed = capture.plan_capture([_msg("user", "外婆住院了")], [], mem.list_memories(), planner=_planner([
        {"op": "add", "text": "用户的外婆住院了"},
        {"op": "merge", "ids": ["m1", "m2"], "text": "用户10月22日感到难过"},
        {"op": "delete", "ids": ["m3"]},
    ]))
    done = capture.apply_plan(mem, plan, keyed, session_id="s", observed_at="2026-10-22T08:00:00+00:00")
    assert done == {"add": 1, "update": 0, "merge": 1, "delete": 1, "failed": 0}
    assert [m["text"] for m in mem.memories] == ["用户10月22日感到难过"]
    assert mem.ingest_calls[0]["text"] == "用户的外婆住院了"


def test_capture_mode_defaults_to_batch():
    assert capture.capture_mode({}) == "batch"
    assert capture.capture_mode({"OLO_MEMORY_CAPTURE": "turn"}) == "turn"


def test_run_capture_batches_and_advances_cursor(head_database: str, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", head_database)
    t0 = datetime(2026, 10, 22, 8, 0, tzinfo=timezone.utc)
    with psycopg.connect(head_database) as conn:
        sid = uuid.uuid4()
        conn.execute("INSERT INTO sessions (id, user_id) VALUES (%s, %s)", (sid, SEEDED_USER_ID))
        for i, (role, body) in enumerate([("user", "刚收到消息，外婆住院了"), ("assistant", "啊，严重吗？"), ("user", "还好")]):
            conn.execute(
                "INSERT INTO messages (id, session_id, role, modality, body, created_at) VALUES (%s,%s,%s,'text',%s,%s)",
                (uuid.uuid4(), sid, role, body, t0 + timedelta(minutes=i)),
            )
        conn.commit()
        mem = FakeMemory()
        calls = []
        planner = _planner([{"op": "add", "text": "用户的外婆住院了", "kind": "life_event"}], calls)
        # 2 user messages, not idle yet -> not due
        assert capture.run_capture(conn, mem, SEEDED_USER_ID, now=t0 + timedelta(minutes=3), planner=planner) == {"ran": False}
        out = capture.run_capture(conn, mem, SEEDED_USER_ID, now=t0 + timedelta(minutes=30), planner=planner)
        assert out["ran"] and out["add"] == 1 and len(calls) == 1
        # cursor advanced: nothing new to capture
        assert capture.run_capture(conn, mem, SEEDED_USER_ID, now=t0 + timedelta(hours=2), planner=planner) == {"ran": False}
        assert len(calls) == 1
        ops = conn.execute("SELECT ops FROM memory_capture_runs").fetchone()[0]
        assert ops[0]["text"] == "用户的外婆住院了"


def test_capture_model_defaults_to_qwen_plus(monkeypatch):
    monkeypatch.delenv("OLO_CAPTURE_MODEL", raising=False)
    assert capture.capture_model() == "qwen-plus"
    monkeypatch.setenv("OLO_CAPTURE_MODEL", "deepseek-flash")
    assert capture.capture_model() == "deepseek-flash"


def test_rows_render_in_user_local_time():
    from zoneinfo import ZoneInfo

    class C:
        def execute(self, *a):
            return self

        def fetchall(self):
            return [("id", "user", "hi", False, datetime(2026, 10, 22, 8, 27, tzinfo=timezone.utc), "s")]

    rows = capture._rows(C(), "", (), tz=ZoneInfo("Asia/Singapore"))
    assert rows[0]["at"] == "10-22 16:27"
