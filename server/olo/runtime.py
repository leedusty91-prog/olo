import contextvars
import threading
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path

from olo.context import Persona
from olo.llm import OpenAIChat
from olo.memory.fake import FakeMemory
from olo.memory.io_lock import VoicememIoLock


@dataclass
class IngestQueue:
    futures: list[Future] = field(default_factory=list)
    pool: ThreadPoolExecutor = field(
        default_factory=lambda: ThreadPoolExecutor(max_workers=1, thread_name_prefix="olo-ingest")
    )

    def submit(self, fn) -> None:
        # Carry the caller's user (olo.userctx) into the worker thread.
        self.futures.append(self.pool.submit(contextvars.copy_context().run, fn))

    def drain(self, timeout: float = 5) -> None:
        for future in list(self.futures):
            future.result(timeout=timeout)


@dataclass
class Runtime:
    memory: object
    io_lock: VoicememIoLock
    llm: object
    exchanges_lock: threading.Lock = field(default_factory=threading.Lock)
    personas: dict = field(default_factory=dict)
    voicemem_status: str = "warming"
    warmup_failed: list[str] = field(default_factory=list)
    search_wait_s: float = 0.4
    asr_wait_s: float = 3.0
    first_token_timeout_s: float = 8.0
    rate_limit_per_minute: int = 30
    ingest: IngestQueue = field(default_factory=IngestQueue)
    space: str = "demo"
    afconvert: object | None = None
    uploads_dir: Path | None = None
    image_generator: object | None = None
    tts_generator: object | None = None
    asr_factory: object | None = None

    @property
    def persona(self) -> Persona | None:
        """Last persona loaded for the current user (fallback when Postgres is down)."""
        from olo.userctx import current_user_id

        return self.personas.get(current_user_id())

    @persona.setter
    def persona(self, value: Persona | None) -> None:
        from olo.userctx import current_user_id

        if value is None:
            self.personas.pop(current_user_id(), None)
        else:
            self.personas[current_user_id()] = value

    def degraded_name(self) -> str | None:
        if self.voicemem_status == "warming":
            return "voicemem_warming"
        if self.voicemem_status == "failed":
            return "voicemem_unavailable"
        return None


def testing_disabled_runtime() -> Runtime:
    from olo.memory.per_user import PerUserMemory

    return Runtime(
        memory=PerUserMemory(FakeMemory(), lambda _uid: FakeMemory()),
        io_lock=VoicememIoLock(),
        llm=OpenAIChat(),
        voicemem_status="warming",
        rate_limit_per_minute=10_000,
    )
