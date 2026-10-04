# 照见 · Star Oracle

独立 React 前端 + NestJS API + MySQL 8.4 + Redis 7.4，提供塔罗、易经、学习图鉴、私人记录与管理后台，适配桌面和手机。

当前全部功能集中在 `feat/comprehensive-oracle` 分支，[PR #4](https://github.com/9theresa9/star-oracle/pull/4) 直接面向 `main`，包含已完成的生产架构升级及全部功能。[分支说明](docs/BRANCHES.md) 与 [实际界面](docs/REVIEW_SCREENSHOTS.md) 可直接查看。GitHub review 不会自动修改主分支或已部署的 Worker 原型；新版正式上线仍需服务器、域名、SMTP、模型凭据与环境验收。

## 功能

- **占卜**：78张塔罗牌、32个明确位置的牌阵、15主题、洗牌与逐张翻牌；易经三硬币、数字、公历时间起卦，本卦、变卦、动爻与互/错/综卦。数字和时间方法为规则公开、可复现的当代简化梅花法。
- **学习与解读**：78牌/64卦图鉴、10篇入门教程；基础解读无需模型密钥。AI初次解读、同次结果连续追问与周/月回顾须主动同意，引用固定结果，不重新抽取。
- **私人空间**：账户、邮箱验证、密码重设、TOTP；每日星笺、心情日历、日记；历史分页搜索、收藏、标签与私人备注；行动计划、周/月统计、回顾删除、关联数据导出。
- **分享与运营**：浏览器生成PNG海报，默认隐藏问题；公告和内容草稿/发布、用户反馈与站内回复、30/90天运营趋势。管理员只读取主动共享的探索与主动提交的反馈，不读取私人日记、备注、标签、追问、回顾或行动。
- **会员与额度**：免费/Plus每日AI额度、会员到期、额度余额、兑换码、兑换历史与账本，使用真实事务和并发控制。现金支付当前未开放。
- **手机与部署**：响应式UI、减少动态偏好、PWA安装与公开静态外壳缓存；独立Docker镜像、增量SQL迁移、HTTPS网关、私网MySQL/Redis、加密备份与恢复。

完整交付范围、算法及使用限制见 [功能清单](docs/FEATURES.md) 与 [占卜规则](docs/DIVINATION.md)。

## 应用与数据

- `apps/web`：React / Vite / TypeScript / TanStack Query，可独立构建静态站点。
- `apps/api`：NestJS / Express / Better Auth / Prisma，可独立运行。
- `packages/domain`：78牌、64卦、牌阵/主题、起卦和固定引用验证、图鉴与教程。
- `packages/contracts`：共享 HTTP 请求校验和类型。
- MySQL：用户、会话索引、永久记录、会员、额度账本、审计和AI持久预算。
- Redis：认证短期数据、跨实例限流和AI并发租约。

依赖锁与SQL迁移已提交；CI使用 `npm ci` 和已提交迁移，仓库权限只读；生产不执行 schema push。Docker Compose 可以启动整套系统，但首次仍需正确配置域名、密钥与外部服务。

[部署说明](docs/DEPLOYMENT.md) · [架构取舍](docs/ARCHITECTURE.md) · [安全与隐私](docs/SECURITY.md) · [备份运维](docs/OPERATIONS.md) · [API规范](docs/openapi.json) · [Review与验证记录](docs/REVIEW.md)

## 本地开发

1. 安装 Node.js 24 与 Docker Compose。
2. 复制 `.env.example` 为 `.env`。
3. 启动开发数据库、Redis与邮件服务：`docker compose -f compose.dev.yml up -d`。
4. `npm ci`，`npm run db:generate`，加载环境变量后 `npm run db:migrate`。
5. 加载环境变量后 `npm run dev:api`；另一个终端 `npm run dev:web`。
6. 打开 http://localhost:5173；开发邮件在 http://localhost:8025 查看。

推荐使用 `node --env-file=.env` 启动已构建API；开发命令加载方法详见部署文档。不把.env、密钥或正式用户数据提交到仓库。

## 验证

运行 `npm run typecheck`、`npm run build`、`npm test` 与 `npm run test:e2e`。集成测试需要真实MySQL与Redis；GitHub Actions提供这些服务，并记录完整提交SHA。浏览器验证涵盖桌面Chromium、iPhone WebKit和320px窄屏。

验证结论以对应提交成功的CI及 [Review记录](docs/REVIEW.md) 为准；SMTP投递、模型计费、域名TLS、国内可达性与服务器容量另做上线验收。安全措施需要持续维护，不承诺绝对无漏洞。

## 性能与维护

页面按需加载、数据库查询与缓存优化，以及相同环境的前后对比方法，见 [性能说明](docs/PERFORMANCE.md)。CI 保存构建体积、真实查询/解密计数与功能回归报告；全部开发继续在当前完整功能分支和 PR #4。
