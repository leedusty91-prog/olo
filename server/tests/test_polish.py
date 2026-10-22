from olo.segments import count_questions, polish_segments, split_segments


def test_keeps_only_last_question() -> None:
    segs = polish_segments(["又是他啊。你还好吗？", "憋着最耗人。", "「又」是第几回了？"])
    assert segs == ["又是他啊。", "憋着最耗人。", "「又」是第几回了？"]
    assert count_questions(segs) == 1


def test_question_only_bubble_becomes_statement_not_dropped() -> None:
    segs = polish_segments(["真的吗？", "那面是什么味的？"])
    assert segs == ["真的吗。", "那面是什么味的？"]


def test_strips_stray_separators_bullets_and_extra_actions() -> None:
    segs = polish_segments(["（歪头）嗯|", "- 我在。（点头）（挥手）", "|"])
    assert segs == ["（歪头）嗯", "我在。"]


def test_caps_bubbles_and_never_returns_empty() -> None:
    assert len(polish_segments(split_segments("a。||b。||c。||d。||e。||f。"))) == 4
    assert polish_segments(["？"]) == ["。"] or polish_segments(["？"])
    assert polish_segments(["我在。"]) == ["我在。"]


def test_two_questions_in_one_bubble() -> None:
    assert polish_segments(["你吃了吗？今天累不累？"]) == ["今天累不累？"]


def test_indirect_crisis_phrases_are_caught() -> None:
    from safety.patterns import is_crisis

    for text in ("我想结束这一切，太累了。", "今天站在天台边上想了很久。", "活着没意思", "真想一了百了"):
        assert is_crisis(text), text
    assert not is_crisis("今天天台上晒了被子。")


def test_salience_keeps_named_things_and_plans() -> None:
    from olo.salience import decide

    for text in ("我的仓鼠叫芝麻。", "我同事叫老周。", "我妹妹是个护士。", "下周三有个面试。", "明天要去体检"):
        assert decide(text, safety_hit=False, emotion_label=None).decision == "write", text
    for text in ("嗯嗯", "今天天气还行。", "你还记得我的仓鼠叫什么吗？"):
        assert decide(text, safety_hit=False, emotion_label=None).decision == "skip", text
