#!/usr/bin/env bash
# 端到端冒烟：健康检查 → 建会话 → 发一轮对话 → 读历史 → 生成日记 → 花园成长
# 用法: ./scripts/smoke.sh [base_url] [token]
set -euo pipefail
BASE="${1:-http://127.0.0.1:8000}"
TOKEN="${2:-${OLO_API_TOKEN:-change-me-dev-token}}"
AUTH=(-H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json")
j() { python3 -c "import json,sys; print(json.load(sys.stdin)$1)"; }

echo "== healthz";  curl -fsS "$BASE/healthz"; echo
echo "== readyz";   curl -fsS "$BASE/readyz"; echo
echo "== 未带 token 应返回 401"
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/v1/sessions"); echo "$code"; [ "$code" = "401" ]
SID=$(curl -fsS -X POST "${AUTH[@]}" "$BASE/v1/sessions" | j "['id']")
echo "== session $SID"
echo "== turn"
curl -fsS -X POST "${AUTH[@]}" -H "Accept: application/json" \
  -d "{\"client_msg_id\":\"smoke-$(date +%s)\",\"text\":\"今天加班到很晚，有点累\"}" \
  "$BASE/v1/sessions/$SID/turns"; echo
echo "== messages"; curl -fsS "${AUTH[@]}" "$BASE/v1/sessions/$SID/messages"; echo
echo "== 免费额度用完时日记生成返回 402（配额由服务端控制），先模拟开通会员"
curl -fsS -X POST "${AUTH[@]}" -d '{"plan":"monthly"}' "$BASE/v1/subscription/activate"; echo
echo "== notebook/generate"
curl -fsS -X POST "${AUTH[@]}" -d "{\"session_id\":\"$SID\"}" "$BASE/v1/notebook/generate"; echo
echo "== garden"; curl -fsS "${AUTH[@]}" "$BASE/v1/garden"; echo
echo "SMOKE OK"
