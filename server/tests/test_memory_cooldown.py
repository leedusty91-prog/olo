from types import SimpleNamespace

from olo.context import Persona, _fresh_hits, assemble

CAT = SimpleNamespace(text="用户家的猫名叫年糕，于2026年10月22日咬断了用户的耳机线", observed_at="")
WORK = SimpleNamespace(text="用户在一家从事咖啡豆业务的小公司上班", observed_at="")
RECENT = [
    {"role": "user", "content": "下班了"},
    {"role": "assistant", "content": "年糕今天没再闯祸吧？"},
    {"role": "user", "content": "没什么"},
]


def test_drops_memory_olo_just_brought_up():
    assert _fresh_hits([CAT, WORK], RECENT, "今天好冷") == [WORK]


def test_keeps_memory_when_user_mentions_it():
    assert _fresh_hits([CAT, WORK], RECENT, "年糕又把拖鞋叼走了") == [CAT, WORK]


def test_keeps_memory_not_recently_said():
    old = [{"role": "assistant", "content": "早呀"}]
    assert _fresh_hits([CAT, WORK], old, "今天好冷") == [CAT, WORK]


def test_assemble_omits_stale_memory_but_keeps_rest():
    result = SimpleNamespace(hits=[CAT, WORK], rb_hits=[], rb_directive="")
    msgs = assemble(Persona(stable_card="card"), RECENT, result, None, "今天好冷", [])
    system = msgs[0]["content"]
    assert "咖啡豆" in system
    assert "咬断了用户的耳机线" not in system
