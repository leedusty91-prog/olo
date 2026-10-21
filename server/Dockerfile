FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg curl \
 && rm -rf /var/lib/apt/lists/*

# Layout: /app/server (code), /app/data (runtime files, mounted volume)
WORKDIR /app/server
COPY server/pyproject.toml ./
COPY server/olo ./olo
COPY server/safety ./safety
RUN pip install .
COPY server/alembic.ini ./
COPY server/alembic ./alembic
COPY scripts/seed_demo.py /app/scripts/seed_demo.py
COPY web /app/web
COPY server/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
 && useradd --create-home --uid 10001 app \
 && mkdir -p /app/data && chown -R app /app
USER app

EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD curl -fsS http://127.0.0.1:8000/healthz || exit 1
ENTRYPOINT ["docker-entrypoint.sh"]
