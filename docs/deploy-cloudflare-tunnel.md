# 测试阶段部署：Mac + Cloudflare Tunnel

这份文档只描述步骤，仓库不会替你执行。所有命令都由 sniper 在 Mac 上手动运行。

## 1. 服务器配置
1. 以 `.env.production.example` 为模板修改 Mac 上的 `.env`：
   - `OLO_PUBLIC=1`
   - `OLO_DEBUG=0`
   - `OLO_LEGACY_TOKEN=0`
   - `OLO_WEB_EMBED_TOKEN=0`
   - `OLO_EMAIL_SENDER=smtp`
2. 服务器启动时会检查这几项。配置不安全时会拒绝启动。
3. SMTP 用 Gmail 应用专用密码（免费）：Google 账号 → 安全 → 两步验证 → 应用专用密码。把它填进 `OLO_SMTP_PASSWORD`。
4. 先跑数据库迁移：`alembic upgrade head`（在 server/ 目录下）。
5. 让 uvicorn 只监听 `127.0.0.1:8000`，由隧道对外提供访问。

## 2. 隧道（免费）
1. 安装：`brew install cloudflared`
2. 登录：`cloudflared tunnel login`。需要一个 Cloudflare 账号和一个托管在 Cloudflare 上的域名。
3. 创建隧道：`cloudflared tunnel create olo`
4. 绑定域名：`cloudflared tunnel route dns olo olo.<你的域名>`
5. 把 `deploy/cloudflared-config.example.yml` 复制成 `~/.cloudflared/config.yml` 并填好。
6. 运行：`cloudflared tunnel run olo`。需要开机自启时用 `sudo cloudflared service install`。

没有域名时可以用 `cloudflared tunnel --url http://127.0.0.1:8000` 拿一个临时的 trycloudflare 地址。这个地址每次运行都会变，只适合短测，不能写进正式包。

## 3. 移动端打包
1. 在 `apps/mobile/eas.json` 里把 `REPLACE-WITH-YOUR-TUNNEL-HOSTNAME` 换成隧道域名。
2. 打包：`APP_ENV=production` 由 eas.json 注入。
   - 正式包只允许 https。
   - 正式包去掉了 iOS 局域网 / ATS 例外，Android 也关闭了明文流量。
   - 正式包不会显示服务器或令牌设置，登录走网页里的邮箱验证码。
3. 以下几步需要 sniper 自己的账号，没有自动化：
   - `npx eas-cli login`
   - `eas build -p ios|android --profile production`
   - `eas submit`
4. 开发包（`development`）仍然允许局域网 http，方便调试。

## 4. 注意
- Mac 睡眠或断网时，App 会显示“连不上 olo 服务器”。公开上架前应该换成常开的主机。
- 不要提交 `.env`、`data/` 或隧道凭证。
