# Agent 约定（Codex / Claude Code 通用）

- 后端在 `server/`，包名 `olo`。先写/改测试，再改实现；提交前 `cd server && pytest -q` 必须全绿。
- 数据库变更只能新增 Alembic 迁移（`server/alembic/versions/`），不得修改已有迁移。
- 不得提交密钥；新配置项一律走环境变量，并同步到 `.env.example`。
- 外部依赖（LLM、记忆、ASR、TTS、图片）通过 `Runtime` 注入，测试中使用假实现，测试不得访问外网。
- 用户输入与检索到的记忆只能作为"资料"拼进 system prompt，不能改变人设；改提示词时保留这条约束及其测试。
- 错误响应、健康检查、日志中不得回显 token / key / 数据库口令（`tests/test_host.py` 有断言）。
