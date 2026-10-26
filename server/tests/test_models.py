from olo.llm import OpenAIChat
from olo.models import memory_model

_VARS = ("OLO_MEMORY_MODEL", "OLO_EXTRACT_MODEL", "OPENAI_BASE_URL", "OPENAI_API_BASE", "OPENAI_MODEL",
         "CHAT_BASE_URL", "OLO_CHAT_THINKING", "OLO_AUX_THINKING")


def _clean(monkeypatch):
    for v in _VARS:
        monkeypatch.delenv(v, raising=False)


def test_memory_model_defaults_to_qwen_flash_on_dashscope(monkeypatch):
    _clean(monkeypatch)
    monkeypatch.setenv("OPENAI_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1")
    monkeypatch.setenv("OPENAI_MODEL", "qwen-plus")
    assert memory_model() == "qwen-flash"
    assert memory_model("canon") == "qwen-flash"
    monkeypatch.setenv("OLO_EXTRACT_MODEL", "qwen-plus")
    assert memory_model("extract") == "qwen-plus" and memory_model("chapters") == "qwen-flash"
    monkeypatch.setenv("OLO_MEMORY_MODEL", "qwen-max")
    assert memory_model("chapters") == "qwen-max"


def test_memory_model_elsewhere_falls_back_to_openai_model(monkeypatch):
    _clean(monkeypatch)
    monkeypatch.setenv("OPENAI_MODEL", "gpt-x")
    assert memory_model() == "gpt-x"


def test_deepseek_thinking_on_for_chat_off_for_aux(monkeypatch):
    _clean(monkeypatch)
    monkeypatch.setenv("CHAT_BASE_URL", "https://api.deepseek.com")
    monkeypatch.delenv("OLO_DIARY_THINKING", raising=False)
    chat = OpenAIChat(api_key="k", model="deepseek-flash")
    assert chat.body([])["thinking"] == {"type": "enabled"}
    assert chat.aux.body([])["thinking"] == {"type": "disabled"}
    assert OpenAIChat(api_key="k", model="deepseek-flash", purpose="aux").body([])["thinking"] == {"type": "disabled"}
    assert OpenAIChat(api_key="k", model="deepseek-flash").diary.body([])["thinking"] == {"type": "enabled"}
    monkeypatch.setenv("OLO_DIARY_THINKING", "disabled")
    assert OpenAIChat(api_key="k", model="deepseek-flash").diary.body([])["thinking"] == {"type": "disabled"}
    monkeypatch.setenv("OLO_CHAT_THINKING", "disabled")
    monkeypatch.setenv("OLO_AUX_THINKING", "enabled")
    assert chat.body([])["thinking"] == {"type": "disabled"}
    assert chat.aux.body([])["thinking"] == {"type": "enabled"}
    monkeypatch.setenv("CHAT_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1")
    assert "thinking" not in OpenAIChat(api_key="k", model="qwen-plus").body([])
