# 备份、恢复与运维

## 加密备份

在运维机安装 age，生成恢复身份文件，私钥放在另一处安全存储；服务器只需要公开的 age recipient。不要将恢复私钥放在公开仓库或普通备份目录。

```bash
export AGE_RECIPIENT=age1你的公开接收方
bash scripts/backup.sh
```

脚本通过容器内环境读取 MySQL 凭据，不把数据库密码放在命令参数中。单事务导出、gzip 压缩、age 加密，权限 `umask 077`。备份先写同目录私有临时文件，只有导出、压缩、加密全部成功才原子发布为 `.sql.gz.age`；任一阶段失败删除未完成文件，不留下看起来可用的备份。同秒备份使用独立随机后缀，不覆盖旧文件。

默认读取仓库根目录 `.env.production`，写入 `backups/`；可通过 `ENV_FILE`、`BACKUP_DIR` 指定绝对路径。不在备份期间运行 DDL/部署迁移；`--single-transaction` 不保证与并发结构变更一致。可每天自动运行。推荐保留 30 天，将已完成备份复制到独立存储，并监控退出码、大小异常和可用空间；保留期按正式隐私政策执行。

必须另外备份 `DATA_ENCRYPTION_KEY` 与 `AUTH_SECRET`，并记录备份时间、部署提交、镜像 digest 和迁移版本。没有正确的原始数据密钥，数据库备份无法恢复问题/日记/AI 正文。密钥与数据库备份分开保护。

## 恢复：验真、隔离导入、验证、人工切换

`restore.sh` **只准备隔离候选环境，不覆盖当前数据库、不停止原 API、不自动接管生产流量**。旧版的 `CONFIRM_RESTORE=replace-star-oracle-data` 不再接受。即使候选导入、迁移或健康检查失败，原项目、原卷和原 Redis 均不改变。

### 1. 准备并完整验真

先确定要恢复的时间点及其之后可能丢失的写入，保存当前状态和当前镜像，核对原数据密钥。固定已审查的源提交及其镜像，确认操作的是正确 Docker context。运行机器需要 Bash、age、gzip、Docker Engine 和支持 `up --wait` 的 Compose。

`TMPDIR` 必须位于加密磁盘或容量足够的 tmpfs，空间至少能容纳压缩明文和完整 SQL，以及另行评估的新数据库卷空间。临时文件权限为 600，目录为 700；退出、INT、TERM 时清理。断电/SIGKILL 不能依靠 shell trap；重启后按恢复记录清理遗留临时文件。删除文件不等于 SSD/COW 文件系统上的安全擦除。

```bash
export AGE_IDENTITY_FILE=/安全位置/age-identity.txt
export ENV_FILE=/安全位置/本次恢复.env
export TMPDIR=/加密磁盘/恢复临时目录
export CONFIRM_RESTORE=prepare-isolated-restore
bash scripts/restore.sh /安全位置/具体备份.sql.gz.age
```

恢复配置需包含完整生产格式变量和正确的原数据加密密钥；数据库密码可以是本次隔离项目专用的新值。仅用测试数据演练时使用独立测试密钥。不要打印该配置或提交它。

脚本先等待 **age 完整解密且最终认证成功**，随后 `gzip -t` 检查完整性，再完整解压到私有 SQL 文件。这三个步骤全部成功之前，不调用任何 Docker 命令。禁止恢复为 `age | gzip | mysql`：age 可以先输出一部分明文再在最终认证处失败，MySQL 的 DDL 也不会因为管道失败自动回滚。

### 2. 只导入全新候选

脚本生成不可由调用者覆盖的唯一 `star-oracle-restore-*` 项目名以及独立 MySQL/Redis 卷，拒绝复用已存在的同名卷；MySQL 初始化后还会检查应用 schema 没有任何表，非空立即终止。导入使用仅限 `star_oracle.*` 的迁移账户及 `--binary-mode=1`，不使用 root 导入，不启用 mysql 客户端脚本命令。

顺序为：空 schema → 历史 dump → 当前已提交迁移 → 迁移状态与实际 schema 对比 → 删除候选库的恢复会话与验证 token → 检查会话数为零 → 候选 API 健康检查。不能先执行当前迁移再导入旧备份，否则会重新引入“备份没有的新表还留在库里”的冲突。schema 对比使用本仓库 Prisma 6.19 的 `migrate diff --exit-code`，发现缺表/缺字段/索引差异时失败关闭，不执行输出的修复 SQL。

候选 Redis 从新空卷启动，因此不需要 `FLUSHDB`。所有命令都带候选 `--project-name`；失败时只停止候选 API/MySQL/Redis，保留候选卷以供受控排查，不执行 `DROP DATABASE`、`down -v`、删除旧卷或清理原 Redis。每次重试创建新的候选，不往失败候选上继续叠加导入。

候选网络独立，edge 也设为 `internal: true`，不启动 web/gateway、不开放宿主机端口，防止演练时对外发送邮件、模型请求或接收真实访问。容器健康检查只检验 DB/Redis 连通性，不能证明数据解密和全部业务正确。

### 3. 验证与人工切换门槛

默认将 `compose.restore.yml`、`project-name` 和自动检查通过标志 `VERIFIED` 写到 `backups/restores/<本次目录>/`（700）；可用 `RESTORE_WORK_DIR` 指定私有目录。这里不保留 SQL/压缩明文、身份私钥或环境配置。`VERIFIED` 只代表自动检查通过，**不代表已经上线，也不代替业务验收**。

使用输出中的完整 Compose 命令检查候选，始终保留 `--project-name`、原 Compose 文件、恢复 override 与本次环境文件，不要改成裸的 `docker compose`：

```bash
restore_dir=/本次输出的完整候选目录
project=$(cat "$restore_dir/project-name")
candidate=(docker compose --project-name "$project" --env-file "$ENV_FILE" \
  -f "$PWD/compose.yml" -f "$restore_dir/compose.restore.yml")
"${candidate[@]}" ps
```

上线前需记录并由维护人员确认：

1. 备份来源/时间点符合预期；当前项目的最新加密备份、镜像标识、原卷都可用。
2. 迁移版本、表结构和关键记录数量符合预期；至少覆盖一次早于新表迁移的旧版备份恢复。
3. 使用正确原数据密钥解密测试账户的代表记录，核对日记归属、今日唯一牌、历史记录/AI 正文及管理员权限。只在受控私有通道查看内容，不复制到普通日志。
4. 原会话/邮箱验证/密码重设链接在候选环境不可复用；测试账户用密码/TOTP 重新登录。测试产生的会话在正式接管前再次撤销，或重新创建干净候选。
5. 准备明确的维护窗口、切换目标、HTTPS 证书/网关持久卷方案与回退指令；切换前阻止原环境新写入。确认愿意接受恢复点之后的业务数据丢失。
6. 获准后才由维护人员调整候选 edge 网络的隔离配置、准备匹配的 web/gateway，再将单一入口转向候选。Docker 网络的 `internal` 属性不能就地修改，必须计划候选网络重建；保留候选数据卷，不能使用 `down -v`。不要直接对恢复 override 执行全栈 `up` 来猜测接管流程，也不能让两个 gateway 争用 80/443。
7. 开放流量前再次检查 HTTPS、健康、登录、代表记录解密和写入。旧环境与旧卷保持可回退；切换失败先阻断候选写入，再按已确认计划切回原入口/原 API。若候选已接收新写入，先评估两边数据差异，不能静默切回并丢失新数据。

每个部署的入口/TLS 拓扑不同，本脚本有意不提供自动切换或自动恢复原生产配置。失败的候选含敏感恢复数据，应按保留政策在人工确认后清理；禁止对运行中的生产项目尝试 DROP/FLUSH 或删卷演练。

至少每月在隔离环境完整演练上述流程；仅“备份文件存在”或“health 为 OK”不算恢复通过。

## 日志与令牌隐私

- Web Nginx 明确覆盖基础镜像的 combined 日志，只记录时间、Nginx 生成的请求 ID、状态、响应字节数、耗时。任何路由均不记录 URL/query、Referer、Cookie、Authorization、User-Agent、IP 或请求正文。
- `/account` 与 `/api` 路由额外关闭访问日志；判断使用原始 `$request_uri`，不会因为 SPA 转到 `index.html` 而重新记录。
- Nginx 原生错误日志无法逐字段脱敏，可能夹带完整请求或 Referer，所以本虚拟主机的错误日志写入 `/dev/null`。使用健康检查、状态计数和 `nginx -t` 排查；不要临时恢复 combined/debug 请求日志。启动期的配置错误仍可用于排查。
- Web 响应使用 `Referrer-Policy: no-referrer`，包括同源跳转；不可依赖浏览器策略代替服务端日志脱敏。Caddy 当前没有启用访问日志；未来启用任何网关/CDN/WAF/代理日志前须独立审查，不能默认认为 Web 已脱敏就覆盖了上游。
- 所有生产容器（包括 Web 和迁移容器）及开发容器使用 Docker `json-file`，每文件 `10m`、最多 `3` 个。轮转不清除已经留存的旧日志，也不保证内容脱敏；升级配置后须重建相关容器才能应用，旧日志按隐私/事件保留政策单独处理。

### 验证范围与隔离环境复验

仓库测试 `node --test tests/operations.test.js` 使用真实 Bash 和 gzip，模拟缺失的 age/Docker 边界，覆盖最终认证失败、损坏压缩包、旧确认词拒绝、已有卷/非空 schema、导入/迁移/schema 对比/会话撤销/健康失败、原项目不变、明文清理、原子备份与日志配置。日志测试使用虚拟 token，检查允许字段与配置；不是运行中的 Nginx 端到端证据。

没有 Docker、age、Nginx 的环境不能据此声称真实恢复演练通过。发布前必须在专用隔离机器上补做：

- 用临时 age 身份和纯虚拟数据产生真实备份；篡改最后认证块/截断备份，确认失败发生在任何容器变化之前。真实 gzip 损坏也需拒绝。
- 使用当前 Web 镜像执行 `nginx -t`。向隔离站点发送 `/account?token=VIRTUAL-RESET-TOKEN`，再发送携带该地址 Referer 的首页、资源和不存在路径请求；检查响应始终为 `no-referrer`，容器全部日志均不含该虚拟 token、query 或 Referer，敏感路由没有访问日志条目。
- 从旧迁移版本创建虚拟备份，原环境保留新版新增表；运行恢复，确认候选从空 schema 成功升级、旧环境表/数据/会话不变。额外注入无效 SQL、迁移失败和错误数据密钥；任何失败均不得改变原环境，错误密钥须在业务解密门槛被发现。
- 检查真实 Compose 渲染、网络隔离、新卷归属、非 root 导入权限、候选健康、日志轮转，以及人工切换/回退演练。不得使用生产用户数据或真实私钥来代替测试夹具。

## 日常监控

- `/api/v1/health`：DB 与 Redis 可用性。外部监控只保存状态，不记录私密响应。
- 证书有效期、磁盘/卷容量、MySQL 连接数、Redis 内存/驱逐、API 错误率/延迟、AI 日预算、SMTP 退信。MySQL 慢查询/通用查询日志可能含正文或 token；默认不启用，必要时先审查脱敏及保留策略。
- Redis 短期认证数据不应被任意驱逐；设置足够内存，采用拒绝写入策略并由服务返回暂不可用。生产正式容量配置以压测为准。
- 模型供应商侧设置独立付费额度；本站请求预算不是 token 或金额账本。
- 记录部署的镜像 digest、源提交、迁移版本；持续追踪 Node、MySQL、Redis、Caddy、Nginx 和 npm 依赖公告。
- 不在公网开放 phpMyAdmin/Adminer、Redis UI、SMTP 调试界面。开发 Mailpit 仅本机。

## 安全事件

撤销涉及账户 session，轮换已泄漏的认证/模型/SMTP 凭据；隔离流量、保留无正文审计和相关运维证据。涉及数据加密密钥时先确定备份与迁移方案，不能仅改环境变量造成全部旧数据无法解密。随后验证跨用户访问与权限失效，并记录用户影响与处置结果。
