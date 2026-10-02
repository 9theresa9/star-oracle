# 备份、恢复与运维

## 加密备份

在运维机安装 age，生成恢复身份文件，私钥放在另一处安全存储；服务器只需要公开的 age recipient。不要将恢复私钥放在公开仓库或普通备份目录。

```bash
export AGE_RECIPIENT=age1你的公开接收方
bash scripts/backup.sh
```

脚本通过容器内环境读取 MySQL 凭据，不在命令参数放数据库密码；单事务导出、压缩、age 加密，权限 umask 077。可每天自动运行。推荐保留 30 天，将备份复制到独立存储，并监控失败、大小异常和可用空间；保留期应按正式隐私政策执行。

还必须单独备份 DATA_ENCRYPTION_KEY 与 AUTH_SECRET。没有正确的原始数据密钥，数据库备份无法恢复问题/日记/AI正文。密钥与数据库备份分开保护。

## 恢复

先隔离对外流量、备份当前状态、确认目标环境与原数据密钥。恢复是覆盖动作，不能对正式库随手执行：
```bash
export AGE_IDENTITY_FILE=/安全位置/age-identity.txt
export CONFIRM_RESTORE=replace-star-oracle-data
bash scripts/restore.sh backups/具体备份.sql.gz.age
```

脚本停止API，导入备份，删除恢复出的数据库会话并清理专用 Redis DB，再启动API。Redis必须仅供本应用使用。若没有恢复成功，不要继续开放流量；先查原备份和原数据密钥。

至少每月在隔离环境实测：恢复到新卷，检查迁移版本，登录测试账户，读取/解密样本记录，确认日记归属与今日唯一牌，确认管理员权限。仅“备份文件存在”不算恢复演练通过。

## 日常监控

- /api/v1/health：DB与Redis可用性。外部监控只保存状态，不记录私密响应。
- 证书有效期、磁盘/卷容量、MySQL慢查询与连接数、Redis内存/驱逐、API错误率/延迟、AI日预算、SMTP退信。
- Redis短期认证数据不应被任意驱逐；设置足够内存，采用拒绝写入策略并由服务返回暂不可用。生产正式容量配置以压测为准。
- 模型供应商侧设置独立付费额度；本站请求预算不是token或金额账本。
- 记录部署的镜像digest、源提交、迁移版本；持续追踪 Node、MySQL、Redis、Caddy、Nginx和npm依赖公告。
- 不在公网开放phpMyAdmin/Adminer、Redis UI、SMTP调试界面。开发Mailpit仅本机。

## 安全事件

撤销涉及账户 session，轮换已泄漏的认证/模型/SMTP凭据；隔离流量、保留无正文审计和相关运维证据。涉及数据加密密钥时先确定备份与迁移方案，不能仅改环境变量造成全部旧数据无法解密。随后验证跨用户访问与权限失效，并记录用户影响与处置结果。
