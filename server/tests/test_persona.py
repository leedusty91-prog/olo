"""人设性格：匹配选择、更新与进入 system prompt。"""

import pytest
from fastapi.testclient import TestClient

from olo.context import FORM_LINES, TONE_ARCHETYPES, Persona, assemble
from olo.main import app
from olo.memory.fake import FakeMemory
from olo.memory.io_lock import VoicememIoLock
from olo.runtime import Runtime

TOKEN = "test-api-token"
AUTH = {"Authorization": f"Bearer {TOKEN}"}


class CapturingLLM:
    def __init__(self) -> None:
        self.calls: list[list[dict]] = []

    def stream(self, messages):
        self.calls.append(messages)
        yield "我在。"


@pytest.fixture
def runtime(head_database: str, monkeypatch: pytest.MonkeyPatch, tmp_path) -> Runtime:
    cert = tmp_path / "lan.pem"
    key = tmp_path / "lan-key.pem"
    cert.write_text("cert\n", encoding="utf-8")
    key.write_text("key\n", encoding="utf-8")
    monkeypatch.setenv("OPENAI_API_KEY", "test-openai-key")
    monkeypatch.setenv("OLO_API_TOKEN", TOKEN)
    monkeypatch.setenv("DATABASE_URL", head_database)
    monkeypatch.setattr("olo.main.DEFAULT_CERT_FILE", cert)
    monkeypatch.setattr("olo.main.DEFAULT_KEY_FILE", key)
    runtime = Runtime(
        memory=FakeMemory(),
        io_lock=VoicememIoLock(),
        llm=CapturingLLM(),
        voicemem_status="ready",
        rate_limit_per_minute=10_000,
    )
    app.state.runtime = runtime
    return runtime


@pytest.fixture
def client(runtime: Runtime) -> object:
    with TestClient(app) as test_client:
        yield test_client


def test_default_persona_is_curious(client) -> None:
    body = client.get("/v1/persona", headers=AUTH).json()
    assert body["name"] == "olo"
    assert body["tone"] == "curious"
    assert {item["id"] for item in body["options"]} == set(TONE_ARCHETYPES)
    assert body["appearance"] == {
        "color": "mint",
        "eyes": "circle",
        "cheeks": "blush",
        "hair": "none",
        "voice": "voice1",
        "form": "buddy",
    }
    assert set(body["appearance_options"]) == {
        "eyes",
        "cheeks",
        "hair",
        "voice",
        "form",
    }


def buy(client, item_id: str) -> None:
    response = client.post("/v1/shop/buy", headers=AUTH, json={"item_id": item_id})
    assert response.status_code == 201, response.text


def test_update_appearance_merges_and_persists(client) -> None:
    buy(client, "hair:bow")
    response = client.put(
        "/v1/persona",
        headers=AUTH,
        json={"appearance": {"hair": "bow", "color": "sky"}},
    )
    assert response.status_code == 200, response.text
    appearance = response.json()["appearance"]
    assert appearance["hair"] == "bow"
    assert appearance["color"] == "mint"  # colour is no longer a choice; ignored, not rejected
    assert appearance["eyes"] == "circle"

    got = client.get("/v1/persona", headers=AUTH).json()["appearance"]
    assert got == appearance


def test_update_tone_and_appearance_together(client) -> None:
    buy(client, "cheeks:warpaint")
    response = client.put(
        "/v1/persona",
        headers=AUTH,
        json={"tone": "playful", "appearance": {"cheeks": "warpaint"}},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["tone"] == "playful"
    assert body["appearance"]["cheeks"] == "warpaint"
    assert body["appearance"]["hair"] == "none"


def test_update_form(client) -> None:
    buy(client, "form:glow")
    response = client.put(
        "/v1/persona", headers=AUTH, json={"appearance": {"form": "glow"}}
    )
    assert response.status_code == 200, response.text
    assert response.json()["appearance"]["form"] == "glow"

    bad = client.put("/v1/persona", headers=AUTH, json={"appearance": {"form": "dragon"}})
    assert bad.status_code == 422


def test_locked_appearance_requires_purchase(client) -> None:
    response = client.put(
        "/v1/persona", headers=AUTH, json={"appearance": {"hair": "halo"}}
    )
    assert response.status_code == 402
    assert response.json()["error"]["code"] == "LOCKED"

    buy(client, "hair:halo")
    allowed = client.put(
        "/v1/persona", headers=AUTH, json={"appearance": {"hair": "halo"}}
    )
    assert allowed.status_code == 200, allowed.text


def test_reject_unknown_appearance(client) -> None:
    bad_key = client.put(
        "/v1/persona", headers=AUTH, json={"appearance": {"hat": "crown"}}
    )
    assert bad_key.status_code == 422
    assert bad_key.json()["error"]["code"] == "VALIDATION_FAILED"

    bad_value = client.put(
        "/v1/persona", headers=AUTH, json={"appearance": {"hair": "mohawk"}}
    )
    assert bad_value.status_code == 422


def test_update_persona_tone(client, head_database: str) -> None:
    response = client.put("/v1/persona", headers=AUTH, json={"tone": "calm"})
    assert response.status_code == 200, response.text
    assert response.json()["tone"] == "calm"
    assert client.get("/v1/persona", headers=AUTH).json()["tone"] == "calm"


def test_reject_unknown_tone(client) -> None:
    response = client.put("/v1/persona", headers=AUTH, json={"tone": "sarcastic"})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_FAILED"


def test_persona_requires_bearer_token(client) -> None:
    assert client.get("/v1/persona").status_code == 401
    assert client.put("/v1/persona", json={"tone": "calm"}).status_code == 401


def test_stored_tone_no_longer_changes_prompt(client, runtime: Runtime) -> None:
    """性格不再可选：旧用户存着 playful 也不影响 prompt，olo 只有默认人设。"""
    client.put("/v1/persona", headers=AUTH, json={"tone": "playful"})
    session = client.post("/v1/sessions", headers=AUTH).json()
    turn = client.post(
        f"/v1/sessions/{session['id']}/turns",
        headers=AUTH,
        json={"client_msg_id": "tone-1", "text": "今天好累"},
    )
    assert turn.status_code == 200, turn.text
    system = runtime.llm.calls[-1][0]["content"]
    assert all(t["instruction"] not in system for t in TONE_ARCHETYPES.values())
    assert "活泼" in system and "收起俏皮" in system


def test_assemble_ignores_tone_and_keeps_identity() -> None:
    calm = assemble(Persona(stable_card="身份正文", tone="calm"), [], None, None, "你好", [])
    playful = assemble(Persona(stable_card="身份正文", tone="playful"), [], None, None, "你好", [])
    assert calm[0]["content"].count("身份正文") == 1
    assert calm[0]["content"] == playful[0]["content"]


def test_form_enters_system_prompt() -> None:
    messages = assemble(
        Persona(stable_card="身份正文", tone="curious", form="glow"),
        [],
        None,
        None,
        "你好",
        [],
    )
    assert FORM_LINES["glow"] in messages[0]["content"]
    assert FORM_LINES["buddy"] not in messages[0]["content"]


def test_colors_not_sold_and_stored_colors_fall_back(client, head_database) -> None:
    items = client.get("/v1/shop", headers=AUTH).json()
    ids = {i["id"] for i in (items.get("items") or [])}
    assert not any(i.startswith("color:") for i in ids)
    assert client.post("/v1/shop/buy", headers=AUTH, json={"item_id": "color:sky"}).status_code == 404
    import psycopg
    from psycopg.types.json import Jsonb

    for stored, shown in (("lavender", "lavender"), ("neon", "mint")):
        with psycopg.connect(head_database) as conn:
            conn.execute("UPDATE companion_personas SET appearance = %s", (Jsonb({"color": stored, "hair": "none"}),))
            conn.commit()
        body = client.get("/v1/persona", headers=AUTH).json()
        assert body["appearance"]["color"] == shown
        # other edits still work for users with a legacy colour stored
        assert client.put("/v1/persona", headers=AUTH, json={"tone": "calm"}).status_code == 200


# ---------------------------------------------------------------- 外形卡

import re as _re

from olo import forms as _forms

_BODY_SPROUT = _re.compile(r"(头顶|头上|我的|身上).{0,4}(芽|叶子)|嫩芽")


@pytest.mark.parametrize("form", ["buddy", "cloud", "glow"])
def test_prompt_contains_only_the_current_form_card(form) -> None:
    system = assemble(Persona(stable_card="你叫 olo。", form=form), [], None, None, "你长什么样？", [])[0]["content"]
    assert _forms.FORM_CARDS[form] in system
    for other in set(_forms.FORMS) - {form}:
        assert _forms.FORM_CARDS[other] not in system
    if form != "buddy":
        # 除了卡片里的「绝不说」清单，prompt 里不能再有把芽当身体的描述
        no_card = system.replace(_forms.FORM_CARDS[form], "")
        assert not _BODY_SPROUT.search(no_card), no_card


def test_shared_prompts_have_no_body_sprout() -> None:
    from olo.chapters import NARRATE_PROMPT
    from olo.notebook import NOTEBOOK_SYSTEM
    from olo.proactive import PROMPT
    from olo.story import DAILY_LIFE, SPEAKING_RULES, STORY_CARD

    for text in (STORY_CARD, SPEAKING_RULES, NOTEBOOK_SYSTEM, PROMPT, NARRATE_PROMPT, *DAILY_LIFE):
        assert not _BODY_SPROUT.search(text), text


def test_diary_and_proactive_prompts_carry_form_card() -> None:
    from datetime import datetime, timezone

    from olo.notebook import notebook_system
    from olo.proactive import build_prompt

    assert _forms.FORM_CARDS["cloud"] in notebook_system(None, "cloud")
    p = build_prompt([], [], datetime.now(timezone.utc), form="glow")
    assert _forms.FORM_CARDS["glow"] in p and _forms.FORM_CARDS["buddy"] not in p


def test_body_facts_are_not_stored_as_canon(head_database: str, monkeypatch: pytest.MonkeyPatch) -> None:
    import psycopg

    from olo import canon

    monkeypatch.setenv("DATABASE_URL", head_database)
    monkeypatch.setattr(canon, "EXTRACTOR", lambda u, r, e: [
        {"fact": "olo整朵云都鼓起来了", "category": "life"},
        {"fact": "olo 在花园边捡到一颗圆石子", "category": "garden"}])
    with psycopg.connect(head_database) as conn:
        conn.execute("DELETE FROM olo_canon")
    assert canon.extract_and_store("嗨", "我整朵云都鼓起来了，还在花园边捡到一颗圆石子。") == 1
    with psycopg.connect(head_database) as conn:
        assert [c["fact"] for c in canon.list_canon(conn)] == ["olo 在花园边捡到一颗圆石子"]


def test_canon_guard_filters_body_facts_for_form() -> None:
    from olo.canon import fitting_canon

    facts = [{"fact": "olo 头顶的嫩芽一开心就竖起来", "category": "likes"},
             {"fact": "olo 喜欢晒月亮", "category": "likes"},
             {"fact": "olo 长了一对小翅膀", "category": "life"}]
    keep = lambda f: [c["fact"] for c in fitting_canon(facts, f)]  # noqa: E731
    assert keep("cloud") == keep("glow") == ["olo 喜欢晒月亮"]
    # 外形只以卡片为准：身体描述类事实在任何形态下都不注入（换形态后不会和新卡片打架）
    assert keep("buddy") == ["olo 喜欢晒月亮"]
    assert _forms.contradicts("olo头顶长了一根小茎，茎上长着两片嫩叶子", "buddy")
    assert _forms.contradicts("olo整朵云会因为受惊而发抖", "glow")
    assert not _forms.contradicts("花园里冒出了第一株芽", "cloud")


def test_form_switch_changes_card_next_turn_and_filters_canon(client, runtime: Runtime, head_database: str) -> None:
    import psycopg

    from olo import canon

    with psycopg.connect(head_database) as conn:
        conn.execute("DELETE FROM olo_canon")
        canon.add_canon(conn, [{"fact": "olo 头顶的嫩芽开心时会竖起来", "category": "likes"},
                               {"fact": "olo 喜欢晒月亮", "category": "likes"}])
    session = client.post("/v1/sessions", headers=AUTH).json()

    def turn(n):
        r = client.post(f"/v1/sessions/{session['id']}/turns", headers=AUTH,
                        json={"client_msg_id": f"form-{n}", "text": "你头顶有什么呀，喜欢晒月亮吗"})
        assert r.status_code == 200, r.text
        return runtime.llm.calls[-1][0]["content"]

    first = turn(1)
    assert _forms.FORM_CARDS["buddy"] in first and "olo 头顶的嫩芽开心时会竖起来" not in first
    buy(client, "form:cloud")
    assert client.put("/v1/persona", headers=AUTH, json={"appearance": {"form": "cloud"}}).status_code == 200
    second = turn(2)
    assert _forms.FORM_CARDS["cloud"] in second and _forms.FORM_CARDS["buddy"] not in second
    assert "olo 头顶的嫩芽开心时会竖起来" not in second and "olo 喜欢晒月亮" in second
