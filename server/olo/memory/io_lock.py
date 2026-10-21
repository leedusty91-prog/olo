import threading
from collections.abc import Callable
from dataclasses import dataclass
from typing import TypeVar

T = TypeVar("T")


@dataclass
class IoResult:
    status: str
    value: object = None
    error: BaseException | None = None
    lock_held: bool = False


class VoicememIoLock:
    """Single-flight gate for every VoiceMem disk call in this process."""

    def __init__(self) -> None:
        self._lock = threading.Lock()

    def locked(self) -> bool:
        return self._lock.locked()

    def acquire(self, blocking: bool = True) -> bool:
        return self._lock.acquire(blocking=blocking)

    def release(self) -> None:
        self._lock.release()

    def run_io(self, fn: Callable[[], T], wait_s: float | None) -> IoResult:
        if wait_s is None:
            self._lock.acquire()
            try:
                return IoResult(status="ok", value=fn())
            except Exception as exc:
                return IoResult(status="error", error=exc)
            finally:
                self._lock.release()

        if not self._lock.acquire(blocking=False):
            return IoResult(status="busy", lock_held=True)

        done = threading.Event()
        box: dict[str, object] = {}

        def worker() -> None:
            try:
                box["value"] = fn()
                box["status"] = "ok"
            except Exception as exc:
                box["error"] = exc
                box["status"] = "error"
            finally:
                self._lock.release()
                done.set()

        threading.Thread(target=worker, name="voicemem-io", daemon=True).start()
        if wait_s == 0:
            return IoResult(status="pending", lock_held=True)
        if not done.wait(wait_s):
            return IoResult(status="timeout", lock_held=True)
        if box.get("status") == "error":
            error = box.get("error")
            if not isinstance(error, BaseException):
                error = RuntimeError("voicemem io failed")
            return IoResult(status="error", error=error, lock_held=False)
        return IoResult(status="ok", value=box.get("value"), lock_held=False)
