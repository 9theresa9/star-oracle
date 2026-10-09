# 预创建账户与离线密码维护

照见只允许管理员预先创建的用户名/密码账户登录。没有公开注册、邮箱登录、邮件验证、邮件找回密码、用户名可用性查询或网页改用户名入口。旧邮件链接也不再可用。无需 SMTP。

用户名为 3–32 位 ASCII 英文字母、数字、点、下划线或短横线，以字母/数字开头；首尾空白去除，英文字母转小写，数据库唯一索引拒绝重复。显示昵称仍可用中文。密码 12–128 个字符，建议使用密码管理器生成独立长密码。

## 安全边界

- 密码不能手工明文写库，不能放命令参数、环境变量、重定向文件、聊天或脚本日志。
- CLI 只接受真实交互终端。密码输入不可见，必须输入两次。执行前会展示操作目标并要求确认；取消不会执行写入。
- 脚本使用 Better Auth 自带的 scrypt 密码哈希和完整 user/account 关联，一次事务创建普通用户。不会创建默认管理员。
- 新用户的 `email` 只是数据库兼容所需的随机 `@accounts.invalid` 标识，`emailVerified=false`，不表示验证过任何邮箱，也不发送邮件。
- CLI 属于服务器维护能力，能重设密码。仅可信运维人员在正确的 Docker context、项目、配置和备份下使用；普通用户请联系管理员。
- HTTPS、SecureCookie、CSRF、登录限流、私有记录归属检查和管理员 TOTP 保持启用。密码重设不会关闭 TOTP或更换恢复码。丢失密码与身份验证器时不能靠本脚本跳过第二因素。

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
