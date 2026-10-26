import json

from olo.guard import enabled, guard_reply


class Aux:
    """Fake aux model: answers guard prompts from a script, regen prompts with a fixed reply."""

    def __init__(self, verdicts, regen="哈？咋弄的"):
        self.verdicts = list(verdicts)
        self.regen = regen
        self.calls = []

    def stream(self, messages):
        self.calls.append(messages)
        if "准备发出去的微信回复" in messages[0]["content"]:
            v = self.verdicts.pop(0)
            if isinstance(v, Exception):
                raise v
            yield json.dumps({"bad": v}, ensure_ascii=False)
        else:
            yield self.regen


class LLM:
    def __init__(self, aux):
        self.aux = aux


class RT:
    def __init__(self, aux):
        self.llm = LLM(aux)


MSGS = [{"role": "system", "content": "s"}, {"role": "user", "content": "我屁股疼"}]


def test_clean_reply_passes_untouched():
    r = guard_reply(RT(Aux([[]])), MSGS, "我屁股疼", [], "哈？咋弄的")
    assert r.action == "pass" and r.text == "哈？咋弄的" and r.calls == 1


def test_offending_sentence_is_trimmed_and_rest_kept():
    text = "哎，屁股疼这种难受最磨人了，坐着站着都不对劲。||怎么弄的，摔了？"
    r = guard_reply(RT(Aux([[{"id": "1.1", "cls": "narrate_feeling"}]])), MSGS, "我屁股疼", [], text)
    assert r.action == "trim" and r.text == "怎么弄的，摔了？"


def test_long_substantive_reply_survives_when_clean():
    story = "以前我在落雾滩的时候，雾一厚我就找不着方向。||有一回我跟着一只萤火虫飘了半宿，最后停在渡灯翁的船头上。||他就笑，说你这粒灯籽胆子倒挺大。"
    r = guard_reply(RT(Aux([[]])), MSGS, "然后呢", [], story)
    assert r.action == "pass" and r.text == story


def test_all_bad_regenerates_once_and_rechecks():
    aux = Aux([[{"id": "1.1", "cls": "stock_line"}, {"id": "1.2", "cls": "offer_choices"}], []])
    r = guard_reply(RT(aux), MSGS, "我好难受", [], "我在这儿呢。想说就说，不想说也行。")
    assert r.action == "regen" and r.text == "哈？咋弄的" and r.calls == 3


def test_guard_failure_fails_open():
    r = guard_reply(RT(Aux([RuntimeError("down")])), MSGS, "hi", [], "嗨！")
    assert r.action == "error" and r.text == "嗨！"


def test_enabled_needs_real_model_and_can_be_switched_off(monkeypatch):
    assert not enabled(type("R", (), {"llm": object()})())
    assert enabled(RT(Aux([])))
    monkeypatch.setenv("OLO_REPLY_GUARD", "off")
    assert not enabled(RT(Aux([])))


def _pieces(log, chunks):
    for c in chunks:
        log.append(("piece", c))
        yield c


def test_stream_shows_clean_first_bubble_before_reply_finishes():
    from olo.guard import guard_stream
    import time

    log = []

    def slow():
        yield from _pieces(log, ["我昨天也", "摔了一跤||"])
        time.sleep(0.3)  # first-bubble check finishes while the model is still writing
        yield from _pieces(log, ["膝盖", "青了一块"])

    out = []
    for kind, val in guard_stream(RT(Aux([[], []])), MSGS, "我屁股疼", [], slow()):
        log.append((kind, val))
        out.append((kind, val))
    deltas = [v for k, v in out if k == "delta"]
    assert deltas[0] == "我昨天也摔了一跤||"
    assert log.index(("delta", deltas[0])) < log.index(("piece", "青了一块"))
    assert out[-1][1].text.replace("\n\n", "||") == "我昨天也摔了一跤||膝盖青了一块"


def test_stream_trims_bad_later_bubble():
    from olo.guard import guard_stream

    v2 = [{"id": "2.1", "cls": "filler"}]
    out = list(guard_stream(RT(Aux([[], v2])), MSGS, "我屁股疼", [], iter(["哈？咋弄的||", "我一直在这儿陪你"])))
    text = "".join(v for k, v in out if k == "delta")
    assert "陪你" not in text and out[-1][1].text == "哈？咋弄的" and out[-1][1].action == "trim"


def test_stream_falls_back_when_first_bubble_is_bad():
    from olo.guard import guard_stream

    v1 = [{"id": "1.1", "cls": "narrate_feeling"}]
    out = list(guard_stream(RT(Aux([v1, v1, []])), MSGS, "我屁股疼", [], iter(["这种疼最磨人了||", "坐着站着都不对"])))
    text = "".join(v for k, v in out if k == "delta")
    assert "磨人" not in text and out[-1][1].action in {"regen", "trim"}
