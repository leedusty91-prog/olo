"""陪你学 Phase 0 (docs/learning.md): olo remembers what the user is learning and,
rarely, slips one casual review question into a normal chat turn.

Off unless OLO_LEARNING=1. Everything here fails closed: an error means "no review",
never a broken turn. Progress lives in Postgres only (not VoiceMem).

Flow per turn (called from olo.turns):
  1. ``before_reply``: grade the user's answer if the previous olo message asked a
     review question; then maybe pick one due item and return a system-prompt hint.
  2. ``after_reply``: if a hint was given and olo actually asked, log the ask; detect a
     new learning goal (explicit "想学/在学/要考" only) or extract 0-2 items from a
     learning Q&A under an existing goal. Model calls run in a background thread.

Gates for a review (all must hold): learning on; no ask yet today (user's day); the goal
was not asked within 2 days and is active / not paused; an item is due; not quiet hours;
the user is not upset or asking for help (mood.score_text / emotion label, the same
per-message signal the mood curve and memory salience use); >=3 user turns this
session; a 30% random gate.
"""
from __future__ import annotations

import json
import logging
import os
import random
import re
import threading
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from olo.db import connect
from olo.sessions import SEEDED_USER_ID

logger = logging.getLogger(__name__)

MAX_ITEMS_IN_FLIGHT = 20
GOAL_GAP = timedelta(days=2)
PAUSE_ON_REFUSAL = timedelta(days=3)
MIN_SESSION_TURNS = 3
GRADES = ("right", "fuzzy", "wrong", "refused")

GOAL_ZH = re.compile(r"(想学|在学|要学|打算学|准备学|开始学|学点|学一下|要考|准备考|在备考|备考)\s*([^，。！？,.!?\n]{1,20})")
GOAL_EN = re.compile(
    r"\b(?:i\s*(?:'m| am)\s+(?:learning|studying(?: for)?|trying to learn)|i\s+(?:want|plan|need)\s+to\s+(?:learn|study|get better at)"
    r"|i'?m\s+preparing\s+for)\s+([^,.!?\n]{1,40})",
    re.IGNORECASE,
)
# Not a goal: negated or past ("不想学", "以前学过").
GOAL_NEG = re.compile(r"(不想学|不要学|没在学|不学了|学过|don'?t want to learn|not learning)", re.IGNORECASE)
REFUSE_ZH = ("别考我", "不想复习", "别问了", "不考了", "别考了", "烦死了别问", "不想答")
REFUSE_EN = ("don't quiz me", "dont quiz me", "stop quizzing", "not now", "no quiz")
HELP_MARKERS = ("怎么办", "帮帮我", "救命", "求助", "出事了", "help me", "what should i do")
UPSET_EMOTIONS = frozenset({"焦虑", "难过", "委屈", "孤独", "纠结", "疲惫", "sad", "angry", "fear", "disgust", "tired"})
LEARN_Q = re.compile(r"(怎么说|什么意思|怎么读|怎么念|是什么|怎么用|区别|how do (?:you|i) say|what does .+ mean|what is|difference between)", re.IGNORECASE)


def enabled() -> bool:
    return (os.environ.get("OLO_LEARNING") or "").strip().lower() in {"1", "on", "true", "yes"}


def rate() -> float:
    try:
        return max(0.0, min(1.0, float(os.environ.get("OLO_LEARNING_RATE", "0.3"))))
    except ValueError:
        return 0.3


def lang_of(text: str) -> str:
    cjk = sum(1 for ch in text if "\u4e00" <= ch <= "\u9fff")
    latin = sum(1 for ch in text if ch.isascii() and ch.isalpha())
    return "zh" if cjk >= max(1, latin // 4) else "en"


# ---------------------------------------------------------------- signals


def is_upset(text: str, emotion_label: str | None = None) -> bool:
    """Per-message upset/help signal. Reuses mood.score_text (lexicon + acoustic label)
    and the memory layer's emotion normaliser; adds help-seeking and English cues."""
    from olo.memory.compat import normalize_emotion_strict
    from olo.mood import score_text

    t = (text or "").strip()
    low = t.lower()
    if any(m in low for m in HELP_MARKERS):
        return True
    s = score_text(t, emotion_label)
    if s is not None and s < 0:
        return True
    if (emotion_label or "").lower() in UPSET_EMOTIONS:
        return True
    label = normalize_emotion_strict(t)
    if label in UPSET_EMOTIONS:
        return True
    return bool(re.search(r"\b(sad|upset|stressed|anxious|exhausted|tired|angry|awful|terrible|depressed)\b", low))


def is_refusal(text: str) -> bool:
    low = (text or "").lower().replace("’", "'")
    return any(m in text for m in REFUSE_ZH) or any(m in low for m in REFUSE_EN)


def detect_goal(text: str) -> str | None:
    """Explicit "I want to learn / am studying X" only; returns a rough topic or None."""
    t = (text or "").strip()
    if not t or GOAL_NEG.search(t):
        return None
    m = GOAL_ZH.search(t)
    if m:
        topic = m.group(2).strip("的了啊呀吧 ")
        return topic or None
    m = GOAL_EN.search(t)
    if m:
        return m.group(1).strip() or None
    return None


# ---------------------------------------------------------------- scheduling


def sm2(result: str, ease: float, interval_days: float, mastery: float) -> tuple[float, float, float]:
    """Simplified SM-2 (docs/learning.md §4). Returns (ease, interval_days, mastery)."""
    if result == "right":
        return ease, max(1.0, interval_days * ease), min(1.0, mastery + 0.25)
    if result == "fuzzy":
        return max(1.3, ease - 0.15), interval_days, min(1.0, mastery + 0.05)
    if result == "wrong":
        return max(1.3, ease - 0.2), 1.0, max(0.0, mastery - 0.2)
    return ease, interval_days, mastery  # skipped / refused: no score


def _day_start(now: datetime, tz) -> datetime:
    local = now.astimezone(tz)
    return local.replace(hour=0, minute=0, second=0, microsecond=0)


@dataclass
class Review:
    item_id: uuid.UUID
    goal_id: uuid.UUID
    topic: str
    prompt: str
    answer: str
    lang: str


def hint(review: Review, lang: str) -> str:
    if lang == "en":
        return (
            "\n\n[Optional, only if it fits] The user is learning \"" + review.topic + "\". If it flows naturally, end your reply "
            "with ONE short, casual question in your own voice to jog their memory: " + review.prompt
            + " (answer: " + review.answer + "). One sentence, no lecture, no praise like \"great job\" or \"keep it up\", "
            "no either/or. If it doesn't fit this moment, don't ask. Never mention reviewing or studying."
        )
    return (
        "\n\n【可选，顺才用】对方在学「" + review.topic + "」。如果顺，可以在回复末尾用你自己的口吻随口问一句："
        + review.prompt + "（答案：" + review.answer + "）。只问一句，不讲课、不说加油/你真棒、不给二选一；"
        "不顺就别问，也别提「复习」「考你」。"
    )


def grade_hint(lang: str, answer: str) -> str:
    if lang == "en":
        return ("\n\n[Context] Your last message asked them a quick memory question (answer: " + answer + "). "
                "If they answered: one short reaction; if they got it wrong, just say the right one in passing, no lesson.")
    return ("\n\n【背景】你上一句随口问过对方一个小问题（答案：" + answer + "）。对方答了就简单回一句；"
            "答错就顺嘴说出正确的，别讲课。")


def turn_gate(now: datetime, tz, user_text: str, recent: list[dict], emotion: str | None = None) -> str | None:
    """The DB-free gates (quiet hours, mood/help, session length). None = may ask."""
    from olo.proactive import in_quiet_hours

    if in_quiet_hours(now, tz):
        return "quiet_hours"
    if is_upset(user_text, emotion) or is_refusal(user_text):
        return "upset"
    if sum(1 for m in recent if m.get("role") == "user") < MIN_SESSION_TURNS:
        return "too_early"
    return None


def pick_review(conn, now: datetime, user_text: str, recent: list[dict], *, emotion: str | None = None,
                user_id=SEEDED_USER_ID, rng: random.Random | None = None) -> tuple[Review | None, str]:
    """(review, reason). reason names the first gate that said no (for evals/logs)."""
    from olo.proactive import local_tz

    if not enabled():
        return None, "off"
    tz = local_tz(conn, user_id)
    reason = turn_gate(now, tz, user_text, recent, emotion)
    if reason:
        return None, reason
    asked_today = conn.execute(
        """
        SELECT 1 FROM learning_reviews r
        JOIN learning_items i ON i.id = r.item_id JOIN learning_goals g ON g.id = i.goal_id
        WHERE g.user_id = %s AND r.result <> 'skipped' AND r.created_at >= %s LIMIT 1
        """,
        (user_id, _day_start(now, tz)),
    ).fetchone()
    if asked_today:
        return None, "daily_cap"
    row = conn.execute(
        """
        SELECT i.id, g.id, g.topic, i.prompt, i.answer, g.lang
        FROM learning_items i JOIN learning_goals g ON g.id = i.goal_id
        WHERE g.user_id = %s AND g.status = 'active'
          AND (g.paused_until IS NULL OR g.paused_until <= %s)
          AND (g.last_asked_at IS NULL OR g.last_asked_at <= %s)
          AND i.due_at <= %s
        ORDER BY i.due_at ASC LIMIT 1
        """,
        (user_id, now, now - GOAL_GAP, now),
    ).fetchone()
    if row is None:
        return None, "nothing_due"
    if (rng or random).random() >= rate():
        return None, "random_gate"
    return Review(*row), "pick"


def pending(conn, session_id, user_id=SEEDED_USER_ID):
    """The 'asked' review on the latest olo message of this session, if any."""
    row = conn.execute(
        """
        SELECT r.id, r.item_id, i.answer, g.lang, i.prompt FROM learning_reviews r
        JOIN learning_items i ON i.id = r.item_id JOIN learning_goals g ON g.id = i.goal_id
        WHERE r.session_id = %s AND r.result = 'asked' AND g.user_id = %s
          AND r.asked_message_id = (
            SELECT id FROM messages WHERE session_id = %s AND role = 'assistant' ORDER BY created_at DESC LIMIT 1)
        ORDER BY r.created_at DESC LIMIT 1
        """,
        (session_id, user_id, session_id),
    ).fetchone()
    return row


def apply_grade(conn, review_id, item_id, result: str, now: datetime) -> None:
    if result not in GRADES:
        result = "skipped"
    if result == "refused":
        conn.execute("UPDATE learning_reviews SET result = 'refused' WHERE id = %s", (review_id,))
        conn.execute(
            """
            UPDATE learning_goals SET refusals = refusals + 1, paused_until = %s, updated_at = now(),
                   status = CASE WHEN refusals + 1 >= 2 THEN 'paused' ELSE status END
            WHERE id = (SELECT goal_id FROM learning_items WHERE id = %s)
            """,
            (now + PAUSE_ON_REFUSAL, item_id),
        )
        conn.execute(
            "UPDATE learning_items SET due_at = %s, last_result = 'skipped' WHERE id = %s",
            (now + PAUSE_ON_REFUSAL, item_id),
        )
        return
    ease, interval, mastery = conn.execute(
        "SELECT ease, interval_days, mastery FROM learning_items WHERE id = %s", (item_id,)
    ).fetchone()
    e2, i2, m2 = sm2(result, ease, interval, mastery)
    conn.execute("UPDATE learning_reviews SET result = %s WHERE id = %s", (result, review_id))
    conn.execute(
        """
        UPDATE learning_items SET ease = %s, interval_days = %s, mastery = %s, due_at = %s,
               last_result = %s, reviews = reviews + %s WHERE id = %s
        """,
        (e2, i2, m2, now + timedelta(days=i2 if result != "skipped" else 1), result,
         0 if result == "skipped" else 1, item_id),
    )


# ---------------------------------------------------------------- model calls

GRADE_PROMPT = (
    "判断对方是否答对了一个随口问的小问题。只输出 JSON：{\"result\":\"right|fuzzy|wrong|refused|none\"}。"
    "right=基本答对；fuzzy=答对一部分或不确定；wrong=答错或说忘了；refused=不想被问/想换话题；none=没在回答这个问题。"
)
GOAL_PROMPT = (
    "对方说想学点东西。只输出 JSON：{\"topic\":\"简短主题\",\"why\":\"对方原话里的动机，没有就空\","
    "\"items\":[{\"prompt\":\"一句话能问完的小问题\",\"answer\":\"一句话能答完\"}]}。items 给 3 到 5 个最入门、最实用的点；"
    "用对方说话的语言。不确定对方是在明确表达想学，就输出 {\"topic\":\"\"}。"
)
ITEM_PROMPT = (
    "对方在学「{topic}」，刚问了 olo 一个问题并得到回答。从这轮对话里抽 0 到 2 个以后可以随口复习的小知识点。"
    "只输出 JSON：{{\"items\":[{{\"prompt\":\"一句话能问完\",\"answer\":\"一句话能答完\"}}]}}；和学习无关就给空列表。"
)


def _aux_json(llm, system: str, user: str, timeout_s: float = 8.0) -> dict:
    from olo.guard import _ask

    raw = _ask(llm, [{"role": "system", "content": system}, {"role": "user", "content": user}], timeout_s)
    m = re.search(r"\{.*\}", raw, re.DOTALL)
    return json.loads(m.group(0)) if m else {}


def _llm(runtime):
    llm = getattr(runtime, "llm", None)
    return getattr(llm, "guard", None) or getattr(llm, "aux", None)


def grade(runtime, prompt: str, answer: str, user_text: str) -> str:
    """Rule-first refusal; else one small JSON call. Any failure -> 'skipped'."""
    if is_refusal(user_text):
        return "refused"
    llm = _llm(runtime)
    if llm is None:
        return "skipped"
    try:
        out = _aux_json(llm, GRADE_PROMPT, f"问题：{prompt}\n正确答案：{answer}\n对方的回答：{user_text}")
        r = str(out.get("result", "")).strip()
        return r if r in GRADES else "skipped"
    except Exception as exc:  # noqa: BLE001
        logger.info("learning grade failed: %s", type(exc).__name__)
        return "skipped"


def _clean_items(items) -> list[tuple[str, str]]:
    out = []
    for it in items if isinstance(items, list) else []:
        if not isinstance(it, dict):
            continue
        p, a = str(it.get("prompt") or "").strip(), str(it.get("answer") or "").strip()
        if p and a and len(p) <= 120 and len(a) <= 120:
            out.append((p, a))
    return out


def _add_items(conn, goal_id, items, now: datetime, source_message_id=None) -> int:
    n = conn.execute(
        "SELECT count(*) FROM learning_items WHERE goal_id = %s AND (mastery < 0.95 OR reviews < 3)", (goal_id,)
    ).fetchone()[0]
    added = 0
    for p, a in items:
        if n + added >= MAX_ITEMS_IN_FLIGHT:
            break
        dup = conn.execute("SELECT 1 FROM learning_items WHERE goal_id = %s AND prompt = %s", (goal_id, p)).fetchone()
        if dup:
            continue
        conn.execute(
            "INSERT INTO learning_items (id, goal_id, prompt, answer, source_message_id, due_at) VALUES (%s,%s,%s,%s,%s,%s)",
            (uuid.uuid4(), goal_id, p, a, source_message_id, now + timedelta(days=1)),
        )
        added += 1
    return added


def create_goal(conn, topic: str, why: str | None, lang: str, now: datetime, user_id=SEEDED_USER_ID):
    row = conn.execute(
        "SELECT id FROM learning_goals WHERE user_id = %s AND lower(topic) = lower(%s) AND status IN ('active','paused')",
        (user_id, topic),
    ).fetchone()
    if row:
        return row[0], False
    gid = uuid.uuid4()
    conn.execute(
        "INSERT INTO learning_goals (id, user_id, topic, why, lang) VALUES (%s,%s,%s,%s,%s)",
        (gid, user_id, topic[:60], (why or None) and why[:200], lang),
    )
    return gid, True


def learn_from_turn(runtime, user_text: str, assistant_text: str, message_id, now: datetime,
                    user_id=SEEDED_USER_ID) -> dict:
    """New goal (explicit only) or 0-2 items under the active goal. Synchronous; see submit_learn."""
    topic = detect_goal(user_text)
    llm = _llm(runtime)
    lang = lang_of(user_text)
    with connect() as conn:
        if topic:
            items: list[tuple[str, str]] = []
            why = None
            if llm is not None:
                try:
                    out = _aux_json(llm, GOAL_PROMPT, f"对方说：{user_text}\nolo 回：{assistant_text}")
                    if not str(out.get("topic", "")).strip():
                        return {"action": "none", "reason": "model_declined"}
                    topic = str(out["topic"]).strip()
                    why = str(out.get("why") or "").strip() or None
                    items = _clean_items(out.get("items"))[:5]
                except Exception as exc:  # noqa: BLE001
                    logger.info("learning goal extract failed: %s", type(exc).__name__)
            gid, new = create_goal(conn, topic, why, lang, now, user_id)
            added = _add_items(conn, gid, items, now, message_id)
            return {"action": "goal" if new else "goal_exists", "topic": topic, "items": added}
        if llm is None or not LEARN_Q.search(user_text):
            return {"action": "none"}
        goal = conn.execute(
            "SELECT id, topic FROM learning_goals WHERE user_id = %s AND status = 'active' ORDER BY updated_at DESC LIMIT 1",
            (user_id,),
        ).fetchone()
        if goal is None:
            return {"action": "none", "reason": "no_goal"}
        try:
            out = _aux_json(llm, ITEM_PROMPT.format(topic=goal[1]), f"对方问：{user_text}\nolo 答：{assistant_text}")
        except Exception as exc:  # noqa: BLE001
            logger.info("learning item extract failed: %s", type(exc).__name__)
            return {"action": "none", "reason": "error"}
        added = _add_items(conn, goal[0], _clean_items(out.get("items"))[:2], now, message_id)
        return {"action": "items", "items": added}


def submit_learn(runtime, user_text: str, assistant_text: str, message_id) -> None:
    def run() -> None:
        try:
            learn_from_turn(runtime, user_text, assistant_text, message_id, datetime.now(UTC))
        except Exception as exc:  # noqa: BLE001
            logger.warning("learning extract failed: %s", type(exc).__name__)

    threading.Thread(target=run, name="olo-learning", daemon=True).start()


# ---------------------------------------------------------------- turn hooks


@dataclass
class TurnPlan:
    review: Review | None = None
    reason: str = "off"
    note: str = ""        # appended to the system prompt
    guard_note: str = ""  # extra context for the reply guard
    graded: str | None = None


GUARD_NOTE_ZH = (
    "\n本轮 olo 可以在末尾随口问对方一个一句话的小问题（对方在学东西）：这一句本身不算问题。"
    "但讲课式的长篇讲解算 filler；鼓励/打卡套话（「加油」「坚持就是胜利」「你真棒」「Great job!」「Keep it up!」）算 stock_line；"
    "「每天坚持 20 分钟」这类学习建议算 generic_advice；「学累了吧」「是不是有点难」算 narrate_feeling / guess_cause。"
)


def before_reply(runtime, session_id, user_text: str, recent: list[dict], *, emotion: str | None = None,
                 now: datetime | None = None, user_id=SEEDED_USER_ID, rng: random.Random | None = None) -> TurnPlan:
    plan = TurnPlan()
    if not enabled():
        return plan
    now = now or datetime.now(UTC)
    # Follow the conversation's language, not one short line ("ikura desu ka" is still a zh chat).
    lang = lang_of(user_text + " " + " ".join(str(m.get("content") or "") for m in recent[-4:]))
    try:
        with connect() as conn:
            p = pending(conn, session_id, user_id)
        if p is not None:
            review_id, item_id, answer, _goal_lang, prompt = p
            result = grade(runtime, prompt, answer, user_text)
            with connect() as conn:
                apply_grade(conn, review_id, item_id, result, now)
            plan.graded = result
            if result in ("right", "fuzzy", "wrong"):
                plan.note = grade_hint(lang, answer)
                plan.guard_note = GUARD_NOTE_ZH
            plan.reason = "graded"
            return plan  # never ask again on the turn that answers one
        with connect() as conn:
            review, reason = pick_review(conn, now, user_text, recent, emotion=emotion, user_id=user_id, rng=rng)
        plan.review, plan.reason = review, reason
        if review is not None:
            plan.note = hint(review, lang)
            plan.guard_note = GUARD_NOTE_ZH
    except Exception as exc:  # noqa: BLE001
        logger.warning("learning before_reply failed: %s", type(exc).__name__)
        return TurnPlan(reason="error")
    return plan


def asked(review: Review, assistant_text: str) -> bool:
    """Did the reply actually carry the review question? (the model may skip it)"""
    tail = assistant_text.strip()[-160:]
    if not re.search(r"[？?]", tail):
        return False
    key = [w for w in re.findall(r"[A-Za-z]{3,}|[\u4e00-\u9fff]{2}", review.prompt + " " + review.answer)]
    return not key or any(k.lower() in tail.lower() for k in key)


def after_reply(runtime, plan: TurnPlan, session_id, user_text: str, assistant_text: str, message_id,
                *, now: datetime | None = None, background: bool = True) -> bool:
    """Log an ask; kick off goal/item extraction. Returns True when an ask was logged."""
    if not enabled():
        return False
    now = now or datetime.now(UTC)
    logged = False
    try:
        if plan.review is not None and message_id is not None and asked(plan.review, assistant_text):
            with connect() as conn:
                conn.execute(
                    "INSERT INTO learning_reviews (id, item_id, session_id, asked_message_id, result, created_at) "
                    "VALUES (%s,%s,%s,%s,'asked',%s)",
                    (uuid.uuid4(), plan.review.item_id, session_id, message_id, now),
                )
                conn.execute("UPDATE learning_goals SET last_asked_at = %s, updated_at = now() WHERE id = %s",
                             (now, plan.review.goal_id))
            logged = True
    except Exception as exc:  # noqa: BLE001
        logger.warning("learning log failed: %s", type(exc).__name__)
    if plan.graded is None and (detect_goal(user_text) or LEARN_Q.search(user_text)):
        if background:
            submit_learn(runtime, user_text, assistant_text, message_id)
        else:
            try:
                learn_from_turn(runtime, user_text, assistant_text, message_id, now)
            except Exception as exc:  # noqa: BLE001
                logger.warning("learning extract failed: %s", type(exc).__name__)
    return logged
