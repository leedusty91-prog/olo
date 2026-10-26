#!/usr/bin/env bash
# Send one test turn without touching the user's memory: X-OLO-Source: test plus a test- id.
# The server stores it as source=test; VoiceMem ingest, remember_reply and batch capture all skip it.
# Usage: scripts/test_turn.sh "text" [base_url] [token]
set -euo pipefail
TEXT="${1:?text}"; BASE="${2:-http://127.0.0.1:8010}"; TOKEN="${3:-${OLO_API_TOKEN:-change-me-dev-token}}"
AUTH=(-H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json" -H "X-OLO-Source: test")
SID=$(curl -fsS -X POST "${AUTH[@]}" "$BASE/v1/sessions" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
python3 -c "import json,sys; print(json.dumps({'client_msg_id': 'test-' + sys.argv[1], 'text': sys.argv[2]}))" "$(date +%s%N)" "$TEXT" |
  curl -fsS -X POST "${AUTH[@]}" -H "Accept: application/json" -d @- "$BASE/v1/sessions/$SID/turns"; echo
