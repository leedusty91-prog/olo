# 陪你学：olo 的轻量学习陪伴（设计方案）

状态：方案，未实现。范围：server/olo + web/app，不新增独立"学习页"。

## 1. 一句话

你跟 olo 说想学什么，olo 记住目标和进度；平时聊天时，偶尔像朋友一样顺口问你一两个点，帮你复习。olo 还是朋友，不是学习软件：没有课程表、没有打卡、没有分数墙。

## 2. 设计原则（直接沿用现有语音规则）

现有 `server/olo/guard.py` 的七类禁止句子同样适用于学习场景，并额外约束：

- **不讲课**：olo 不主动长篇讲解；用户问了才答，答完就停。
- **不说教、不鼓励套话**：没有"加油""你已经很棒了""坚持就是胜利"。
- **不替用户定性**："学累了吧""是不是有点难"都算 narrate_feeling / guess_cause。
- **不给二选一**：不问"今天复习还是学新的？"，只问一个具体问题。
- **不给泛泛建议**：不说"每天坚持 20 分钟"。
- **复习要稀少**：默认每天最多 1 次、同一话题间隔不少于 2 天；用户情绪低落、在聊正事、深夜安静时段（沿用 `proactive.py` 的 23:00–08:00）一律不插。
- **复习像随口一问**：一句话，带 olo 自己的口吻，答错了不纠正成课堂，顺手说一句正确的就过去。

## 3. 用户体验：对话示例

**① 设定目标（自然说出口即可，无表单）**

> 用户：我打算下个月去大阪，想学点日语
> olo：去大阪好啊！你现在会几句？
> 用户：只会 arigatou
> olo：那我先记着：日语，从点餐和问路开始。你会"这个多少钱"怎么说吗？

（后台：新建 learning_goal "日语-旅行会话"，种下 3–5 个起始知识点。）

**② 两天后，聊别的时顺口复习（低频）**

> 用户：今天中午吃了拉面
> olo：哪家？对了，在大阪点拉面想要"一碗这个"，你还记得怎么说吗？
> 用户：kore hitotsu kudasai？
> olo：对！我刚在镜湖边练了半天都没你说得顺。

**③ 答错时，不变成课堂**

> olo：上回那个"多少钱"还记得吗？
> 用户：ikura... desu ka? 不确定
> olo：就是 ikura desu ka，你说对了一大半。

（后台：该点记为"模糊"，间隔缩短。）

**④ 用户不想复习，立刻收手**

> olo：上次的 kudasai 还记得吗？
> 用户：别考我了今天好烦
> olo：好，不考。烦什么？

（后台：该目标暂停 3 天；连续两次拒绝则改为"只在用户主动提起时出现"。）

English example:

> User: I want to get better at Python decorators
> olo: Nice. What made you pick decorators?
> …(3 days later)… olo: Random thought — what does `functools.wraps` actually fix? I forgot.

## 4. 数据模型（Postgres，新 alembic 迁移）

```sql
CREATE TABLE learning_goals (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  topic text NOT NULL,            -- "日语-旅行会话"
  why text,                        -- 用户原话里的动机（"下个月去大阪"）
  lang text NOT NULL DEFAULT 'zh', -- 复习时用的语言
  status text NOT NULL DEFAULT 'active', -- active / paused / done / dropped
  paused_until timestamptz,
  refusals int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE learning_items (
  id uuid PRIMARY KEY,
  goal_id uuid NOT NULL REFERENCES learning_goals(id) ON DELETE CASCADE,
  prompt text NOT NULL,     -- "这个多少钱"
  answer text NOT NULL,     -- "ikura desu ka"
  source_message_id uuid,   -- 来自哪条对话（可追溯）
  mastery real NOT NULL DEFAULT 0,      -- 0..1，简化版知识追踪
  ease real NOT NULL DEFAULT 2.5,       -- SM-2 ease
  interval_days real NOT NULL DEFAULT 1,
  due_at timestamptz NOT NULL,
  last_result text,         -- right / fuzzy / wrong / skipped
  reviews int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE learning_reviews (
  id uuid PRIMARY KEY,
  item_id uuid NOT NULL REFERENCES learning_items(id) ON DELETE CASCADE,
  asked_message_id uuid,
  result text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

调度用简化 SM-2：right → interval × ease；fuzzy → interval 不变、ease −0.15；wrong → interval = 1 天；skipped 不计分只推迟。每个 goal 同时"在途"的 item ≤ 20，避免变成题库。

## 5. 复习何时、如何触发

**入口一：聊天内顺带（主路径）。** 在 `turns.py` 组 prompt 时调用 `learning.pick_review(conn, now, user_text, recent)`，满足全部条件才返回 1 个 item：

1. 今天还没问过（全局 ≤1 次/天）；同一 goal 距上次 ≥2 天；
2. 有 due 的 item，goal 为 active 且不在 paused_until 内；
3. 当前不在安静时段；
4. 用户这句话轻松、不是在倾诉或求助（复用 `mood.py`/salience 的情绪标记；负面或含问题求助 → 不插）；
5. 本会话已经聊了 ≥3 轮（不在开场第一句就考）；
6. 随机门 30%（防止每天固定出现）。

命中时只往 system prompt 加一段 hint："如果顺，可以在回复末尾随口问一句：{prompt}（答案：{answer}）。不顺就别问。" 由模型决定是否用，而不是强插。

**入口二：主动消息（可选，Phase 2）。** 复用 `proactive.py` 的每日额度：若当天主动消息本来就要发，可以拿一个 due item 当话头，不额外增加推送次数。

**判分。** 下一轮用户回复后，用一次小 JSON 调用（同 guard 的规格：无 thinking、temperature 0、超时失败即 skipped）判 right/fuzzy/wrong/refused。refused → goal.refusals+1、暂停 3 天。

**新知识点从哪来。** 用户问了 olo 一个学习相关的问题并得到答案时，异步抽取 0–2 个 item（同样一次小调用），只在已有 goal 下抽；不会因为随口一问就开新 goal。新 goal 只在用户明确表达"想学/在学/要考"时创建（规则 + 模型确认）。

## 6. 与记忆（VoiceMem）的关系与成本

- **结构化进度存 Postgres，不存 VoiceMem。** VoiceMem 继续存"人"的事实（"下个月去大阪"），学习进度是高频更新的数值，放进向量记忆会污染召回。
- goal 创建时写一条普通记忆（"在学日语，为了大阪旅行"），让 olo 在别的话题里也能自然提到。
- 删除 goal 时同步删这条记忆。
- **成本**（DeepSeek）：每次复习额外 ≈1 次判分小调用（~300 tokens）+ 偶尔 1 次抽取调用；按每人每天 ≤1 次复习估算，增量 < 1k tokens/人/天，可以忽略。prompt hint 只在命中当轮加入，其余轮次零开销。

## 7. 中英文

- goal.lang 记录用户设定时使用的语言；复习口吻跟随当前对话语言。
- 规则词表（"想学/在学/要考"、"I want to learn / studying for"）中英各一份；guard 已是语言无关的模型判定，需补几条英文反例（"Great job!" "Keep it up!" 归 stock_line）。

## 8. 隐私

- 学习数据只属于该用户，跟随账号删除（ON DELETE CASCADE 到 users）。
- 设置里加一个开关"让 olo 帮我复习"（默认开，用户可关），并能看到/删除自己的学习目标列表（只是一个简单列表，不是学习页）。
- 不用学习数据做任何推荐、排名或对外统计；不上传第三方。
- 用户说"别记这个"立刻删对应 goal/item。

## 9. 借鉴 DeepTutor（Apache-2.0）什么、不要什么

DeepTutor 是完整的个性化辅导系统（知识库/RAG、出题、学习路径、多 agent 解题等）。

| DeepTutor 能力 | olo 的处理 |
| --- | --- |
| 知识追踪（追踪对每个知识点的掌握度） | **借鉴思路**：简化为每个 item 一个 mastery + SM-2 间隔 |
| 题目生成 | **借鉴思路**：只生成"一句话能问完、一句话能答完"的口头小问题，不生成试卷 |
| 学习路径规划 | **只借一点**：goal 下最多保留一个"下一步"，不给用户展示路径 |
| 知识库/文档上传/RAG | **不要**：会把 olo 变成学习工具 |
| 多 agent 解题、长篇讲解 | **不要**：违反"不讲课" |
| 可视化面板、学习报告 | **不要** |

目前方案**不复用其代码**，只参考思路。若将来复用任何代码片段，需保留其 LICENSE 和 NOTICE 文件，并在文件头注明来源与修改。

## 10. MVP 范围与分阶段

**Phase 0（MVP，约 3–4 天）**
- 迁移：三张表。
- `server/olo/learning.py`：goal 识别、item 抽取、pick_review、判分、SM-2。
- `turns.py` 接入 hint；只走聊天内顺带这一个入口。
- 环境开关 `OLO_LEARNING=1`（默认关），先在 Mac 上自测。
- 评测：在 `docs/chat-eval.md` 的评测集里加 15 条学习场景（含拒绝、负面情绪、深夜），确保 guard 不放过说教/套话，并统计复习频率。

**Phase 1**
- 设置开关 + 学习目标列表（web/app 里一个小抽屉）。
- 英文规则词表与 guard 英文反例。

**Phase 2**
- 主动消息复用 due item 作话头（不加额度）。
- olo 日记（notebook）里偶尔写一句"今天他记住了 kudasai"——要等 Phase 0 的数据证明不烦人再做。

## 11. 风险

| 风险 | 缓解 |
| --- | --- |
| 变得唠叨、像打卡软件 | 全局 1 次/天 + 30% 随机门 + 拒绝即暂停；评测中统计频率 |
| 在用户难过时考题 | 情绪/求助检测命中则不插；评测集覆盖 |
| 模型讲课、说教 | guard 已有类别 + prompt hint 明确"一句话问完" |
| 误判"想学"，乱建 goal | 只在明确表达时建；用户可在列表里删 |
| 判分错误 | 失败即 skipped；只影响间隔，不展示分数给用户 |
| 进度数据污染记忆召回 | 进度只存 Postgres，VoiceMem 只存一句目标 |
| 许可证 | 不复用 DeepTutor 代码；若复用则保留 Apache NOTICE |
