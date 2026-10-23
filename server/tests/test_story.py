"""olo 世界观：进入 system prompt、相遇仪式、花园解锁故事、离线 mock 保持角色、网页入口。"""

import pytest
from fastapi.testclient import TestClient

from olo.context import Persona, assemble
from olo.demo import DemoChat
from olo.main import app
from olo.memory.fake import FakeMemory
from olo.memory.io_lock import VoicememIoLock
from olo.runtime import Runtime
from olo.story import LORE_BEATS, STORY_CARD

TOKEN = "test-api-token"
AUTH = {"Authorization": f"Bearer {TOKEN}"}


class CapturingLLM:
    def __init__(self) -> None:
        self.calls: list[list[dict]] = []

    def stream(self, messages):
        self.calls.append(messages)
        yield "我在。"


@pytest.fixture
def runtime(head_database: str, monkeypatch: pytest.MonkeyPatch) -> Runtime:
    monkeypatch.setenv("OPENAI_API_KEY", "test-openai-key")
    monkeypatch.setenv("OLO_API_TOKEN", TOKEN)
    monkeypatch.setenv("DATABASE_URL", head_database)
    monkeypatch.delenv("OLO_TLS", raising=False)
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
def client(runtime: Runtime):
    with TestClient(app) as test_client:
        yield test_client


def test_story_card_and_custom_name_enter_system_prompt() -> None:
    messages = assemble(Persona(stable_card="你叫 olo。", name="小灯"), [], None, None, "嗨", [])
    system = messages[0]["content"]
    assert STORY_CARD in system
    assert "雾里集" in system
    assert "「小灯」" in system


def test_default_name_has_no_rename_line() -> None:
    system = assemble(Persona(stable_card="你叫 olo。"), [], None, None, "嗨", [])[0]["content"]
    assert "用户给你取的名字" not in system


def test_user_nickname_enters_chat_prompt_only_when_set() -> None:
    system = assemble(Persona(stable_card="你叫 olo。", user_nickname="阿星"), [], None, None, "嗨", [])[0]["content"]
    assert "对方希望你叫「阿星」" in system
    assert "对方希望你叫" not in assemble(Persona(stable_card="你叫 olo。"), [], None, None, "嗨", [])[0]["content"]


def test_onboarding_sets_name_tone_and_gifts_first_form(client: TestClient, runtime: Runtime) -> None:
    response = client.post(
        "/v1/onboarding",
        headers=AUTH,
        json={"name": " 小灯 ", "tone": "playful", "form": "cloud", "color": "sky"},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["name"] == "小灯"
    assert body["tone"] == "playful"
    assert body["appearance"]["form"] == "cloud"
    assert body["appearance"]["color"] == "sky"

    session = client.post("/v1/sessions", headers=AUTH).json()["id"]
    turn = client.post(
        f"/v1/sessions/{session}/turns",
        headers=AUTH,
        json={"client_msg_id": "story-1", "text": "你是谁"},
    )
    assert turn.status_code == 200, turn.text
    runtime.ingest.drain(timeout=3)
    system = runtime.llm.calls[-1][0]["content"]
    assert "「小灯」" in system and "灯籽" in system and "云朵形态" in system


@pytest.mark.parametrize(
    "payload",
    [
        {"name": "", "tone": "calm"},
        {"name": "x" * 13, "tone": "calm"},
        {"name": "olo", "tone": "calm", "form": "dragon"},
    ],
)
def test_onboarding_validates(client: TestClient, payload: dict) -> None:
    assert client.post("/v1/onboarding", headers=AUTH, json=payload).status_code == 422


def test_onboarding_requires_token(client: TestClient) -> None:
    assert client.post("/v1/onboarding", json={"name": "a", "tone": "calm"}).status_code == 401


def test_persona_put_can_rename(client: TestClient) -> None:
    response = client.put("/v1/persona", headers=AUTH, json={"name": "豆豆"})
    assert response.status_code == 200
    assert response.json()["name"] == "豆豆"


def test_garden_unlocks_lore_with_milestones(client: TestClient) -> None:
    empty = client.get("/v1/garden", headers=AUTH).json()
    assert empty["stage"] == "空地"
    assert empty["lore"] == []
    session = client.post("/v1/sessions", headers=AUTH).json()["id"]
    client.post(
        f"/v1/sessions/{session}/turns",
        headers=AUTH,
        json={"client_msg_id": "g1", "text": "你好"},
    )
    garden = client.get("/v1/garden", headers=AUTH).json()
    assert [item["key"] for item in garden["lore"]] == ["first_talk"]
    assert garden["lore"][0]["title"] == LORE_BEATS["first_talk"]["title"]


def test_demo_chat_stays_in_character() -> None:
    chat = DemoChat()
    system = "用户给你取的名字是「小灯」，自称时用这个名字"
    text = "".join(chat.stream([{"role": "system", "content": system}, {"role": "user", "content": "你是谁？"}]))
    assert "小灯" in text and "灯籽" in text and "芦婆婆" in text
    calm = "".join(chat.stream([
        {"role": "system", "content": "你更安静，句子短，先陪着"},
        {"role": "user", "content": "今天好累"},
    ]))
    assert len(calm) < 30


def test_web_root_and_config(monkeypatch: pytest.MonkeyPatch, client: TestClient) -> None:
    root = client.get("/", follow_redirects=False)
    assert root.status_code in {200, 307}
    monkeypatch.setenv("OLO_WEB_EMBED_TOKEN", "0")
    hidden = client.get("/app/config.js")
    assert hidden.status_code == 200 and TOKEN not in hidden.text
    monkeypatch.setenv("OLO_WEB_EMBED_TOKEN", "1")
    assert TOKEN in client.get("/app/config.js").text


def test_story_slice_stage_and_rotating_daily_life() -> None:
    from olo.story import DAILY_LIFE, DAILY_LIFE_EVERY, STAGE_RELATION, story_slice

    quiet = story_slice(1, 0)
    assert STAGE_RELATION[1] in quiet
    assert not any(d in quiet for d in DAILY_LIFE)
    with_life = [story_slice(3, i) for i in range(DAILY_LIFE_EVERY * 3)]
    shown = [s for s in with_life if "【你自己今天的小事】" in s]
    assert len(shown) == 3  # 大约每 4 轮一次
    assert len({s for s in shown}) == 3  # 每次换一件
    assert all(STAGE_RELATION[3] in s for s in with_life)


def test_assemble_uses_stage_and_form() -> None:
    from olo.story import STAGE_RELATION

    system = assemble(Persona(stable_card="你叫 olo。", form="cloud"), [], None, None, "嗨", [],
                      garden_level=4, turn_index=0)[0]["content"]
    assert STAGE_RELATION[4] in system
    assert "云朵形态" in system
    assert STAGE_RELATION[1] not in system


def test_onboarding_without_tone_uses_default(client: TestClient) -> None:
    r = client.post("/v1/onboarding", headers=AUTH, json={"name": "olo"})
    assert r.status_code == 200, r.text
    assert r.json()["tone"] == "curious"
    # 旧客户端传了奇怪的 tone 也不报错，回落默认
    r = client.post("/v1/onboarding", headers=AUTH, json={"name": "olo", "tone": "nope"})
    assert r.status_code == 200 and r.json()["tone"] == "curious"
