# 清透观星体验：修订与验收

基线：`2a1c0c841a7bf55dec2490a1b24482a755dfb0d3`。独立分支 `feat/luminous-oracle-experience`；不合并 main 或 PR #4，不部署服务器。此文记录实现范围与验收边界，CI 以对应提交为准。

## 功能对照

| 原有能力 | 保留入口与实现 | 本次变化 |
|---|---|---|
| 78 塔罗、32 牌阵、15 主题、正逆位、洗牌与翻牌 | `/tarot`、domain 与 Explore | 浅蓝阅读界面；旧 AI 回包不覆盖新探索 |
| 三硬币/数字/上海公历时间、六爻与关联卦 | `/iching`、原算法 | 规则和展示均保留，统一可读配色 |
| 78 牌/64 卦图鉴、10 篇教程 | `/library`、`/tutorials` | 原数据及检索保留 |
| AI 初次解读、同次追问、周月回顾 | `/tarot`、`/iching`、`/insights` | 未知结果保留 nonce；不可变输入恢复已付费结果；明确终态才允许新付费尝试 |
| 记录分页搜索/收藏/标签/备注 | `/history` | 私有请求、缓存、迟到回写绑定账号和会话代次 |
| 每日星笺、心情、日记、月历 | `/daily`、`/journal` | 功能与版本冲突保护保留；换号清理草稿和旧内容 |
| 行动、回顾、导出、反馈、公告、会员/额度/兑换 | `/space` 及全部原子页面 | 原 API、访问范围和入口保留 |
| 注册、邮箱验证、重设、TOTP、恢复码、退出、删除 | `/account` | 完整账户界面重做；敏感字段默认遮罩；设置操作也核验预期账号 |
| 管理员共享记录、用户管理、统计、内容、反馈 | `/admin` | 原权限和强制管理员 2FA 保留 |
| PWA、分享 PNG、响应式 | 原组件及 manifest | 浅蓝外壳；公开静态缓存边界不变 |

## 可靠性与隐私

- 跨标签广播只包含随机标记；身份撤销取消私有网络请求、清缓存与草稿。失效会话、确认失败、旧 actor/session 请求和迟到响应均不能写入新会话。
- 服务端期望身份检查涵盖业务 API 及带绑定的 Better Auth 安全设置操作；它不是认证替代，仍核验 Cookie、数据库 live session、禁用状态和管理员规则。
- 密码重设 token 留在当前页面短期内存并移出地址栏。Web access log 不含 URL、query 或 Referer，敏感路由关闭 access log，页面与网关回应采用 no-referrer，容器日志有限轮转。
- 新增可空 `reading_conversation.inputCipher` 迁移。AI 输入快照加密，fingerprint 绑定具体追问；恢复不再调用 provider 或消费额度。旧无快照失败追问保守拒绝复用。
- 备份仅在 dump/compress/encrypt 全成功后原子发布。恢复完整验证 age/gzip 后导入唯一新项目/卷，执行迁移、schema diff、会话撤销和健康检查，保留原项目，人工验收后切换。

## 验证与边界

已在独立云端测试目录实测 MySQL 8.4.11、Redis 7.4.7、Node 24。只使用合成账号/数据和本地 TLS 模型 fixture，没有真实模型调用、外发 SMTP 或生产凭据。领域、身份边界、恢复脚本边界、API 与本地模型故障注入测试，以及 typecheck/build 均持续运行，准确统计见最终 CI/交付记录。

本地执行器虽有 Chromium，但 Unix socket 限制阻止启动；受支持云浏览器不能访问测试执行器 loopback。因此没有把静态检查冒充真实浏览器验收。新增 Playwright 用例覆盖双标签真实 Cookie 换号、同账号会话更换、丢回包/截断 JSON 重试、迟到 AI/TOTP 响应、首次首页样式、账户模式、重设 token、键盘/小屏原流程。截图在对应 CI 的 `production-review` artifact。

本地无 Docker、age、Nginx，shell 故障注入是真实 Bash 加边界命令仿真。CI container smoke 已扩展为虚拟 token 日志断言、损坏 age 拒绝、跨新增迁移的旧备份导入新卷、无新表残留及解密校验；以该 CI 实际结果为准。

上线前仍需真实域名 HTTPS、可验证 SMTP、服务器资源与磁盘/备份容量、专用 Redis、真实凭据安全注入、解密抽样、恢复切换审批与运维告警。没有取消任何生产 HTTPS、邮箱验证、SecureCookie 或管理员 2FA 限制。试部署仍须另行准入。
