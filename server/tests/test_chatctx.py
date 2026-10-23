import uuid
from datetime import date, datetime, timedelta, timezone

import psycopg

from olo import chatctx
from olo.context import Persona, assemble
from olo.sessions import SEEDED_USER_ID
from olo.story import SPEAKING_RULES

P = Persona(stable_card="你是 olo。", name="小灯", user_nickname="阿默")


def test_rules_cover_subtext_and_variety() -> None:
    assert "听潜台词" in SPEAKING_RULES and "你说没事" in SPEAKING_RULES
    assert "别重复自己" in SPEAKING_RULES and "唱个小反调" in SPEAKING_RULES
    # 之前的规则仍在
    assert "要有自己的看法" in SPEAKING_RULES and "读气氛" in SPEAKING_RULES


def test_plan_day_stable_and_ongoing_spans_days() -> None:
    d = date(2026, 10, 24)
    assert chatctx.plan_day(d) == chatctx.plan_day(d)
    block = [chatctx.plan_day(date.fromordinal((d.toordinal() // 3) * 3 + i))[1] for i in range(3)]
    assert len(set(block)) == 1


def test_openers_and_variety() -> None:
    recent = [
        {"role": "user", "content": "嗯"},
        {"role": "assistant", "content": "诶，那你后来呢？||我还想听"},
        {"role": "user", "content": "没啥"},
        {"role": "assistant", "content": "诶，你是不是累啦。"},
    ]
    ops = chatctx.recent_openers(recent)
    assert ops == ["诶，那你后来呢", "诶，你是不是累啦"]
    msgs = assemble(P, recent, None, None, "哦", [], openers=ops)
    assert "【你最近几次回复是这样开头的】" in msgs[0]["content"]
    assert chatctx.variety_text(ops[:1]) == ""


def test_assemble_recap_and_own_life() -> None:
    recap = chatctx.recap_text([("user", "明天要面试，好紧张"), ("assistant", "我陪你||加油呀")], 20, "小灯")
    life = chatctx.own_life_text("花园来了只蜗牛。", "你在攒晴天话。", "昨晚下雨。")
    sys_ = assemble(P, [], None, None, "嗨", [], recap=recap, own_life=life, turn_index=3)[0]["content"]
    assert "【上次聊到哪】（大约 20 小时前" in sys_ and "小灯：我陪你 加油呀" in sys_
    assert "明天要面试" in sys_ and "【你自己这几天的日子】" in sys_ and "昨天：昨晚下雨。" in sys_
    assert "【你自己今天的小事】" not in sys_  # 不和旧的轮换小事重复
    assert "小灯" in sys_ and "阿默" in sys_
    # 不传新参数时保持旧行为
    old = assemble(P, [], None, None, "嗨", [], turn_index=3)[0]["content"]
    assert "【上次聊到哪】" not in old and "【你自己今天的小事】" in old


def test_db_recap_and_persisted_day(head_database: str) -> None:
    with psycopg.connect(head_database, autocommit=True) as conn:
        old_s, new_s = uuid.uuid4(), uuid.uuid4()
        for s in (old_s, new_s):
            conn.execute("INSERT INTO sessions (id, user_id) VALUES (%s, %s)", (s, SEEDED_USER_ID))
        t = datetime.now(timezone.utc) - timedelta(hours=30)
        for i, (role, body) in enumerate([("user", "周五要去面试"), ("assistant", "哇，紧张吗？")]):
            conn.execute(
                "INSERT INTO messages (id, session_id, role, modality, body, created_at) VALUES (%s,%s,%s,'text',%s,%s)",
                (uuid.uuid4(), old_s, role, body, t + timedelta(seconds=i)),
            )
        text = chatctx.last_session_recap(conn, new_s, "小灯")
        assert "昨天" in text and "对方：周五要去面试" in text and "小灯：哇，紧张吗？" in text
        assert chatctx.last_session_recap(conn, old_s) == ""

        d = date(2026, 10, 24)
        conn.execute(
            "INSERT INTO olo_days (user_id, day, happening, ongoing) VALUES (%s,%s,'自定义的一天','自定义心事')",
            (SEEDED_USER_ID, d),
        )
        assert chatctx.olo_today(conn, d) == ("自定义的一天", "自定义心事")
        first = chatctx.olo_today(conn, d + timedelta(days=1))
        assert chatctx.olo_today(conn, d + timedelta(days=1)) == first
        assert "昨天：自定义的一天" in chatctx.own_life(conn, d + timedelta(days=1))
