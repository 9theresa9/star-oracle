# 全面功能版 review 路线

1. docs/FEATURES.md 与 docs/DIVINATION.md：已实现范围、牌阵、起卦规则与学习内容。
2. packages/domain 与 tests/divination.test.js：32牌阵与三种起卦、互错综、旧存档兼容。
3. apps/api/prisma/schema.prisma 及两次增量迁移：私密数据关系、归属、级联删除、来源外键、回顾输入快照、幂等与额度账本。
4. model.service.ts / oracle.service.ts：全调用预算、统一账期、已消费标识保护与缓存恢复、固定引用、追问归属、搜索扫描及metadata乐观锁。
5. membership.service.ts / personal.service.ts：额度并发、码兑换、主动同意回顾、行动与完整导出。
6. admin.service.ts：汇总与主动共享范围、内容运营、反馈、码和权限审计，不提供私人日记/备注/对话接口。
7. apps/web/src/pages：占卜/图鉴、记录/月历/回顾、个人星空与运营后台，手机布局及空态。
8. public/sw.js 与 infra/nginx.conf：公开静态缓存范围、API绕过和安全头；不能缓存认证或私人响应。
9. GitHub Actions：真实MySQL/Redis与浏览器、新旧迁移、容器及加密恢复，以最后成功的源提交为准。

本PR基于生产架构分支便于只看这次扩展，不自动合并主分支或替换线上原型。模型测试为受控HTTPS服务，邮件为隔离Mailpit，不把测试称为真实商户付款或生产上线。
