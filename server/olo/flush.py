import logging
import time
from collections.abc import Callable
from pathlib import Path

from olo.memory.io_lock import VoicememIoLock

logger = logging.getLogger(__name__)


def select_idle(conn) -> list:
    return conn.execute(
        """
        SELECT id
        FROM sessions
        WHERE ended_at IS NULL
          AND last_turn_at < now() - interval '6 hours'
        """
    ).fetchall()


def mark_ended(conn, ids: list) -> None:
    for session_id in ids:
        conn.execute(
            """
            UPDATE sessions
            SET ended_at = now()
            WHERE id = %s
              AND ended_at IS NULL
              AND last_turn_at < now() - interval '6 hours'
            """,
            (session_id,),
        )


def flush_idle(
    connect: Callable,
    vm,
    io_lock: VoicememIoLock,
    *,
    before_mark: Callable[[], None] | None = None,
) -> None:
    with connect() as conn:
        rows = select_idle(conn)
    if not rows:
        return
    if not io_lock.acquire(blocking=False):
        return
    flushed = False
    try:
        vm.flush()
        flushed = True
    except Exception as exc:
        logger.warning(
            "flush failed session_ids=%s error=%s",
            [str(row[0]) for row in rows],
            type(exc).__name__,
        )
    finally:
        io_lock.release()
    if not flushed:
        return
    if before_mark is not None:
        before_mark()
    with connect() as conn:
        mark_ended(conn, [row[0] for row in rows])


def sweep_uploads(root: Path, older_than_days: int = 90) -> int:
    if not root.exists():
        return 0
    cutoff = time.time() - older_than_days * 86400
    removed = 0
    for path in root.iterdir():
        if path.is_file() and path.stat().st_mtime < cutoff:
            path.unlink()
            removed += 1
    return removed
