# olo · AI 情感陪伴应用（全栈）

> FastAPI + PostgreSQL + Alembic + Docker Compose 后端，Expo (React Native) 手机端，OpenAI 兼容大模型接口，可选 VoiceMem 本地长期记忆。
> 产品形态参考同类 AI 陪伴产品，代码、提示词、角色设定与美术均为原创。

`docker compose up` 一条命令即可在任意 Linux / macOS 上跑起来，打开 <http://127.0.0.1:8000> 就是带动画的网页版；**不填任何 API Key 也能完整演示**（内置离线 mock 大模型）。

<p align="center"><img src="docs/olo-demo.gif" width="300" alt="olo 演示：故事引导 → 起名选形态 → 流式聊天 → 花园 → 日记" /></p>

完整录屏：[docs/olo-demo.mp4](docs/olo-demo.mp4)（由 Playwright e2e 测试自动录制）

## olo 的故事

> 城市里每一句没说出口的话，都会化成雾，飘到一片叫**雾里集**的河湾，凝成发光的**灯籽**。摆渡人**芦婆婆**撑着小船，把其中一粒送到了你身边，它就是 olo。
> olo 只有纽扣大，靠「被听见的话」长大：你说的每句话都会变成一滴雨，落进你们的小花园；写日记会发芽，被看懂会开花，聊得越久，解锁的小故事越多。

完整世界观、性格与说话规矩见 [docs/story.md](docs/story.md)。故事卡（`server/olo/story.py`）会拼进每一轮 system prompt，相遇时取的名字也会写入人设，保证接真实大模型时回复依然「在角色里」；离线 mock 模式同样按故事口吻回复。

## 网页版截图

| 故事开场 | 芦婆婆的小船 | 破壳相遇 | 选样子 |
| --- | --- | --- | --- |
| ![](docs/screenshots/01-title.png) | ![](docs/screenshots/04-story-3.png) | ![](docs/screenshots/06-hatch.png) | ![](docs/screenshots/08-form.png) |
| **选性子** | **流式聊天** | **花园与解锁故事** | **olo 的日记** |
| ![](docs/screenshots/09-tone.png) | ![](docs/screenshots/11-chat.png) | ![](docs/screenshots/12-garden.png) | ![](docs/screenshots/13-diary.png) |

网页前端在 [`web/`](web/)：原生 HTML/CSS/ES Module，无构建步骤，由 FastAPI 挂载在 `/app`。整体是**像素风**：

- **原创像素角色**：灯籽 olo（头顶嫩芽）在 32×32 画布上逐像素程序绘制，三种形态（小团子 / 云朵 / 光点）× 五种配色，逐帧动画包含待机、眨眼、说话、开心、难过、思考，随流式回复与用户情绪切换（[`web/pixel.js`](web/pixel.js)）。
- **像素故事分镜**（[`web/scenes.js`](web/scenes.js)）：城市雾气升起 → 河面漂流的灯籽 → 芦婆婆撑船 → 灯籽落进屏幕，视差 + 逐帧动画 + 粒子。若放入 `web/assets/scenes/scene1.mp4`…`scene4.mp4`，会自动改为循环播放视频，缺失时回退到代码动画（见 [`web/assets/scenes/README.md`](web/assets/scenes/README.md)）。
- **像素 UI 与动效**：阶梯像素边框对话框/按钮/气泡、方块擦除转场、星空粒子与鼠标视差、发光、震屏、按压回弹、气泡弹出；像素花园（随等级生长的植物、路灯、萤火虫、新消息化作雨滴）与像素笔记本日记。
- 支持手机竖屏；`prefers-reduced-motion` 下关闭逐帧动画与转场。
- 字体：[Fusion Pixel Font](https://github.com/TakWolf/fusion-pixel-font)（缝合像素字体，SIL OFL 1.1），随仓库附带许可证，见 [`web/fonts/`](web/fonts/)。

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

启动后浏览器打开 <http://127.0.0.1:8000>（网页版）或 <http://127.0.0.1:8000/docs>（API 文档）。


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

**当前结果：后端 `128 passed`**（Python 3.13 + PostgreSQL 17 本地；CI 为 Python 3.12 + PostgreSQL 16）。

### 浏览器端到端测试（Playwright）

```bash
docker compose up -d --build
pip install -r e2e/requirements.txt && python -m playwright install chromium
OLO_SHOTS_DIR=docs/screenshots pytest e2e -q     # 可选 OLO_VIDEO_DIR=/tmp/video 录屏
```

覆盖：完整故事引导 → 起名/选形态/选颜色/选性子 → 流式聊天（断言回复在角色里、头像状态切换）→ 花园阶段与解锁故事 → 生成日记（额度用完时走模拟开通会员）→ 刷新保持状态；手机视口跳过故事流程且无横向溢出；错误 token 提示。**当前结果：`3 passed`**。CI 中在 `docker compose up` 后自动运行，并上传截图产物。

### 手机端

```bash
cd apps/mobile && npm install && npx expo start
```

在 App「设置」里填 API 地址（如 `http://<电脑局域网IP>:8000`，需打开"允许明文"）和 `OLO_API_TOKEN`。

## 功能清单（均已实现并有测试）

- 动画网页版：分镜式故事引导、起名/选形态/选性子、流式聊天、花园、日记
- 原创世界观（雾里集、芦婆婆、灯籽），进入 system prompt；花园里程碑解锁小故事
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
web/               动画网页前端（FastAPI 挂载于 /app）
e2e/               Playwright 端到端测试
docs/story.md      olo 原创世界观
server/            FastAPI 后端（olo/ 业务、safety/ 安全词、alembic/ 迁移、tests/ 测试、Dockerfile）
apps/mobile/       Expo SDK 52 手机端
scripts/           seed_demo.py 演示数据、smoke.sh 冒烟测试
docker-compose.yml postgres + api
.github/workflows/ CI：pytest(+postgres 服务)、docker compose 冒烟 + Playwright e2e、手机端 tsc 类型检查
```

## 已知限制

- 单用户模型（种子用户），多用户/多租户未实现。
- docker compose 默认 `OLO_WEB_EMBED_TOKEN=1`，网页会自动拿到 API token，仅适合本机演示；部署到公网前请关闭并改用登录。
- 真实长期记忆依赖 VoiceMem 及本地模型，默认 Docker 镜像不包含（`OLO_MEMORY_ENABLED=0`，使用 FakeMemory）。
- 内购为模拟实现，未接入应用商店收据校验。
