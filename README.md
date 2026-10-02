# 照见 · Star Oracle 2

独立 React 前端 + NestJS API + MySQL 8.4 + Redis 7.4。塔罗、易经、每日星笺、私人日记、账户与管理后台。

当前升级在 `feat/production-architecture` 分支；旧 Worker 原型保留在 Git 历史与原部署，升级不会自动改动它。

## 应用与数据

- `apps/web`：React / Vite / TypeScript / TanStack Query；可独立构建静态站点。
- `apps/api`：NestJS / Express / Better Auth / Prisma；可独立运行与横向扩展。
- `packages/domain`：已验证的 78 张牌、64 卦、随机与解读规则。
- `packages/contracts`：共享 HTTP 请求校验和类型。
- MySQL：永久记录、用户、会话索引、审计和 AI 日预算。
- Redis：认证短期数据、跨实例限流和 AI 并发租约。

安装、正式部署、架构取舍与安全验证见 `docs/`。依赖锁与初始 SQL 迁移已提交；CI 使用 `npm ci` 和已提交迁移，仅有仓库读取权限，不在生产执行 schema push。

## 本地开发

1. 安装 Node.js 24 与 Docker Compose。
2. 复制 `.env.example` 为 `.env`。
3. 启动开发数据库、Redis 与邮件服务：`docker compose -f compose.dev.yml up -d`。
4. `npm ci`，`npm run db:generate`，加载环境变量后 `npm run db:migrate`。
5. 加载环境变量后 `npm run dev:api`；另一个终端 `npm run dev:web`。
6. 打开 http://localhost:5173；开发邮件在 http://localhost:8025 查看。

推荐使用 `node --env-file=.env` 启动已构建 API；开发命令加载方法详见部署文档。绝不把 .env、密钥或正式用户数据提交到仓库。

## 验证

`npm run typecheck`、`npm run build`、`npm test`、`npm run test:e2e`。集成测试需要真实 MySQL 与 Redis；GitHub Actions 自动提供，并记录测试所使用的完整提交 SHA。界面在桌面 Chromium、iPhone WebKit 和 320px 浏览器验证。

安全没有“零隐患”承诺。实现、测试、部署与剩余外部条件分别记录，具体以成功的 CI 与部署验收为准。
