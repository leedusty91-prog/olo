# olo · AI 情感陪伴应用（全栈）

> FastAPI + PostgreSQL + Alembic + Docker Compose 后端，Expo (React Native) 手机端，OpenAI 兼容大模型接口，可选 VoiceMem 本地长期记忆。
> 产品形态参考同类 AI 陪伴产品，代码、提示词、角色设定与美术均为原创。

`docker compose up` 一条命令即可在任意 Linux / macOS 上跑起来，打开 <http://127.0.0.1:8000> 就是带动画的网页版；**不填任何 API Key 也能完整演示**（内置离线 mock 大模型）。

<p align="center"><img src="docs/olo-demo.gif" width="300" alt="olo 演示：故事引导 → 起名选形态 → 流式聊天 → 花园 → 日记" /></p>

完整录屏（含合成音效与配乐）：[docs/olo-demo.mp4](docs/olo-demo.mp4)（由 Playwright e2e 测试自动录制）

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

网页前端在 [`web/`](web/)：原生 HTML/CSS/ES Module，无构建步骤，由 FastAPI 挂载在 `/app`。

### 美术方向：黄昏与台灯光

整体是**暖色像素风**，像傍晚回到家、台灯刚亮起的那一刻：琥珀、蜜桃、奶油、柔玫瑰、暖木为主色，青绿只作点缀（输入框焦点、青瓷/湖青配色）。所有画面共用一套色板与光源设定（左上方暖光 + 右侧暖色轮廓光），背景是 14 级细分的梅子→暖砖渐变和缓慢上升的火花。

- **olo 角色（重新设计，[`web/pixel.js`](web/pixel.js)）**：底部圆鼓、顶部收窄的「灯籽」轮廓，头顶一株会摆动的双叶嫩芽，芽尖是一粒随呼吸明灭的小灯苞；小手小脚、大眼睛带双高光、腮红。三种形态（小团子 / 云朵 / 微光）× 五种暖色配色，32×32 画布逐像素程序绘制，20fps：
  - **挤压拉伸与预备动作**：每次跳跃都有下蹲 → 拉伸起跳 → 空中 → 落地压扁 → 回弹；
  - **二级运动**：嫩芽按身体垂直速度滞后摆动，难过时耷拉、思考时卷起；
  - **待机小动作**（每 7 秒随机一段）：左右张望、小跳、转嫩芽、哼歌（♪）、打哈欠（Zz），外加随机连眨眼；
  - **情绪与表情符号**：开心（^^ + 爱心 + 闪光）、说话（四帧口型 + 手势）、难过（下垂眉 + 眼泪 + 水滴）、思考（侧身 + 抬眼 + …）。
- **像素故事分镜**（[`web/scenes.js`](web/scenes.js)）：落日里的城市、窗口升起暖雾 → 金色河面漂流的灯籽 → 芦婆婆撑船 → 暖光小屋里灯籽落进手机、olo 探出头。多层视差 + 逐帧粒子 + 震屏闪光。若放入 `web/assets/scenes/scene1.mp4`…`scene4.mp4` 会优先播放视频，缺失时回退到代码动画（见 [`web/assets/scenes/README.md`](web/assets/scenes/README.md)）；早先那批冷色调 AI 视频与新风格不符，已移除。
- **像素 UI 与动效**：阶梯像素边框对话框/按钮/气泡、带金边的方块擦除转场、按钮扫光与按压回弹、点击迸火花、标题后的旋转光芒、暖色暗角与灯光呼吸、气泡弹出；像素花园（黄昏、随等级生长的植物、路灯、萤火虫、新消息化作金色的雨）与像素笔记本日记。
- 支持手机竖屏；`prefers-reduced-motion` 下关闭逐帧动画、转场与粒子。
- 字体：[Fusion Pixel Font](https://github.com/TakWolf/fusion-pixel-font)（缝合像素字体，SIL OFL 1.1），随仓库附带许可证，见 [`web/fonts/`](web/fonts/)。

### 音效说明

[`web/audio.js`](web/audio.js) 用 WebAudio **实时合成**全部声音，仓库里没有任何音频文件，也没有第三方素材：

- **音效**：打字声、按钮悬停 / 按下、选项选择、转场（滤波噪声扫频 + 铃音）、破壳（裂纹 + 上行琶音）、olo 的开心 / 难过 / 思考反应、消息发送 / 收到、流式回复的轻敲、花园生长琶音与雨滴、日记翻页、出错提示。
- **环境音**：每个场景一段生成式小曲（和弦铺底 + 五声音阶铃音 / 八音盒），按场景换调式和音色，并叠加水声、晚风或虫鸣；切换场景时淡入淡出。旋律按拍号确定性生成，可无限延续不重复播放同一个循环。
- **静音开关**：右上角 ♪ 按钮（进入主界面后在顶栏），状态保存在 `localStorage["olo.muted"]`；浏览器要求首个用户手势后才会出声，主音量经压缩器限幅，默认音量适中。
- **演示视频的配乐**：e2e 测试会记录音效事件，再用同一套合成函数在 `OfflineAudioContext` 里重放成 WAV，与录屏合成为 `docs/olo-demo.mp4`。

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

### 如何开启真实记忆（VoiceMem，全部走 API）

olo 的长期记忆用 [VoiceMem](https://pypi.org/project/voicemem/) 0.2.3 的**文本模式**：事实抽取、查询分类走 Chat 接口（`OPENAI_MODEL`），向量走 `/embeddings` 接口，存储为 mem0 + 嵌入式 Qdrant 文件（docker 中在 `appdata` 卷的 `/app/data/voicemem`，重建容器不丢）。不装 torch、不下载任何本地模型；Docker 镜像默认已包含。

1. `cp .env.example .env`，填：
   - `LLM_PROVIDER=openai`、`OPENAI_API_KEY`、`OPENAI_BASE_URL`、`OPENAI_MODEL`
   - `OLO_MEMORY=auto`（默认，有 key 即启用）
   - 嵌入：OpenAI 直接留空复用即可（`text-embedding-3-small` / 1536）。**DeepSeek 没有嵌入接口**，需另指一家，例如通义：
     `EMBEDDING_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1`、`EMBEDDING_API_KEY=<DashScope key>`、`EMBEDDING_MODEL=text-embedding-v3`、`EMBEDDING_DIMENSIONS=1024`
2. `docker compose up -d --build`，`curl -s localhost:8000/healthz` 里记忆状态由 `warming` 变为 `ready`。
3. 用真 key 冒烟：`./scripts/voicemem_smoke.sh`（直接在本机 venv 里写入一条事实再召回，不经过 docker；会产生少量 API 费用）。

API 模式下的耗时（qwen-plus + text-embedding-v3，实测）：
- **每轮检索**：1 次 embedding，约 0.3–0.4 秒（查询分类用向量相似度，不调大模型；`OLO_MEMORY_CLASSIFIER=llm` 可改回 VoiceMem 原版 LLM 分类）。上限 `OLO_SEARCH_WAIT_S`（默认 3 秒）。
- **写入一条记忆**：后台线程执行，约 12–20 秒 = 2 次大模型（事实抽取 ~6s，写入侧打标签 ~1.5s）+ 约 6 次 embedding（事实、属性短语、实体、回复各一次）。写入期间**不阻塞检索**：只有嵌入式 Qdrant 的毫秒级读写串行加锁。刚说完的事实要等写入完成（约 15 秒）后才能被召回。
- 抽取时 olo 会给 VoiceMem 追加「保持用户原语言」的规则，中文对话存成中文记忆。

没有 key 或 `OLO_MEMORY=off` 时自动回落到内置 FakeMemory，对话照常。**注意**：`EMBEDDING_DIMENSIONS` 一旦写入就不能换模型，否则 VoiceMem 会拒绝写入；换模型请删除记忆目录。

### 本地开发与测试

```bash
cd server
python3.12 -m venv .venv && . .venv/bin/activate
pip install -e ".[dev,memory-api]" && pip install --no-deps voicemem==0.2.3   # API 版记忆，无 torch
export DATABASE_URL=postgresql://olo:change-me@127.0.0.1:5432/olo   # 任意可建库的 Postgres
pytest -q
```

测试会自建并销毁独立的 `olo_test` 库，覆盖：迁移升降级与 schema、鉴权、幂等、SSE 流式、限流、危机短路、记忆写入决策与审计、日记/洞察生成、额度与订阅、商店、主动关心、TTS/ASR 降级、健康检查不泄露密钥等。

**当前结果：后端 `132 passed`**（含 `test_voicemem_api.py`：用本地 mock 的 OpenAI 兼容接口跑真实 VoiceMem→mem0→Qdrant 写入、召回、进入提示词）（Python 3.13 + PostgreSQL 17 本地；CI 为 Python 3.12 + PostgreSQL 16）。

### 浏览器端到端测试（Playwright）

```bash
docker compose up -d --build
pip install -r e2e/requirements.txt && python -m playwright install chromium
OLO_SHOTS_DIR=docs/screenshots pytest e2e -q     # 可选 OLO_VIDEO_DIR=/tmp/video 录屏
```

覆盖：完整故事引导 → 起名/选形态/选颜色/选性子 → 流式聊天（断言回复在角色里、头像状态切换）→ 花园阶段与解锁故事 → 生成日记（额度用完时走模拟开通会员）→ 音效事件日志（转场、破壳、发送、收到、生长、翻页与各场景环境音）→ 刷新保持状态；手机视口跳过故事流程、无横向溢出、静音开关可切换且刷新后保持；错误 token 提示。**当前结果：`3 passed`**。CI 中在 `docker compose up` 后自动运行，并上传截图产物。

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
- VoiceMem 以纯文本模式运行：声纹、声学情绪、场景感知需要 torch，未启用（情绪改用关键词，语音转写走 API）。嵌入式 Qdrant 只支持单进程（已固定 `--workers 1`）。
- 内购为模拟实现，未接入应用商店收据校验。
