#!/usr/bin/env bash
# 端到端冒烟：健康检查 → 建会话 → 发一轮对话 → 读历史 → 生成日记 → 花园成长
# 用法: ./scripts/smoke.sh [base_url] [token]
set -euo pipefail
BASE="${1:-http://127.0.0.1:8000}"
TOKEN="${2:-${OLO_API_TOKEN:-change-me-dev-token}}"
# X-OLO-Source: test keeps smoke turns out of the user's memory (olo.provenance); never use the user's words here.
AUTH=(-H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json" -H "X-OLO-Source: test")
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
code=$(curl -sS -o /tmp/olo-smoke-activate.json -w '%{http_code}' -X POST "${AUTH[@]}" -d '{"plan":"monthly"}' "$BASE/v1/subscription/activate")
cat /tmp/olo-smoke-activate.json; echo
# 403 = dev activation is off (OLO_DEV_SUBSCRIPTIONS=0, the production default).
case "$code" in 2*|403) ;; *) echo "subscription/activate failed: $code"; exit 1;; esac
echo "== notebook/generate"
gen=$(curl -sS -o /tmp/olo-smoke-diary.json -w '%{http_code}' -X POST "${AUTH[@]}" -d "{\"session_id\":\"$SID\"}" "$BASE/v1/notebook/generate")
cat /tmp/olo-smoke-diary.json; echo
# Without olo+ the quota gate answers 402 PAYWALL; that is the expected, working path.
case "$gen" in 2*) ;; 402) [ "$code" = 403 ] || { echo "notebook/generate 402 despite olo+"; exit 1; };; *) echo "notebook/generate failed: $gen"; exit 1;; esac
echo "== garden"; curl -fsS "${AUTH[@]}" "$BASE/v1/garden"; echo
echo "SMOKE OK"
