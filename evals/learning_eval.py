"""陪你学 Phase 0 评测（docs/learning.md §10）：15 条学习场景。

检查三件事：
  1. 出题闸门：情绪低落 / 求助 / 拒绝 / 深夜 / 开场第一句一律不插（olo.learning.turn_gate，离线）。
  2. 目标识别：只有明确说「想学/在学/要考」才建 goal（olo.learning.detect_goal，离线）。
  3. 回复 guard：带学习提示的那一轮，说教、鼓励套话、讲课、二选一必须被 guard 标出来，
     正常的一句随口问不能被误伤（olo.guard.judge + learning.GUARD_NOTE_ZH，需要真实模型）。
  另外用 30 天 × 每天 12 轮的模拟统计复习频率（SM-2 + 每日上限 + 同一目标间隔 2 天 + 30% 随机门）。

用法（仓库根目录）：
  python evals/learning_eval.py --mock     # 离线：1、2、频率模拟（CI）
  python evals/learning_eval.py            # 再加 3：用 CHAT_API_KEY/DEEPSEEK_API_KEY 跑 guard（每条 ≤2 次小调用）
密钥只从环境变量或本地 .env 读，不写进报告。
"""
from __future__ import annotations

import argparse
import json
import os
import random
import sys
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "server"))
SCENARIOS = Path(__file__).with_name("learning_scenarios.json")
TZ = ZoneInfo("Asia/Shanghai")


def load_env() -> None:
    env = ROOT / ".env"
    if env.is_file():
        for line in env.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
    if not os.environ.get("CHAT_API_KEY") and os.environ.get("DEEPSEEK_API_KEY"):
        os.environ["CHAT_API_KEY"] = os.environ["DEEPSEEK_API_KEY"]
        os.environ.setdefault("CHAT_BASE_URL", "https://api.deepseek.com")
        os.environ.setdefault("CHAT_MODEL", "deepseek-flash")


def simulate(days: int = 30, turns_per_day: int = 12, seed: int = 7) -> dict:
    """Frequency check with the real gates' rules (cap, gap, random gate, SM-2), no DB."""
    from olo import learning as L

    rng = random.Random(seed)
    start = datetime(2026, 11, 1, 9, 0, tzinfo=TZ)
    items = [{"due": start, "ease": 2.5, "iv": 1.0, "m": 0.0} for _ in range(5)]
    last_goal_ask = None
    per_day = []
    for d in range(days):
        asked = 0
        for t in range(turns_per_day):
            now = start + timedelta(days=d, minutes=50 * t)
            recent = [{"role": "user"}] * t
            if L.turn_gate(now, TZ, "今天中午吃了拉面", recent):
                continue
            if asked or (last_goal_ask and now - last_goal_ask < L.GOAL_GAP):
                continue
            due = [i for i in items if i["due"] <= now]
            if not due or rng.random() >= L.rate():
                continue
            it = min(due, key=lambda i: i["due"])
            res = rng.choice(["right", "right", "fuzzy", "wrong"])
            it["ease"], it["iv"], it["m"] = L.sm2(res, it["ease"], it["iv"], it["m"])
            it["due"] = now + timedelta(days=it["iv"])
            asked, last_goal_ask = 1, now
        per_day.append(asked)
    return {"days": days, "asks": sum(per_day), "max_per_day": max(per_day),
            "asks_per_week": round(sum(per_day) / days * 7, 2)}


def run(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--mock", action="store_true")
    ap.add_argument("--out", default=str(ROOT / "evals" / "out" / "learning.md"))
    args = ap.parse_args(argv)
    os.environ.setdefault("OLO_QUIET_HOURS", "23:00-08:00")
    from olo import learning as L

    data = json.loads(SCENARIOS.read_text(encoding="utf-8"))["scenarios"]
    llm = None
    if not args.mock:
        load_env()
        if not (os.environ.get("CHAT_API_KEY") or os.environ.get("OPENAI_API_KEY")):
            print("no CHAT_API_KEY / DEEPSEEK_API_KEY: guard checks skipped (use --mock in CI)", file=sys.stderr)
        else:
            from olo.llm import OpenAIChat

            llm = OpenAIChat().guard
    rows, fails = [], 0
    sim = None
    for s in data:
        r = {"id": s["id"], "category": s["category"], "checks": []}
        if s["category"] == "frequency":
            sim = simulate()
            ok = sim["max_per_day"] <= 1 and sim["asks"] > 0
            r["checks"].append(("frequency", ok, f"{sim['asks']} 次/{sim['days']} 天，单日最多 {sim['max_per_day']}，约 {sim['asks_per_week']} 次/周"))
        else:
            h, m = map(int, s["local_time"].split(":"))
            now = datetime(2026, 11, 2, h, m, tzinfo=TZ)
            got = L.turn_gate(now, TZ, s["user"], s["history"], s.get("emotion")) or "pick"
            r["checks"].append(("gate", got == s["expect_gate"], f"{got} (want {s['expect_gate']})"))
            if "expect_goal" in s:
                g = L.detect_goal(s["user"])
                r["checks"].append(("goal", g == s["expect_goal"], f"{g!r}"))
            check = None
            if "review" in s:
                import uuid as _uuid

                rv = s["review"]
                check = L.react_first_check(L.Review(_uuid.uuid4(), _uuid.uuid4(), rv["topic"], rv["prompt"], rv["answer"], rv["lang"]), s["user"])
            if s.get("rule_bad"):
                # Offline rule layer (either-or, react-first): must catch the bad reply, spare the good one.
                from olo.guard import _numbered, rule_hits
                from olo.segments import polish_segments, split_segments

                for key, want_bad in (("bad_reply", True), ("good_reply", False)):
                    sents, _ = _numbered(polish_segments(split_segments(s[key])) or [s[key]])
                    hits = rule_hits(sents) + (check(sents) if check else [])
                    detail = ",".join(sorted({h["cls"] for h in hits})) or "pass"
                    r["checks"].append(("rule_" + key, bool(hits) == want_bad, detail))
            if llm is not None:
                from olo.guard import judge

                for key, want_bad in (("bad_reply", True), ("good_reply", False)):
                    if key not in s:
                        continue
                    try:
                        _, hits = judge(llm, s["user"], s["history"], [s[key]], timeout_s=20, note=L.GUARD_NOTE_ZH, check=check)
                        flagged = bool(hits)
                        detail = ",".join(sorted({h["cls"] for h in hits})) or "pass"
                        r["checks"].append((key, flagged == want_bad, detail))
                    except Exception as exc:  # noqa: BLE001
                        r["checks"].append((key, False, f"error {type(exc).__name__}"))
        r["ok"] = all(c[1] for c in r["checks"])
        fails += not r["ok"]
        rows.append(r)
    n = len(rows)
    lines = ["# olo 陪你学评测", "", f"场景 {n} 条，通过 {n - fails}/{n}；guard 检查：{'开' if llm else '关（--mock / 无密钥）'}", ""]
    lines += ["| id | 类别 | 结果 | 明细 |", "| --- | --- | --- | --- |"]
    for r in rows:
        det = "；".join(f"{k}:{'✓' if ok else '✗'} {d}" for k, ok, d in r["checks"])
        lines.append(f"| {r['id']} | {r['category']} | {'✓' if r['ok'] else '✗'} | {det} |")
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    summary = {"scenarios": n, "passed": n - fails, "guard": bool(llm), "frequency": sim}
    out.with_suffix(".json").write_text(json.dumps({"summary": summary, "rows": rows}, ensure_ascii=False, indent=1), encoding="utf-8")
    print("\n".join(lines))
    return 0 if fails == 0 else 1


def main(argv=None) -> int:
    return run(argv)


if __name__ == "__main__":
    raise SystemExit(main())
