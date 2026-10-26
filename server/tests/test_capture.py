import json
import uuid
from datetime import datetime, timedelta, timezone

import psycopg

from olo import capture
from olo.memory.fake import FakeMemory
from olo.sessions import SEEDED_USER_ID

EXISTING = [
    {"id": "a", "text": "用户在咖啡豆公司上班", "created_at": "2026-10-22"},
    {"id": "b", "text": "用户常加班到九点", "created_at": "2026-10-22"},
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
        {"op": "merge", "ids": ["m1", "m2"], "text": "用户在咖啡豆公司上班，常加班到九点"},
        {"op": "delete", "ids": ["m3"], "reason": "roleplay", "why": "玩笑", "cite": "我是尼爸爸，我是宇航员"},
        {"op": "update", "ids": ["m9"], "text": "不存在的 id"},
        {"op": "add", "text": ""},
        {"op": "explode"},
    ]}, ensure_ascii=False)
    plan = capture.parse_ops("好的：" + content, keyed, user_said=["我是尼爸爸，我是宇航员"])
    assert [o.op for o in plan.ops] == ["add", "merge", "delete"]
    assert len(plan.rejected) == 3
    assert capture.parse_ops("not json", keyed).ops == []


def test_delete_is_capped():
    items = [{"id": str(i), "text": f"x{i}"} for i in range(6)]
    _, keyed = capture.render_existing(items)
    plan = capture.parse_ops(json.dumps({"ops": [{"op": "delete", "ids": [k], "reason": "user_correction"} for k in keyed]}), keyed)
    assert len(plan.ops) == capture.MAX_DELETES


def test_safety_and_empty_messages_never_reach_the_model():
    seen = []
    window = [_msg("user", "我站在天台边上不想活了", 1, safety=True), _msg("user", "😀", 2), _msg("user", "外婆住院了", 3)]
    capture.plan_capture(window, [], [], planner=_planner([], seen))
    assert "不想活了" not in seen[0] and "外婆住院了" in seen[0]
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
        {"op": "merge", "ids": ["m1", "m2"], "text": "用户在咖啡豆公司上班，常加班到九点"},
        {"op": "delete", "ids": ["m3"], "reason": "roleplay", "cite": "我是尼爸爸，我是宇航员"},
    ]), user_said=["我是尼爸爸，我是宇航员"])
    done = capture.apply_plan(mem, plan, keyed, session_id="s", observed_at="2026-10-22T08:00:00+00:00")
    assert done == {"add": 1, "update": 0, "merge": 1, "delete": 1, "failed": 0}
    assert [m["text"] for m in mem.memories] == ["用户在咖啡豆公司上班，常加班到九点"]
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


T0 = datetime(2026, 10, 22, 9, 0, tzinfo=timezone.utc)


def _at(role, body, minutes, sid="s1", safety=False, mid=None):
    at = T0 + timedelta(minutes=minutes)
    return {"id": mid or f"{role}{minutes}", "role": role, "body": body, "safety_hit": safety,
            "at": at.strftime("%m-%d %H:%M"), "created_at": at, "session_id": sid}


def test_crisis_stretch_is_excluded_even_when_unflagged_and_olo_words_with_it():
    seen = []
    window = [
        _at("user", "我想跳楼", 0), _at("assistant", "现在在哪儿", 1),
        _at("user", "我已经跳下去了呀，现在在icu", 4), _at("assistant", "现在在ICU，身边有人吗", 5),
        _at("user", "到处疼", 6),
        _at("user", "我外婆住院了", 120),
    ]
    capture.plan_capture(window, [], [], planner=_planner([], seen))
    p = seen[0].split("【新的聊天")[1]
    assert "跳" not in p and "icu" not in p.lower() and "到处疼" not in p and "我外婆住院了" in p


def test_crisis_stretch_from_before_the_window_still_excludes():
    seen = []
    back = [_at("user", "我跳下去了", 0, mid="b0")]
    capture.plan_capture([_at("user", "在icu里好疼", 10), _at("user", "我叫哇咔咔", 60)], [], [], planner=_planner([], seen), lookback=back)
    p = seen[0].split("【新的聊天")[1]
    assert "icu" not in p and "我叫哇咔咔" in p


def test_crisis_text_is_never_written_and_existing_crisis_memories_are_purged():
    existing = [{"id": "x", "text": "用户曾因跳楼未遂被送入ICU"}, {"id": "y", "text": "用户在找工作"}]
    plan, keyed = capture.plan_capture([_at("user", "我在找工作", 0)], [], existing, planner=_planner([
        {"op": "add", "text": "用户近期因跳楼未遂入ICU"},
        {"op": "update", "ids": ["m1"], "text": "用户在找工作，此前曾在ICU"},
    ]))
    assert [(o.op, keyed[o.ids[0]]["id"]) for o in plan.ops] == [("delete", "x")]


def test_olo_lines_are_labelled_as_not_user_facts():
    seen = []
    capture.plan_capture([_at("user", "嗯", 0), _at("assistant", "你是不是在ICU", 1), _at("user", "我叫哇咔咔", 2)], [], [], planner=_planner([], seen))
    assert "olo（olo 自己说的，不是用户的事实）：" in seen[0]
    assert "identity" in seen[0] and "我叫X" in seen[0]


def test_delete_needs_a_reason_and_roleplay_has_its_own_budget():
    items = [{"id": str(i), "text": f"尼爸爸自称宇航员{i}"} for i in range(6)] + [{"id": "z", "text": "用户的外婆住院了"}]
    _, keyed = capture.render_existing(items)
    ops = [{"op": "delete", "ids": [f"m{i + 1}"], "reason": "roleplay", "cite": "我是尼爸爸，我是宇航员"} for i in range(6)]
    ops += [{"op": "delete", "ids": ["m7"]}, {"op": "delete", "ids": ["m7"], "reason": "dedupe"}]
    plan = capture.parse_ops(json.dumps({"ops": ops}, ensure_ascii=False), keyed, user_said=["我是尼爸爸，我是宇航员"])
    assert len(plan.ops) == capture.MAX_ROLEPLAY_DELETES == 2 and all(o.reason == "roleplay" for o in plan.ops)
    assert len(plan.rejected) == 6


def test_merge_that_drops_a_distinct_event_is_rejected():
    items = [{"id": "a", "text": "用户的外婆住院了"}, {"id": "b", "text": "用户常加班到晚上九点"}, {"id": "c", "text": "用户常加班到九点"}]
    _, keyed = capture.render_existing(items)
    plan = capture.parse_ops(json.dumps({"ops": [
        {"op": "merge", "ids": ["m1", "m2"], "text": "用户常加班到晚上九点"},
        {"op": "merge", "ids": ["m2", "m3"], "text": "用户常加班到晚上九点"},
    ]}, ensure_ascii=False), keyed)
    assert [o.ids for o in plan.ops] == [("m2", "m3")] and len(plan.rejected) == 1


def test_texts_are_single_short_facts_without_timestamp_logs():
    _, keyed = capture.render_existing([])
    plan = capture.parse_ops(json.dumps({"ops": [
        {"op": "add", "text": "用户于2026年10月22日16:57被夸了；同日17:36和18:39两次主动提及", "kind": "feeling"},
        {"op": "add", "text": "用户叫哇咔咔", "kind": "identity"},
    ]}, ensure_ascii=False), keyed)
    assert [(o.text, o.kind) for o in plan.ops] == [("用户被夸了", "feeling"), ("用户叫哇咔咔", "identity")]
    assert all(len(o.text) <= capture.MAX_TEXT for o in plan.ops)


def test_roleplay_delete_never_hits_memories_the_users_words_back():
    items = [{"id": "a", "text": "用户养的猫叫年糕"}, {"id": "b", "text": "用户的外婆住院了"}, {"id": "c", "text": "尼爸爸自称是宇航员"}]
    _, keyed = capture.render_existing(items)
    ops = [{"op": "delete", "ids": ["m1", "m2"], "reason": "roleplay", "cite": "我家猫年糕今天把我的耳机线咬断了"}, {"op": "delete", "ids": ["m2"], "reason": "joke"},
           {"op": "delete", "ids": ["m3"], "reason": "roleplay", "cite": "我是尼爸爸，我是宇航员"}]
    plan = capture.parse_ops(json.dumps({"ops": ops}, ensure_ascii=False), keyed,
                             user_said=["我家猫年糕今天把我的耳机线咬断了", "年糕今天啥也没干，我养的猫就是懒", "刚收到消息，外婆住院了", "我是尼爸爸，我是宇航员"])
    assert [o.ids for o in plan.ops] == [("m3",)]


def test_memory_backed_by_the_users_own_words_is_never_a_roleplay_delete():
    items = [{"id": "c", "text": "用户自称在天台看夕阳"}]
    _, keyed = capture.render_existing(items)
    ops = [{"op": "delete", "ids": ["m1"], "reason": "roleplay", "cite": "我在天台哈哈"}]
    assert capture.parse_ops(json.dumps({"ops": ops}), keyed, user_said=["我在天台看夕阳", "我在天台哈哈"]).ops == []
    assert len(capture.parse_ops(json.dumps({"ops": ops}), keyed, user_said=["今天好累", "我在天台哈哈"]).ops) == 1


def test_prompt_asks_for_clear_facts_and_the_latest_sincere_name():
    seen = []
    capture.plan_capture([_at("user", "我家猫年糕把耳机线咬断了", 0), _at("user", "我叫哇咔咔", 1)], [], [], planner=_planner([], seen))
    p = seen[0]
    assert "宠物" in p and "住院" in p and "叠字" in p and "最新" in p and "只当天成立" in p
    assert "reason=\"joke\"" not in p


def test_roleplay_cap_applies_the_first_valid_ids_instead_of_rejecting():
    items = [{"id": str(i), "text": f"尼爸爸自称宇航员{i}"} for i in range(8)] + [{"id": "z", "text": "用户养的猫叫年糕"}]
    _, keyed = capture.render_existing(items)
    ops = [{"op": "delete", "ids": ["m9"] + [f"m{i + 1}" for i in range(8)], "reason": "roleplay", "cite": "我是尼爸爸，我是宇航员"}]
    plan = capture.parse_ops(json.dumps({"ops": ops}, ensure_ascii=False), keyed, user_said=["我家猫年糕今天把我的耳机线咬断了", "我是尼爸爸，我是宇航员"])
    assert [o.ids for o in plan.ops] == [("m1", "m2")]


def test_duplicate_deletes_only_hit_memories_covered_by_a_kept_one():
    items = [{"id": "a", "text": "用户家的猫名叫年糕"}, {"id": "b", "text": "用户家的猫名叫年糕"}, {"id": "c", "text": "用户的外婆住院了"}]
    _, keyed = capture.render_existing(items)
    ops = [{"op": "delete", "ids": ["m2"], "reason": "duplicate"}, {"op": "delete", "ids": ["m3"], "reason": "duplicate"}]
    plan = capture.parse_ops(json.dumps({"ops": ops}, ensure_ascii=False), keyed)
    assert [o.ids for o in plan.ops] == [("m2",)]


def test_near_duplicate_add_is_rejected():
    _, keyed = capture.render_existing([{"id": "a", "text": "用户家的猫名叫年糕"}])
    plan = capture.parse_ops(json.dumps({"ops": [{"op": "add", "text": "用户家的猫名叫年糕。"}]}, ensure_ascii=False), keyed)
    assert plan.ops == []


def test_no_keyword_roleplay_filter_sincere_astronaut_is_stored():
    _, keyed = capture.render_existing([])
    plan = capture.parse_ops(json.dumps({"ops": [{"op": "add", "text": "用户是宇航员，下个月去训练", "kind": "identity"}]},
                                        ensure_ascii=False), keyed, user_said=["我是宇航员，下个月去训练"])
    assert [o.text for o in plan.ops] == ["用户是宇航员，下个月去训练"]
    assert not hasattr(capture, "_ROLEPLAY_TEXT")


def test_sincere_memory_survives_a_roleplay_delete_but_playful_one_goes():
    items = [{"id": "s", "text": "用户是宇航员，下个月去训练"}, {"id": "p", "text": "尼爸爸说自己正在火星开派对"}]
    _, keyed = capture.render_existing(items)
    ops = [{"op": "delete", "ids": ["m1", "m2"], "reason": "roleplay", "cite": "哈哈我在火星开派对，猜猜我是谁"}]
    plan = capture.parse_ops(json.dumps({"ops": ops}, ensure_ascii=False), keyed,
                             user_said=["我是宇航员，下个月去训练", "哈哈我在火星开派对，猜猜我是谁"])
    assert [keyed[i]["id"] for o in plan.ops for i in o.ids] == ["p"]


def test_prompt_judges_play_from_context_not_words():
    seen = []
    capture.plan_capture([_at("user", "我是宇航员，下个月去训练", 0)], [], [], planner=_planner([], seen))
    assert "上下文" in seen[0] and "下个月去训练" in seen[0]


def test_existing_duplicates_are_purged_but_distinct_ones_kept():
    existing = [
        {"id": "d1", "text": "用户家的猫名叫年糕", "created_at": "2026-10-22"},
        {"id": "d2", "text": "用户家的猫名叫年糕", "created_at": "2026-10-23"},
        {"id": "g", "text": "用户外婆住院"},
        {"id": "v", "text": "用户感到难过"},
    ]
    plan, keyed = capture.plan_capture([_at("user", "嗯嗯", 0)], [], existing, planner=_planner([]))
    gone = [keyed[o.ids[0]]["id"] for o in plan.ops]
    assert len(gone) == 1 and gone[0].startswith("d")  # no word list: 感到难过 is the model's call, not code's


def test_user_correction_delete_needs_the_model_to_cite_a_real_user_line():
    existing = [{"id": "a", "text": "用户的外婆住院了"}]
    no_cite = [{"op": "delete", "ids": ["m1"], "reason": "user_correction"}]
    fake = [{"op": "delete", "ids": ["m1"], "reason": "user_correction", "cite": "不是外婆"}]
    real = [{"op": "delete", "ids": ["m1"], "reason": "user_correction", "cite": "不是外婆，是奶奶住院了"}]
    win = [_at("user", "今天上班好累", 0)]
    assert capture.plan_capture(win, [], existing, planner=_planner(no_cite))[0].ops == []
    assert capture.plan_capture(win, [], existing, planner=_planner(fake))[0].ops == []
    plan, keyed = capture.plan_capture([_at("user", "不是外婆，是奶奶住院了", 0)], [], existing, planner=_planner(real))
    assert [keyed[o.ids[0]]["id"] for o in plan.ops] == ["a"]


def test_store_decisions_have_no_code_word_lists():
    _, keyed = capture.render_existing([])
    texts = ["用户今天加班好累", "用户感到难过", "用户去过医院", "用户叫橘子汽水"]
    plan = capture.parse_ops(json.dumps({"ops": [{"op": "add", "text": t} for t in texts]}, ensure_ascii=False), keyed)
    assert [o.text for o in plan.ops] == texts  # whatever the model proposes is not word-filtered
    for gone in ("_ONE_DAY", "_VAGUE", "_CORRECTION", "_ROLEPLAY_TEXT", "no_store"):
        assert not hasattr(capture, gone)


def test_prompt_carries_the_judgement_guidance():
    seen = []
    capture.plan_capture([_at("user", "记得这句：橘子汽水", 0)], [], [], planner=_planner([], seen))
    p = seen[0]
    assert "只当天成立" in p and "泛泛" in p and "不是用户的名字" in p and "cite" in p


def test_roleplay_delete_must_cite_a_playful_user_line_about_that_memory():
    items = [{"id": "w", "text": "用户常加班至晚上九点"}, {"id": "p", "text": "尼爸爸自称是宇航员"}]
    _, keyed = capture.render_existing(items)
    said = ["我是宇航员哈哈哈", "今天加班好累"]
    def run(ids, cite):
        ops = [{"op": "delete", "ids": ids, "reason": "roleplay", "cite": cite}]
        return [keyed[i]["id"] for o in capture.parse_ops(json.dumps({"ops": ops}, ensure_ascii=False), keyed, user_said=said).ops for i in o.ids]
    assert run(["m2"], "") == []                       # no quote
    assert run(["m2"], "记得你家的年糕") == []          # olo's words, not the user's
    assert run(["m1"], "我是宇航员哈哈哈") == []         # quote unrelated to the memory
    assert run(["m2"], "我是宇航员哈哈哈") == ["p"]


def test_judge_pass_keeps_one_day_labelled_drops_vague_adds_and_fails_open():
    ops = [{"op": "add", "text": "用户今天被夸了"}, {"op": "add", "text": "用户感到难过"},
           {"op": "add", "text": "用户养的猫叫年糕"}, {"op": "add", "text": "用户让 olo 记住：橘子汽水", "kind": "remember_this"}]
    seen = []
    def judge(prompt):
        seen.append(prompt)
        return json.dumps({"labels": {"1": "one_day", "2": "vague", "3": "lasting", "4": "lasting"}}), {"prompt_tokens": 10, "completion_tokens": 5}
    plan, _ = capture.plan_capture([_at("user", "我家猫年糕咬断了耳机线", 0)], [], [], planner=_planner(ops), judge=judge)
    assert [(o.text, o.durability) for o in plan.ops] == [("用户今天被夸了", "one_day"), ("用户养的猫叫年糕", "lasting"), ("用户让 olo 记住：橘子汽水", "lasting")]
    assert plan.usage["prompt_tokens"] == 110 and "one_day" in seen[0]
    broken = lambda prompt: ("not json", {})
    plan, _ = capture.plan_capture([_at("user", "嗯", 0)], [], [], planner=_planner(ops), judge=broken)
    assert len(plan.ops) == 4


def test_prompt_shows_related_earlier_user_lines_and_requires_user_cites():
    seen = []
    existing = [{"id": "p", "text": "尼爸爸自称是宇航员，在太空"}]
    capture.plan_capture([_at("user", "早", 0)], [], existing, planner=_planner([], seen),
                         user_said=["哈哈我是宇航员，我在太空呢", "今天吃了面"])
    p = seen[0]
    assert "用户：哈哈我是宇航员，我在太空呢" in p and "今天吃了面" not in p
    assert "标着「用户」的一行原话" in p and '"cite": "哈哈我是宇航员' in p


def test_prompt_name_rules():
    seen = []
    capture.plan_capture([_at("user", "记得这句：橘子汽水", 0)], [], [], planner=_planner([], seen))
    assert "永远不是名字" in seen[0] and "只留一条名字记忆" in seen[0] and "remember_this" in seen[0]


def test_judge_vague_merge_is_kept_and_labels_reach_memory():
    from olo.memory.fake import FakeMemory
    mem = FakeMemory()
    mem.memories = [{"id": "v1", "text": "用户感到难过", "created_at": ""}, {"id": "v2", "text": "用户外婆住院", "created_at": ""}]
    ops = [{"op": "merge", "ids": ["m1", "m2"], "text": "用户因为外婆住院感到难过"}]
    judge = lambda prompt: (json.dumps({"labels": {"1": "vague"}}), {})
    plan, keyed = capture.plan_capture([_at("user", "外婆住院了我好难过", 0)], [], mem.list_memories(), planner=_planner(ops), judge=judge)
    assert [o.op for o in plan.ops if o.op != "delete"] == ["merge"]
    capture.apply_plan(mem, plan, keyed, session_id="s", observed_at="2026-10-26")
    assert mem.labels and mem.labels[-1][1] == "lasting"
