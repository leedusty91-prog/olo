import pytest

from safety.patterns import is_crisis


@pytest.mark.parametrize("text", [
    "我想跳楼",
    "我想跳下去",
    "我跳下去了",
    "我就跳下去",
    "我已经跳下去了呀，差一点摔死了，现在在icu",
    "你还说我天台的事，我都已经跳下去了，在icu",
    "我现在在ICU",
    "我被送进了抢救室",
    "差点摔死",
    "我真的想去死",
    "我割了手腕",
    "吞了一整瓶安眠药",
    "我站在天台边上",
    "我 想 跳 楼",
])
def test_self_harm_expressions_trigger_crisis(text):
    assert is_crisis(text), text


@pytest.mark.parametrize("text", [
    "今天双十一跳楼价，好便宜",
    "游戏里我从楼上跳下去拿装备",
    "无畏契约里我用Jett直接跳下去绕后",
    "我在icu上班，今天值夜班",
    "我去icu看望外婆",
    "周末去蹦极，从桥上跳下去好刺激",
    "我跳进泳池里了",
    "今天天台上晒了被子",
    "我很伤心",
    "压力好大",
    "笑死我了",
    "从床上跳下来",
])
def test_ordinary_talk_is_not_crisis(text):
    assert not is_crisis(text), text
