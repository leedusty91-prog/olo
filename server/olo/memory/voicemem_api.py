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

import functools
import logging
import os
import threading
from dataclasses import dataclass
from pathlib import Path

from olo.memory.voicemem_adapter import SEEDED_USER_ID
from olo.models import memory_model as _aux_model

REPO_ROOT = Path(__file__).resolve().parents[3]


logger = logging.getLogger(__name__)

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
    memory_model: str = ""
    classifier: str = "embedding"

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
            memory_model=_env("OLO_MEMORY_MODEL", env),
            classifier=(_env("OLO_MEMORY_CLASSIFIER", env) or "embedding").lower(),
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


_QDRANT_LOCK = threading.RLock()


def serialize_qdrant_local() -> None:
    """Guard embedded Qdrant with one process-wide lock per call.

    ``QdrantLocal`` keeps its collections in plain dicts/numpy arrays without
    locking. olo now lets a background write (seconds of LLM/embedding network
    time) overlap a turn's search, so the only thing that must be serialized is
    the millisecond-scale Qdrant access itself. SQLite stores in VoiceMem open a
    connection per call and mem0's history DB has its own lock. Idempotent.
    """
    from qdrant_client.local.qdrant_local import QdrantLocal

    if getattr(QdrantLocal, "_olo_serialized", False):
        return
    for name, fn in list(vars(QdrantLocal).items()):
        if name.startswith("_") and name != "__init__" or not callable(fn) or isinstance(fn, (staticmethod, classmethod)):
            continue

        def wrap(f):
            @functools.wraps(f)
            def locked(*a, **k):
                with _QDRANT_LOCK:
                    return f(*a, **k)
            return locked

        setattr(QdrantLocal, name, wrap(fn))
    QdrantLocal._olo_serialized = True


def use_memory_model(model: str, extract_model: str = "") -> None:
    """Point VoiceMem's internal LLM calls at the memory model (default qwen-flash).

    ``extract_model`` (``OLO_EXTRACT_MODEL``) overrides the fact extractor (and resolve),
    the one large call per memory write. ``_llm_json`` reads OPENAI_MODEL at
    call time, so it is re-pointed too (OPENAI_MODEL itself is left alone).
    """
    if not model:
        return
    from voicemem import orchestrator

    _patch_llm_json(orchestrator, model)
    from voicemem.leftbrain.cognitive_graph import annotator, query_slot_classifier
    from voicemem.leftbrain import extract_facts_openai

    for mod in (extract_facts_openai, annotator, query_slot_classifier):
        for obj in vars(mod).values():
            if isinstance(obj, type) and "resolved_model" in vars(obj):
                obj.resolved_model = lambda self, _m=model: (getattr(self, "model", None) or _m)
    if extract_model:
        cfg = extract_facts_openai.OpenAIAdditiveExtractorConfig
        cfg.resolved_model = lambda self, _m=extract_model: (getattr(self, "model", None) or _m)


def _patch_llm_json(orchestrator, model: str) -> None:
    for obj in vars(orchestrator).values():
        fn = getattr(obj, "_llm_json", None) if isinstance(obj, type) else None
        if fn is None or getattr(fn, "_olo_model", None) == model:
            continue

        def _llm_json(self, prompt: str, _m=model) -> str:
            try:
                from openai import OpenAI
                client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"), base_url=self._base_url, timeout=15.0)
                resp = client.chat.completions.create(
                    model=_m, messages=[{"role": "user", "content": prompt}],
                    response_format={"type": "json_object"}, temperature=0, max_tokens=512)
                return (resp.choices[0].message.content or "").strip()
            except Exception:  # noqa: BLE001 - same contract as VoiceMem: "" on failure
                return ""

        _llm_json._olo_model = model
        obj._llm_json = _llm_json


# Extractor-prompt examples that never apply to a one-user text companion
# (documents, tables, multi-speaker, photos, very long transcripts). Dropping
# them trims ~9K chars (~2K tokens) of the ~37K-char system prompt per write;
# the rules, integrity section and the chat-shaped examples stay.
_DROP_SECTIONS = (
    "### Shared Photos and Images",
    "## Example 7:",
    "## Example 8:",
    "## Example 9:",
    "## Example 11:",
    "## Example 12:",
)


def trim_extractor_prompt() -> None:
    """Drop irrelevant example sections from VoiceMem's extractor system prompt. Idempotent."""
    import re

    from voicemem.leftbrain import extract_facts_openai as ef

    cls = ef.OpenAIMem0V3AdditiveExtractor
    if getattr(cls, "_olo_trimmed", False):
        return
    original_init = cls.__init__

    def __init__(self, *a, **k):
        original_init(self, *a, **k)
        parts = re.split(r"\n(?=#+ )", self._system)
        self._system = "\n".join(p for p in parts if not p.startswith(_DROP_SECTIONS))

    cls.__init__ = __init__
    cls._olo_trimmed = True


class _ApiEncoder:
    """SentenceTransformer-shaped ``encode`` backed by the embeddings API.

    Lets VoiceMem's ``LocalQueryClassifier`` (cosine vs. 7 slot descriptions,
    no LLM) run on the API embedder instead of a local E5 model. The E5
    ``query:``/``passage:`` prefixes are dropped so the query vector is the very
    string search embeds next, which VoiceMem's embed cache then reuses.
    """

    def __init__(self, embedder) -> None:
        self._e = embedder

    def encode(self, texts, normalize_embeddings: bool = True):
        import numpy as np

        clean = [t.split(": ", 1)[1] if t.startswith(("query: ", "passage: ")) else t for t in texts]
        out = np.asarray(self._e.embed_texts(clean), dtype=float)
        if normalize_embeddings:
            out = out / np.maximum(np.linalg.norm(out, axis=1, keepdims=True), 1e-12)
        return out


def _embedding_classifier(s: VoiceMemSettings):
    from voicemem.leftbrain.cognitive_graph.local_query_classifier import LocalQueryClassifier
    from voicemem.leftbrain.local_memory_store import OpenAILocalEmbedder, OpenAILocalEmbedderConfig

    def make():
        emb = OpenAILocalEmbedder(OpenAILocalEmbedderConfig(
            model=s.embedding_model, api_key=s.embedding_api_key,
            base_url=s.embedding_base_url or None, dimensions=s.embedding_dims))
        return LocalQueryClassifier(model=_ApiEncoder(emb))

    return make


def make_voicemem(s: VoiceMemSettings):
    """Construct a real ``voicemem.VoiceMem`` wired to the APIs in ``s``."""
    apply_env(s)
    s.memory_root.mkdir(parents=True, exist_ok=True)
    from voicemem import VoiceMem

    keep_user_language()
    serialize_qdrant_local()
    trim_extractor_prompt()
    use_memory_model(s.memory_model or _aux_model(), _aux_model("extract"))
    from voicemem.config import build_kwargs

    kwargs = build_kwargs(build_api_config(s))
    if s.classifier != "llm":
        # Query classification by embedding similarity: saves one LLM round
        # trip (~1-2s on qwen-plus) per turn. OLO_MEMORY_CLASSIFIER=llm restores
        # VoiceMem's LLM classifier (also extracts query entities).
        kwargs["schema"] = _embedding_classifier(s)
    return VoiceMem(**kwargs)


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
        # Writes spend seconds on network calls; only Qdrant access is locked
        # (serialize_qdrant_local), so they must not hold olo's VoiceMem io lock.
        self.writes_bypass_io_lock = True
        from olo.memory.lifecycle import Lifecycle

        root = settings.memory_root if settings is not None else Path(os.environ.get("OLO_VOICEMEM_DIR") or ".")
        self.lifecycle = Lifecycle(Path(root) / "olo_lifecycle.json")

    def classify(self, query):
        return self._inner.classify(query)

    def search(self, query, **kwargs):
        # Archived memories the user brings back up are revived before the search sees the store.
        try:
            if getattr(self, "lifecycle", None) is not None:
                self.lifecycle.revive(self, query)
        except Exception as exc:  # noqa: BLE001
            logger.warning("memory revive failed: %s", type(exc).__name__)
        result = self._inner.search(query, **kwargs)
        hits = getattr(result, "hits", None)
        if hits and getattr(self, "lifecycle", None) is not None:
            try:
                result.hits = self.lifecycle.rerank(list(hits))
            except Exception as exc:  # noqa: BLE001
                logger.warning("memory rerank failed: %s", type(exc).__name__)
        return result

    # -- lifecycle (olo.memory.lifecycle) ----------------------------------
    def archive_cold(self, *, min_age_days: float) -> dict:
        return self._vm._o.ArchiveColdMemories(min_age_days=min_age_days)  # noqa: SLF001

    def archive_memory(self, memory_id: str) -> bool:
        return bool(self._repo()._vector_store.archive_memory(memory_id))  # noqa: SLF001

    def unarchive_memory(self, memory_id: str) -> bool:
        return bool(self._repo()._vector_store.unarchive_memory(memory_id))  # noqa: SLF001

    def label_memories(self, memory_ids, durability: str) -> None:
        self.lifecycle.label(memory_ids, durability)

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

    # -- consolidation (olo.consolidate) -----------------------------------
    def _repo(self):
        return self._vm._o._get_repo()  # noqa: SLF001 - VoiceMem has no public list API

    def list_memories(self) -> list[dict]:
        """All left-brain memories of this user: ``[{id, text, created_at}]``.

        The live store is mem0 (``repo.vector_store``); the old JSON/kv mirror
        that this used to read is empty on current VoiceMem, which made
        consolidation see nothing. Order: mem0 -> cognitive sqlite -> mirror.
        """
        return list_live_memories(self._repo(), self._s.user_id if self._s else None)

    def update_memory(self, memory_id: str, new_text: str) -> bool:
        uid = self._s.user_id if self._s else None
        repo = self._repo()
        ok = bool(repo.update_memory(memory_id, new_text, user_id=uid))
        if ok:
            _cognitive_sync(repo, "UPDATE memories SET content = ?, updated_at = datetime('now') WHERE id = ?", (new_text, memory_id))
        return ok

    def delete_memory(self, memory_id: str) -> bool:
        repo = self._repo()
        ok = bool(repo.delete_memory(memory_id))
        if ok:
            _cognitive_delete(repo, memory_id)
            if getattr(self, "lifecycle", None) is not None:
                self.lifecycle.forget(memory_id)
        return ok


def list_live_memories(repo, uid: str | None) -> list[dict]:
    vs = getattr(repo, "vector_store", None)
    if uid and vs is not None and hasattr(vs, "list_entries"):
        try:
            rows = [e for e in vs.list_entries(user_id=uid) if (e.get("role") or "user") == "user"]
            out = [{"id": str(e["id"]), "text": str(e.get("text") or "").strip(), "created_at": str(e.get("date") or "")} for e in rows]
            out = [o for o in out if o["id"] and o["text"]]
            if out:
                return out
        except Exception as exc:  # noqa: BLE001
            logger.warning("mem0 list failed: %s", type(exc).__name__)
    store = getattr(repo, "cognitive_store", None)
    if uid and store is not None:
        try:
            with store._conn() as c:  # noqa: SLF001
                rows = c.execute("SELECT id, content, created_at FROM memories WHERE user_id=? ORDER BY created_at", (uid,)).fetchall()
            out = [{"id": str(r[0]), "text": str(r[1] or "").strip(), "created_at": str(r[2] or "")} for r in rows]
            out = [o for o in out if o["text"]]
            if out:
                return out
        except Exception as exc:  # noqa: BLE001
            logger.warning("cognitive list failed: %s", type(exc).__name__)
    out = []
    for obj in repo.load_json_store().get("results", []):
        if not isinstance(obj, dict) or (uid and obj.get("user_id", uid) != uid):
            continue
        mid, text = str(obj.get("id", "")).strip(), str(obj.get("memory", "")).strip()
        if mid and text:
            out.append({"id": mid, "text": text, "created_at": str(obj.get("created_at") or "")})
    return out


def _cognitive_sync(repo, sql: str, args: tuple) -> None:
    store = getattr(repo, "cognitive_store", None)
    if store is None:
        return
    try:
        with store._conn() as c:  # noqa: SLF001
            c.execute(sql, args)
    except Exception as exc:  # noqa: BLE001
        logger.warning("cognitive sync failed: %s", type(exc).__name__)


def _cognitive_delete(repo, memory_id: str) -> None:
    """mem0 delete leaves the cognitive-graph row (which retrieval ranks from); drop it too."""
    store = getattr(repo, "cognitive_store", None)
    if store is None:
        return
    try:
        with store._conn() as c:  # noqa: SLF001
            tables = [r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
            for t in tables:
                cols = [r[1] for r in c.execute(f'PRAGMA table_info("{t}")').fetchall()]
                if t != "memories" and "memory_id" in cols:
                    c.execute(f'DELETE FROM "{t}" WHERE memory_id = ?', (memory_id,))
            c.execute("DELETE FROM memories WHERE id = ?", (memory_id,))
    except Exception as exc:  # noqa: BLE001
        logger.warning("cognitive delete failed: %s", type(exc).__name__)
