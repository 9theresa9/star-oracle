# Review 路线

1. `docs/ARCHITECTURE.md`：为什么采用当前方案，三项成熟方案的比较。
2. `packages/contracts` 与 `docs/openapi.json`：前后端契约和输入限制。
3. `apps/api/src/security.ts`、`auth.ts`、`infrastructure.ts`：会话、最新角色、数据归属、加密、Redis。
4. `oracle.service.ts`：唯一抽取、日记版本、幂等与AI证据/预算；`admin.service.ts`：共享范围与停用事务。
5. `apps/web/src/pages`：组件化前端、真实API交互、手机视图、隐私说明。
6. `compose.yml`、两个Dockerfile、网关与数据库初始化：独立构建和国内部署。
7. GitHub Actions：真实数据库测试、浏览器截图、audit、最终 verified-revision.txt。请使用最终成功运行，不用早期失败运行作为结论。

此 PR 不自动合并主分支，不替换原线上 Worker 站点。实际部署要在服务器完成 SMTP、模型、域名、密钥和TLS验收。没有把受控模型测试称为正式模型上线。
