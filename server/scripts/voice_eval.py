"""Voice eval: per-class hit rates of lines a real friend wouldn't say.

Compares three variants on scripts/voice_cases.py (100+ inputs, incl. multi-turn and recap):
  old    = prompts from --old-root, no guard
  prompt = prompts from this checkout, no guard
  guard  = prompts from this checkout + olo.guard (trim / regenerate)
An independent judge (thinking on; different wording from the guard) labels every
sentence. Also measures guard latency and extra calls/tokens.

  CHAT_API_KEY=... python server/scripts/voice_eval.py --old-root /tmp/olo-old --out /tmp/ve
"""
from __future__ import annotations

import argparse, json, os, re, subprocess, sys, time
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))
from voice_cases import build_cases  # noqa: E402

CLS = ["narrate_feeling", "guess_cause", "stock_line", "offer_choices", "filler", "echo", "generic_advice"]

JUDGE = """你是很挑剔的读者，判断一个 AI 陪伴角色（olo，一个小生灵，对方的朋友）发的微信像不像真人朋友。逐句看 olo 的回复，挑出真人朋友不会这样说的句子，并归类：
- narrate_feeling：替对方描述/点评/总结感受或处境（如「这种疼最磨人了」「累得不冤」「挺心酸的」）
- guess_cause：替对方猜原因、动机或状态，而不是问（如「是坐太久了吧」「你是在硬撑吧」「缓过来点啦」）
- stock_line：共情/陪伴套话（如「我在这儿」「我陪你」「抱抱」「听起来很难」「辛苦了」「照顾好自己」）
- offer_choices：让对方在怎么聊之间挑、或二选一式追问（如「想聊聊还是就待着」「是A还是B」）
- filler：没新内容的句子或气泡、客套收尾、重复前面的意思
- echo：把对方的话/原词/事实复述回去
- generic_advice：泛泛的建议或命令（如「早点休息」「别想太多」「先别…」）
长度不是问题；olo 讲自己的事、说真实看法、认真回答、直接具体的提问、玩笑都不算问题。
另外判断 substance：对方在问问题、要故事、要看法或要办法时，回复有没有真的给出（yes/no/na）。
只输出 JSON：{"hits":[{"cls":"类别","text":"原句"}],"substance":"yes|no|na"}"""


def load_env(path):
    if path and os.path.exists(path):
        for line in open(path, encoding="utf-8"):
            m = re.match(r"\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$", line)
            if m and m.group(1) not in os.environ:
                os.environ[m.group(1)] = m.group(2).strip().strip("'\"")


BUILD = r'''
import json, sys
from olo.context import Persona, assemble
from olo.chatctx import recap_text
from olo.memory.port import SearchView, Hit
cases = json.load(sys.stdin); out = {}
for c in cases:
    hits = []
    for m in c["memory"]:
        when, _, text = (m[1:].partition("] ") if m.startswith("[") else ("", "", m))
        hits.append(Hit(text=text, observed_at=when))
    p = Persona(stable_card=STABLE, name="olo", form="buddy")
    extra = {}
    if c.get("recap"):
        lines, hours = c["recap"]
        extra["recap"] = recap_text([tuple(x) for x in lines], hours)
    out[c["id"]] = assemble(p, c["history"], SearchView(hits=hits), None, c["user"], [], garden_level=1, turn_index=3, **extra)
print(json.dumps(out, ensure_ascii=False))
'''


def build_prompts(root, cases):
    seed = open(os.path.join(root, "server/alembic/versions/20261010_0002_seed.py"), encoding="utf-8").read()
    ns = {}
    exec(re.search(r"STABLE_CARD = \(.*?\n\)", seed, re.S).group(0), ns)
    code = "STABLE = " + json.dumps(ns["STABLE_CARD"], ensure_ascii=False) + "\n" + BUILD
    env = {**os.environ, "PYTHONPATH": os.path.join(root, "server")}
    res = subprocess.run([sys.executable, "-c", code], input=json.dumps(cases), capture_output=True, text=True, env=env, cwd=root)
    if res.returncode:
        sys.exit("prompt build failed: " + res.stderr[-800:])
    return json.loads(res.stdout)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--old-root", required=True)
    ap.add_argument("--env-file"); ap.add_argument("--out", default="/tmp/voice-eval"); ap.add_argument("--workers", type=int, default=12)
    ap.add_argument("--limit", type=int, default=0)
    a = ap.parse_args()
    load_env(a.env_file)
    os.environ.setdefault("CHAT_BASE_URL", "https://api.deepseek.com")
    os.environ.setdefault("CHAT_MODEL", "deepseek-chat")
    from olo.guard import guard_reply
    from olo.llm import OpenAIChat

    new_root = os.path.dirname(os.path.dirname(HERE))
    cases = build_cases()[: a.limit or None]
    prompts = {"old": build_prompts(a.old_root, cases), "new": build_prompts(new_root, cases)}
    chat = OpenAIChat()  # purpose chat: thinking on, like production
    judge_llm = OpenAIChat(purpose="diary")  # thinking on for the judge

    class RT:
        llm = chat

    def gen(msgs):
        for attempt in range(3):
            try:
                return "".join(chat.stream(msgs)).strip()
            except Exception:
                time.sleep(2 + attempt * 3)
        return ""

    def judge(c, reply):
        convo = "\n".join(f"{'对方' if m['role']=='user' else 'olo'}：{m['content']}" for m in c["history"])
        msg = f"之前的对话：\n{convo or '（无）'}\n对方：{c['user']}\n\nolo 的回复：\n{reply.replace('||', ' / ')}"
        for attempt in range(3):
            try:
                txt = "".join(judge_llm.stream([{"role": "system", "content": JUDGE}, {"role": "user", "content": msg}]))
                return json.loads(re.search(r"\{.*\}", txt, re.S).group(0))
            except Exception:
                time.sleep(2 + attempt * 3)
        return {"hits": [], "substance": "na", "error": True}

    def run(c):
        row = {"case": c}
        row["old"] = {"text": gen(prompts["old"][c["id"]])}
        draft = gen(prompts["new"][c["id"]])
        row["prompt"] = {"text": draft}
        t = time.perf_counter()
        g = guard_reply(RT, prompts["new"][c["id"]], c["user"], c["history"], draft)
        row["guard"] = {"text": g.text, "action": g.action, "guard_hits": g.hits, "guard_ms": round(g.guard_ms),
                        "regen_ms": round(g.regen_ms), "calls": g.calls, "total_ms": round((time.perf_counter() - t) * 1000)}
        for v in ("old", "prompt", "guard"):
            row[v]["judge"] = judge(c, row[v]["text"])
        print(c["id"], g.action, flush=True)
        return row

    with ThreadPoolExecutor(a.workers) as ex:
        rows = list(ex.map(run, cases))
    os.makedirs(a.out, exist_ok=True)
    json.dump(rows, open(os.path.join(a.out, "results.json"), "w"), ensure_ascii=False, indent=1)
    n = len(rows)
    rate = {v: {k: sum(any(h.get("cls") == k for h in r[v]["judge"].get("hits", [])) for r in rows) for k in CLS} for v in ("old", "prompt", "guard")}
    anyhit = {v: sum(bool(r[v]["judge"].get("hits")) for r in rows) for v in ("old", "prompt", "guard")}
    subst = {v: [r[v]["judge"].get("substance") for r in rows] for v in ("old", "prompt", "guard")}
    ms = sorted(r["guard"]["total_ms"] for r in rows)
    actions = {k: sum(r["guard"]["action"] == k for r in rows) for k in ("pass", "trim", "regen", "error")}
    summary = {"n": n, "replies_with_any_hit": anyhit, "per_class_replies": rate,
               "substance_no": {v: subst[v].count("no") for v in subst}, "substance_yes": {v: subst[v].count("yes") for v in subst},
               "guard_actions": actions, "guard_ms_p50": ms[n // 2], "guard_ms_p90": ms[int(n * 0.9)], "guard_ms_max": ms[-1],
               "guard_calls_avg": round(sum(r["guard"]["calls"] for r in rows) / n, 2),
               "avg_len": {v: sum(len(r[v]["text"]) for r in rows) // n for v in ("old", "prompt", "guard")}}
    json.dump(summary, open(os.path.join(a.out, "summary.json"), "w"), ensure_ascii=False, indent=1)
    print(json.dumps(summary, ensure_ascii=False))


if __name__ == "__main__":
    main()
