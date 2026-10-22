"""Notebook 与 Insight 生成端点。LLM 用脚本替身，不发起真实请求。"""

import json
import uuid

import psycopg
import pytest
from fastapi.testclient import TestClient

from olo.main import app
from olo.memory.fake import FakeMemory
from olo.memory.io_lock import VoicememIoLock
from olo.runtime import Runtime
from olo.sessions import SEEDED_USER_ID

TOKEN = "test-api-token"
AUTH = {"Authorization": f"Bearer {TOKEN}"}

NOTEBOOK_JSON = json.dumps(
    {
        "title": "今天的重量",
        "body": "我今天注意到你把日程排得很满，连喘气都像在赶下一件事。",
        "image_prompt": "a cluttered desk at dusk, warm lamp, half-finished tea",
        "mood": "tender",
    },
    ensure_ascii=False,
)

INSIGHT_JSON = json.dumps(
    {"category": "wellbeing", "body": "你会在累的时候先怪自己不够努力。"},
    ensure_ascii=False,
)


class ScriptedLLM:
    def __init__(self, payload: str) -> None:
        self.payload = payload
        self.calls: list[list[dict]] = []
        self.fail = False

    def stream(self, messages):
        self.calls.append(messages)
        if self.fail:
            raise RuntimeError("upstream down")
        yield self.payload


PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"not-a-real-png-but-valid-header"


class FakeImage:
    def __init__(self, result: tuple[bytes, str] | None = (PNG_BYTES, "image/png")) -> None:
        self.result = result
        self.prompts: list[str] = []
        self.raise_error = False

    def __call__(self, prompt: str):
        self.prompts.append(prompt)
        if self.raise_error:
            raise RuntimeError("image backend down")
        return self.result


def make_runtime(llm: ScriptedLLM, image: FakeImage | None = None) -> Runtime:
    return Runtime(
        memory=FakeMemory(),
        io_lock=VoicememIoLock(),
        llm=llm,
        image_generator=image or FakeImage(),
        voicemem_status="ready",
        rate_limit_per_minute=10_000,
    )


@pytest.fixture
def runtime(head_database: str, monkeypatch: pytest.MonkeyPatch, tmp_path) -> Runtime:
    cert = tmp_path / "lan.pem"
    key = tmp_path / "lan-key.pem"
    cert.write_text("cert\n", encoding="utf-8")
    key.write_text("key\n", encoding="utf-8")
    monkeypatch.setenv("OPENAI_API_KEY", "test-openai-key")
    monkeypatch.setenv("OLO_API_TOKEN", TOKEN)
    monkeypatch.setenv("DATABASE_URL", head_database)
    monkeypatch.setenv("OLO_IMAGES_DIR", str(tmp_path / "images"))
    monkeypatch.setattr("olo.main.DEFAULT_CERT_FILE", cert)
    monkeypatch.setattr("olo.main.DEFAULT_KEY_FILE", key)
    runtime = make_runtime(ScriptedLLM(NOTEBOOK_JSON))
    app.state.runtime = runtime
    return runtime


@pytest.fixture
def client(runtime: Runtime) -> object:
    with TestClient(app) as test_client:
        yield test_client


def seed_messages(database_url: str):
    session_id = uuid.uuid4()
    with psycopg.connect(database_url) as conn:
        conn.execute(
            "INSERT INTO sessions (id, user_id) VALUES (%s, %s)",
            (session_id, SEEDED_USER_ID),
        )
        for role, body in (
            ("user", "今天有点撑不住，事太多了。"),
            ("assistant", "先不急着解决，今天最压你的是哪一件？"),
            ("user", "可能是那篇一直没动的论文。"),
        ):
            conn.execute(
                """
                INSERT INTO messages (id, session_id, role, modality, body)
                VALUES (%s, %s, %s, 'text', %s)
                """,
                (uuid.uuid4(), session_id, role, body),
            )
        conn.commit()
    return session_id


def test_generate_notebook_then_list_and_fetch(client, runtime, database_url) -> None:
    session_id = seed_messages(database_url)

    generated = client.post(
        "/v1/notebook/generate",
        headers=AUTH,
        json={"session_id": str(session_id)},
    )
    assert generated.status_code == 201, generated.text
    entry = generated.json()
    assert entry["title"] == "今天的重量"
    assert entry["kind"] == "journal"
    assert entry["mood"] == "tender"
    assert entry["image_prompt"].startswith("a cluttered desk")

    listed = client.get("/v1/notebook", headers=AUTH)
    assert listed.status_code == 200
    assert [item["id"] for item in listed.json()["entries"]] == [entry["id"]]

    fetched = client.get(f"/v1/notebook/{entry['id']}", headers=AUTH)
    assert fetched.status_code == 200
    assert fetched.json()["body"] == entry["body"]


def test_notebook_regenerate_same_day_upserts(client, runtime, database_url) -> None:
    session_id = seed_messages(database_url)
    client.post("/v1/subscription/activate", headers=AUTH, json={"plan": "monthly"})
    first = client.post(
        "/v1/notebook/generate",
        headers=AUTH,
        json={"session_id": str(session_id), "entry_date": "2026-10-19"},
    ).json()
    second = client.post(
        "/v1/notebook/generate",
        headers=AUTH,
        json={"session_id": str(session_id), "entry_date": "2026-10-19"},
    ).json()

    assert first["id"] == second["id"]
    listed = client.get("/v1/notebook", headers=AUTH).json()["entries"]
    assert len(listed) == 1

    # 生成调用确实把对话内容交给了模型，而不是空转。
    assert "论文" in runtime.llm.calls[0][1]["content"]


def test_generate_insight(client, runtime, database_url) -> None:
    session_id = seed_messages(database_url)
    runtime.llm.payload = INSIGHT_JSON

    generated = client.post(
        "/v1/insights/generate",
        headers=AUTH,
        json={"session_id": str(session_id)},
    )
    assert generated.status_code == 201, generated.text
    insight = generated.json()
    assert insight["category"] == "wellbeing"
    assert insight["stars"] == 4

    listed = client.get("/v1/insights", headers=AUTH)
    assert listed.status_code == 200
    assert [item["id"] for item in listed.json()["insights"]] == [insight["id"]]


def test_generate_without_messages_is_conflict(client) -> None:
    response = client.post("/v1/notebook/generate", headers=AUTH, json={})
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "NO_MESSAGES"


def test_generate_with_bad_json_fails_loudly(client, runtime, database_url) -> None:
    seed_messages(database_url)
    runtime.llm.payload = "抱歉，我今天不想写日记。"

    response = client.post("/v1/notebook/generate", headers=AUTH, json={})
    assert response.status_code == 502
    assert response.json()["error"]["code"] == "LLM_BAD_JSON"
    assert client.get("/v1/notebook", headers=AUTH).json()["entries"] == []


def test_generate_when_llm_raises_is_bad_gateway(client, runtime, database_url) -> None:
    seed_messages(database_url)
    runtime.llm.fail = True

    response = client.post("/v1/notebook/generate", headers=AUTH, json={})
    assert response.status_code == 502
    assert response.json()["error"]["code"] == "LLM_FAILED"


def test_notebook_requires_bearer_token(client) -> None:
    assert client.get("/v1/notebook").status_code == 401
    assert client.post("/v1/notebook/generate", json={}).status_code == 401
    assert client.get("/v1/insights").status_code == 401


def test_generated_entry_serves_image(client, runtime, database_url) -> None:
    session_id = seed_messages(database_url)
    entry = client.post(
        "/v1/notebook/generate",
        headers=AUTH,
        json={"session_id": str(session_id)},
    ).json()

    assert entry["image_relpath"]
    assert runtime.image_generator.prompts == [
        "a cluttered desk at dusk, warm lamp, half-finished tea"
    ]

    image = client.get(f"/v1/notebook/{entry['id']}/image", headers=AUTH)
    assert image.status_code == 200
    assert image.headers["content-type"] == "image/png"
    assert image.content == PNG_BYTES

    listed = client.get("/v1/notebook", headers=AUTH).json()["entries"]
    assert listed[0]["image_relpath"] == entry["image_relpath"]


def test_image_generation_declining_keeps_text_card(client, runtime, database_url) -> None:
    seed_messages(database_url)
    runtime.image_generator.result = None

    generated = client.post("/v1/notebook/generate", headers=AUTH, json={})
    assert generated.status_code == 201
    entry = generated.json()
    assert entry["image_relpath"] is None
    assert client.get(f"/v1/notebook/{entry['id']}/image", headers=AUTH).status_code == 404


def test_image_generator_crash_keeps_text_card(client, runtime, database_url) -> None:
    seed_messages(database_url)
    runtime.image_generator.raise_error = True

    generated = client.post("/v1/notebook/generate", headers=AUTH, json={})
    assert generated.status_code == 201
    assert generated.json()["image_relpath"] is None


def test_image_endpoint_requires_bearer_token(client, runtime, database_url) -> None:
    seed_messages(database_url)
    entry = client.post("/v1/notebook/generate", headers=AUTH, json={}).json()
    assert client.get(f"/v1/notebook/{entry['id']}/image").status_code == 401


# ---------- 日记里的「原话」 ----------
from olo.notebook import QUOTE_MARK, place_quote, quote_candidates  # noqa: E402


def test_quote_candidates_are_verbatim_safe_user_lines() -> None:
    msgs = [
        {"role": "user", "body": "  我其实挺想回老家看看外婆的。  "},
        {"role": "assistant", "body": "olo 说的话不能被当作原话"},
        {"role": "user", "body": "嗯"},  # too short
        {"role": "user", "body": "我不想活了"},  # crisis content is never quoted
        {"role": "user", "body": "我电话是13800138000"},  # private
        {"role": "user", "body": "我其实挺想回老家看看外婆的。"},  # duplicate
    ]
    assert quote_candidates(msgs) == ["我其实挺想回老家看看外婆的。"]


def test_place_quote_is_its_own_paragraph() -> None:
    body = f"今天心里软软的。\n\n{QUOTE_MARK}\n\n我好想知道外婆家门口有没有树。"
    out = place_quote(body, "我其实挺想回老家看看外婆的。")
    assert out.split("\n\n") == ["今天心里软软的。", "「我其实挺想回老家看看外婆的。」", "我好想知道外婆家门口有没有树。"]
    # marker glued inside a paragraph still becomes standalone
    assert place_quote(f"前面{QUOTE_MARK}后面", "原话在这").split("\n\n") == ["前面", "「原话在这」", "后面"]
    # no marker: goes after the first paragraph
    assert place_quote("一段。\n\n二段。", "原话在这").split("\n\n") == ["一段。", "「原话在这」", "二段。"]
    # no quote: marker removed, nothing invented
    assert place_quote(f"一段。\n\n{QUOTE_MARK}", None) == "一段。"


def test_generated_diary_quotes_only_real_user_text(client, runtime, database_url) -> None:
    with psycopg.connect(database_url) as conn:
        conn.execute("DELETE FROM notebook_entries")
        conn.execute("DELETE FROM messages")
        conn.commit()
    session_id = seed_messages(database_url)
    runtime.llm.payload = json.dumps(
        {"title": "论文", "body": f"今天有点心疼。\n\n{QUOTE_MARK}\n\n我好奇那篇论文卡在哪。", "quote_index": 1, "mood": "soft"},
        ensure_ascii=False,
    )
    entry = client.post("/v1/notebook/generate", headers=AUTH, json={"session_id": str(session_id)}).json()
    paras = entry["body"].split("\n\n")
    assert paras[1] == "「可能是那篇一直没动的论文。」"
    prompt = runtime.llm.calls[-1][1]["content"]
    assert "0. 今天有点撑不住，事太多了。" in prompt and "先不急着解决" not in prompt.split("【可引用的原话】")[1]
    # an out-of-range index (model inventing) yields no quote at all
    client.post("/v1/subscription/activate", headers=AUTH, json={"plan": "monthly"})
    runtime.llm.payload = json.dumps({"title": "x", "body": f"一段。\n\n{QUOTE_MARK}", "quote_index": 7}, ensure_ascii=False)
    entry = client.post("/v1/notebook/generate", headers=AUTH, json={"session_id": str(session_id)}).json()
    assert entry.get("body") == "一段。", entry


def test_diary_and_chat_prompts_address_user_as_you_without_gender() -> None:
    from olo.notebook import NOTEBOOK_SYSTEM
    from olo.story import SPEAKING_RULES

    assert "始终用「你」称呼对方" in NOTEBOOK_SYSTEM and "不要猜对方的性别" in NOTEBOOK_SYSTEM
    assert "始终用「你」称呼对方" in SPEAKING_RULES and "不猜对方的性别" in SPEAKING_RULES
    # the rules themselves never refer to the user with a gendered pronoun
    for text in (NOTEBOOK_SYSTEM, SPEAKING_RULES):
        stripped = text.replace("「他」「她」", "")
        assert "她" not in stripped and "他的" not in stripped and "他说" not in stripped
