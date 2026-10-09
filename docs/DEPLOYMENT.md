# 部署与迁移到国内服务器

## 运行条件

建议 Ubuntu 24.04 / Debian 12，2 核 4GB 起步；持续使用建议 4 核 8GB。安装受支持的 Docker Engine 与 Compose 插件。生产只向公网开放 80、443；SSH 按来源限制。MySQL、Redis、API 与静态容器均无宿主机端口映射。

GPT Sites 的 Worker 运行环境不能承载本项目的 Nest 进程、MySQL 与 Redis 守护进程。完整系统使用常规服务器或容器平台；以后可让独立静态前端部署到其他平台，再连接同站域 API，但需同步配置 CORS、cookie、CSP 与 HTTPS。前后端独立部署不要求浏览器跨站使用 cookie。

国内服务器应使用运营者可访问的镜像仓库与模型服务。源码无外部字体或 Google 登录依赖；构建需要 npm / 容器镜像网络，可先在 CI 或能联网的机器构建，再推送至自己的国内镜像仓库。镜像仓库登录凭据放到服务器或 CI secrets，不写在 Dockerfile。公网域名、备案和证书按实际部署地点准备。

## 正式部署步骤

1. 获取全面功能分支用于review/测试。[受控账户与视觉改版 PR #5](https://github.com/9theresa9/star-oracle/pull/5) 基于完整功能 PR #4，尚未合并；保留完整功能分支；正式上线前先完成review，再固定已确认的完整提交SHA，不自动跟随开发分支：
   ```bash
   git clone https://github.com/9theresa9/star-oracle.git
   cd star-oracle
   git checkout feat/luminous-oracle-experience
   ```
2. 复制并编辑配置：
   ```bash
   cp .env.production.example .env.production
   chmod 600 .env.production
   ```
3. 用 `openssl rand -hex 32` 分别生成 MySQL root、应用、迁移与 Redis 密码。四个值独立；迁移密码至少 48 个十六进制字符。生成独立 AUTH_SECRET（32 字节以上随机字符），再用 `openssl rand -hex 32` 生成 DATA_ENCRYPTION_KEY（64 个 hex 字符）。把输出填入配置，不发到聊天或公开仓库。
4. 设置 DOMAIN（不含 https://）与 TLS_EMAIL。账户采用预创建用户名/密码，无需 SMTP，生产必须启用 HTTPS 和管理员 TOTP。填入可访问的模型地址、提供方名称、模型和可选 AI_API_KEY；不配置 key 时基础解读照常使用。日请求预算不是金额账单，模型账号仍应设置付费额度。
5. 将域名 A/AAAA 指向服务器。网关默认使用 Caddy 自动申请证书；如果国内网络无法访问 ACME，先取得可信 PEM 证书，按下节替换网关配置。
6. 校验并启动：
   ```bash
   docker compose --env-file .env.production config --quiet
   docker compose --env-file .env.production up -d --build
   docker compose --env-file .env.production ps
   ```
   MySQL 首次启动设置独立迁移账户；迁移容器用 oracle_migrator 执行已提交 SQL，API 的 oracle 账户仅有 SELECT / INSERT / UPDATE / DELETE。API 仅在迁移成功后启动。初始化脚本只在全新数据库卷执行；已有数据库必须由维护人员单独确认权限，不能删卷“重置”。
7. 按[账户维护说明](ACCOUNTS.md)停止 API，交互式创建第一个普通账号，再启动 API。验证 `https://你的域名/api/v1/health` 返回 status=ok，用户名登录、每日一牌、写日记、刷新确认云端保存、塔罗/易经/历史与删除。确认邮件/注册端点返回 404，普通账号不能访问 /admin。
8. 首个管理员也先通过维护工具预建普通账户；网站启用并确认 TOTP后，另经明确授权再离线提升。具体命令见[管理员说明](ACCOUNTS.md#管理员)。没有默认管理员、公开注册或自助提权。

## 自有证书

将证书和私钥保存到服务器只读目录，权限限制为运维用户。在 Caddyfile 站点块内配置：
```caddyfile
tls /certs/fullchain.pem /certs/privkey.pem
```
Compose gateway 增加只读证书目录挂载，不把证书私钥提交到 GitHub。替换后先运行 Caddy 配置校验，再重建网关；证书到期监控和续期由运营者负责。

## 本地开发

复制 .env.example 后：
```bash
docker compose -f compose.dev.yml up -d
npm ci
npm run db:generate
npm run db:migrate
npm run dev:api
```
另一个终端 `npm run dev:web`。开发端口仅绑定本机；不启动邮件服务；先在 API 停止时运行 `npm run account:manage -- create` 创建开发账号。本地固定示例密钥仅用于开发，生产配置会拒绝明显示例值。前端代理 /api 到 localhost:3001；没有前端打包后端的步骤。

## 发布与回退

先备份数据库及当前镜像/提交标识。检查并应用已 review 的增量迁移，再更新 API 与前端。禁止生产使用 `prisma db push`、迁移重置或 `docker compose down -v`。代码回退不自动回退数据库；迁移采用先扩展、后迁移、最后删除字段，必要时编写单独修复迁移。

日志只记录事件/请求标识和通用错误，不打印正文或连接字符串。故障排查尽量使用 health、容器状态、审计和受限运维视图。持久卷和密钥须有独立恢复方案。
