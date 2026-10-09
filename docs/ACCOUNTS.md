# 预创建账户与离线密码维护

照见只允许管理员预先创建的用户名/密码账户登录。没有公开注册、邮箱登录、邮件验证、邮件找回密码、用户名可用性查询或网页改用户名入口。旧邮件链接也不再可用。无需 SMTP。

用户名为 3–32 位 ASCII 英文字母、数字、点、下划线或短横线，以字母/数字开头；首尾空白去除，英文字母转小写，数据库唯一索引拒绝重复。显示昵称仍可用中文。密码 12–128 个字符，建议使用密码管理器生成独立长密码。

## 安全边界

- 密码不能手工明文写库，不能放命令参数、环境变量、重定向文件、聊天或脚本日志。
- CLI 只接受真实交互终端。密码输入不可见，必须输入两次。执行前会展示操作目标并要求确认；取消不会执行写入。
- 脚本使用 Better Auth 自带的 scrypt 密码哈希和完整 user/account 关联，一次事务创建普通用户。不会创建默认管理员。
- 新用户的 `email` 只是数据库兼容所需的随机 `@accounts.invalid` 标识，`emailVerified=false`，不表示验证过任何邮箱，也不发送邮件。
- CLI 属于服务器维护能力，能重设密码。仅可信运维人员在正确的 Docker context、项目、配置和备份下使用；普通用户请联系管理员。
- 默认公开部署继续使用 HTTPS 和 SecureCookie。独立 SSH-only 模式仅通过 SSH 隧道访问指定 localhost HTTP 地址；两种模式都保留 CSRF、登录限流、私有记录归属检查和管理员 TOTP。密码重设不会关闭 TOTP 或更换恢复码。丢失密码与身份验证器时不能靠本脚本跳过第二因素。

## 生产操作

以下是供获授权维护人员使用的步骤，本次开发未执行真实账号创建或重设。

先确认备份与目标环境，停止并排空此部署的**全部 API 实例**，保留 MySQL/Redis。多实例平台也必须停止其他副本；CLI 的人工确认不能证明所有副本已经停止。此工具不支持在线并发密码重设。

```bash
docker compose --env-file .env.production stop api
# 新账号：按提示输入用户名、昵称、隐藏密码、重复密码并确认
docker compose --env-file .env.production run --rm --no-deps api node apps/api/dist/maintenance/account-cli.js create
# 已有账号：按提示输入已确认的 user.id 和新用户名；不输入或重设原密码
docker compose --env-file .env.production run --rm --no-deps api node apps/api/dist/maintenance/account-cli.js assign-username
# 重设：按提示输入目标用户名、隐藏新密码、重复新密码并确认
docker compose --env-file .env.production run --rm --no-deps api node apps/api/dist/maintenance/account-cli.js reset-password
```

Compose `run` 必须保留交互终端，不使用 `-T`、stdin 管道或 `exec` 进入仍在线的 API。生产镜像只需已编译的 JavaScript，不依赖开发工具 tsx。

一次只运行所需操作。成功后才重启：

```bash
docker compose --env-file .env.production up -d api
```

重设会撤销目标用户在数据库和 Redis 的现有会话、未完成的两步验证和可信设备状态，并保留角色、停用状态、TOTP 秘钥、恢复码与所有业务数据。采用限定目标的 SCAN/DEL，不清空其他用户的 Redis。失败后保持全部 API 停止，修复 DB/Redis 连通性并重试，不能把失败当作重设成功。Redis 删除与数据库事务不是分布式原子事务，失败时可能先撤销部分缓存，但事务回滚保留原密码和数据库撤销目标以便安全重试。

## 已有数据库切换公开 / SSH-only 模式

已有数据库在公开 HTTPS 与 SSH-only 模式之间切换时，**必须先离线撤销全部登录状态，再启动新模式**。仅修改 Cookie 名称或 `cookiePrefix` 不能撤销会话：原签名 Cookie 改为新名称后仍可能通过签名验证。不要为清理会话而更换 `AUTH_SECRET`；它也用于保护 TOTP 数据。保留原 `AUTH_SECRET`、`DATA_ENCRYPTION_KEY`、数据库与 Redis 连接到正确的专用环境。

1. 备份并确认目标部署，停止并排空旧模式、新模式及其他项目中的全部 API 副本和认证写入进程，关闭会自动拉起它们的机制。保留 MySQL 与 Redis。单独停止一个 Compose 项目不能证明其他副本也已停止。
2. 用准备切换的数据库和 Redis 配置，从新版本镜像的真实交互终端运行 `revoke-all-sessions`。SSH-only 部署使用其独立 Compose 文件和对应的运维启动流程；不要合并公开部署的 Compose 文件。以下是公开 Compose 的命令形式：

   ```bash
   docker compose --env-file .env.production run --rm --no-deps api node apps/api/dist/maintenance/account-cli.js revoke-all-sessions
   ```

3. 核对当前操作为全部账号，在终端准确输入 `STOPPED`，然后输入 `ALL`。此命令不会询问用户名或密码，不接受参数形式的确认、环境变量确认、管道、重定向输入或 `-T`。
4. 只有出现全部撤销并验证完成、允许重启的成功提示且退出码为 0，才启动新模式。全部用户随后使用原用户名、密码及原 TOTP 重新登录；旧可信设备须重新完成两步验证。

命令枚举所有用户，包括已停用用户、无用户名的旧用户和无密码凭据的用户。每个用户各用一个数据库事务，收集会话 token 与用户绑定的 Verification 标识，删除数据库会话、待处理挑战、可信设备和关联挑战尝试计数，并验证限定目标的 Redis 撤销。数据库中找不到但 Redis 中仍能按用户 ID 确认归属的旧会话也会被撤销。每个成功事务记录 `account.sessions-revoked.offline` 审计事件。结束前再次检查数据库会话总数为零、无用户绑定 Verification，且这些用户的 Redis 活动索引和可识别会话/挑战均已清除。

保留用户 ID、用户名、密码哈希、角色、停用状态、邮箱验证标志、TOTP 秘钥和恢复码，以及全部业务数据。不会运行 `FLUSHDB`、`FLUSHALL` 或 `KEYS`，不会清理 `limit:*` 或无关的登录限流记录；只有被撤销挑战自己的尝试计数一起清理。

**任意步骤失败都必须保持全部 API 停止。** 先处理数据库或 Redis 问题，再从头重跑同一命令。命令可能已经撤销较早处理用户的会话；当前用户的数据库事务会回滚并保留重试所需的 token/Verification 标识，已删除的 Redis 记录无需恢复。重试可再次产生审计事件。这不是跨 MySQL/Redis 的分布式事务，也不会自动停机、阻止其他写入者或在启动时自动执行；人工 `STOPPED` 只确认运维前提，不能替代真正停止全部写入者。

## 旧邮箱账号迁移

迁移只新增可空唯一 `username` 字段。没有自动猜用户名、自动分配管理员、重置密码或修改邮箱验证标志。原有 ID、密码哈希、角色、停用状态、TOTP、会员、私有记录全部保留。

没有用户名的旧账号不能登录，旧会话也不再授权访问。维护人员通过受限数据库管理工具确认其 `user.id` 和所属用户，然后运行 `assign-username`。该操作要求原本有且只有一条有效 credential 记录，字节级保留原哈希，并撤销数据库会话；分配完成后用新用户名、原密码和原 TOTP 重新登录。缺失/不兼容/重复 credential 记录会拒绝，须单独评估，不能猜测或静默覆盖。

已分配用户名不能通过此命令再次更换。若需要重命名、恢复丢失 TOTP、变更管理员权限或处理禁用账号，请另开受控维护变更；不要直接手写表数据。

## 管理员

先用普通预建账户登录，在“我的账户”启用并确认 TOTP，离线保存恢复码。获得明确权限批准后，停止 API，运行现有独立提升命令：

```bash
docker compose --env-file .env.production run --rm --no-deps api node apps/api/dist/maintenance/promote-admin.js operator-username
```

提升仅接受已有、启用状态且已确认 TOTP 的用户名账户，不会自动解禁。数据库会话撤销后，重启 API并用密码/TOTP 重新登录。无默认管理员或自助提权入口。

## 本地开发

启动隔离开发 MySQL/Redis、执行迁移后，在 API 停止时运行：

```bash
npm run account:manage -- create
```

开发脚本从本地 `.env` 读取连接配置，用户密码仍只在终端隐藏输入。测试只在明确 `NODE_ENV=test` 的隔离回环数据库创建合成凭据；测试入口不是生产注册后门。
