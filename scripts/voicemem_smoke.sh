#!/usr/bin/env bash
# 真实 key 冒烟：VoiceMem（API 模式）写入一条事实 -> 召回 -> 渲染成提示词。
# 用法：在仓库根目录，已 `cp .env.example .env` 并填好 OPENAI_* / EMBEDDING_*：
#   ./scripts/voicemem_smoke.sh
# 会调用几次 chat + embeddings 接口（费用极低）。记忆写在临时目录，结束即删除。
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -f .env ]; then set -a; . ./.env; set +a; fi
: "${OPENAI_API_KEY:?请先在 .env 里填 OPENAI_API_KEY}"
PY=${PYTHON:-server/.venv/bin/python}
[ -x "$PY" ] || PY=python3
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
ok = any("豆豆" in t for t in r.result_leftbrain)
print("OK: VoiceMem 端到端可用" if ok else "FAIL: 没有召回到“豆豆”")
raise SystemExit(0 if ok else 1)
PY
