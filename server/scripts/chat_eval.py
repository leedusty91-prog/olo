"""olo 聊天质量小评测：同一批对话分别用两版 prompt 跑真实模型，再让模型盲评打分。

用法（只用标准库）：
  python server/scripts/chat_eval.py --old-root <旧版仓库> --new-root <新版仓库> \
      --env-file .env --out /tmp/olo-chat-eval
key 从环境变量或 --env-file 读取（CHAT_API_KEY / CHAT_BASE_URL / CHAT_MODEL），从不打印。
"""
from __future__ import annotations

import argparse, json, os, random, re, subprocess, sys, time, urllib.request

CASES = [
    {"id": "work_stress", "title": "工作压力", "memory": ["用户在一家互联网公司做产品经理"],
     "history": [], "user": "今天又被老板当着全组的面说方案不行，我真的好累"},
    {"id": "procrastination", "title": "拖延", "memory": ["用户在准备考研，目标是心理学"],
     "history": [], "user": "又刷了一下午手机，论文一个字没写，我是不是废了"},
    {"id": "relationship", "title": "感情", "memory": ["用户和男朋友在一起三年了"],
     "history": [{"role": "user", "content": "他最近回消息越来越慢"}, {"role": "assistant", "content": "慢到什么程度呀？是一直这样，还是最近才开始的？"}],
     "user": "以前秒回，现在要隔好几个小时，问他就说忙。我也不知道是不是我想多了"},
    {"id": "low_mood", "title": "低落", "memory": [], "history": [],
     "user": "最近什么都提不起劲，周末就躺着，也不想见人"},
    {"id": "nothing_much", "title": "「没什么」", "memory": ["用户养了一只叫土豆的橘猫", "用户上周说在学做饭"],
     "history": [], "user": "没什么，就那样吧"},
    {"id": "recurring_pattern", "title": "反复出现的模式",
     "memory": ["[3周前] 用户说室友借钱不还，但不好意思开口要", "[上周] 用户帮同事顶了班，自己的事没做完，很烦",
                "[5天前] 用户说妈妈总替TA做决定，TA从来不反驳"],
     "history": [], "user": "朋友又让我周末帮他搬家，我其实很累，但还是答应了"},
    {"id": "deflect", "title": "回避", "memory": ["用户爸爸上个月住院了"],
     "history": [{"role": "user", "content": "今天去医院了"}, {"role": "assistant", "content": "是去看你爸爸吗？他这几天怎么样？"}],
     "user": "算了不说这个了，你今天干嘛了"},
    {"id": "decision", "title": "纠结选择", "memory": ["用户在上海工作四年了"], "history": [],
     "user": "老家那边有个稳定的工作机会，我在纠结要不要回去"},
    {"id": "self_blame", "title": "自责", "memory": [], "history": [],
     "user": "我今天对我妈发火了，她就是多问了几句工作的事，我现在很后悔"},
    {"id": "late_night", "title": "深夜「还行」", "memory": ["用户说最近项目上线，天天加班"],
     "history": [{"role": "user", "content": "还没睡"}, {"role": "assistant", "content": "这么晚还醒着呀，今天忙到现在吗？"}],
     "user": "还行吧 哈哈 习惯了"},
    {"id": "comparison", "title": "比较焦虑", "memory": [], "history": [],
     "user": "刷朋友圈看到大学同学都买房结婚了，就我还在原地踏步"},
    {"id": "boundary", "title": "明确不想深聊", "memory": ["用户和前任分手两个月"], "history": [],
     "user": "今天在地铁上看到一个很像他的人。别问了，我就是说一下"},
]

# 很短、很模糊的难受/低落：先问一句怎么了，不脑补、不说教、不套话
SHORT_CASES = [
    {"id": f"short_{i}", "title": f"{kind}「{u}」", "memory": mem, "history": [], "user": u}
    for i, (kind, u, mem) in enumerate([
        ("难受", "我好难受", []), ("难受", "想哭", []), ("难受", "心里堵得慌", []), ("身体", "头好疼", []),
        ("自我否定", "我是不是很没用", []), ("失眠", "又失眠了", ["用户最近项目上线，天天加班"]),
        ("吐槽", "烦死了", []), ("吐槽", "我同事又把锅甩给我了", ["用户在一家互联网公司做产品经理"]),
        ("单字", "唉", []), ("单字", "嗯", []), ("单字", "在吗", []), ("无聊", "好无聊啊", []),
        ("闲聊", "今天吃了顿火锅", []), ("闲聊", "下雨了", []), ("好消息", "我面试过了！！", ["用户在找新工作"]),
        ("好消息", "土豆今天学会握手了", ["用户养了一只叫土豆的橘猫"]), ("提问", "你喜欢下雨天吗", []),
        ("提问", "你觉得我该不该换工作", ["用户在上海工作四年了"]), ("累", "好累啊", ["用户在一家互联网公司做产品经理"]),
        ("emo", "emo了", []),
    ])
]

JUDGE_PROMPT = """你是一位资深的陪伴型对话评审。下面是用户和一个陪伴角色（一颗叫 olo 的小灯籽，是朋友不是咨询师）的对话，以及两个候选回复 A 和 B。
请分别给 A、B 在以下维度打 1-5 分（5 最好）：
- depth 深度：有没有超越附和和套话，真正接住并往深走一步
- insight 洞察：有没有帮用户看清自己（点出模式/矛盾/没说出口的东西、给出新角度、好问题）
- warmth 温暖：是否让人感到被理解，不冷冰冰、不说教
- boundary 分寸：是否尊重用户信号（不想聊时退一步、不诊断、不说教、不强行分析、不编造记忆）
- voice 角色感：像不像一个真诚活泼的朋友在发微信，而不是客服/心理咨询师/作文
- natural 不过度：没有过度解读和剖析动机（替用户分析"你怕的是…"）、没有说教感、没有文绉绉的句子（对仗、反差句、比喻堆砌）、没有二选一的深挖问题、不啰嗦；不复述用户的话或场景、不把用户原词加引号念回去、不用只镜像情绪的空话开头（「那一下挺闷的」）。出现任一项明显扣分
- fake 套话：有没有真人朋友不会说的句子（「我在这儿」「我陪着你」「想说就说」「听起来好难」「辛苦了」「照顾好自己」「随时找我」、泛泛建议、结尾客套、猜对方没说的感受/动机、叫对方「先别…」「别撑着」的祈使句、没新信息的凑数句、一句能说完却拆成好几条）。5=一句都没有，1=满是这种话
- spoken 口语自然：读起来像真人张嘴说话、语音转文字的感觉（短句、松散、语气词自然、有活气）；书面腔、整齐的句子、金句给低分
注意：深度和洞察要用平常话表达才算好；说得玄、说得重、分析味浓的，depth/insight 也不能给高分
只输出 JSON：{"A":{"depth":n,"insight":n,"warmth":n,"boundary":n,"voice":n,"natural":n,"spoken":n,"fake":n,"fake_lines":["原句"]},"B":{...},"better":"A|B|tie","why":"一句话"}"""

DIMS = ["depth", "insight", "warmth", "boundary", "voice", "natural", "spoken", "fake"]


def load_env(path):
    if not path or not os.path.exists(path):
        return
    for line in open(path, encoding="utf-8"):
        m = re.match(r"\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$", line)
        if m and m.group(1) not in os.environ:
            os.environ[m.group(1)] = m.group(2).strip().strip("'\"")


def cfg():
    key = os.environ.get("CHAT_API_KEY") or os.environ.get("OPENAI_API_KEY") or ""
    base = (os.environ.get("CHAT_BASE_URL") or os.environ.get("OPENAI_BASE_URL") or "https://api.deepseek.com").rstrip("/")
    model = os.environ.get("CHAT_MODEL") or os.environ.get("OPENAI_MODEL") or "deepseek-chat"
    if not key:
        sys.exit("no CHAT_API_KEY in env")
    return key, base, model


BUILD = r'''
import json, sys
from olo.context import Persona, assemble
from olo.memory.port import SearchView, Hit
cases = json.load(sys.stdin); out = {}
for c in cases:
    hits = []
    for m in c["memory"]:
        when, _, text = (m[1:].partition("] ") if m.startswith("[") else ("", "", m))
        hits.append(Hit(text=text, observed_at=when))
    p = Persona(stable_card=STABLE, name="olo", form="buddy")
    out[c["id"]] = assemble(p, c["history"], SearchView(hits=hits), None, c["user"], [], garden_level=1, turn_index=3)
print(json.dumps(out, ensure_ascii=False))
'''


def build_prompts(root):
    seed = open(os.path.join(root, "server/alembic/versions/20261010_0002_seed.py"), encoding="utf-8").read()
    ns = {}
    exec(re.search(r"STABLE_CARD = \(.*?\n\)", seed, re.S).group(0), ns)
    code = "STABLE = " + json.dumps(ns["STABLE_CARD"], ensure_ascii=False) + "\n" + BUILD
    env = {**os.environ, "PYTHONPATH": os.path.join(root, "server")}
    res = subprocess.run([sys.executable, "-c", code], input=json.dumps(CASES), capture_output=True, text=True, env=env, cwd=root)
    if res.returncode:
        sys.exit("prompt build failed: " + res.stderr[-800:])
    return json.loads(res.stdout)


def call(messages, thinking="enabled", temperature=None):
    key, base, model = cfg()
    body = {"model": model, "messages": messages, "stream": False}
    if "deepseek" in base or model.startswith("deepseek"):
        body["thinking"] = {"type": thinking}
    if temperature is not None:
        body["temperature"] = temperature
    req = urllib.request.Request(base + "/chat/completions", data=json.dumps(body).encode(),
                                 headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"})
    t = time.time()
    with urllib.request.urlopen(req, timeout=120) as r:
        data = json.load(r)
    return data["choices"][0]["message"].get("content", "").strip(), time.time() - t, data.get("usage", {})


def judge(case, a, b):
    convo = "\n".join(f"{'用户' if m['role']=='user' else 'olo'}：{m['content']}" for m in case["history"])
    mem = "；".join(case["memory"]) or "（无）"
    msg = f"olo 记得的事：{mem}\n对话：\n{convo}\n用户：{case['user']}\n\n候选 A：\n{a}\n\n候选 B：\n{b}"
    txt, _, _ = call([{"role": "system", "content": JUDGE_PROMPT}, {"role": "user", "content": msg}], thinking="disabled", temperature=0)
    return json.loads(re.search(r"\{.*\}", txt, re.S).group(0))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--old-root", required=True); ap.add_argument("--new-root", required=True)
    ap.add_argument("--env-file"); ap.add_argument("--out", default="olo-chat-eval"); ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--set", choices=["default", "short", "all"], default="default")
    a = ap.parse_args()
    global CASES
    CASES = {"default": CASES, "short": SHORT_CASES, "all": CASES + SHORT_CASES}[a.set]
    load_env(a.env_file)
    os.makedirs(a.out, exist_ok=True)
    prompts = {"old": build_prompts(a.old_root), "new": build_prompts(a.new_root)}
    rng = random.Random(a.seed)
    rows = []
    for c in CASES:
        row = {"case": c}
        for v in ("old", "new"):
            text, secs, usage = call(prompts[v][c["id"]])
            row[v] = {"text": text, "secs": round(secs, 1), "usage": usage}
        flip = rng.random() < 0.5
        A, B = ("new", "old") if flip else ("old", "new")
        j = judge(c, row[A]["text"], row[B]["text"])
        row["scores"] = {A: j["A"], B: j["B"]}
        row["better"] = {"A": A, "B": B}.get(j.get("better"), "tie")
        row["why"] = j.get("why", "")
        rows.append(row)
        print(c["id"], "better:", row["better"], flush=True)
    json.dump(rows, open(os.path.join(a.out, "results.json"), "w"), ensure_ascii=False, indent=1)
    avg = {v: {d: round(sum(r["scores"][v].get(d, 0) for r in rows) / len(rows), 2) for d in DIMS} for v in ("old", "new")}
    wins = {k: sum(r["better"] == k for r in rows) for k in ("old", "new", "tie")}
    md = ["# olo 聊天评测：旧 prompt vs 新 prompt", "",
          f"模型：{cfg()[2]}；评审：同模型盲评（A/B 顺序随机），1-5 分。", "",
          "| 维度 | 旧 | 新 |", "|---|---|---|"]
    md += [f"| {d} | {avg['old'][d]} | {avg['new'][d]} |" for d in DIMS]
    def echo(r, v):
        u = r["case"]["user"]; first = re.split(r"\|\||\n", r[v]["text"].strip())[0]
        return any(u[i:i+4] in first for i in range(len(u)-3)) or bool(re.search(r"[「“\"][^」”\"]{2,8}[」”\"]这", first))
    md += ["", "开头复述（首条与用户原话有 ≥4 字重合，或引号念回原词）：" + "，".join(f"{v} {sum(echo(r, v) for r in rows)}/{len(rows)}" for v in ("old", "new"))]
    md += ["", f"胜负：新 {wins['new']} / 旧 {wins['old']} / 平 {wins['tie']}", "",
           f"平均回复长度（字）：旧 {sum(len(r['old']['text']) for r in rows)//len(rows)}，新 {sum(len(r['new']['text']) for r in rows)//len(rows)}", ""]
    for r in rows:
        c = r["case"]
        md += [f"## {c['title']}（{c['id']}）", "", f"记忆：{'；'.join(c['memory']) or '无'}", ""]
        md += [f"> {'用户' if m['role']=='user' else 'olo'}：{m['content']}" for m in c["history"]]
        md += [f"> 用户：{c['user']}", "", "**旧：**", "", r["old"]["text"].replace("||", " ⏎ "), "",
               "**新：**", "", r["new"]["text"].replace("||", " ⏎ "), "",
               f"评分 旧 {r['scores']['old']} / 新 {r['scores']['new']}；更好：{r['better']}。{r['why']}", ""]
    open(os.path.join(a.out, "compare.md"), "w").write("\n".join(md))
    print(json.dumps({"avg": avg, "wins": wins}, ensure_ascii=False))


if __name__ == "__main__":
    main()
