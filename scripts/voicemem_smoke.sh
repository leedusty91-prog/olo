#!/usr/bin/env bash
# 真实 key 冒烟：VoiceMem（API 模式）写入一条事实 -> 召回 -> 渲染成提示词。
# 用法：在仓库根目录，已 `cp .env.example .env` 并填好 OPENAI_* / EMBEDDING_*：
#   ./scripts/voicemem_smoke.sh
# 会调用几次 chat + embeddings 接口（费用极低）。记忆写在临时目录，结束即删除。
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd)
if [ -f .env ]; then set -a; . ./.env; set +a; fi
: "${OPENAI_API_KEY:?请先在 .env 里填 OPENAI_API_KEY}"
PY=${PYTHON:-$ROOT/server/.venv/bin/python}
[ -x "$PY" ] || PY=$(command -v python3)
case "$PY" in /*) ;; *) PY="$ROOT/$PY" ;; esac   # 下面会 cd server，必须是绝对路径
"$PY" -c "import voicemem, mem0" 2>/dev/null || {
  echo "缺依赖：cd server && pip install -e '.[memory-api]' && pip install --no-deps voicemem==0.2.3"; exit 1; }
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
export OLO_VOICEMEM_DIR="$TMP" MEM0_DIR="$TMP/mem0"
cd server
"$PY" - <<'PY'
from olo.memory.compat import build_memory_context
from olo.memory.voicemem_api import ApiVoiceMemAdapter, VoiceMemSettings, make_voicemem
s = VoiceMemSettings.from_env()
print(f"embedding={s.embedding_model}@{s.embedding_base_url or 'api.openai.com'} dims={s.embedding_dims}")
mem = ApiVoiceMemAdapter(make_voicemem(s), s)
mem.ingest_user(text="我对坚果过敏，我养了一只叫豆豆的柯基。", agent_reply="记住啦。",
                session_id="smoke", observed_at="2026-10-22T20:00:00+08:00")
mem.flush()
q = "我的狗叫什么名字？"
c = mem.classify(q)
r = mem.search(q, slots=list(c.slots), entities=list(c.entities))
print("slots:", c.slots, "entities:", c.entities)
print(build_memory_context(r) or "(空)")
import re
hits = list(r.result_leftbrain)
recalled = any(re.search(r"豆豆|dou\s*dou", t, re.I) for t in hits)
chinese = any("豆豆" in t for t in hits)
if not recalled:
    print("FAIL: 没有召回到宠物名（豆豆）"); raise SystemExit(1)
if not chinese:
    print("FAIL: 召回了，但记忆被翻译成了非中文（检查抽取语言）"); raise SystemExit(2)
print("OK: VoiceMem 端到端可用（中文写入 + 召回）")
PY
