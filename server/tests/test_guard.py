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
