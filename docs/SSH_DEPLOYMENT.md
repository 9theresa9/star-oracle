# 正式 SSH-only 部署

这是可持续保存正式账户和数据的独立 HTTP 模式，不是开发服务器。浏览器入口固定为 **http://localhost:17777**，通过 SSH 转发到服务器的回环端口。不需要域名、CA、浏览器证书或公网 80/443。原 `compose.yml` 与默认公开 HTTPS 行为保留；两份 Compose 绝不能合并。本次代码改造不代表已部署，也没有创建真实账户或正式密钥。

## 支持边界

- 服务器使用本机 Linux、rootful Docker Engine **28.0.0 或更新稳定版**、Compose v2（支持 `create --pull never` 和 `start --wait`，建议 2.34+）、Node.js 24。启动器只连接 `/var/run/docker.sock`，不支持远端 Docker context、rootless、Docker Desktop 或未知版本后缀。不会自动升级系统。
- Docker 28 之前的同一二层网络回环发布漏洞不在支持范围。启动器还检查实际 dockerd 参数及配置，拒绝 `allow-direct-routing`、关闭 Docker 防火墙、IPv6/路由型网络与额外受信网卡设置。不要用防火墙转发、反向代理、FRP、Tailscale Serve 等再公开此端口。
- 此参考栈含独立 MySQL 与 Redis。容器上限为 MySQL 768 MiB、API/一次性迁移各 512 MiB、Redis 192 MiB、Web 128 MiB，单容器 1 CPU/256 PID；Redis `maxmemory 128mb`，达到容量时拒绝写入而不驱逐认证状态。需给操作系统、Docker 和磁盘缓存留余量；建议至少 3 GiB 可用内存，1 GiB 主机不适合此完整参考栈。已有其他应用时先核算资源，限制不是容量保证。
- 共享 MySQL 实例是后续单独受审查的拓扑变更。这里固定使用照见独立库 `star_oracle`、仅 DML 的 `oracle` 应用账户、只限本库的 `oracle_migrator`，以及专用 Redis；不会连接或修改其他应用数据库。参考栈密码为独立 64 位十六进制值，已有共享库的凭据不能直接塞入此配置。
- SSH 保护网络传输。浏览器端及服务器端回环 HTTP 不防恶意本地进程；localhost Cookie 不按端口隔离。只在可信电脑/服务器使用，避免其他不可信 localhost 服务。已有浏览器若缓存了 localhost HSTS，HTTP 不能清除它；使用独立干净浏览器配置或由用户手动清除对应状态，不能绕过证书警告。

## 拓扑与拒绝规则

唯一宿主机发布为 `127.0.0.1:17777:8080`。API、MySQL、Redis 不发布任何宿主机端口。没有 gateway 服务。

| 网络 | 成员 | 属性 |
| --- | --- | --- |
| `star-oracle-ssh-private` / `172.30.77.0/24` | API `.2`、Web `.3` | IPv4 NAT；允许 API 调用 HTTPS 模型供应商 |
| `star-oracle-ssh-backend` / `172.30.78.0/24` | API `.2`、MySQL `.4`、Redis `.5`、迁移 `.6` | `internal: true`；Web 不可访问数据库/缓存 |

Web 仅接受 edge 网关 `.1` 和自身回环来源；其他直接路由到容器的请求，即使伪造正确 Host，也被拒绝。API 仅接受 Web 的 `172.30.77.3`，以及严格限定的自身回环健康检查。原生非容器 API 始终绑定 `127.0.0.1`；容器监听所有接口前检查真实网卡与容器标识。

Host 必须逐字为 `localhost:17777`，Origin 缺省或逐字为 `http://localhost:17777`；别名、大小写变体、其他端口和绝对形式请求均拒绝。Nginx 不生成或信任代理身份头，传给 API 的 Host 固定。已知非空代理头在 Web 拒绝；任何 `Forwarded`、`X-Forwarded-*`、`X-Real-IP`（含空值与未知后缀）在 API 拒绝。

此模式不发送 HSTS 或 HTTPS 升级指令，专用 Cookie 前缀为 `star-oracle-ssh`；Cookie 为 HttpOnly、SameSite=Lax、host-only，在本模式关闭 Secure。用户名密码、CSRF、限流、归属校验、管理员强制 TOTP 和数据加密保持生产要求。不要依赖 Cookie 改名替代全会话撤销。

## 获取离线发布包

在 GitHub 的 “Production architecture verification” 成功运行中，下载 `star-oracle-ssh-linux-amd64-<完整提交>`。PR 运行检出确切 PR head，不把合并测试 SHA 当作交付提交。所有类型/构建/单元/浏览器/公开容器/SSH 真实网络检查均成功，才导出和上传发布包。失败运行可以有普通诊断产物，但不会发布可部署的 SSH 包。

包内 `images.tar.gz` 包含同次检查实际使用的 API、Web、MySQL 8.4、Redis 7.4 镜像，不需要新镜像仓库，不在服务器安装依赖或构建镜像，数据库迁移由已验证镜像执行，也不在部署时拉取浮动基础镜像。`ssh-manifest.json` 记录完整提交、源码 tree、CI run、平台、实际镜像 ID、网络测试通过证明和文件 SHA-256；`SHA256SUMS` 覆盖包内文件。保存时再次核对镜像未变化。当前工作流产物为 linux/amd64；其他架构须在匹配 CI runner 上重新完整验证，不用仿真假装原生通过。

GitHub 产物保留 7 天。需要长期回退时，由获授权维护人员将该版本包、校验记录和原密钥备份到受控存储。校验和检验完整性，不替代对仓库、CI run 和提交来源的信任。

将包传到服务器并在独立版本目录解压后：

```bash
cd /opt/star-oracle/releases/完整提交
sha256sum -c SHA256SUMS
node scripts/ssh-release.mjs verify "$PWD"
node scripts/ssh-release.mjs load "$PWD"
```

`load` 先校验所有文件、Docker 版本和真实服务器架构，再导入并逐个核对镜像 ID。镜像别名只用于 Compose 引用，启动时仍须匹配该包的不可变镜像 ID。已有其他部署使用相同本地镜像别名时先安排维护，不要并发切换镜像。

## 首次准备与启动

仅在最终部署获准后，由维护人员在服务器的私有目录准备 `.env.ssh`（当前用户所有，权限 600）。从 `.env.ssh.example` 复制并填入独立随机秘密；新秘密可分别使用 `openssl rand -hex 32` 生成，绝不复制到聊天、日志或仓库。AI Key 可留空。路径不能是公开可读文件。

如果迁移已有数据，必须保留原 `AUTH_SECRET` 与 `DATA_ENCRYPTION_KEY`。AUTH_SECRET 至少 32 字符；含特殊字符的旧值可在受控本地工具中转为 UTF-8 canonical base64，写入 `AUTH_SECRET_BASE64`，同时删除 `AUTH_SECRET` 行。启动器只解码数据，不执行 shell 插值，并在运行及维护中恢复完全相同的原始秘密。Base64 不是加密，该文件仍须保密。不能为满足示例格式而换掉 TOTP 或数据密钥。

模式、origin、端口、数据库目标、代理信任均固定在独立 Compose 中，不能通过环境覆盖。启动器只接受白名单设置，忽略环境中的 `COMPOSE_FILE`、项目名、profiles、Docker context/host 和应用覆写，使用唯一绝对 Compose 路径。不会合并 `.env` 或隐含 override。

首次可直接进入账号维护；它只启动私有数据库/缓存、完成迁移，再打开没有监听端口的交互 CLI：

```bash
node scripts/ssh-deploy.mjs maintenance --env-file /安全目录/.env.ssh --operation create
```

按终端提示输入用户名、昵称、隐藏密码、重复密码和确认。不会创建默认管理员；管理员必须先在账户页面启用 TOTP，再按 [账户文档](ACCOUNTS.md) 做单独批准的角色变更。初始设置或维护成功后：

```bash
node scripts/ssh-deploy.mjs check --env-file /安全目录/.env.ssh
node scripts/ssh-deploy.mjs start --env-file /安全目录/.env.ssh
```

启动顺序为：校验发布包与完整渲染配置 → `create --no-build --pull never` 创建停止状态的容器 → inspect 实际 HostConfig、挂载、资源限制、网络和 IPAM → 启动并等待健康/迁移完成 → 再 inspect 实际分配地址、健康状态和发布端口。检查失败会停止此固定 SSH 项目拥有的容器，不会停止其他项目、清空 Redis、删除数据卷或运行 prune。

网络检查拒绝无关容器端点。不要手工把其他容器接入这两张网。所有服务 `restart: 'no'`，重启服务器后由获授权维护人员再次运行检查启动器；Docker 自动重启不能绕过检查。启动后检查是启动/显式 check 时的快照，不是后台安全监控。人工改动 Docker、网络或镜像后必须重新 check；拥有 root/Docker 权限的人也能绕过应用隔离。

## 浏览器与 SSH 隧道

在自己的可信电脑运行，保留该终端连接：

```bash
ssh -N -T -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 \
  -L 127.0.0.1:17777:127.0.0.1:17777 运维用户名@服务器
```

浏览器只打开 **http://localhost:17777**。不要用 `127.0.0.1`、服务器 IP、自定义域名或不同本地端口替代；Host/Origin 校验会拒绝。不要添加 `-g`、`0.0.0.0` 绑定、远程转发或把此隧道共享给同网段设备。客户端 17777 被占用时先解决冲突，不能静默换 origin。

## 账号维护与模式切换

完整约束见 [账户文档](ACCOUNTS.md)。维护前备份，并停止/排空照见其他部署项目、旧模式、定时任务和外部副本中的认证写入者，勿停止简章等其他应用。启动器只能停止自己的 API/Web；交互确认不能证明其他副本已停。

```bash
node scripts/ssh-deploy.mjs maintenance --env-file /安全目录/.env.ssh --operation reset-password
# 或 assign-username；一次只运行所需操作
```

维护动作检查拓扑，停止 API/Web/迁移容器，保留或启动 MySQL/Redis，离线完成迁移，然后在 backend `.7` 运行一次固定 CLI。它没有宿主机端口、没有 Web/edge 网络，使用只读根目录、临时 /tmp、无 capabilities、512 MiB/1 CPU/256 PID，结束自动删除。秘密使用私有临时配置及直接子进程环境传递，密码仅在真实 TTY 中隐藏输入。不要并发运行两次维护。中断/失败不会重开 API，处理问题后重试；SIGKILL 后可能遗留权限 600 的临时文件，须由维护人员清理。

已有数据在 HTTPS 与 SSH-only 之间切换时，在所有认证写入者停止后必须执行：

```bash
node scripts/ssh-deploy.mjs maintenance --env-file /安全目录/.env.ssh --operation revoke-all-sessions
```

核对全部账号的操作目标，按提示输入 `STOPPED`、`ALL`。原密码、TOTP 种子/恢复码、角色、停用状态和私有记录保留；会话、未完成挑战和可信设备状态全部撤销并验证。任何部分失败都保持所有 API 停止，修复后重跑；只有成功退出后才能 `start`。旧数据卷/共享数据库的迁移需要另外审查正确的数据与权限目标，本启动器不会自动接管旧项目的数据卷。

## 备份、停止与升级

包内有可执行的 SSH 备份入口和运维文档。安装 age、设置单独保管的恢复密钥对应的公开 recipient 后：

```bash
BACKUP_DEPLOYMENT_MODE=ssh-only ENV_FILE=/安全目录/.env.ssh \
  AGE_RECIPIENT=age1你的公开接收方 bash scripts/backup.sh
```

备份加密并原子发布，失败不留下看起来完成的文件。密钥与数据分开备份，定期在隔离环境验证恢复。包只携带部署/维护/备份文件；完整隔离恢复流程需要同提交的受审查源码 checkout 与 [运维文档](OPERATIONS.md)，不是对现有卷做自动覆盖。共享数据库不能套用容器内 root 导出。

```bash
node scripts/ssh-deploy.mjs stop --env-file /安全目录/.env.ssh
```

停止操作保留 MySQL/Redis 数据卷，即使镜像包损坏也可按固定项目标签停机。升级时先备份、停止旧版本，保存旧包与密钥，解压并核对新成功 CI 包、load 新镜像，再从新目录 check/start。不要同时运行两个版本，不要直接使用 `docker compose up`、`down -v` 或删卷。数据库迁移可能影响回退，不能只换回旧镜像就假定数据兼容。

## 验收与证据范围

CI 浏览器回归以生产 API 配置验证 Chromium、WebKit、窄屏中的 HTTP Cookie、登录/退出/刷新、旧 Cookie 前缀、TOTP/恢复码和账户切换。Docker 回归创建纯合成数据，检查真实容器/网络、外部宿主 IP 即使伪造正确 Host 也无法连接、探测容器直连 Web/API 被拒、Web 无法连接 MySQL/Redis、代理头/Origin 拒绝、会话 Cookie、DML 权限与日志虚拟令牌不泄漏。没有真实数据、正式账号或供应商密钥。

本地单元测试覆盖恶意配置和启动时序，不能代替 Docker/浏览器运行证据。发布必须对应上述成功 CI 运行；工作流配置存在或打包脚本通过语法检查不代表上线验收完成。

参考：[Docker 端口发布与 28.0.0 之前的回环限制](https://docs.docker.com/engine/network/port-publishing/)、[Compose start --wait](https://docs.docker.com/reference/cli/docker/compose/start/)。
