#!/bin/sh
set -e
echo "[olo] running alembic migrations..."
alembic upgrade head
if [ "${OLO_SEED_DEMO:-0}" = "1" ]; then
  echo "[olo] seeding demo data..."
  python /app/scripts/seed_demo.py || echo "[olo] seed skipped"
fi
echo "[olo] starting API on :8000"
exec uvicorn olo.main:app --host 0.0.0.0 --port 8000 --workers 1
