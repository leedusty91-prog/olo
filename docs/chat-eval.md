# 聊天提示词评测（evals/chat_eval.py）

改聊天提示词之前/之后跑一遍，看看哪里变好、哪里变坏。不需要起服务和数据库：脚本直接用某个版本的
`server/olo/context.py` 拼 system prompt（人设、世界观、说话规则、记忆、上次聊到哪、olo 自己的日子……），
再调用真实聊天模型（DeepSeek，思考模式开启，和线上同一条 `OpenAIChat(purpose="chat")`）。

场景在 `evals/chat_scenarios.json`，每个场景可以带：`memory`（记得的用户事实）、`last_session`（上次聊天最后几句）
+ `gap_hours`、`history`（本次会话之前的几轮）、`diary`、`own_life`、`nickname`，以及要依次发送的 `turns`。

```bash
# 仓库根目录，密钥从环境变量或 .env 读取（CHAT_API_KEY 或 DEEPSEEK_API_KEY；评委用 OPENAI_API_KEY 或 QWEN_API_KEY）
python evals/chat_eval.py --mock                          # 离线检查流程
python evals/chat_eval.py                                 # 当前工作区
python evals/chat_eval.py --rev fbfb8f3                   # 某个提交
python evals/chat_eval.py --compare fbfb8f3 WORKTREE --judge   # 两版并排 + Qwen 评委打分
python evals/chat_eval.py --only topic,subtext            # 只跑几类
```

报告写到 `evals/out/chat-report.md`（和同名 `.json`），里面有每个场景两版的完整回复和评委分数
（有料/有看法、共情、听懂潜台词、不重复、像真人说话、不编造）。老版本没有的参数会自动跳过，所以任意两个提交都能比。
模型本身有随机性，单个场景的分数波动正常，看整体和具体回复更靠谱。

最近一次对比（fbfb8f3 → 本次改动）见 `docs/chat-eval-report.md`。
