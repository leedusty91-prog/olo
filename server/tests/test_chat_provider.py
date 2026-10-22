from olo.llm import OpenAIChat, chat_completions_url


def test_chat_env_overrides_openai(monkeypatch) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "memory-key")
    monkeypatch.setenv("OPENAI_BASE_URL", "https://dashscope.example/v1")
    monkeypatch.setenv("OPENAI_MODEL", "qwen-plus")
    monkeypatch.setenv("CHAT_API_KEY", "chat-key")
    monkeypatch.setenv("CHAT_BASE_URL", "https://api.deepseek.com")
    monkeypatch.setenv("CHAT_MODEL", "deepseek-chat")
    chat = OpenAIChat()
    assert (chat.api_key, chat.model) == ("chat-key", "deepseek-chat")
    assert chat_completions_url() == "https://api.deepseek.com/chat/completions"


def test_chat_falls_back_to_openai(monkeypatch) -> None:
    for name in ("CHAT_API_KEY", "CHAT_BASE_URL", "CHAT_MODEL"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("OPENAI_API_KEY", "k")
    monkeypatch.setenv("OPENAI_BASE_URL", "https://dashscope.example/v1")
    monkeypatch.setenv("OPENAI_MODEL", "qwen-plus")
    chat = OpenAIChat()
    assert (chat.api_key, chat.model) == ("k", "qwen-plus")
    assert chat_completions_url() == "https://dashscope.example/v1/chat/completions"
