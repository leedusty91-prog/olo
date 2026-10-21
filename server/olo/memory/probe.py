"""Probe the four normal-mode steps. Never call vm.warmup()."""

from pathlib import Path
import tempfile


def warm_asr(vm: object) -> None:
    hook = getattr(vm, "warm_asr", None)
    if callable(hook):
        hook()
        return
    import numpy as np

    asr = vm.utils.get("asr")  # type: ignore[attr-defined]
    asr.feed(np.zeros(9600, dtype=np.float32))
    asr.reset()


def warm_vad(vm: object) -> None:
    hook = getattr(vm, "warm_vad", None)
    if callable(hook):
        hook()
        return
    import numpy as np

    vm.utils.get("vad").is_speech(np.zeros(512, dtype=np.float32))  # type: ignore[attr-defined]


def warm_perceive(vm: object) -> None:
    hook = getattr(vm, "warm_perceive", None)
    if callable(hook):
        hook()
        return
    import numpy as np
    import soundfile as sf  # type: ignore[import-not-found]

    path = Path(tempfile.gettempdir()) / "voicemem_warmup.wav"
    sf.write(path, np.zeros(16000, dtype=np.float32), 16000)
    try:
        vm.preprocess("预热", audio=str(path))  # type: ignore[attr-defined]
    finally:
        path.unlink(missing_ok=True)


def probe_warmup(vm: object) -> list[str]:
    """Return failed step names. An empty list is ready. Do not call vm.warmup()."""
    failed: list[str] = []

    def run(name: str, fn) -> None:
        try:
            fn()
        except Exception:
            failed.append(name)

    run("classify", lambda: vm.classify("你好"))  # type: ignore[attr-defined]
    run("asr", lambda: warm_asr(vm))
    run("vad", lambda: warm_vad(vm))
    run("perceive", lambda: warm_perceive(vm))
    return failed
