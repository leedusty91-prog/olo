import threading

from olo.memory.port import (
    ClassificationView,
    IngestResult,
    PerceptionView,
    SearchView,
)


def ingest_call_kwargs(
    *,
    text: str,
    agent_reply: str,
    session_id: str,
    observed_at: str,
    audio_path: str | None = None,
) -> dict:
    """Shape passed to VoiceMem.ingest. Voice turns omit speaker."""
    common = {
        "text": text,
        "agent_reply": agent_reply,
        "session_id": session_id,
        "observed_at": observed_at,
        "async_facts": False,
    }
    if audio_path is None:
        return {**common, "speaker": "user"}
    return {**common, "audio": audio_path}


class FakeMemory:
    """In-process port. Records the ingest kwargs the adapter must send."""

    mode = "multi_modal"

    def __init__(self) -> None:
        self.events: list[tuple] = []
        self.ingest_calls: list[dict] = []
        self.remember_calls: list[tuple[str, str]] = []
        self.classify_result = ClassificationView(slots=["diet"], entities=["坚果"])
        self.search_result = SearchView()
        self.search_error: BaseException | None = None
        self.search_gate: threading.Event | None = None
        self.search_started = threading.Event()
        self.transcribe_text = ""
        self.transcribe_error: BaseException | None = None
        self.transcribe_gate: threading.Event | None = None
        self.transcribe_started = threading.Event()
        self.perceive_emotion: str | None = None
        self.flush_error: BaseException | None = None
        self.flush_calls = 0
        self._lock = threading.Lock()
        self.memories: list[dict] = []  # consolidation tests: {id, text, created_at}
        self.archived: dict[str, dict] = {}
        self.cold: list[str] = []  # ids ArchiveColdMemories would return
        self.labels: list[tuple] = []
        self.lifecycle = None  # tests attach olo.memory.lifecycle.Lifecycle

    def classify(self, query: str) -> ClassificationView:
        with self._lock:
            self.events.append(("classify", query))
        return self.classify_result

    def search(
        self,
        query: str,
        *,
        slots: list[str],
        entities: list[str],
        top_k: int = 5,
        emotion: str | None = None,
    ) -> SearchView:
        with self._lock:
            self.events.append(
                ("search", query, tuple(slots), tuple(entities), top_k, emotion)
            )
        self.search_started.set()
        if self.search_gate is not None:
            self.search_gate.wait()
        if self.search_error is not None:
            raise self.search_error
        return self.search_result

    def remember_reply(self, user_text: str, assistant_text: str) -> None:
        with self._lock:
            self.remember_calls.append((user_text, assistant_text))

    def ingest_user(
        self,
        *,
        text: str,
        agent_reply: str,
        session_id: str,
        observed_at: str,
        audio_path: str | None = None,
    ) -> IngestResult:
        recorded = ingest_call_kwargs(
            text=text,
            agent_reply=agent_reply,
            session_id=session_id,
            observed_at=observed_at,
            audio_path=audio_path,
        )
        with self._lock:
            self.ingest_calls.append(recorded)
        return IngestResult()

    def transcribe(self, audio_path: str) -> str:
        with self._lock:
            self.events.append(("transcribe", audio_path))
        self.transcribe_started.set()
        if self.transcribe_gate is not None:
            self.transcribe_gate.wait()
        if self.transcribe_error is not None:
            raise self.transcribe_error
        return self.transcribe_text

    def perceive(self, text: str, audio_path: str) -> PerceptionView:
        with self._lock:
            self.events.append(("perceive", text, audio_path))
        return PerceptionView(emotion=self.perceive_emotion)

    def flush(self) -> None:
        self.flush_calls += 1
        if self.flush_error is not None:
            raise self.flush_error

    def search_start_count(self) -> int:
        with self._lock:
            return sum(1 for event in self.events if event[0] == "search")

    def classify_count(self) -> int:
        with self._lock:
            return sum(1 for event in self.events if event[0] == "classify")

    def list_memories(self) -> list[dict]:
        with self._lock:
            return [dict(m) for m in self.memories]

    def update_memory(self, memory_id: str, text: str) -> bool:
        with self._lock:
            for m in self.memories:
                if m["id"] == memory_id:
                    m["text"] = text
                    return True
        return False

    def archive_cold(self, *, min_age_days: float) -> dict:
        done = [mid for mid in self.cold if self.archive_memory(mid)]
        return {"status": "archived" if done else "nothing_to_archive", "archived": done, "min_age_days": min_age_days}

    def archive_memory(self, memory_id: str) -> bool:
        with self._lock:
            for m in self.memories:
                if m["id"] == memory_id:
                    self.memories.remove(m)
                    self.archived[memory_id] = m
                    return True
        return False

    def unarchive_memory(self, memory_id: str) -> bool:
        with self._lock:
            m = self.archived.pop(memory_id, None)
            if m is None:
                return False
            self.memories.append(m)
            return True

    def label_memories(self, memory_ids, durability: str) -> None:
        self.labels.append((tuple(memory_ids), durability))
        if self.lifecycle is not None:
            self.lifecycle.label(memory_ids, durability)

    def delete_memory(self, memory_id: str) -> bool:
        with self._lock:
            before = len(self.memories)
            self.memories = [m for m in self.memories if m["id"] != memory_id]
            return len(self.memories) < before
