# olo · AI 情感陪伴应用（全栈）

> FastAPI + PostgreSQL + Alembic + Docker Compose 后端，Expo (React Native) 手机端，OpenAI 兼容大模型接口，可选 VoiceMem 本地长期记忆。
> 产品形态参考同类 AI 陪伴产品，代码、提示词、角色设定与美术均为原创。

`docker compose up` 一条命令即可在任意 Linux / macOS 上跑起来；**不填任何 API Key 也能完整演示**（内置离线 mock 大模型）。

---

## 1. 需求

| 需求 | 落地要点 |
| --- | --- |
| 有温度、不跑偏的陪伴对话 | 稳定人设卡 + 情绪感知语气 + 可选性格（好奇/安静/损友），用户输入不能改写身份 |
| 记得用户 | 每轮对话先检索长期记忆，再决定是否写入；写入决策落审计表 |
| 安全 | 危机词短路（不经过模型，直接给出求助信息）、Bearer Token 鉴权、限流、`/metrics` 仅回环访问 |
| 非聊天产物 | 日记卡片、个人洞察、「花园」成长、主动关心（定时 check-in） |
| 商业化雏形 | 免费额度 / 会员（模拟开通）、代币商店解锁外观，额度全部由服务端判定 |
| 可部署、可验证 | Docker Compose 一键启动、Alembic 迁移、pytest + GitHub Actions |

## 2. 方案（架构）

```mermaid
flowchart LR
  subgraph Client
    M[Expo 手机端<br/>陪伴/日记/洞察/花园/我的]
    C[curl / smoke.sh]
  end
  subgraph API["FastAPI (server/olo)"]
    A[Bearer 鉴权 + 限流] --> T[turns: 一轮对话]
    T --> S{safety<br/>危机词?}
    S -- 是 --> R1[固定求助回复]
    S -- 否 --> MEM[记忆检索<br/>Memory Port]
    MEM --> CTX[context.assemble<br/>人设+语气+记忆+承诺]
    CTX --> LLM[LLM 适配层]
    LLM --> SAL[salience: 是否写入记忆]
    SAL --> AUD[(memory_write_audit<br/>turn_traces)]
    N[notebook / insights] --> LLM
    G[garden / shop / subscription / check-ins]
  end
  LLM -->|LLM_PROVIDER=mock| MOCK[DemoChat 离线确定性回复]
  LLM -->|OpenAI 兼容| EXT[OpenAI / DeepSeek / 通义 / vLLM / Ollama]
  MEM -->|可选| VM[VoiceMem 本地长期记忆]
  MEM -->|默认| FM[FakeMemory]
  M & C --> A
  API --> PG[(PostgreSQL 16<br/>Alembic 8 个迁移)]
```

关键设计：

- **端口/适配器**：记忆（`memory/port.py`）、大模型（`llm.py` / `demo.py`）、ASR、TTS、图片生成都通过 `Runtime` 注入，测试里全部替换为假实现，不依赖外网。
- **幂等**：每轮对话带 `client_msg_id`，`turn_requests` 表去重，客户端重试不会产生重复消息。
- **流式**：`Accept: text/event-stream` 时以 SSE 逐 token 返回；首 token 超时自动降级。
- **审计**：每轮的检索耗时、命中数、降级原因写 `turn_traces`；每次"写不写记忆、为什么"写 `memory_write_audit`。
- **配置全部走环境变量**，见 [`.env.example`](.env.example)，仓库内无任何密钥。

## 3. 用 Claude Code / Codex 实现

开发方式是「人定需求与验收标准，AI 编码代理实现，测试兜底」：

1. **先写验收**：每个功能先用中文写清接口契约与边界（如"额度用完返回 402"、"危机词不进模型"），再让 Claude Code / Codex 先写 pytest 用例。
2. **小步实现**：让代理按模块（sessions → turns → notebook → subscription → shop …）逐个实现，每步跑 `pytest` 通过才进入下一步；数据库变更一律通过新的 Alembic 迁移。
3. **人工把关**：重点审查提示词注入面（记忆/用户输入只是"资料"不是"指令"）、鉴权、错误信息里不回显密钥（有专门测试）。
4. **代理约定**写在 [`AGENTS.md`](AGENTS.md)（Codex）/ [`CLAUDE.md`](CLAUDE.md)（Claude Code），保证换工具也遵循同一套规则。

## 4. 验证

### 一键启动（Docker）

```bash
git clone https://github.com/leedusty91-prog/olo.git && cd olo
docker compose up -d --build        # postgres + api，启动时自动 alembic upgrade head 并写入演示数据
./scripts/smoke.sh                  # 端到端冒烟：健康检查 → 鉴权 → 对话 → 历史 → 日记 → 花园
```

默认 `LLM_PROVIDER=mock`，无需任何 Key。接真实模型：`cp .env.example .env`，填 `LLM_PROVIDER=openai`、`OPENAI_API_KEY`、`OPENAI_BASE_URL`、`OPENAI_MODEL`（DeepSeek / 通义千问等 OpenAI 兼容接口均可），再 `docker compose up -d`。

API 文档：<http://127.0.0.1:8000/docs>

### 本地开发与测试

```bash
cd server
python3.12 -m venv .venv && . .venv/bin/activate
pip install -e ".[dev]"            # 需要长期记忆再加 .[memory]（会装 torch，较大）
export DATABASE_URL=postgresql://olo:change-me@127.0.0.1:5432/olo   # 任意可建库的 Postgres
pytest -q
```

测试会自建并销毁独立的 `olo_test` 库，覆盖：迁移升降级与 schema、鉴权、幂等、SSE 流式、限流、危机短路、记忆写入决策与审计、日记/洞察生成、额度与订阅、商店、主动关心、TTS/ASR 降级、健康检查不泄露密钥等。

**当前结果：`116 passed`**（Python 3.13 + PostgreSQL 17 本地；CI 为 Python 3.12 + PostgreSQL 16）。

### 手机端

```bash
cd apps/mobile && npm install && npx expo start
```

在 App「设置」里填 API 地址（如 `http://<电脑局域网IP>:8000`，需打开"允许明文"）和 `OLO_API_TOKEN`。

## 功能清单（均已实现并有测试）

- 文本对话（JSON / SSE 流式），会话与历史消息
- 人设卡 + 3 种性格 + 情绪语气调节 + 3 种形态外观（颜色/眼睛/腮红/发饰/声音）
- 长期记忆检索与写入决策（事实、关系、承诺、情绪峰值），写入审计
- 「我答应过的事」承诺追踪，自动注入下一轮上下文
- 危机词安全短路
- 日记卡片 / 个人洞察生成（可选文生图配图）
- 花园成长等级与里程碑
- 主动关心 check-in（定时到期写入会话，可生成语音留言）
- 免费额度 / 会员（模拟内购）/ 代币商店
- 语音：上传语音转写（需 VoiceMem）、WebSocket 流式 ASR 接口（演示模式为假实现）、TTS 语音回复（OpenAI 兼容 `/audio/speech`，失败回落文字）
- `/healthz`、`/readyz`（DB/记忆状态）、`/metrics`（Prometheus 文本，仅回环）

## 目录

```
server/            FastAPI 后端（olo/ 业务、safety/ 安全词、alembic/ 迁移、tests/ 测试、Dockerfile）
apps/mobile/       Expo SDK 52 手机端
scripts/           seed_demo.py 演示数据、smoke.sh 冒烟测试
docker-compose.yml postgres + api
.github/workflows/ CI：pytest(+postgres 服务)、docker compose 冒烟、手机端 tsc 类型检查
```

## 已知限制

- 单用户模型（种子用户），多用户/多租户未实现。
- 真实长期记忆依赖 VoiceMem 及本地模型，默认 Docker 镜像不包含（`OLO_MEMORY_ENABLED=0`，使用 FakeMemory）。
- 内购为模拟实现，未接入应用商店收据校验。
