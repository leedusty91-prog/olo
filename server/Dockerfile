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
# OLO_VOICEMEM=1 (默认): 装 API 版 VoiceMem 长期记忆（mem0 + 嵌入式 Qdrant，无 torch）。
# voicemem 用 --no-deps 安装，跳过它声明的 torch/funasr 等本地模型依赖。
ARG OLO_VOICEMEM=1
RUN if [ "$OLO_VOICEMEM" = "1" ]; then \
      pip install ".[memory-api]" && pip install --no-deps voicemem==0.2.3; \
    else pip install .; fi \
 && ! python -c "import torch" 2>/dev/null
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
