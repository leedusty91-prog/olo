"""外形卡带上当前装扮（发型/眼睛/脸颊），canon 不记装扮。"""

from olo.forms import FORM_CARDS, accessories_line, contradicts, form_card


def test_default_look_adds_nothing():
    for form in ("buddy", "cloud", "glow"):
        assert form_card(form) == FORM_CARDS[form]
        assert form_card({"form": form, "hair": "none", "eyes": "circle", "cheeks": "blush"}) == FORM_CARDS[form]


def test_card_mentions_equipped_items():
    card = form_card({"form": "buddy", "hair": "bow", "eyes": "almond", "cheeks": "dots"})
    assert "小蝴蝶结" in card and "杏眼" in card and "雀斑" in card
    assert card.startswith("【你现在的样子：麻薯】")
    assert card.rstrip().endswith("别照着念，也别一次说一大串。）")
    assert "光环" in form_card({"form": "cloud", "hair": "halo"})
    assert "战纹" in form_card({"form": "cloud", "cheeks": "warpaint"})


def test_glow_cheeks_are_glow_marks_not_blush():
    line = accessories_line({"form": "glow", "cheeks": "triangle"})
    assert "光痕" in line and "三角" not in line
    assert accessories_line({"form": "glow", "cheeks": "none"}) == ""


def test_canon_never_keeps_accessory_facts():
    for fact in ("我头上戴着小蝴蝶结", "我扎了个丸子头", "我有一圈光环", "我脸上画着战纹", "我是杏眼"):
        assert contradicts(fact, "buddy"), fact
    assert not contradicts("我最喜欢下雨天的花园", "buddy")


def test_straw_hat_and_v2_mochi_card():
    assert "斗笠" in form_card({"form": "glow", "hair": "straw"})
    assert "没有手也没有腿" in form_card("buddy")
    from olo.forms import contradicts
    assert contradicts("我挥手跟你打招呼", "buddy")
