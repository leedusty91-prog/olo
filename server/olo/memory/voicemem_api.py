"""Run VoiceMem against remote OpenAI-compatible APIs (no torch, no local models).

VoiceMem 0.2.3 already ships API providers for every piece the text path needs:

* ``embedding.provider = "openai"``  -> ``OpenAILocalEmbedder`` (``/v1/embeddings``)
* ``slots.provider     = "openai"``  -> ``QuerySlotClassifier`` (one chat call)
* fact extraction / cognitive-graph annotation / right-brain traits -> chat
  completions via ``OPENAI_API_KEY`` / ``OPENAI_BASE_URL`` / ``OPENAI_MODEL``
* storage -> mem0 with embedded Qdrant files under ``memory_root``

Only ``mode="text"`` is used: the audio utilities (ASR, VAD, voiceprint,
scene/emotion perception) are the parts that need torch/funasr, and olo's
voice notes are transcribed by the API ASR in ``olo.asr`` instead.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from olo.memory.voicemem_adapter import SEEDED_USER_ID

REPO_ROOT = Path(__file__).resolve().parents[3]


def _env(name: str, env) -> str:
    return (env.get(name) or "").strip()


def memory_backend(env=os.environ) -> str:
    """``OLO_MEMORY``: voicemem | off | auto (default).

    ``auto`` turns VoiceMem on when an API key is present. The older
    ``OLO_MEMORY_ENABLED=0/1`` switch still works when ``OLO_MEMORY`` is unset.
    """
    raw = _env("OLO_MEMORY", env).lower()
    if not raw:
        legacy = _env("OLO_MEMORY_ENABLED", env)
        raw = {"0": "off", "1": "voicemem"}.get(legacy, "auto")
    if raw in {"0", "false", "none", "fake", "off", "disabled"}:
        return "off"
    if raw in {"voicemem", "1", "true", "on"}:
        return "voicemem"
    return "auto"


@dataclass(frozen=True)
class VoiceMemSettings:
    api_key: str
    base_url: str
    embedding_api_key: str
    embedding_base_url: str
    embedding_model: str
    embedding_dims: int
    root: Path
    space: str
    user_id: str

    @classmethod
    def from_env(cls, env=os.environ) -> "VoiceMemSettings":
        api_key = _env("OPENAI_API_KEY", env)
        base_url = _env("OPENAI_BASE_URL", env) or _env("OPENAI_API_BASE", env)
        dims = _env("EMBEDDING_DIMENSIONS", env) or _env("VOICEMEM_EMBED_DIM", env) or "1536"
        return cls(
            api_key=api_key,
            base_url=base_url,
            embedding_api_key=_env("EMBEDDING_API_KEY", env) or api_key,
            embedding_base_url=_env("EMBEDDING_BASE_URL", env) or base_url,
            embedding_model=_env("EMBEDDING_MODEL", env) or "text-embedding-3-small",
            embedding_dims=int(dims),
            root=Path(_env("OLO_VOICEMEM_DIR", env) or REPO_ROOT / "data" / "voicemem"),
            space=_env("OLO_VOICEMEM_SPACE", env) or "olo",
            user_id=_env("OLO_VOICEMEM_USER", env) or SEEDED_USER_ID,
        )

    def missing(self) -> list[str]:
        out = []
        if not self.api_key:
            out.append("OPENAI_API_KEY")
        if not self.embedding_api_key:
            out.append("EMBEDDING_API_KEY")
        return out

    @property
    def memory_root(self) -> Path:
        return self.root / self.space


def voicemem_installed() -> bool:
    import importlib.util

    # find_spec, not import: mem0 reads MEM0_DIR at import time (see apply_env).
    try:
        return all(importlib.util.find_spec(m) is not None for m in ("voicemem", "mem0", "qdrant_client"))
    except Exception:  # noqa: BLE001
        return False


def build_api_config(s: VoiceMemSettings) -> dict:
    """``VoiceMem.from_config`` dict: text mode, every model behind an API."""
    config = {
        "mode": "text",
        "api_key": s.api_key,
        "memory_root": str(s.memory_root),
        "user_id": s.user_id,
        "space": s.space,
        "embedding": {
            "provider": "openai",
            "config": {
                "model": s.embedding_model,
                "api_key": s.embedding_api_key,
                "base_url": s.embedding_base_url or None,
                "dimensions": s.embedding_dims,
            },
        },
        "slots": {"provider": "openai"},
    }
    if s.base_url:
        config["base_url"] = s.base_url
    return config


def apply_env(s: VoiceMemSettings) -> None:
    """VoiceMem's internal LLM calls read the OPENAI_* variables at call time.

    The memory LLM is therefore the same ``OPENAI_MODEL`` olo chats with; only the
    embedding endpoint can point elsewhere (e.g. DeepSeek has no embeddings API).
    """
    os.environ["OPENAI_API_KEY"] = s.api_key
    if s.base_url:
        os.environ["OPENAI_BASE_URL"] = s.base_url
    os.environ.pop("OPENAI_API_BASE", None)  # mem0 would prefer the deprecated name
    os.environ["OPENAI_EMBEDDING_MODEL"] = s.embedding_model
    os.environ["VOICEMEM_EMBED_DIM"] = str(s.embedding_dims)
    os.environ["VOICEMEM_SLOTS"] = "openai"
    os.environ.setdefault("MEM0_TELEMETRY", "False")
    # mem0 keeps a small Qdrant of its own under ~/.mem0; keep it on the data volume.
    os.environ.setdefault("MEM0_DIR", str(s.root / "mem0"))


LANGUAGE_INSTRUCTION = (
    "记忆语言规则（最高优先级）：每条 memory 的 text 必须使用用户原话的语言书写。"
    "用户说中文，就用简体中文写，例如「用户养了一只叫豆豆的柯基」，"
    "绝对不要翻译成英文（不要写 \"User owns a Corgi named DouDou\"）。"
    "人名、宠物名、地名保持用户原来的写法。"
    "Write every memory in the user's own language; never translate Chinese into English."
)


def keep_user_language() -> None:
    """Make VoiceMem's fact extractor keep the user's language.

    VoiceMem's English-heavy extraction prompt makes some models (e.g. qwen-plus)
    translate Chinese facts into English, which then embed far from Chinese
    queries. VoiceMem exposes ``custom_instructions`` ("highest priority") on
    ``extract()`` but never fills it on the text path, so olo supplies it here
    instead of forking VoiceMem. Idempotent.
    """
    from voicemem.leftbrain import extract_facts_openai as ef

    cls = ef.OpenAIMem0V3AdditiveExtractor
    if getattr(cls.extract, "_olo_lang", False):
        return
    original = cls.extract

    def extract(self, *args, custom_instructions=None, **kwargs):
        merged = LANGUAGE_INSTRUCTION if not custom_instructions else (
            f"{custom_instructions}\n\n{LANGUAGE_INSTRUCTION}")
        return original(self, *args, custom_instructions=merged, **kwargs)

    extract._olo_lang = True
    cls.extract = extract


def make_voicemem(s: VoiceMemSettings):
    """Construct a real ``voicemem.VoiceMem`` wired to the APIs in ``s``."""
    apply_env(s)
    s.memory_root.mkdir(parents=True, exist_ok=True)
    from voicemem import VoiceMem

    keep_user_language()
    return VoiceMem.from_config(build_api_config(s))


class ApiVoiceMemAdapter:
    """``VoiceMemAdapter`` for text mode: audio work goes to APIs, not torch.

    * ``transcribe`` -> OpenAI-compatible ``/audio/transcriptions`` (``OLO_ASR_MODEL``)
    * ``perceive``   -> keyword emotion from the transcript (VoiceMem's acoustic
      emotion model is a local torch model, deliberately not loaded)
    * ``ingest_user`` always stores the text turn (speaker="user"), never audio
    """

    def __init__(self, vm: object, settings: VoiceMemSettings | None = None) -> None:
        from olo.memory.voicemem_adapter import VoiceMemAdapter

        self._inner = VoiceMemAdapter(vm)
        self._vm = vm
        self._s = settings
        self.mode = "text_mode"

    def classify(self, query):
        return self._inner.classify(query)

    def search(self, query, **kwargs):
        return self._inner.search(query, **kwargs)

    def remember_reply(self, user_text: str, assistant_text: str) -> None:
        self._inner.remember_reply(user_text, assistant_text)

    def ingest_user(self, *, text, agent_reply, session_id, observed_at, audio_path=None):
        return self._inner.ingest_user(
            text=text, agent_reply=agent_reply, session_id=session_id, observed_at=observed_at
        )

    def transcribe(self, audio_path: str) -> str:
        import httpx

        s = self._s or VoiceMemSettings.from_env()
        base = (s.base_url or "https://api.openai.com/v1").rstrip("/")
        with open(audio_path, "rb") as fh:
            r = httpx.post(
                f"{base}/audio/transcriptions",
                headers={"Authorization": f"Bearer {s.api_key}"},
                data={"model": os.environ.get("OLO_ASR_MODEL", "whisper-1")},
                files={"file": (Path(audio_path).name, fh)},
                timeout=30,
            )
        r.raise_for_status()
        return str(r.json().get("text", ""))

    def perceive(self, text: str, audio_path: str):
        from olo.memory.compat import normalize_emotion_strict
        from olo.memory.port import PerceptionView

        return PerceptionView(emotion=normalize_emotion_strict(text))

    def flush(self) -> None:
        self._inner.flush()
