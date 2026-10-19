# 照见 API 完整参考与 Java 迁移契约

2026-10-19 current frontend verification: actual Vue library now preserves all78tarot/64hexagram records, SVG art, filters/query/history and native dialogs. Unit/actualSSR9/9+typecheck/build pass; real isolated Edge checked every142detail record and all10tutorials/40steps, with separately observed pageErrors0/consoleErrors0/API0. These original public features have no backend persistence endpoint. Authenticated Vue/Java chains and all52+8JavaHTTP operations remain pending; old production React entry is intact. See docs/migration/2026-10-19-vue-library-verification.md.

2026-10-19 frontend migration: independent Vue tutorial module now preserves all10courses/40steps and actor-scoped local progress; composable/actualSFC SSR6/6, typecheck and production build pass. This original feature has no server persistence endpoint. The guest review entry does not activate login; confirmed session host, other/API-backed pages and real Java integration remain pending. The original loopback browser action subsequently passed through formal approval: actual isolated Edge verified toggle/reload, categories, completion and375px mobile layout with0console errors and0API calls; backend integration is not exercised. Original React entry remains unchanged. See docs/migration/2026-10-19-vue-tutorials-verification.md.

基线：9theresa9/star-oracle，提交 `139554bb4594eb8ca8ab6da4f130506ad062c76d`，2026-10-17 核验。本文覆盖现有 52 个业务操作（42 路径）及 8 个认证操作。Java 迁移当前全部 pending；本文描述现有可运行实现及必须保留的契约，不表示新 Java 接口已实现。

源码：[当前基线](https://github.com/9theresa9/star-oracle/tree/139554bb4594eb8ca8ab6da4f130506ad062c76d)。请求模型以 packages/contracts/index.js、各 controller 内 Zod 为准；响应以各 service 的实际投影为准。现有 docs/openapi.json 被用作逐字段底稿；本次已按源码补全遗漏的 Error.code、User.username/sessionBinding、AdminUser.username、Config.deploymentMode。原 OpenAPI 没有列出 Better Auth 入口，本文件单独补充。

## 通用协议

- 业务前缀 `/api/v1`；认证前缀 `/api/auth`。部署同源，Cookie 随请求携带（fetch credentials: include）。不使用客户端提交的 userId 决定所有权。
- 生产默认 HTTPS、Secure/HttpOnly/SameSite=Lax Cookie。SSH-only 仅允许精确 http://localhost:17777，独立 Cookie 家族；不信任 Forwarded/X-Forwarded-*，还校验实际网络对端。
- 所有非 GET/HEAD 写请求要求 Origin 精确等于 WEB_ORIGIN，Content-Type 为 application/json；最大 32 KiB。OPTIONS 204。任意请求带不匹配 Origin 都拒绝 403。当前没有单独 CSRF token 接口；Java 若新增必须显式兼容设计与前端一同变更。
- 现有前端私有请求总是携带 X-Expected-Actor（已验证账号ID）与 X-Expected-Session（已验证sessionBinding）。服务端这两个条件头是可选的：缺省不拒绝；存在非空值且不匹配才返回409。服务端始终独立进行真实Cookie/DB会话认证，不能用这两个头替代认证。私有业务响应带 X-Actor-Id、X-Session-Binding。401、SESSION_CHANGED或成功回包身份头不匹配，前端撤销当前身份和私有缓存。
- `/api/v1/me` 仍需登录，只是前端用来建立初始身份时不附旧expected头。用户必须未disabled、有username、DB会话存在且未过期。管理员接口另需role=admin，并在生产强制twoFactorEnabled=true。
- API Cache-Control: no-store。X-Request-ID 是服务端为每个HTTP请求新生成的UUID，用于追踪/审计；它不是请求JSON里的幂等requestId。
- 业务输入对象由Zod strict规则拒绝未知字段；认证库schema并非一律strict，详见认证节。query limit会从字符串转整数。path `{id}` 通常UUID；管理员users的ID是ASCII字母/数字/连字符8–80，不能擅自把所有userId也改成仅UUID。
- 时间戳返回ISO8601；业务日期显式Asia/Shanghai；周一为一周起点。Action/回顾日期限制2000–2099且为真实公历日，历史探索dateFrom/dateTo允许真实四位年日期。
- 全局HTTP限流120次/60秒/服务器可信IP（HMAC处理），health豁免。Redis故障fail closed 503。登录另外5次/60秒；其他认证默认30次/60秒。

### 统一错误与业务代码

业务错误形状：`{"error":{"message":"中文安全提示","code":"可选","requestId":"可选UUID"}}`。部分传输守卫返回无requestId；认证使用顶层 message/code，见认证节。不可直接向客户端返回数据库异常、模型响应原文、堆栈、Cookie、密钥或私文。

| HTTP | 语义 |
|---|---|
| 400 | 格式/约束错误；JSON解析失败；无效兑换码/日期等 |
| 401 | 未登录、会话撤销/过期、账号被停用/未预创建 |
| 403 | Origin/SSH入口不符、权限不足、管理员2FA未启用 |
| 404 | 不存在/不属于本人/未发布资源；关闭认证入口 |
| 409 | 旧版本、幂等ID与内容冲突、正在进行、身份前置条件变化 |
| 413 | 请求超过32KiB或导出超过预设限制 |
| 415 | 写入不是application/json |
| 429 | HTTP/业务速率、AI并发或每日额度限制 |
| 503 | 安全依赖/服务/模型不可用；含下述明确代码时才有额外含义 |

- SESSION_CHANGED：actor/session前置条件不一致（409）；撤销前端身份，不继续旧操作。
- AI_ATTEMPT_FAILED：模型尝试已经持久确认终止失败（503）；仅此时前端可由用户明确开始新的付费nonce。未知网络结果、破损JSON或普通503不得自动换nonce。
- UNKNOWN_OUTCOME：前端把成功HTTP但不完整JSON归类为该本地错误，status=0；不是服务端响应code。

### 分页、版本、删除与幂等

- 常规列表 query `cursor?: UUID`, `limit?: integer(1..50)=20`，响应 `{items:[...],nextCursor:UUID|null}`。daily默认90，最大100。admin/users游标遵循userId约束。
- 常规顺序createdAt DESC/id DESC；daily按date DESC/id DESC；conversation按createdAt ASC/id ASC。探索列表游标仅校验id+userId，不要求游标本身匹配kind/favorite/date/q/tag；actions/content/feedback等按代码的用户及筛选域校验，conversation还限制readingId。admin users/audit当前直接数据库cursor，不保证和其他列表相同的404提示；每路由保留原语义。
- 探索加密搜索每批150，单请求最多扫描600行。items为空但nextCursor非空仍须继续，不可当结束。
- version/metadataVersion使用条件更新并增1。409需要保留本地草稿，用户选择重读或调整，不能静默重试覆盖。sharing独立于metadataVersion，不能用过期记录全量写回元数据。
- 创建探索的requestId与userId在reading表唯一绑定，重放校验原始选项；普通reading删除后该唯一行也删除，不存在永久创建nonce墓碑。AI另有不可变输入/来源指纹及内容无关ai_allowance消费墓碑，删除内容不能让已消费AI nonce重获免费模型调用。
- 已预留AI额度的失败请求当前不退款。完成模型结果可用已知原nonce重复恢复，无再次provider调用或扣额。pending满120秒仍需数据库CAS确认终止，不能只看客户端计时器。现React attempt仅在组件内存，硬刷新/离开重进不保证恢复原UI尝试；此API能力不等于前端已有跨刷新完整恢复。

## 业务接口（52操作）

### 1. GET /api/v1/health

检查MySQL与Redis连接

- 原实现：`apps/api/src/public.controller.ts:7`
- 迁移状态：pending；计划类 `com.staroracle.platform.PublicController`。
- 权限：public。
- 数据边界：none (public metadata)。

参数：
无独立path/query参数；通用身份头、Cookie/Origin规则仍适用。

请求体：无业务字段。现有所有写请求仍要求JSON Content-Type；daily/today可发空JSON。

响应：
- 200：object；成功。

| 字段 | 类型/引用 | 必需 | 限制及说明 |
|---|---|---|---|
| status | string | 是 | 固定：ok |
- 错误边界：400, 401, 403, 404, 409, 413, 415, 429, 503（共享守卫/资源/校验/业务规则中适用者；不是宣称每条路径必触发每种错误）。
- 计划验收：`LegacyContractParityTest.get_api_v1_health`。

### 2. GET /api/v1/config

获取服务能力与模型提供商信息

- 原实现：`apps/api/src/public.controller.ts:8`
- 迁移状态：pending；计划类 `com.staroracle.platform.PublicController`。
- 权限：public。
- 数据边界：none (public metadata)。

参数：
无独立path/query参数；通用身份头、Cookie/Origin规则仍适用。

请求体：无业务字段。现有所有写请求仍要求JSON Content-Type；daily/today可发空JSON。

响应：
- 200：Config；成功。
- 错误边界：400, 401, 403, 404, 409, 413, 415, 429, 503（共享守卫/资源/校验/业务规则中适用者；不是宣称每条路径必触发每种错误）。
- 计划验收：`LegacyContractParityTest.get_api_v1_config`。

### 3. GET /api/v1/oracle/catalog

获取32牌阵、15主题与三种起卦目录

- 原实现：`apps/api/src/public.controller.ts:9`
- 迁移状态：pending；计划类 `com.staroracle.platform.PublicController`。
- 权限：public。
- 数据边界：none (public metadata)。

参数：
无独立path/query参数；通用身份头、Cookie/Origin规则仍适用。

请求体：无业务字段。现有所有写请求仍要求JSON Content-Type；daily/today可发空JSON。

响应：
- 200：Catalog；成功。
- 错误边界：400, 401, 403, 404, 409, 413, 415, 429, 503（共享守卫/资源/校验/业务规则中适用者；不是宣称每条路径必触发每种错误）。
- 计划验收：`LegacyContractParityTest.get_api_v1_oracle_catalog`。

### 4. GET /api/v1/me

获取当前账户身份

- 原实现：`apps/api/src/oracle.controller.ts:10`
- 迁移状态：pending；计划类 `com.staroracle.oracle.OracleController`。
- 权限：live provisioned session + actor/session binding。
- 数据边界：authenticated actor; every resource/cursor/association restricted to actor.id。

参数：
无独立path/query参数；通用身份头、Cookie/Origin规则仍适用。

请求体：无业务字段。现有所有写请求仍要求JSON Content-Type；daily/today可发空JSON。

响应：
- 200：User；成功。
- 错误边界：400, 401, 403, 404, 409, 413, 415, 429, 503（共享守卫/资源/校验/业务规则中适用者；不是宣称每条路径必触发每种错误）。
- 计划验收：`LegacyContractParityTest.get_api_v1_me`, `OwnershipContractTest.get_api_v1_me_rejects_other_actor`。

### 5. POST /api/v1/readings

服务端生成并幂等保存占卜

- 原实现：`apps/api/src/oracle.controller.ts:11`
- 迁移状态：pending；计划类 `com.staroracle.oracle.OracleController`。
- 权限：live provisioned session + actor/session binding。
- 数据边界：authenticated actor; every resource/cursor/association restricted to actor.id。
- 行为：相同本人requestId与相同内容返回原记录；不同内容409。服务端生成牌面/六爻，客户端不能指定结果。数字/时间casting按规则复算校验；币法由服务器随机。
- 幂等/恢复：userId+requestId unique; verify same normalized create input before replay。

参数：

| 位置 | 名称 | 必需 | 类型 | 约束/说明 |
|---|---|---|---|---|
| header | Origin | 是 | string | 格式：uri；必须准确等于服务器 WEB_ORIGIN。所有写请求另须 Content-Type: application/json。 |

JSON请求体必需：CreateReading（完整嵌套定义见模型节）。

| 字段 | 类型/引用 | 必需 | 限制及说明 |
|---|---|---|---|
| kind | string | 是 | 枚举：["tarot","iching"] |
| question | string | 是 | 最短：2；最长：500；说明：服务端 trim 后长度校验 |
| spread | string | 否 | 枚举：["single","three","past-present-future","mind-heart-action","relationship-five","relationship-cross","relationship-bridge","reconciliation","self-love","career-path","career-cross","job-change","project-launch","business-five","money-budget","study-plan","exam-preparation","decision-two","decision-three","crossroads","obstacle-breakthrough","shadow-work","balance-five","new-moon","full-moon","week-ahead","month-ahead","year-wheel","celtic-cross","purpose","creative-spark","travel-transition"]；默认：three |
| allowReversed | boolean | 否 | 默认：true |
| requestId | string | 是 | 格式：uuid |
| scenario | string | 否 | 枚举：["general","relationship","career","decision","resources","study","self","growth","communication","transition","creative","weekly","monthly","annual","lunar"]；默认：general |
| method | string | 否 | 枚举：["coins","numbers","time"]；默认：coins |
| numbers | tuple[integer, integer, integer] | 否 | 最少项：3；最多项：3；说明：数字分别定上卦、下卦、动爻；第三数自身取余6；各项约束：[{"type":"integer","minimum":1,"maximum":1000000000},{"type":"integer","minimum":1,"maximum":1000000000},{"type":"integer","minimum":1,"maximum":1000000000}] |
| time | string | 否 | 格式：date-time；说明：必须带 Z/数值偏移；按上海公历年月日与时辰采用当代简化规则 |

响应：
- 201：ReadingRecord；成功。
- 错误边界：400, 401, 403, 404, 409, 413, 415, 429, 503（共享守卫/资源/校验/业务规则中适用者；不是宣称每条路径必触发每种错误）。
- 计划验收：`LegacyContractParityTest.post_api_v1_readings`, `OwnershipContractTest.post_api_v1_readings_rejects_other_actor`, `IdempotencyRecoveryTest.post_api_v1_readings_replay_and_interruption`。

### 6. GET /api/v1/readings

分页搜索本人的探索记录

- 原实现：`apps/api/src/oracle.controller.ts:12`
- 迁移状态：pending；计划类 `com.staroracle.oracle.OracleController`。
- 权限：live provisioned session + actor/session binding。
- 数据边界：authenticated actor; every resource/cursor/association restricted to actor.id。
- 行为：日期按上海自然日含头尾；dateTo不得早于dateFrom。私文加密搜索仅扫描本人记录，每请求最多600条；即使本页无匹配也可能返回nextCursor，应继续翻页。

参数：

| 位置 | 名称 | 必需 | 类型 | 约束/说明 |
|---|---|---|---|---|
| query | cursor | 否 | string | 格式：uuid |
| query | limit | 否 | integer | 默认：20；最小：1；最大：50 |
| query | q | 否 | string | 最长：100 |
| query | kind | 否 | string | 枚举：["tarot","iching"] |
| query | favorite | 否 | string | 枚举：["true","false"] |
| query | tag | 否 | string | 最短：1；最长：24 |
| query | dateFrom | 否 | string | 格式：date |
| query | dateTo | 否 | string | 格式：date |

请求体：无业务字段。现有所有写请求仍要求JSON Content-Type；daily/today可发空JSON。

响应：
- 200：ReadingRecordPage；成功。
- 错误边界：400, 401, 403, 404, 409, 413, 415, 429, 503（共享守卫/资源/校验/业务规则中适用者；不是宣称每条路径必触发每种错误）。
- 计划验收：`LegacyContractParityTest.get_api_v1_readings`, `OwnershipContractTest.get_api_v1_readings_rejects_other_actor`。

### 7. GET /api/v1/readings/{id}

查看本人记录

- 原实现：`apps/api/src/oracle.controller.ts:13`
- 迁移状态：pending；计划类 `com.staroracle.oracle.OracleController`。
- 权限：live provisioned session + actor/session binding。
- 数据边界：authenticated actor; every resource/cursor/association restricted to actor.id。

参数：

| 位置 | 名称 | 必需 | 类型 | 约束/说明 |
|---|---|---|---|---|
| path | id | 是 | string | 格式：uuid |

请求体：无业务字段。现有所有写请求仍要求JSON Content-Type；daily/today可发空JSON。

响应：
- 200：ReadingRecord；成功。
- 错误边界：400, 401, 403, 404, 409, 413, 415, 429, 503（共享守卫/资源/校验/业务规则中适用者；不是宣称每条路径必触发每种错误）。
- 计划验收：`LegacyContractParityTest.get_api_v1_readings_id`, `OwnershipContractTest.get_api_v1_readings_id_rejects_other_actor`。

### 8. DELETE /api/v1/readings/{id}

删除本人记录及其追问和关联AI缓存

- 原实现：`apps/api/src/oracle.controller.ts:14`
- 迁移状态：pending；计划类 `com.staroracle.oracle.OracleController`。
- 权限：live provisioned session + actor/session binding。
- 数据边界：authenticated actor; every resource/cursor/association restricted to actor.id。
- 行为：ReadingConversation与AIRequest按FK级联删除；已有独立行动保留但readingId置空。额度和审计不退款/撤销；已生成的独立周月回顾仍保留其历史快照，需本人单独删除。

参数：

| 位置 | 名称 | 必需 | 类型 | 约束/说明 |
|---|---|---|---|---|
| path | id | 是 | string | 格式：uuid |
| header | Origin | 是 | string | 格式：uri；必须准确等于服务器 WEB_ORIGIN。所有写请求另须 Content-Type: application/json。 |

请求体：无业务字段。现有所有写请求仍要求JSON Content-Type；daily/today可发空JSON。

响应：
- 200：Ok；成功。
- 错误边界：400, 401, 403, 404, 409, 413, 415, 429, 503（共享守卫/资源/校验/业务规则中适用者；不是宣称每条路径必触发每种错误）。
- 计划验收：`LegacyContractParityTest.delete_api_v1_readings_id`, `OwnershipContractTest.delete_api_v1_readings_id_rejects_other_actor`。

### 9. PATCH /api/v1/readings/{id}/sharing

设置是否向管理员主动共享此记录

- 原实现：`apps/api/src/oracle.controller.ts:15`
- 迁移状态：pending；计划类 `com.staroracle.oracle.OracleController`。
- 权限：live provisioned session + actor/session binding。
- 数据边界：authenticated actor; every resource/cursor/association restricted to actor.id。
- 行为：默认不共享。仅分享问题、牌面/卦象和初次解读；私人标签、备注、日记、追问与行动不进入管理员共享接口。

参数：

| 位置 | 名称 | 必需 | 类型 | 约束/说明 |
|---|---|---|---|---|
| path | id | 是 | string | 格式：uuid |
| header | Origin | 是 | string | 格式：uri；必须准确等于服务器 WEB_ORIGIN。所有写请求另须 Content-Type: application/json。 |

JSON请求体必需：ShareInput（完整嵌套定义见模型节）。

| 字段 | 类型/引用 | 必需 | 限制及说明 |
|---|---|---|---|
| shared | boolean | 是 | — |

响应：
- 200：ReadingRecord；成功。
- 错误边界：400, 401, 403, 404, 409, 413, 415, 429, 503（共享守卫/资源/校验/业务规则中适用者；不是宣称每条路径必触发每种错误）。
- 计划验收：`LegacyContractParityTest.patch_api_v1_readings_id_sharing`, `OwnershipContractTest.patch_api_v1_readings_id_sharing_rejects_other_actor`。

### 10. PATCH /api/v1/readings/{id}/metadata

更新本人收藏、标签与私人备注

- 原实现：`apps/api/src/oracle.controller.ts:16`
- 迁移状态：pending；计划类 `com.staroracle.oracle.OracleController`。
- 权限：live provisioned session + actor/session binding。
- 数据边界：authenticated actor; every resource/cursor/association restricted to actor.id。
- 行为：metadataVersion必须匹配input.version，更新递增；过期409。标签去重，所有元数据按本人归属处理。
- 版本：metadataVersion from body.version; CAS conflict 409。

参数：

| 位置 | 名称 | 必需 | 类型 | 约束/说明 |
|---|---|---|---|---|
| path | id | 是 | string | 格式：uuid |
| header | Origin | 是 | string | 格式：uri；必须准确等于服务器 WEB_ORIGIN。所有写请求另须 Content-Type: application/json。 |

JSON请求体必需：ReadingMetadata（完整嵌套定义见模型节）。

| 字段 | 类型/引用 | 必需 | 限制及说明 |
|---|---|---|---|
| favorite | boolean | 是 | — |
| tags | array<string> | 是 | 最多项：8；每项(最短：1；最长：24) |
| note | string | 是 | 最长：1000 |
| version | integer | 是 | 最小：0 |

响应：
- 200：ReadingRecord；成功。
- 错误边界：400, 401, 403, 404, 409, 413, 415, 429, 503（共享守卫/资源/校验/业务规则中适用者；不是宣称每条路径必触发每种错误）。
- 计划验收：`LegacyContractParityTest.patch_api_v1_readings_id_metadata`, `OwnershipContractTest.patch_api_v1_readings_id_metadata_rejects_other_actor`, `OptimisticVersionTest.patch_api_v1_readings_id_metadata_stale_version_preserves_saved_state`。

### 11. POST /api/v1/readings/{id}/interpret

同意后生成本次固定结果的AI解读

- 原实现：`apps/api/src/oracle.controller.ts:17`
- 迁移状态：pending；计划类 `com.staroracle.ai.ReflectionController`。
- 权限：live provisioned session + actor/session binding。
- 数据边界：authenticated actor; every resource/cursor/association restricted to actor.id。
- 行为：已完成直接返回；生成中409，失败后新尝试需新requestId。每个固定牌/卦reference恰好一次；30秒超时和100KB响应上限。额度在请求认领事务中预留，失败也占尝试额度。
- 幂等/恢复：explicit requestId or stable legacy reading-derived UUID; fingerprint; replay completed model; no repeat failed/pending provider call。

参数：

| 位置 | 名称 | 必需 | 类型 | 约束/说明 |
|---|---|---|---|---|
| path | id | 是 | string | 格式：uuid |
| header | Origin | 是 | string | 格式：uri；必须准确等于服务器 WEB_ORIGIN。所有写请求另须 Content-Type: application/json。 |

JSON请求体必需：AIInput（完整嵌套定义见模型节）。

| 字段 | 类型/引用 | 必需 | 限制及说明 |
|---|---|---|---|
| consent | boolean | 是 | 固定：true |
| requestId | string | 否 | 格式：uuid |

requestId用于同一次尝试的幂等重试；旧客户端省略时按readingId派生稳定ID。真正失败的新尝试需新requestId。

响应：
- 200：ReadingRecord；成功。
- 错误边界：400, 401, 403, 404, 409, 413, 415, 429, 503（共享守卫/资源/校验/业务规则中适用者；不是宣称每条路径必触发每种错误）。
- 计划验收：`LegacyContractParityTest.post_api_v1_readings_id_interpret`, `OwnershipContractTest.post_api_v1_readings_id_interpret_rejects_other_actor`, `IdempotencyRecoveryTest.post_api_v1_readings_id_interpret_replay_and_interruption`。

### 12. GET /api/v1/readings/{id}/conversation

分页查看本人对本次结果的追问

- 原实现：`apps/api/src/oracle.controller.ts:18`
- 迁移状态：pending；计划类 `com.staroracle.ai.ReflectionController`。
- 权限：live provisioned session + actor/session binding。
- 数据边界：authenticated actor; every resource/cursor/association restricted to actor.id。
- 行为：按创建时间正序；游标须属于本人且属于该reading。过期pending转failed。

参数：

| 位置 | 名称 | 必需 | 类型 | 约束/说明 |
|---|---|---|---|---|
| path | id | 是 | string | 格式：uuid |
| query | cursor | 否 | string | 格式：uuid |
| query | limit | 否 | integer | 默认：20；最小：1；最大：50 |

请求体：无业务字段。现有所有写请求仍要求JSON Content-Type；daily/today可发空JSON。

响应：
- 200：ConversationPage；成功。
- 错误边界：400, 401, 403, 404, 409, 413, 415, 429, 503（共享守卫/资源/校验/业务规则中适用者；不是宣称每条路径必触发每种错误）。
- 计划验收：`LegacyContractParityTest.get_api_v1_readings_id_conversation`, `OwnershipContractTest.get_api_v1_readings_id_conversation_rejects_other_actor`。

### 13. POST /api/v1/readings/{id}/conversation

围绕同一次固定结果继续提问

- 原实现：`apps/api/src/oracle.controller.ts:19`
- 迁移状态：pending；计划类 `com.staroracle.ai.ReflectionController`。
- 权限：live provisioned session + actor/session binding。
- 数据边界：authenticated actor; every resource/cursor/association restricted to actor.id。
- 行为：不会重新抽牌/起卦，沿用原证据，包含最近6条已完成追问的受限上下文。相同requestId与prompt幂等；并发pending409。
- 幂等/恢复：userId+requestId unique; reading/prompt/frozen snapshot bound; recover completed paid result without provider call。

参数：

| 位置 | 名称 | 必需 | 类型 | 约束/说明 |
|---|---|---|---|---|
| path | id | 是 | string | 格式：uuid |
| header | Origin | 是 | string | 格式：uri；必须准确等于服务器 WEB_ORIGIN。所有写请求另须 Content-Type: application/json。 |

JSON请求体必需：ConversationInput（完整嵌套定义见模型节）。

| 字段 | 类型/引用 | 必需 | 限制及说明 |
|---|---|---|---|
| prompt | string | 是 | 最短：2；最长：1000 |
| consent | boolean | 是 | 固定：true |
| requestId | string | 是 | 格式：uuid |

响应：
- 200：Conversation；成功。
- 错误边界：400, 401, 403, 404, 409, 413, 415, 429, 503（共享守卫/资源/校验/业务规则中适用者；不是宣称每条路径必触发每种错误）。
- 计划验收：`LegacyContractParityTest.post_api_v1_readings_id_conversation`, `OwnershipContractTest.post_api_v1_readings_id_conversation_rejects_other_actor`, `IdempotencyRecoveryTest.post_api_v1_readings_id_conversation_replay_and_interruption`。

### 14. POST /api/v1/daily/today

领取上海当日唯一星笺

- 原实现：`apps/api/src/oracle.controller.ts:20`
- 迁移状态：pending；计划类 `com.staroracle.oracle.OracleController`。
- 权限：live provisioned session + actor/session binding。
- 数据边界：authenticated actor; every resource/cursor/association restricted to actor.id。
- 行为：唯一userId+date；并发请求返回同一条，每日牌面不会随日记清空改变。无需业务正文，但写请求仍要求Origin和JSON Content-Type。
- 幂等/恢复：userId+Shanghai date unique; replay same saved daily card。

参数：

| 位置 | 名称 | 必需 | 类型 | 约束/说明 |
|---|---|---|---|---|
| header | Origin | 是 | string | 格式：uri；必须准确等于服务器 WEB_ORIGIN。所有写请求另须 Content-Type: application/json。 |

请求体：无业务字段。现有所有写请求仍要求JSON Content-Type；daily/today可发空JSON。

响应：
- 200：DailyRecord；成功。
- 错误边界：400, 401, 403, 404, 409, 413, 415, 429, 503（共享守卫/资源/校验/业务规则中适用者；不是宣称每条路径必触发每种错误）。
- 计划验收：`LegacyContractParityTest.post_api_v1_daily_today`, `OwnershipContractTest.post_api_v1_daily_today_rejects_other_actor`, `IdempotencyRecoveryTest.post_api_v1_daily_today_replay_and_interruption`。

### 15. GET /api/v1/daily

分页查看本人星笺与日记

- 原实现：`apps/api/src/oracle.controller.ts:21`
- 迁移状态：pending；计划类 `com.staroracle.oracle.OracleController`。
- 权限：live provisioned session + actor/session binding。
- 数据边界：authenticated actor; every resource/cursor/association restricted to actor.id。

参数：

| 位置 | 名称 | 必需 | 类型 | 约束/说明 |
|---|---|---|---|---|
| query | cursor | 否 | string | 格式：uuid |
| query | limit | 否 | integer | 默认：90；最小：1；最大：100 |

请求体：无业务字段。现有所有写请求仍要求JSON Content-Type；daily/today可发空JSON。

响应：
- 200：DailyRecordPage；成功。
- 错误边界：400, 401, 403, 404, 409, 413, 415, 429, 503（共享守卫/资源/校验/业务规则中适用者；不是宣称每条路径必触发每种错误）。
- 计划验收：`LegacyContractParityTest.get_api_v1_daily`, `OwnershipContractTest.get_api_v1_daily_rejects_other_actor`。

### 16. GET /api/v1/daily/{id}

查看本人指定历史星笺

- 原实现：`apps/api/src/oracle.controller.ts:22`
- 迁移状态：pending；计划类 `com.staroracle.oracle.OracleController`。
- 权限：live provisioned session + actor/session binding。
- 数据边界：authenticated actor; every resource/cursor/association restricted to actor.id。

参数：

| 位置 | 名称 | 必需 | 类型 | 约束/说明 |
|---|---|---|---|---|
| path | id | 是 | string | 格式：uuid |

请求体：无业务字段。现有所有写请求仍要求JSON Content-Type；daily/today可发空JSON。

响应：
- 200：DailyRecord；成功。
- 错误边界：400, 401, 403, 404, 409, 413, 415, 429, 503（共享守卫/资源/校验/业务规则中适用者；不是宣称每条路径必触发每种错误）。
- 计划验收：`LegacyContractParityTest.get_api_v1_daily_id`, `OwnershipContractTest.get_api_v1_daily_id_rejects_other_actor`。

### 17. PATCH /api/v1/daily/{id}/journal

保存心情与私人日记

- 原实现：`apps/api/src/oracle.controller.ts:23`
- 迁移状态：pending；计划类 `com.staroracle.oracle.OracleController`。
- 权限：live provisioned session + actor/session binding。
- 数据边界：authenticated actor; every resource/cursor/association restricted to actor.id。
- 行为：version不匹配409；指定历史条目也可保存，跨午夜不会把旧草稿写到新日记录。清空日记不删除固定牌面；不会删除已主动生成的历史回顾快照。
- 版本：version from body.version; CAS conflict 409。

参数：

| 位置 | 名称 | 必需 | 类型 | 约束/说明 |
|---|---|---|---|---|
| path | id | 是 | string | 格式：uuid |
| header | Origin | 是 | string | 格式：uri；必须准确等于服务器 WEB_ORIGIN。所有写请求另须 Content-Type: application/json。 |

JSON请求体必需：JournalInput（完整嵌套定义见模型节）。

| 字段 | 类型/引用 | 必需 | 限制及说明 |
|---|---|---|---|
| note | string | 是 | 最长：600 |
| mood | string 或 null | 是 | — |
| version | integer | 是 | 最小：0 |

响应：
- 200：DailyRecord；成功。
- 错误边界：400, 401, 403, 404, 409, 413, 415, 429, 503（共享守卫/资源/校验/业务规则中适用者；不是宣称每条路径必触发每种错误）。
- 计划验收：`LegacyContractParityTest.patch_api_v1_daily_id_journal`, `OwnershipContractTest.patch_api_v1_daily_id_journal_rejects_other_actor`, `OptimisticVersionTest.patch_api_v1_daily_id_journal_stale_version_preserves_saved_state`。

### 18. GET /api/v1/calendar

查看本人的月度心情日历

- 原实现：`apps/api/src/personal.controller.ts:24`
- 迁移状态：pending；计划类 `com.staroracle.personal.PersonalController`。
- 权限：live provisioned session + actor/session binding。
- 数据边界：authenticated actor; every resource/cursor/association restricted to actor.id。
- 行为：返回日期、心情与是否有日记；不重复返回日记正文。

参数：

| 位置 | 名称 | 必需 | 类型 | 约束/说明 |
|---|---|---|---|---|
| query | month | 否 | string | 正则：^20\d\d-(0[1-9]\|1[0-2])$；说明：默认上海当前月份 |

请求体：无业务字段。现有所有写请求仍要求JSON Content-Type；daily/today可发空JSON。

响应：
- 200：Calendar；成功。
- 错误边界：400, 401, 403, 404, 409, 413, 415, 429, 503（共享守卫/资源/校验/业务规则中适用者；不是宣称每条路径必触发每种错误）。
- 计划验收：`LegacyContractParityTest.get_api_v1_calendar`, `OwnershipContractTest.get_api_v1_calendar_rejects_other_actor`。

### 19. GET /api/v1/insights

查看本人周或月统计与本地反思

- 原实现：`apps/api/src/personal.controller.ts:25`
- 迁移状态：pending；计划类 `com.staroracle.personal.PersonalController`。
- 权限：live provisioned session + actor/session binding。
- 数据边界：authenticated actor; every resource/cursor/association restricted to actor.id。
- 行为：周为周一到周日，月为自然月，上海日界。没有模型调用，也不发送/返回日记正文。

参数：

| 位置 | 名称 | 必需 | 类型 | 约束/说明 |
|---|---|---|---|---|
| query | period | 否 | string | 枚举：["week","month"]；默认：week |
| query | date | 否 | string | 格式：date；正则：^20\d\d-\d{2}-\d{2}$；说明：实际存在的公历日期，默认上海当日 |

请求体：无业务字段。现有所有写请求仍要求JSON Content-Type；daily/today可发空JSON。

响应：
- 200：Insights；成功。
- 错误边界：400, 401, 403, 404, 409, 413, 415, 429, 503（共享守卫/资源/校验/业务规则中适用者；不是宣称每条路径必触发每种错误）。
- 计划验收：`LegacyContractParityTest.get_api_v1_insights`, `OwnershipContractTest.get_api_v1_insights_rejects_other_actor`。

### 20. GET /api/v1/insights/reports

分页查看本人的AI回顾

- 原实现：`apps/api/src/personal.controller.ts:26`
- 迁移状态：pending；计划类 `com.staroracle.personal.PersonalController`。
- 权限：live provisioned session + actor/session binding。
- 数据边界：authenticated actor; every resource/cursor/association restricted to actor.id。

参数：

| 位置 | 名称 | 必需 | 类型 | 约束/说明 |
|---|---|---|---|---|
| query | cursor | 否 | string | 格式：uuid |
| query | limit | 否 | integer | 默认：20；最小：1；最大：50 |

请求体：无业务字段。现有所有写请求仍要求JSON Content-Type；daily/today可发空JSON。

响应：
- 200：ReportPage；成功。
- 错误边界：400, 401, 403, 404, 409, 413, 415, 429, 503（共享守卫/资源/校验/业务规则中适用者；不是宣称每条路径必触发每种错误）。
- 计划验收：`LegacyContractParityTest.get_api_v1_insights_reports`, `OwnershipContractTest.get_api_v1_insights_reports_rejects_other_actor`。

### 21. POST /api/v1/insights/reports

主动生成本人周或月AI回顾

- 原实现：`apps/api/src/personal.controller.ts:28`
- 迁移状态：pending；计划类 `com.staroracle.ai.ReflectionController`。
- 权限：live provisioned session + actor/session binding。
- 数据边界：authenticated actor; every resource/cursor/association restricted to actor.id。
- 行为：默认不发送日记正文；includeJournal=true额外明确选择才纳入最多最近10天每条500字。最多最近6次探索各取前2条证据，未包含资料不推断。输入加密快照固定，恢复复用同一快照；之后修改原日记不会改变该回顾。
- 幂等/恢复：userId+requestId unique; period/start/includeJournal+immutable snapshot bound; recover completed paid result。

参数：

| 位置 | 名称 | 必需 | 类型 | 约束/说明 |
|---|---|---|---|---|
| header | Origin | 是 | string | 格式：uri；必须准确等于服务器 WEB_ORIGIN。所有写请求另须 Content-Type: application/json。 |

JSON请求体必需：ReportCreate（完整嵌套定义见模型节）。

| 字段 | 类型/引用 | 必需 | 限制及说明 |
|---|---|---|---|
| period | string | 是 | 枚举：["week","month"] |
| date | string | 是 | 格式：date；正则：^20\d\d-\d{2}-\d{2}$；说明：2000..2099 的真实公历日期 |
| includeJournal | boolean | 否 | 默认：false |
| consent | boolean | 是 | 固定：true |
| requestId | string | 是 | 格式：uuid |

响应：
- 201：Report；成功。
- 错误边界：400, 401, 403, 404, 409, 413, 415, 429, 503（共享守卫/资源/校验/业务规则中适用者；不是宣称每条路径必触发每种错误）。
- 计划验收：`LegacyContractParityTest.post_api_v1_insights_reports`, `OwnershipContractTest.post_api_v1_insights_reports_rejects_other_actor`, `IdempotencyRecoveryTest.post_api_v1_insights_reports_replay_and_interruption`。

### 22. DELETE /api/v1/insights/reports/{id}

删除本人回顾及关联AI缓存与输入快照

- 原实现：`apps/api/src/personal.controller.ts:27`
- 迁移状态：pending；计划类 `com.staroracle.personal.PersonalController`。
- 权限：live provisioned session + actor/session binding。
- 数据边界：authenticated actor; every resource/cursor/association restricted to actor.id。
- 行为：FK级联删除AIRequest；额度/账本和审计不退款或删除，原占卜与日记保留。

参数：

| 位置 | 名称 | 必需 | 类型 | 约束/说明 |
|---|---|---|---|---|
| path | id | 是 | string | 格式：uuid |
| header | Origin | 是 | string | 格式：uri；必须准确等于服务器 WEB_ORIGIN。所有写请求另须 Content-Type: application/json。 |

请求体：无业务字段。现有所有写请求仍要求JSON Content-Type；daily/today可发空JSON。

响应：
- 200：Ok；成功。
- 错误边界：400, 401, 403, 404, 409, 413, 415, 429, 503（共享守卫/资源/校验/业务规则中适用者；不是宣称每条路径必触发每种错误）。
- 计划验收：`LegacyContractParityTest.delete_api_v1_insights_reports_id`, `OwnershipContractTest.delete_api_v1_insights_reports_id_rejects_other_actor`。

### 23. GET /api/v1/actions

按状态分页查看本人行动计划

- 原实现：`apps/api/src/personal.controller.ts:29`
- 迁移状态：pending；计划类 `com.staroracle.personal.PersonalController`。
- 权限：live provisioned session + actor/session binding。
- 数据边界：authenticated actor; every resource/cursor/association restricted to actor.id。

参数：

| 位置 | 名称 | 必需 | 类型 | 约束/说明 |
|---|---|---|---|---|
| query | cursor | 否 | string | 格式：uuid |
| query | limit | 否 | integer | 默认：20；最小：1；最大：50 |
| query | status | 否 | string | 枚举：["all","open","done"]；默认：all |

请求体：无业务字段。现有所有写请求仍要求JSON Content-Type；daily/today可发空JSON。

响应：
- 200：ActionPage；成功。
- 错误边界：400, 401, 403, 404, 409, 413, 415, 429, 503（共享守卫/资源/校验/业务规则中适用者；不是宣称每条路径必触发每种错误）。
- 计划验收：`LegacyContractParityTest.get_api_v1_actions`, `OwnershipContractTest.get_api_v1_actions_rejects_other_actor`。

### 24. POST /api/v1/actions

创建本人行动计划

- 原实现：`apps/api/src/personal.controller.ts:31`
- 迁移状态：pending；计划类 `com.staroracle.personal.PersonalController`。
- 权限：live provisioned session + actor/session binding。
- 数据边界：authenticated actor; every resource/cursor/association restricted to actor.id。
- 行为：readingId若提供必须属于本人；文本应用层加密，每用户30次/60秒创建限制。

参数：

| 位置 | 名称 | 必需 | 类型 | 约束/说明 |
|---|---|---|---|---|
| header | Origin | 是 | string | 格式：uri；必须准确等于服务器 WEB_ORIGIN。所有写请求另须 Content-Type: application/json。 |

JSON请求体必需：ActionCreate（完整嵌套定义见模型节）。

| 字段 | 类型/引用 | 必需 | 限制及说明 |
|---|---|---|---|
| title | string | 是 | 最短：1；最长：160 |
| detail | string | 否 | 最长：1000 |
| readingId | string | 否 | 格式：uuid |
| dueDate | string 或 null | 否 | — |

响应：
- 201：Action；成功。
- 错误边界：400, 401, 403, 404, 409, 413, 415, 429, 503（共享守卫/资源/校验/业务规则中适用者；不是宣称每条路径必触发每种错误）。
- 计划验收：`LegacyContractParityTest.post_api_v1_actions`, `OwnershipContractTest.post_api_v1_actions_rejects_other_actor`。

### 25. GET /api/v1/actions/{id}

查看本人行动

- 原实现：`apps/api/src/personal.controller.ts:30`
- 迁移状态：pending；计划类 `com.staroracle.personal.PersonalController`。
- 权限：live provisioned session + actor/session binding。
- 数据边界：authenticated actor; every resource/cursor/association restricted to actor.id。

参数：

| 位置 | 名称 | 必需 | 类型 | 约束/说明 |
|---|---|---|---|---|
| path | id | 是 | string | 格式：uuid |

请求体：无业务字段。现有所有写请求仍要求JSON Content-Type；daily/today可发空JSON。

响应：
- 200：Action；成功。
- 错误边界：400, 401, 403, 404, 409, 413, 415, 429, 503（共享守卫/资源/校验/业务规则中适用者；不是宣称每条路径必触发每种错误）。
- 计划验收：`LegacyContractParityTest.get_api_v1_actions_id`, `OwnershipContractTest.get_api_v1_actions_id_rejects_other_actor`。

### 26. PATCH /api/v1/actions/{id}

版本控制更新本人行动

- 原实现：`apps/api/src/personal.controller.ts:32`
- 迁移状态：pending；计划类 `com.staroracle.personal.PersonalController`。
- 权限：live provisioned session + actor/session binding。
- 数据边界：authenticated actor; every resource/cursor/association restricted to actor.id。
- 行为：version过期409。completed=true保留已有完成时间；false清空完成时间。
- 版本：version from body.version; CAS conflict 409。

参数：

| 位置 | 名称 | 必需 | 类型 | 约束/说明 |
|---|---|---|---|---|
| path | id | 是 | string | 格式：uuid |
| header | Origin | 是 | string | 格式：uri；必须准确等于服务器 WEB_ORIGIN。所有写请求另须 Content-Type: application/json。 |

JSON请求体必需：ActionEdit（完整嵌套定义见模型节）。

| 字段 | 类型/引用 | 必需 | 限制及说明 |
|---|---|---|---|
| title | string | 是 | 最短：1；最长：160 |
| detail | string | 是 | 最长：1000 |
| dueDate | string 或 null | 是 | — |
| completed | boolean | 是 | — |
| version | integer | 是 | 最小：0 |

响应：
- 200：Action；成功。
- 错误边界：400, 401, 403, 404, 409, 413, 415, 429, 503（共享守卫/资源/校验/业务规则中适用者；不是宣称每条路径必触发每种错误）。
- 计划验收：`LegacyContractParityTest.patch_api_v1_actions_id`, `OwnershipContractTest.patch_api_v1_actions_id_rejects_other_actor`, `OptimisticVersionTest.patch_api_v1_actions_id_stale_version_preserves_saved_state`。

### 27. DELETE /api/v1/actions/{id}

删除本人行动

- 原实现：`apps/api/src/personal.controller.ts:33`
- 迁移状态：pending；计划类 `com.staroracle.personal.PersonalController`。
- 权限：live provisioned session + actor/session binding。
- 数据边界：authenticated actor; every resource/cursor/association restricted to actor.id。

参数：

| 位置 | 名称 | 必需 | 类型 | 约束/说明 |
|---|---|---|---|---|
| path | id | 是 | string | 格式：uuid |
| header | Origin | 是 | string | 格式：uri；必须准确等于服务器 WEB_ORIGIN。所有写请求另须 Content-Type: application/json。 |

请求体：无业务字段。现有所有写请求仍要求JSON Content-Type；daily/today可发空JSON。

响应：
- 200：Ok；成功。
- 错误边界：400, 401, 403, 404, 409, 413, 415, 429, 503（共享守卫/资源/校验/业务规则中适用者；不是宣称每条路径必触发每种错误）。
- 计划验收：`LegacyContractParityTest.delete_api_v1_actions_id`, `OwnershipContractTest.delete_api_v1_actions_id_rejects_other_actor`。

### 28. GET /api/v1/feedback

分页查看本人的反馈与站内回复

- 原实现：`apps/api/src/personal.controller.ts:34`
- 迁移状态：pending；计划类 `com.staroracle.personal.PersonalController`。
- 权限：live provisioned session + actor/session binding。
- 数据边界：authenticated actor; every resource/cursor/association restricted to actor.id。

参数：

| 位置 | 名称 | 必需 | 类型 | 约束/说明 |
|---|---|---|---|---|
| query | cursor | 否 | string | 格式：uuid |
| query | limit | 否 | integer | 默认：20；最小：1；最大：50 |

请求体：无业务字段。现有所有写请求仍要求JSON Content-Type；daily/today可发空JSON。

响应：
- 200：FeedbackPage；成功。
- 错误边界：400, 401, 403, 404, 409, 413, 415, 429, 503（共享守卫/资源/校验/业务规则中适用者；不是宣称每条路径必触发每种错误）。
- 计划验收：`LegacyContractParityTest.get_api_v1_feedback`, `OwnershipContractTest.get_api_v1_feedback_rejects_other_actor`。

### 29. POST /api/v1/feedback

主动向运营者提交反馈

- 原实现：`apps/api/src/personal.controller.ts:35`
- 迁移状态：pending；计划类 `com.staroracle.personal.PersonalController`。
- 权限：live provisioned session + actor/session binding。
- 数据边界：authenticated actor; every resource/cursor/association restricted to actor.id。
- 行为：反馈正文及回复加密；管理员可读取用户主动提交的反馈。每用户3次/小时，不自动发送邮件。

参数：

| 位置 | 名称 | 必需 | 类型 | 约束/说明 |
|---|---|---|---|---|
| header | Origin | 是 | string | 格式：uri；必须准确等于服务器 WEB_ORIGIN。所有写请求另须 Content-Type: application/json。 |

JSON请求体必需：FeedbackCreate（完整嵌套定义见模型节）。

| 字段 | 类型/引用 | 必需 | 限制及说明 |
|---|---|---|---|
| category | string | 是 | 枚举：["bug","idea","account","other"] |
| body | string | 是 | 最短：2；最长：2000 |

响应：
- 201：Feedback；成功。
- 错误边界：400, 401, 403, 404, 409, 413, 415, 429, 503（共享守卫/资源/校验/业务规则中适用者；不是宣称每条路径必触发每种错误）。
- 计划验收：`LegacyContractParityTest.post_api_v1_feedback`, `OwnershipContractTest.post_api_v1_feedback_rejects_other_actor`。

### 30. GET /api/v1/membership

查看本人会员、余额与当日额度

- 原实现：`apps/api/src/personal.controller.ts:36`
- 迁移状态：pending；计划类 `com.staroracle.membership.MembershipController`。
- 权限：live provisioned session + actor/session binding。
- 数据边界：authenticated actor; every resource/cursor/association restricted to actor.id。
- 行为：free每日5次、未到期plus每日20次；用完后可消费credits。额度认领与全站AI预算采用同一个captured上海账期。

参数：
无独立path/query参数；通用身份头、Cookie/Origin规则仍适用。

请求体：无业务字段。现有所有写请求仍要求JSON Content-Type；daily/today可发空JSON。

响应：
- 200：Membership；成功。
- 错误边界：400, 401, 403, 404, 409, 413, 415, 429, 503（共享守卫/资源/校验/业务规则中适用者；不是宣称每条路径必触发每种错误）。
- 计划验收：`LegacyContractParityTest.get_api_v1_membership`, `OwnershipContractTest.get_api_v1_membership_rejects_other_actor`。

### 31. GET /api/v1/membership/redemptions

分页查看本人兑换历史

- 原实现：`apps/api/src/personal.controller.ts:37`
- 迁移状态：pending；计划类 `com.staroracle.membership.MembershipController`。
- 权限：live provisioned session + actor/session binding。
- 数据边界：authenticated actor; every resource/cursor/association restricted to actor.id。
- 行为：仅提示码尾段与类型，不提供完整兑换码或codeHash。

参数：

| 位置 | 名称 | 必需 | 类型 | 约束/说明 |
|---|---|---|---|---|
| query | cursor | 否 | string | 格式：uuid |
| query | limit | 否 | integer | 默认：20；最小：1；最大：50 |

请求体：无业务字段。现有所有写请求仍要求JSON Content-Type；daily/today可发空JSON。

响应：
- 200：RedemptionPage；成功。
- 错误边界：400, 401, 403, 404, 409, 413, 415, 429, 503（共享守卫/资源/校验/业务规则中适用者；不是宣称每条路径必触发每种错误）。
- 计划验收：`LegacyContractParityTest.get_api_v1_membership_redemptions`, `OwnershipContractTest.get_api_v1_membership_redemptions_rejects_other_actor`。

### 32. GET /api/v1/membership/ledger

分页查看本人额度账本

- 原实现：`apps/api/src/personal.controller.ts:38`
- 迁移状态：pending；计划类 `com.staroracle.membership.MembershipController`。
- 权限：live provisioned session + actor/session binding。
- 数据边界：authenticated actor; every resource/cursor/association restricted to actor.id。

参数：

| 位置 | 名称 | 必需 | 类型 | 约束/说明 |
|---|---|---|---|---|
| query | cursor | 否 | string | 格式：uuid |
| query | limit | 否 | integer | 默认：20；最小：1；最大：50 |

请求体：无业务字段。现有所有写请求仍要求JSON Content-Type；daily/today可发空JSON。

响应：
- 200：LedgerPage；成功。
- 错误边界：400, 401, 403, 404, 409, 413, 415, 429, 503（共享守卫/资源/校验/业务规则中适用者；不是宣称每条路径必触发每种错误）。
- 计划验收：`LegacyContractParityTest.get_api_v1_membership_ledger`, `OwnershipContractTest.get_api_v1_membership_ledger_rejects_other_actor`。

### 33. GET /api/v1/membership/payment-options

获取现金支付开放状态

- 原实现：`apps/api/src/personal.controller.ts:39`
- 迁移状态：pending；计划类 `com.staroracle.membership.MembershipController`。
- 权限：live provisioned session + actor/session binding。
- 数据边界：authenticated actor; every resource/cursor/association restricted to actor.id。
- 行为：当前enabled=false、providers=[]，不会创建支付订单或假付款成功记录。

参数：
无独立path/query参数；通用身份头、Cookie/Origin规则仍适用。

请求体：无业务字段。现有所有写请求仍要求JSON Content-Type；daily/today可发空JSON。

响应：
- 200：PaymentOptions；成功。
- 错误边界：400, 401, 403, 404, 409, 413, 415, 429, 503（共享守卫/资源/校验/业务规则中适用者；不是宣称每条路径必触发每种错误）。
- 计划验收：`LegacyContractParityTest.get_api_v1_membership_payment_options`, `OwnershipContractTest.get_api_v1_membership_payment_options_rejects_other_actor`。

### 34. POST /api/v1/membership/redeem

兑换额度或会员期限

- 原实现：`apps/api/src/personal.controller.ts:40`
- 迁移状态：pending；计划类 `com.staroracle.membership.MembershipController`。
- 权限：live provisioned session + actor/session binding。
- 数据边界：authenticated actor; every resource/cursor/association restricted to actor.id。
- 行为：每用户6次/300秒；Serializable事务、条件usedCount递增、用户码唯一约束、账本原子更新。重复已兑换返回409，不重复发放。会员期限从当前有效到期时间或现在开始延长。
- 幂等/恢复：userId+codeId uniqueness; atomic maxUses and credits/expiry/ledger transaction。

参数：

| 位置 | 名称 | 必需 | 类型 | 约束/说明 |
|---|---|---|---|---|
| header | Origin | 是 | string | 格式：uri；必须准确等于服务器 WEB_ORIGIN。所有写请求另须 Content-Type: application/json。 |

JSON请求体必需：RedeemInput（完整嵌套定义见模型节）。

| 字段 | 类型/引用 | 必需 | 限制及说明 |
|---|---|---|---|
| code | string | 是 | 最短：18；最长：80；正则：^[A-Za-z0-9-]+$；说明：服务端移除连字符、转大写后SHA-256匹配；同用户同码只能兑换一次 |

响应：
- 201：Membership；成功。
- 错误边界：400, 401, 403, 404, 409, 413, 415, 429, 503（共享守卫/资源/校验/业务规则中适用者；不是宣称每条路径必触发每种错误）。
- 计划验收：`LegacyContractParityTest.post_api_v1_membership_redeem`, `OwnershipContractTest.post_api_v1_membership_redeem_rejects_other_actor`, `IdempotencyRecoveryTest.post_api_v1_membership_redeem_replay_and_interruption`。

### 35. GET /api/v1/me/export

导出本人全部可见关联数据

- 原实现：`apps/api/src/personal.controller.ts:41`
- 迁移状态：pending；计划类 `com.staroracle.personal.PersonalController`。
- 权限：live provisioned session + actor/session binding。
- 数据边界：authenticated actor; every resource/cursor/association restricted to actor.id。
- 行为：每用户2次/300秒。包含全部读取记录、日记、追问、回顾、行动、反馈、会员、额度账本及兑换历史；没有无声取前几页。行数/字节过大拒绝413。内部inputCipher与重复AI缓存不默认导出，密码/TOTP/完整兑换码不导出。

参数：
无独立path/query参数；通用身份头、Cookie/Origin规则仍适用。

请求体：无业务字段。现有所有写请求仍要求JSON Content-Type；daily/today可发空JSON。

响应：
- 200：Export；成功。
- 错误边界：400, 401, 403, 404, 409, 413, 415, 429, 503（共享守卫/资源/校验/业务规则中适用者；不是宣称每条路径必触发每种错误）。
- 计划验收：`LegacyContractParityTest.get_api_v1_me_export`, `OwnershipContractTest.get_api_v1_me_export_rejects_other_actor`。

### 36. GET /api/v1/content

分页查看已发布的纯文本内容

- 原实现：`apps/api/src/personal.controller.ts:46`
- 迁移状态：pending；计划类 `com.staroracle.personal.PersonalController`。
- 权限：public。
- 数据边界：none (published content only)。

参数：

| 位置 | 名称 | 必需 | 类型 | 约束/说明 |
|---|---|---|---|---|
| query | cursor | 否 | string | 格式：uuid |
| query | limit | 否 | integer | 默认：20；最小：1；最大：50 |
| query | kind | 否 | string | 枚举：["announcement","guide"] |

请求体：无业务字段。现有所有写请求仍要求JSON Content-Type；daily/today可发空JSON。

响应：
- 200：ContentPage；成功。
- 错误边界：400, 401, 403, 404, 409, 413, 415, 429, 503（共享守卫/资源/校验/业务规则中适用者；不是宣称每条路径必触发每种错误）。
- 计划验收：`LegacyContractParityTest.get_api_v1_content`。

### 37. GET /api/v1/content/{slug}

查看已发布的公开内容

- 原实现：`apps/api/src/personal.controller.ts:47`
- 迁移状态：pending；计划类 `com.staroracle.personal.PersonalController`。
- 权限：public。
- 数据边界：none (published content only)。
- 行为：草稿不公开；slug按固定字符与长度规则校验，正文按纯文本渲染。

参数：

| 位置 | 名称 | 必需 | 类型 | 约束/说明 |
|---|---|---|---|---|
| path | slug | 是 | string | 最长：80；正则：^[a-z0-9]+(?:-[a-z0-9]+)*$ |

请求体：无业务字段。现有所有写请求仍要求JSON Content-Type；daily/today可发空JSON。

响应：
- 200：Content；成功。
- 错误边界：400, 401, 403, 404, 409, 413, 415, 429, 503（共享守卫/资源/校验/业务规则中适用者；不是宣称每条路径必触发每种错误）。
- 计划验收：`LegacyContractParityTest.get_api_v1_content_slug`。

### 38. GET /api/v1/admin/overview

查看服务状态与总量

- 原实现：`apps/api/src/admin.controller.ts:23`
- 迁移状态：pending；计划类 `com.staroracle.administration.AdministrationController`。
- 权限：admin + live provisioned session + 2FA。
- 数据边界：admin role + configured 2FA; shared-only reading/content-free audit boundary。

参数：
无独立path/query参数；通用身份头、Cookie/Origin规则仍适用。

请求体：无业务字段。现有所有写请求仍要求JSON Content-Type；daily/today可发空JSON。

响应：
- 200：AdminOverview；成功。
- 错误边界：400, 401, 403, 404, 409, 413, 415, 429, 503（共享守卫/资源/校验/业务规则中适用者；不是宣称每条路径必触发每种错误）。
- 计划验收：`LegacyContractParityTest.get_api_v1_admin_overview`, `OwnershipContractTest.get_api_v1_admin_overview_rejects_other_actor`, `AdminBoundaryTest.get_api_v1_admin_overview_requires_admin_second_factor`。

### 39. GET /api/v1/admin/statistics

查看30或90天运营趋势

- 原实现：`apps/api/src/admin.controller.ts:24`
- 迁移状态：pending；计划类 `com.staroracle.administration.AdministrationController`。
- 权限：admin + live provisioned session + 2FA。
- 数据边界：admin role + configured 2FA; shared-only reading/content-free audit boundary。
- 行为：只有聚合数量与分类，不返回私人正文。

参数：

| 位置 | 名称 | 必需 | 类型 | 约束/说明 |
|---|---|---|---|---|
| query | days | 否 | integer | 枚举：[30,90]；默认：30；最小：0 |

请求体：无业务字段。现有所有写请求仍要求JSON Content-Type；daily/today可发空JSON。

响应：
- 200：AdminStatistics；成功。
- 错误边界：400, 401, 403, 404, 409, 413, 415, 429, 503（共享守卫/资源/校验/业务规则中适用者；不是宣称每条路径必触发每种错误）。
- 计划验收：`LegacyContractParityTest.get_api_v1_admin_statistics`, `OwnershipContractTest.get_api_v1_admin_statistics_rejects_other_actor`, `AdminBoundaryTest.get_api_v1_admin_statistics_requires_admin_second_factor`。

### 40. GET /api/v1/admin/users

分页查看基本用户信息与会员状态

- 原实现：`apps/api/src/admin.controller.ts:25`
- 迁移状态：pending；计划类 `com.staroracle.administration.AdministrationController`。
- 权限：admin + live provisioned session + 2FA。
- 数据边界：admin role + configured 2FA; shared-only reading/content-free audit boundary。

参数：

| 位置 | 名称 | 必需 | 类型 | 约束/说明 |
|---|---|---|---|---|
| query | cursor | 否 | string | 正则：^[a-zA-Z0-9-]{8,80}$ |
| query | limit | 否 | integer | 默认：20；最小：1；最大：50 |

请求体：无业务字段。现有所有写请求仍要求JSON Content-Type；daily/today可发空JSON。

响应：
- 200：AdminUserPage；成功。
- 错误边界：400, 401, 403, 404, 409, 413, 415, 429, 503（共享守卫/资源/校验/业务规则中适用者；不是宣称每条路径必触发每种错误）。
- 计划验收：`LegacyContractParityTest.get_api_v1_admin_users`, `OwnershipContractTest.get_api_v1_admin_users_rejects_other_actor`, `AdminBoundaryTest.get_api_v1_admin_users_requires_admin_second_factor`。

### 41. PATCH /api/v1/admin/users/{id}/status

停用或恢复普通用户

- 原实现：`apps/api/src/admin.controller.ts:26`
- 迁移状态：pending；计划类 `com.staroracle.administration.AdministrationController`。
- 权限：admin + live provisioned session + 2FA。
- 数据边界：admin role + configured 2FA; shared-only reading/content-free audit boundary。
- 行为：停用事务删除会话；管理员账户和本人管理账户只允许服务器离线维护。

参数：

| 位置 | 名称 | 必需 | 类型 | 约束/说明 |
|---|---|---|---|---|
| path | id | 是 | string | 正则：^[a-zA-Z0-9-]{8,80}$ |
| header | Origin | 是 | string | 格式：uri；必须准确等于服务器 WEB_ORIGIN。所有写请求另须 Content-Type: application/json。 |

JSON请求体必需：UserStatus（完整嵌套定义见模型节）。

| 字段 | 类型/引用 | 必需 | 限制及说明 |
|---|---|---|---|
| disabled | boolean | 是 | — |

响应：
- 200：Ok；成功。
- 错误边界：400, 401, 403, 404, 409, 413, 415, 429, 503（共享守卫/资源/校验/业务规则中适用者；不是宣称每条路径必触发每种错误）。
- 计划验收：`LegacyContractParityTest.patch_api_v1_admin_users_id_status`, `OwnershipContractTest.patch_api_v1_admin_users_id_status_rejects_other_actor`, `AdminBoundaryTest.patch_api_v1_admin_users_id_status_requires_admin_second_factor`。

### 42. PATCH /api/v1/admin/users/{id}/membership

设置会员期限或绝对额度余额

- 原实现：`apps/api/src/admin.controller.ts:27`
- 迁移状态：pending；计划类 `com.staroracle.membership.MembershipController`。
- 权限：admin + live provisioned session + 2FA。
- 数据边界：admin role + configured 2FA; shared-only reading/content-free audit boundary。
- 行为：事务重试保护并发；余额变化记差额账本与无正文审计。

参数：

| 位置 | 名称 | 必需 | 类型 | 约束/说明 |
|---|---|---|---|---|
| path | id | 是 | string | 正则：^[a-zA-Z0-9-]{8,80}$ |
| header | Origin | 是 | string | 格式：uri；必须准确等于服务器 WEB_ORIGIN。所有写请求另须 Content-Type: application/json。 |

JSON请求体必需：MemberUpdate（完整嵌套定义见模型节）。

| 字段 | 类型/引用 | 必需 | 限制及说明 |
|---|---|---|---|
| tier | string | 是 | 枚举：["free","plus"] |
| expiresAt | string 或 null | 否 | — |
| credits | integer | 否 | 最小：0；最大：100000000 |

plus必须提供未来expiresAt；credits为绝对目标余额，账本记录差额。free清空会员到期时间。

响应：
- 200：Membership；成功。
- 错误边界：400, 401, 403, 404, 409, 413, 415, 429, 503（共享守卫/资源/校验/业务规则中适用者；不是宣称每条路径必触发每种错误）。
- 计划验收：`LegacyContractParityTest.patch_api_v1_admin_users_id_membership`, `OwnershipContractTest.patch_api_v1_admin_users_id_membership_rejects_other_actor`, `AdminBoundaryTest.patch_api_v1_admin_users_id_membership_requires_admin_second_factor`。

### 43. GET /api/v1/admin/shared-readings

分页查看用户主动共享的探索

- 原实现：`apps/api/src/admin.controller.ts:28`
- 迁移状态：pending；计划类 `com.staroracle.administration.AdministrationController`。
- 权限：admin + live provisioned session + 2FA。
- 数据边界：admin role + configured 2FA; shared-only reading/content-free audit boundary。
- 行为：shared=true方可查询；私人note/tags为空、favorite=false、metadataVersion=0，追问不返回。访问记无正文审计。

参数：

| 位置 | 名称 | 必需 | 类型 | 约束/说明 |
|---|---|---|---|---|
| query | cursor | 否 | string | 格式：uuid |
| query | limit | 否 | integer | 默认：20；最小：1；最大：50 |

请求体：无业务字段。现有所有写请求仍要求JSON Content-Type；daily/today可发空JSON。

响应：
- 200：ReadingRecordPage；成功。
- 错误边界：400, 401, 403, 404, 409, 413, 415, 429, 503（共享守卫/资源/校验/业务规则中适用者；不是宣称每条路径必触发每种错误）。
- 计划验收：`LegacyContractParityTest.get_api_v1_admin_shared_readings`, `OwnershipContractTest.get_api_v1_admin_shared_readings_rejects_other_actor`, `AdminBoundaryTest.get_api_v1_admin_shared_readings_requires_admin_second_factor`。

### 44. GET /api/v1/admin/audit

分页查看无正文审计

- 原实现：`apps/api/src/admin.controller.ts:29`
- 迁移状态：pending；计划类 `com.staroracle.administration.AdministrationController`。
- 权限：admin + live provisioned session + 2FA。
- 数据边界：admin role + configured 2FA; shared-only reading/content-free audit boundary。

参数：

| 位置 | 名称 | 必需 | 类型 | 约束/说明 |
|---|---|---|---|---|
| query | cursor | 否 | string | 格式：uuid |
| query | limit | 否 | integer | 默认：20；最小：1；最大：50 |

请求体：无业务字段。现有所有写请求仍要求JSON Content-Type；daily/today可发空JSON。

响应：
- 200：AuditPage；成功。
- 错误边界：400, 401, 403, 404, 409, 413, 415, 429, 503（共享守卫/资源/校验/业务规则中适用者；不是宣称每条路径必触发每种错误）。
- 计划验收：`LegacyContractParityTest.get_api_v1_admin_audit`, `OwnershipContractTest.get_api_v1_admin_audit_rejects_other_actor`, `AdminBoundaryTest.get_api_v1_admin_audit_requires_admin_second_factor`。

### 45. GET /api/v1/admin/content

分页查看内容草稿与发布状态

- 原实现：`apps/api/src/admin.controller.ts:30`
- 迁移状态：pending；计划类 `com.staroracle.administration.AdministrationController`。
- 权限：admin + live provisioned session + 2FA。
- 数据边界：admin role + configured 2FA; shared-only reading/content-free audit boundary。

参数：

| 位置 | 名称 | 必需 | 类型 | 约束/说明 |
|---|---|---|---|---|
| query | cursor | 否 | string | 格式：uuid |
| query | limit | 否 | integer | 默认：20；最小：1；最大：50 |
| query | kind | 否 | string | 枚举：["announcement","guide"] |

请求体：无业务字段。现有所有写请求仍要求JSON Content-Type；daily/today可发空JSON。

响应：
- 200：ContentPage；成功。
- 错误边界：400, 401, 403, 404, 409, 413, 415, 429, 503（共享守卫/资源/校验/业务规则中适用者；不是宣称每条路径必触发每种错误）。
- 计划验收：`LegacyContractParityTest.get_api_v1_admin_content`, `OwnershipContractTest.get_api_v1_admin_content_rejects_other_actor`, `AdminBoundaryTest.get_api_v1_admin_content_requires_admin_second_factor`。

### 46. POST /api/v1/admin/content

创建纯文本内容或公告

- 原实现：`apps/api/src/admin.controller.ts:31`
- 迁移状态：pending；计划类 `com.staroracle.administration.AdministrationController`。
- 权限：admin + live provisioned session + 2FA。
- 数据边界：admin role + configured 2FA; shared-only reading/content-free audit boundary。

参数：

| 位置 | 名称 | 必需 | 类型 | 约束/说明 |
|---|---|---|---|---|
| header | Origin | 是 | string | 格式：uri；必须准确等于服务器 WEB_ORIGIN。所有写请求另须 Content-Type: application/json。 |

JSON请求体必需：ContentInput（完整嵌套定义见模型节）。

| 字段 | 类型/引用 | 必需 | 限制及说明 |
|---|---|---|---|
| slug | string | 是 | 最长：80；正则：^[a-z0-9]+(?:-[a-z0-9]+)*$ |
| kind | string | 是 | 枚举：["announcement","guide"] |
| title | string | 是 | 最短：1；最长：160 |
| body | string | 是 | 最长：10000；说明：纯文本，不作为HTML渲染 |
| published | boolean | 是 | — |

响应：
- 201：Content；成功。
- 错误边界：400, 401, 403, 404, 409, 413, 415, 429, 503（共享守卫/资源/校验/业务规则中适用者；不是宣称每条路径必触发每种错误）。
- 计划验收：`LegacyContractParityTest.post_api_v1_admin_content`, `OwnershipContractTest.post_api_v1_admin_content_rejects_other_actor`, `AdminBoundaryTest.post_api_v1_admin_content_requires_admin_second_factor`。

### 47. PATCH /api/v1/admin/content/{id}

版本控制编辑内容与发布状态

- 原实现：`apps/api/src/admin.controller.ts:32`
- 迁移状态：pending；计划类 `com.staroracle.administration.AdministrationController`。
- 权限：admin + live provisioned session + 2FA。
- 数据边界：admin role + configured 2FA; shared-only reading/content-free audit boundary。
- 行为：slug唯一冲突409，version过期409。
- 版本：version from body.version; CAS conflict 409。

参数：

| 位置 | 名称 | 必需 | 类型 | 约束/说明 |
|---|---|---|---|---|
| path | id | 是 | string | 格式：uuid |
| header | Origin | 是 | string | 格式：uri；必须准确等于服务器 WEB_ORIGIN。所有写请求另须 Content-Type: application/json。 |

JSON请求体必需：ContentUpdate（完整嵌套定义见模型节）。

| 字段 | 类型/引用 | 必需 | 限制及说明 |
|---|---|---|---|
| slug | string | 是 | 最长：80；正则：^[a-z0-9]+(?:-[a-z0-9]+)*$ |
| kind | string | 是 | 枚举：["announcement","guide"] |
| title | string | 是 | 最短：1；最长：160 |
| body | string | 是 | 最长：10000；说明：纯文本，不作为HTML渲染 |
| published | boolean | 是 | — |
| version | integer | 是 | 最小：0 |

响应：
- 200：Content；成功。
- 错误边界：400, 401, 403, 404, 409, 413, 415, 429, 503（共享守卫/资源/校验/业务规则中适用者；不是宣称每条路径必触发每种错误）。
- 计划验收：`LegacyContractParityTest.patch_api_v1_admin_content_id`, `OwnershipContractTest.patch_api_v1_admin_content_id_rejects_other_actor`, `AdminBoundaryTest.patch_api_v1_admin_content_id_requires_admin_second_factor`, `OptimisticVersionTest.patch_api_v1_admin_content_id_stale_version_preserves_saved_state`。

### 48. GET /api/v1/admin/feedback

分页读取主动提交的反馈

- 原实现：`apps/api/src/admin.controller.ts:33`
- 迁移状态：pending；计划类 `com.staroracle.administration.AdministrationController`。
- 权限：admin + live provisioned session + 2FA。
- 数据边界：admin role + configured 2FA; shared-only reading/content-free audit boundary。
- 行为：用户主动发给运营者的内容；读取记审计，不提供私人日记或回顾入口。

参数：

| 位置 | 名称 | 必需 | 类型 | 约束/说明 |
|---|---|---|---|---|
| query | cursor | 否 | string | 格式：uuid |
| query | limit | 否 | integer | 默认：20；最小：1；最大：50 |
| query | status | 否 | string | 枚举：["open","in_progress","resolved"] |

请求体：无业务字段。现有所有写请求仍要求JSON Content-Type；daily/today可发空JSON。

响应：
- 200：AdminFeedbackPage；成功。
- 错误边界：400, 401, 403, 404, 409, 413, 415, 429, 503（共享守卫/资源/校验/业务规则中适用者；不是宣称每条路径必触发每种错误）。
- 计划验收：`LegacyContractParityTest.get_api_v1_admin_feedback`, `OwnershipContractTest.get_api_v1_admin_feedback_rejects_other_actor`, `AdminBoundaryTest.get_api_v1_admin_feedback_requires_admin_second_factor`。

### 49. PATCH /api/v1/admin/feedback/{id}

回复反馈并更新处理状态

- 原实现：`apps/api/src/admin.controller.ts:34`
- 迁移状态：pending；计划类 `com.staroracle.administration.AdministrationController`。
- 权限：admin + live provisioned session + 2FA。
- 数据边界：admin role + configured 2FA; shared-only reading/content-free audit boundary。
- 行为：版本过期409；回复存站内，不自动发送邮件。空回复会清除原回复。
- 版本：version from body.version; CAS conflict 409。

参数：

| 位置 | 名称 | 必需 | 类型 | 约束/说明 |
|---|---|---|---|---|
| path | id | 是 | string | 格式：uuid |
| header | Origin | 是 | string | 格式：uri；必须准确等于服务器 WEB_ORIGIN。所有写请求另须 Content-Type: application/json。 |

JSON请求体必需：FeedbackReply（完整嵌套定义见模型节）。

| 字段 | 类型/引用 | 必需 | 限制及说明 |
|---|---|---|---|
| status | string | 是 | 枚举：["open","in_progress","resolved"] |
| reply | string | 是 | 最长：2000 |
| version | integer | 是 | 最小：0 |

响应：
- 200：AdminFeedback；成功。
- 错误边界：400, 401, 403, 404, 409, 413, 415, 429, 503（共享守卫/资源/校验/业务规则中适用者；不是宣称每条路径必触发每种错误）。
- 计划验收：`LegacyContractParityTest.patch_api_v1_admin_feedback_id`, `OwnershipContractTest.patch_api_v1_admin_feedback_id_rejects_other_actor`, `AdminBoundaryTest.patch_api_v1_admin_feedback_id_requires_admin_second_factor`, `OptimisticVersionTest.patch_api_v1_admin_feedback_id_stale_version_preserves_saved_state`。

### 50. GET /api/v1/admin/redeem-codes

分页查看提示码与使用状态

- 原实现：`apps/api/src/admin.controller.ts:35`
- 迁移状态：pending；计划类 `com.staroracle.membership.MembershipController`。
- 权限：admin + live provisioned session + 2FA。
- 数据边界：admin role + configured 2FA; shared-only reading/content-free audit boundary。
- 行为：不返回完整码或codeHash；完整码仅在新建响应展示。

参数：

| 位置 | 名称 | 必需 | 类型 | 约束/说明 |
|---|---|---|---|---|
| query | cursor | 否 | string | 格式：uuid |
| query | limit | 否 | integer | 默认：20；最小：1；最大：50 |

请求体：无业务字段。现有所有写请求仍要求JSON Content-Type；daily/today可发空JSON。

响应：
- 200：CodePage；成功。
- 错误边界：400, 401, 403, 404, 409, 413, 415, 429, 503（共享守卫/资源/校验/业务规则中适用者；不是宣称每条路径必触发每种错误）。
- 计划验收：`LegacyContractParityTest.get_api_v1_admin_redeem_codes`, `OwnershipContractTest.get_api_v1_admin_redeem_codes_rejects_other_actor`, `AdminBoundaryTest.get_api_v1_admin_redeem_codes_requires_admin_second_factor`。

### 51. POST /api/v1/admin/redeem-codes

生成额度或会员兑换码

- 原实现：`apps/api/src/admin.controller.ts:36`
- 迁移状态：pending；计划类 `com.staroracle.membership.MembershipController`。
- 权限：admin + live provisioned session + 2FA。
- 数据边界：admin role + configured 2FA; shared-only reading/content-free audit boundary。
- 行为：144位安全随机码；数据库仅存SHA-256和尾段提示。限制金额/天数/最大使用数，创建审计无明文码。

参数：

| 位置 | 名称 | 必需 | 类型 | 约束/说明 |
|---|---|---|---|---|
| header | Origin | 是 | string | 格式：uri；必须准确等于服务器 WEB_ORIGIN。所有写请求另须 Content-Type: application/json。 |

JSON请求体必需：RedeemCreate（完整嵌套定义见模型节）。

| 字段 | 类型/引用 | 必需 | 限制及说明 |
|---|---|---|---|
| kind | string | 是 | 枚举：["credits","membership"] |
| amount | integer | 是 | 最小：1；最大：1000000 |
| durationDays | integer | 否 | 最小：1；最大：3650 |
| expiresAt | string 或 null | 否 | — |
| maxUses | integer | 否 | 默认：1；最小：1；最大：10000 |

membership未传durationDays时以amount作为天数（最多3650）；credits金额最多1000000。

响应：
- 201：CodeCreated；成功。
- 错误边界：400, 401, 403, 404, 409, 413, 415, 429, 503（共享守卫/资源/校验/业务规则中适用者；不是宣称每条路径必触发每种错误）。
- 计划验收：`LegacyContractParityTest.post_api_v1_admin_redeem_codes`, `OwnershipContractTest.post_api_v1_admin_redeem_codes_rejects_other_actor`, `AdminBoundaryTest.post_api_v1_admin_redeem_codes_requires_admin_second_factor`。

### 52. PATCH /api/v1/admin/redeem-codes/{id}

停用或启用兑换码

- 原实现：`apps/api/src/admin.controller.ts:37`
- 迁移状态：pending；计划类 `com.staroracle.membership.MembershipController`。
- 权限：admin + live provisioned session + 2FA。
- 数据边界：admin role + configured 2FA; shared-only reading/content-free audit boundary。

参数：

| 位置 | 名称 | 必需 | 类型 | 约束/说明 |
|---|---|---|---|---|
| path | id | 是 | string | 格式：uuid |
| header | Origin | 是 | string | 格式：uri；必须准确等于服务器 WEB_ORIGIN。所有写请求另须 Content-Type: application/json。 |

JSON请求体必需：CodeStatus（完整嵌套定义见模型节）。

| 字段 | 类型/引用 | 必需 | 限制及说明 |
|---|---|---|---|
| disabled | boolean | 是 | — |

响应：
- 200：Ok；成功。
- 错误边界：400, 401, 403, 404, 409, 413, 415, 429, 503（共享守卫/资源/校验/业务规则中适用者；不是宣称每条路径必触发每种错误）。
- 计划验收：`LegacyContractParityTest.patch_api_v1_admin_redeem_codes_id`, `OwnershipContractTest.patch_api_v1_admin_redeem_codes_id_rejects_other_actor`, `AdminBoundaryTest.patch_api_v1_admin_redeem_codes_id_requires_admin_second_factor`。

## 认证接口（8操作）

基线：`139554bb4594eb8ca8ab6da4f130506ad062c76d`；Better Auth **1.7.7**（`apps/api/package.json`、`package-lock.json:24-42`）。以下按应用dispatcher与安装的锁定依赖实现核验；依赖源码路径均相对仓库。Java实现/跨语言验证状态全部 **pending**；本文件不是已实现声明。

### 统一规则

- 唯一允许清单：GET `/api/auth/get-session`；POST `/api/auth/sign-in/username`、`/sign-out`、`/delete-user`、`/two-factor/enable`、`/two-factor/disable`、`/two-factor/verify-totp`、`/two-factor/verify-backup-code`。精确路径匹配，其他method/path，包括允许路径尾斜杠，都不由库自动开放。源：`apps/api/src/main.ts:55-61`。
- 每个POST都必须 `Origin == WEB_ORIGIN`、`Content-Type: application/json`；非同源403，非JSON415，Content-Length>32768返回413，认证流还计算实际body bytes并在超额时断连接。GET可无Origin；有Origin仍需精确相同。OPTIONS204。源：`main.ts:27-44,75-79`。
- CSRF是现有精确Origin、JSON请求与SameSite cookie约束；**没有独立CSRF-token发放接口/header**。不得无前端协议变更引入默认Spring token校验，导致旧写接口全部403。Better Auth还校验callbackURL与可信来源；允许受审查的相对路径/可信origin，非可信callback为403 `INVALID_CALLBACK_URL`。源：`auth.ts:11`、`node_modules/better-auth/dist/api/middlewares/origin-check.mjs:43-69`。
- SSH-only还要求原始Host/Origin/peer/无Forwarded等条件；入口HTTP并不取消CSRF。源：`main.ts:22-25`、`apps/api/src/ssh-transport.ts`。
- `X-Expected-Actor`、`X-Expected-Session` 可选，但一旦存在非空值即必须与权威登录身份匹配；错配409、`code: SESSION_CHANGED`。敏感入口无这些headers也必须检查实时DB user+session，不能依赖Redis旧缓存。源：`main.ts:62-74`、`security.ts:10-19`。
- `Cache-Control: no-store`、`X-Request-ID`；认证库错误通常为顶层 `{message,code?}`；应用传输层错误为 `{error:{message,requestId?}}`，不要与业务错误envelope混成一种。`get-session`额外`Pragma: no-cache`。源：`main.ts:27-53,68-72`、依赖`api/routes/session.mjs:32-34`。
- 限流：全局非health 120次/60秒（HMAC-IP键）；认证默认30次/60秒，用户名登录5次/60秒；2FA路径plugin rule为3次/10秒。认证限流响应429 `{message:"Too many requests. Please try again later."}`，header `X-Retry-After`；全局Redis安全服务失败503，不放行。源：`main.ts:46-52`、`auth.ts:27-28`、依赖`plugins/two-factor/index.mjs:338-344`、`api/rate-limiter/index.mjs:64-72`。
- schema里的string不等于已声明min/max；下面只写实际源码限制。未知附加字段不得改变role/disabled/emailVerified/TOTP等服务器字段，不应声称当前schema会对所有未知字段做strict拒绝。

#### 共用 User / Session 响应

`AuthUser`：`id:string, name:string, email:string, emailVerified:boolean, createdAt:ISO8601, updatedAt:ISO8601, image?:string|null, username?:string|null, role:string, disabled:boolean, twoFactorEnabled:boolean`。`displayUsername`已关闭。密码、TwoFactor secret/backupCodes、account token不在普通User响应中。记录级可空/缺省细节须由合成oracle响应快照冻结，不能把SQL null自动序列化成false/空字符串。

`AuthSession`：`id:string, token:string, userId:string, expiresAt:ISO8601, createdAt:ISO8601, updatedAt:ISO8601, ipAddress?:string|null, userAgent?:string|null`。日期按原HTTP JSON语义输出；`/api/auth/get-session`不是业务`/api/v1/me`，默认**不增加sessionBinding**。

Cookie：HTTPS生产`__Secure-better-auth.session_token`；SSH-only `star-oracle-ssh.session_token`。均HttpOnly、SameSite=Lax、Path=/、无Domain(host-only)。HTTPS Secure=true，SSH Secure=false。常规记住登录Max-Age604800；会话7天，12小时refresh threshold；rememberMe=false为session cookie、数据库会话1天，并有签名`dont_remember` cookie。其他cookie同profile前缀：`two_factor`挑战600秒、`trust_device`信任设备30天。源：`auth.ts:21,25`、`config.ts:28-31`、依赖`cookies/index.mjs:20-74,167-179`、`db/internal-adapter.mjs:247-275`、`plugins/two-factor/index.mjs:23,290-304`。

### AUTH-01 · GET /api/auth/get-session

- 状态：pending。
- Body：无。
- Query：`disableCookieCache?:boolean-coercible`，`disableRefresh?:boolean-coercible`。安装版用 `z.coerce.boolean()`，字符串布尔的实际行为必须按原库快照处理，不能擅自假设`"false"`等于false；本应用cookieCache已禁用。
- 权限：允许未登录查询。若库识别到session，dispatcher再resolveActor，必须存在未过期DB session与启用且已分配username的DB user。任意expected身份header也会强制resolve。
- 成功：200 `null`（无有效cookie/找不到session），或200 `{session:AuthSession,user:AuthUser}`。过期/缺失session可清cookie；达到刷新阈值可延长DB有效期并Set-Cookie。不要以GET等同无写入。
- 错误：旧cache识别session但DB记录已撤销/disabled/无username时401；expected错配409 `SESSION_CHANGED`；dispatcher查询错误503；库读取失败500 `FAILED_TO_GET_SESSION`；刷新时并发删除401 `FAILED_TO_GET_SESSION`。
- 来源：`main.ts:57,64-74`、`security.ts:10-19`；依赖`api/routes/session.mjs:12-47,153-232`，`cookies/session-store.mjs:174-181`。
- 必验：无cookie=null；invalid signature；expired；stale Redis不能复活DB session；disabled/legacy；刷新/disableRefresh；A-B-A旧binding409；DB/Redis故障关闭。

### AUTH-02 · POST /api/auth/sign-in/username

- 状态：pending。
- Body：`username:string`必需、`password:string`必需；`rememberMe?:boolean`；`callbackURL?:string`。
- 用户名：实际入口先检查输入string长度3–32，再按trim后的ASCII正则 `^[A-Za-z0-9][A-Za-z0-9._-]{2,31}$`校验，查询时trim+lowercase。故边界空白与最大长度不可仅按CLI规范化结果猜测。密码非空；登录只执行最大128字符检查，**不会因短于12就直接PASSWORD_TOO_SHORT**；12是新建/重设密码门槛，旧有效短密码的验证语义需保留。
- 权限：不要求登录；仅已预建username账户。未知账户、错密码、缺credential均统一401；session.create hook再次拒绝disabled/无username。提交role/disabled/emailVerified/twoFactorEnabled不得赋权或创建账号。
- 无待验证2FA成功：200 `{redirect:boolean,token:string,user:AuthUser,url?:string}`；callbackURL存在时Location header及redirect=true，HTTP仍200；设置session cookie。
- 待验证2FA成功：200 `{twoFactorRedirect:true,twoFactorMethods:["totp"]}`（实际可为空列表，取决于已verified TOTP数据）；签名two_factor cookie，创建challenge与attempt计数。此时**没有已认证session**：移除临时credential session和早先Set-Cookie，不允许从raw响应头复用临时session。
- 已验证trust_device：核验签名、userId、服务器verification及到期，轮换trust identifier/cookie后允许session；无效trust cookie清除并进入2FA挑战。
- 错误：400 `PASSWORD_TOO_LONG`；401 `INVALID_USERNAME_OR_PASSWORD`；422 `USERNAME_TOO_SHORT`/`USERNAME_TOO_LONG`/`INVALID_USERNAME`；429登录限流；500 `FAILED_TO_CREATE_SESSION`；共同403来源/callback。当前requireEmailVerification=false，不要求emailVerified=true。
- 来源：`auth.ts:14-31`；依赖`plugins/username/index.mjs:16-21,153-222`、`plugins/two-factor/index.mjs:247-328`、`utils/password.mjs:9-13`。
- 必验：ASCII/大小写/边界空白/Unicode折叠拒绝；scrypt+NFKC；未知账号同失败；无自建/提权；2FA前不能访问私有API；trust轮换/撤销；rememberMe；callback约束；raw Set-Cookie无绕过。

### AUTH-03 · POST /api/auth/sign-out

- 状态：pending。
- Body：可省或`{}`；可选`callbackURL:string`、`disableRedirect:boolean`、`state:string`。应用传输仍要求JSON Content-Type和正确Origin。
- 权限：通常可无session调用；有expected身份header时dispatcher先强制resolve并可能401/409。
- 成功：本项目未配置social provider，200 `{success:true}`。清session cookie及session_data、dont_remember等会话cookie；尝试从DB/secondary store删除当前token。不是撤销所有设备，也不默认清trust_device。
- 库级兼容细节：该版本对session读取/删除内部失败会catch，仍清cookie并返回success；因此200并不证明全后端存储撤销。Java若改为故障503属于可取但须单独确认的安全语义变更，不能默认为既有表现。
- 通用provider响应的url/redirect在当前项目没有来源，不应虚构OAuth logout能力。
- 来源：依赖`api/routes/sign-out.mjs:5-19,41-94`、`cookies/index.mjs:241-255`；`main.ts:64`。
- 必验：成功后原token被拒绝；另一设备不被误撤销；无cookie幂等；expected旧身份不得登出当前其他用户；存储故障策略明确。

### AUTH-04 · POST /api/auth/delete-user

- 状态：pending。
- Body：JSON object；`password?:string`、`token?:string`、`callbackURL?:string`。这些字段在实际schema均可选，**不能因UI要求当前密码就文档写成后端必需**。
- 权限：dispatcher强制live Actor；库sensitive authoritative session；admin一律403 `Administrator deletion requires offline maintenance`。
- 密码/新鲜度：提供非空password时最大128、验当前credential密码；未给password且未走token分支时要求session创建不足默认24小时，否则400 `SESSION_EXPIRED`。空password走未提供分支。提供token时内部消费`delete-account-<token>`并核对当前用户；HTTP GET callback仍关闭，POST token分支没有被dispatcher移除。
- 本项目未配置sendDeleteAccountVerification，因此不会发送删除确认邮件，也不会返回“Verification email sent”。callbackURL在常规删除不触发HTTP重定向；仍受origin校验。
- 成功：200 `{success:true,message:"User deleted"}`；删除用户及关联记录/账号/会话，清session cookie。数据级cascade必须由真实MySQL验收（私有readings/journals/actions/reviews/conversations/usage/ledger等）。
- 错误：401会话无效；409 `SESSION_CHANGED`；403管理员禁止；400 `CREDENTIAL_ACCOUNT_NOT_FOUND`/`INVALID_PASSWORD`/`PASSWORD_TOO_LONG`/`SESSION_EXPIRED`；token无效404 `INVALID_TOKEN`（需有效session前提）；共同请求错误。
- 来源：`auth.ts:15`、`main.ts:64-74`；依赖`api/routes/update-user.mjs:219-336,373-388`、`context/create-context.mjs:149`；`apps/api/test/system.test.ts:207-225`、`personal-expansion.test.ts:98`。
- 必验：正确/错密码；fresh无密码/过期无密码；token归属/消费；admin禁止；全cascade；旧actor阻断在任何删除前；其他用户完整。

### AUTH-05 · POST /api/auth/two-factor/enable

- 状态：pending。
- Body：`password:string`必需；`method?:"totp"|"otp"`，默认totp；`issuer?:string`。issuer schema未指定独立长度，受整体请求大小限制。
- 权限：live Actor +库session；必须验证当前密码，空/错密码400；密码最大128。`otp`虽schema接受，但本项目无sendOTP，400 `OTP_NOT_CONFIGURED`，不得在Java新增邮件/SMS。
- 成功：200 `{method:"totp",totpURI:string,backupCodes:string[]}`。默认10条恢复码，每条5字符-5字符，字符集大小写字母+数字。URI由配置issuer（默认“照见 Star Oracle”）与内部email形成；当前UI只改显示label为username。不得把已存TOTP secret当Base32文本直接用，库内部保存raw secret，URI才Base32。
- 状态：创建/覆盖未验证TwoFactor记录，secret与backupCodes均AUTH_SECRET加密，verified=false；**尚不把user.twoFactorEnabled设true**。须AUTH-07确认启用。已经verified的记录拒绝重建，不静默换掉已启用因素。初次enable不轮换现有session（默认skipVerificationOnEnable未启用）。
- 错误：400 `INVALID_PASSWORD`/`PASSWORD_TOO_LONG`/`OTP_NOT_CONFIGURED`/`TOTP_ALREADY_ENABLED`；401/409 live Actor；共同429。
- 来源：依赖`plugins/two-factor/index.mjs:21-50,73-175`、`backup-codes/index.mjs:14-31`；`auth.ts:31`、`apps/web/src/pages/account.tsx:71-72`。
- 必验：重发未完成enroll；verified账户不可覆盖；返回恢复码仅此流程展示；正确key可解密；第一次确认前仍未启用；输入issuer转义与URI编码；无邮件渠道旁路。

### AUTH-06 · POST /api/auth/two-factor/disable

- 状态：pending。
- Body：`password:string`必需，非空并校验当前密码，最大128。
- 权限：强制live Actor +库sensitive authoritative session；expected错配必须先拒绝。当前未在该入口禁止admin关闭TOTP，但之后业务AdminGuard因ADMIN_REQUIRE_2FA拒绝无TOTP管理员；如要禁止关闭须作为显式变更。
- 成功：200 `{status:true}`。user.twoFactorEnabled=false，删除该用户TwoFactor记录，创建替换session+新cookie、删除当前旧session；若请求带trust_device，删除对应服务器verification并expire该cookie。不能把关闭改成只flip布尔。
- 错误：400 `INVALID_PASSWORD`/`PASSWORD_TOO_LONG`；401无有效session；409 `SESSION_CHANGED`；共同429/安全错误。
- 来源：依赖`plugins/two-factor/index.mjs:50,192-241`；`security.ts:29-34`。
- 必验：旧session和old binding无效；正确新session；TOTP/恢复码删除；trust撤销；不误删其他用户；admin后续权限收敛。

### AUTH-07 · POST /api/auth/two-factor/verify-totp

- 状态：pending。
- Body：`code:string`必需；`trustDevice?:boolean`。schema不限制code.length，但当前算法精确比较6位TOTP；窗口±1个30秒周期、HMAC-SHA1。禁止数字类型丢失前导0。
- 模式A（匿名登录挑战）：必须有有效签名two_factor cookie+服务器challenge+user；只允许verified!=false的TOTP；成功原子消费challenge并创建session、设cookie、清two_factor；trustDevice=true创建30天trust记录和cookie。
- 模式B（已登录enrollment/验证）：必须通过live Actor；验证待确认secret后设置verified=true，必要时设置user.twoFactorEnabled=true并轮换session、撤销旧token。无session时不能拿未verified enrollment绕过注册。
- 成功实际handler：200 `{token:string,user:AuthUser}`，由verifyTwoFactor.valid返回；依赖中openapi注释写`{status:boolean}`与执行实现不一致，**以执行实现为准**。enrollment时cookie中的替换session需实测锁定，客户端随后refresh。
- 限制：匿名challenge最多5次尝试（consume/rearm计数）；账户级连续失败上限10，锁15分钟，跨challenge/factor计数；成功重置账户计数。错误/中断恢复attempt不能把挑战变成无上限。
- 错误：401 `INVALID_TWO_FACTOR_COOKIE`/`INVALID_CODE`；400 `TOTP_NOT_ENABLED`、尝试超限 `TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE`；429 `ACCOUNT_TEMPORARILY_LOCKED`；无live Actor401、错expected409；存储故障不能创session。
- 来源：依赖`plugins/two-factor/totp/index.mjs:14-28,150-224`、`verify-two-factor.mjs:10-115,117-202`、`@better-auth/utils/dist/otp.mjs:7-57`。
- 必验：旧/当前/未来±1窗口、±2拒绝、前导0、错误长度、过期/重放/并发challenge、5次challenge/10次账户锁、15分钟到期、状态切换与session轮换。

### AUTH-08 · POST /api/auth/two-factor/verify-backup-code

- 状态：pending。
- Body：`code:string`必需；`trustDevice?:boolean`；`disableSession?:boolean`。code是精确大小写字符串匹配；schema未指定格式regex或长度。默认生成格式不能当输入强制格式替代历史代码兼容。
- 权限：与AUTH-07相同的匿名challenge或live session双模式；有cached session也必须通过权威Actor检查。
- 成功：默认200 `{token:string,user:AuthUser}`；消费该恢复码、加密存储余下码，使用old encrypted backupCodes条件的原子更新，竞争只能一人成功。匿名模式随后原子消费challenge，设置session/清two_factor，按trustDevice选择创建可信设备。
- `disableSession=true`：仍消费恢复码但不调用valid(ctx)，不新建登录session/不清挑战；返回`{user:AuthUser,token?:string}`，已登录时token为现有session.token，匿名时token未定义被JSON省略。不得忽略此可选参数。
- 错误：400 `BACKUP_CODES_NOT_ENABLED`；401 `INVALID_BACKUP_CODE`/`INVALID_TWO_FACTOR_COOKIE`；409并发CAS失败，message `Failed to verify backup code. Please try again.`，该分支没有固定code；challenge次数、账户锁与AUTH-07相同；Actor 401/409及全局错误。
- 来源：依赖`plugins/two-factor/backup-codes/index.mjs:33-64,186-233`、`verify-two-factor.mjs:10-115,117-202`。
- 必验：一次性、并发两次只一次成功、剩余码正确、wrongcase拒绝、失败不删码、disableSession匿名/登录、trustDevice、旧挑战与旧用户隔离。

### 关闭的认证入口（都必须显式保持404）

所有不在8项允许清单中的入口，包括但不限于：

- 注册：`/sign-up/email`。
- 邮件/密码找回：`/sign-in/email`、`/request-password-reset`、`/reset-password`、`/send-verification-email`、`/verify-email`。
- 资料/密码/邮箱更改：`/change-email`、`/change-password`、`/update-user`、`/is-username-available`。
- 其他2FA库路由：`/two-factor/send-otp`、`/two-factor/verify-otp`、`/two-factor/generate-totp`、`/two-factor/get-totp-uri`、`/two-factor/generate-backup-codes`、`/two-factor/view-backup-codes`。
- 其他session/OAuth/admin路由、GET `/delete-user/callback`、POST `/get-session`、GET任一POST入口、任一尾斜杠变体。

返回404 `{message:"此账户入口未开放"}`（在来源/内容类型/全局限流等更外层前置校验通过后）；添加query不能绕过。库注册了某路由不代表应用开放。来源：`main.ts:55-61`、`apps/api/test/precreated-auth.test.ts:15-23`、`apps/api/test/system.test.ts:175-205`。

### 兼容验收状态（机读矩阵同名AUTH-01…08）

每一项当前均：`implementation=pending, unit=pending, integration=pending, browser=pending, cross_language=pending`。现有Node测试仅作为baseline证据，不能填成Java通过。只有同一fixture的状态码、响应schema、cookie属性、DB/Redis副作用、权限拒绝、并发/恢复行为全部对照后，才可更新对应状态。

## 模型定义（请求与响应）

下列定义包含完整字段、必需项、枚举、默认值与嵌套形状。$ref均指本节同名模型。JSON Schema用于文档，不表示现有服务直接运行JSON Schema；跨字段规则同时以原Zod和服务代码为准。

### Error

| 字段 | 类型/引用 | 必需 | 限制及说明 |
|---|---|---|---|
| error | object | 是 | 不接受未知字段 |

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "error": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "message": {
          "type": "string"
        },
        "requestId": {
          "type": "string",
          "format": "uuid"
        },
        "code": {
          "type": "string",
          "enum": [
            "SESSION_CHANGED",
            "AI_ATTEMPT_FAILED"
          ],
          "description": "仅已确认的身份变化或AI持久终止失败；普通503没有此code。前端UNKNOWN_OUTCOME是客户端分类，不是服务器code。"
        }
      },
      "required": [
        "message"
      ]
    }
  },
  "required": [
    "error"
  ]
}
```

### Ok

| 字段 | 类型/引用 | 必需 | 限制及说明 |
|---|---|---|---|
| ok | boolean | 是 | 固定：true |

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "ok": {
      "type": "boolean",
      "const": true
    }
  },
  "required": [
    "ok"
  ]
}
```

### User

| 字段 | 类型/引用 | 必需 | 限制及说明 |
|---|---|---|---|
| id | string | 是 | — |
| name | string | 是 | — |
| email | string | 是 | 格式：email |
| role | string | 是 | 枚举：["user","admin"] |
| twoFactorEnabled | boolean | 是 | — |
| username | string 或 null | 是 | — |
| sessionBinding | string | 是 | 正则：^[a-f0-9]{64}$；说明：AUTH_SECRET HMAC-SHA256(browser-session:<liveSessionId>)，不可代替Cookie认证 |

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "id": {
      "type": "string"
    },
    "name": {
      "type": "string"
    },
    "email": {
      "type": "string",
      "format": "email"
    },
    "role": {
      "type": "string",
      "enum": [
        "user",
        "admin"
      ]
    },
    "twoFactorEnabled": {
      "type": "boolean"
    },
    "username": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ]
    },
    "sessionBinding": {
      "type": "string",
      "pattern": "^[a-f0-9]{64}$",
      "description": "AUTH_SECRET HMAC-SHA256(browser-session:<liveSessionId>)，不可代替Cookie认证"
    }
  },
  "required": [
    "id",
    "name",
    "email",
    "role",
    "twoFactorEnabled",
    "username",
    "sessionBinding"
  ]
}
```

### CreateReading

| 字段 | 类型/引用 | 必需 | 限制及说明 |
|---|---|---|---|
| kind | string | 是 | 枚举：["tarot","iching"] |
| question | string | 是 | 最短：2；最长：500；说明：服务端 trim 后长度校验 |
| spread | string | 否 | 枚举：["single","three","past-present-future","mind-heart-action","relationship-five","relationship-cross","relationship-bridge","reconciliation","self-love","career-path","career-cross","job-change","project-launch","business-five","money-budget","study-plan","exam-preparation","decision-two","decision-three","crossroads","obstacle-breakthrough","shadow-work","balance-five","new-moon","full-moon","week-ahead","month-ahead","year-wheel","celtic-cross","purpose","creative-spark","travel-transition"]；默认：three |
| allowReversed | boolean | 否 | 默认：true |
| requestId | string | 是 | 格式：uuid |
| scenario | string | 否 | 枚举：["general","relationship","career","decision","resources","study","self","growth","communication","transition","creative","weekly","monthly","annual","lunar"]；默认：general |
| method | string | 否 | 枚举：["coins","numbers","time"]；默认：coins |
| numbers | tuple[integer, integer, integer] | 否 | 最少项：3；最多项：3；说明：数字分别定上卦、下卦、动爻；第三数自身取余6；各项约束：[{"type":"integer","minimum":1,"maximum":1000000000},{"type":"integer","minimum":1,"maximum":1000000000},{"type":"integer","minimum":1,"maximum":1000000000}] |
| time | string | 否 | 格式：date-time；说明：必须带 Z/数值偏移；按上海公历年月日与时辰采用当代简化规则 |

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "kind": {
      "type": "string",
      "enum": [
        "tarot",
        "iching"
      ]
    },
    "question": {
      "type": "string",
      "minLength": 2,
      "maxLength": 500,
      "description": "服务端 trim 后长度校验"
    },
    "spread": {
      "type": "string",
      "enum": [
        "single",
        "three",
        "past-present-future",
        "mind-heart-action",
        "relationship-five",
        "relationship-cross",
        "relationship-bridge",
        "reconciliation",
        "self-love",
        "career-path",
        "career-cross",
        "job-change",
        "project-launch",
        "business-five",
        "money-budget",
        "study-plan",
        "exam-preparation",
        "decision-two",
        "decision-three",
        "crossroads",
        "obstacle-breakthrough",
        "shadow-work",
        "balance-five",
        "new-moon",
        "full-moon",
        "week-ahead",
        "month-ahead",
        "year-wheel",
        "celtic-cross",
        "purpose",
        "creative-spark",
        "travel-transition"
      ],
      "default": "three"
    },
    "allowReversed": {
      "type": "boolean",
      "default": true
    },
    "requestId": {
      "type": "string",
      "format": "uuid"
    },
    "scenario": {
      "type": "string",
      "enum": [
        "general",
        "relationship",
        "career",
        "decision",
        "resources",
        "study",
        "self",
        "growth",
        "communication",
        "transition",
        "creative",
        "weekly",
        "monthly",
        "annual",
        "lunar"
      ],
      "default": "general"
    },
    "method": {
      "type": "string",
      "enum": [
        "coins",
        "numbers",
        "time"
      ],
      "default": "coins"
    },
    "numbers": {
      "type": "array",
      "prefixItems": [
        {
          "type": "integer",
          "minimum": 1,
          "maximum": 1000000000
        },
        {
          "type": "integer",
          "minimum": 1,
          "maximum": 1000000000
        },
        {
          "type": "integer",
          "minimum": 1,
          "maximum": 1000000000
        }
      ],
      "minItems": 3,
      "maxItems": 3,
      "items": false,
      "description": "数字分别定上卦、下卦、动爻；第三数自身取余6"
    },
    "time": {
      "type": "string",
      "format": "date-time",
      "description": "必须带 Z/数值偏移；按上海公历年月日与时辰采用当代简化规则"
    }
  },
  "required": [
    "kind",
    "question",
    "requestId"
  ],
  "allOf": [
    {
      "oneOf": [
        {
          "properties": {
            "kind": {
              "const": "tarot"
            },
            "method": {
              "const": "coins"
            }
          },
          "required": [
            "kind"
          ],
          "not": {
            "anyOf": [
              {
                "required": [
                  "numbers"
                ]
              },
              {
                "required": [
                  "time"
                ]
              }
            ]
          }
        },
        {
          "properties": {
            "kind": {
              "const": "iching"
            },
            "method": {
              "const": "coins"
            }
          },
          "required": [
            "kind"
          ],
          "not": {
            "anyOf": [
              {
                "required": [
                  "numbers"
                ]
              },
              {
                "required": [
                  "time"
                ]
              }
            ]
          }
        },
        {
          "properties": {
            "kind": {
              "const": "iching"
            },
            "method": {
              "const": "numbers"
            }
          },
          "required": [
            "kind",
            "method",
            "numbers"
          ],
          "not": {
            "required": [
              "time"
            ]
          }
        },
        {
          "properties": {
            "kind": {
              "const": "iching"
            },
            "method": {
              "const": "time"
            }
          },
          "required": [
            "kind",
            "method",
            "time"
          ],
          "not": {
            "required": [
              "numbers"
            ]
          }
        }
      ]
    }
  ]
}
```

### JournalInput

| 字段 | 类型/引用 | 必需 | 限制及说明 |
|---|---|---|---|
| note | string | 是 | 最长：600 |
| mood | string 或 null | 是 | — |
| version | integer | 是 | 最小：0 |

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "note": {
      "type": "string",
      "maxLength": 600
    },
    "mood": {
      "anyOf": [
        {
          "type": "string",
          "enum": [
            "calm",
            "hopeful",
            "tired",
            "restless",
            "low"
          ]
        },
        {
          "type": "null"
        }
      ]
    },
    "version": {
      "type": "integer",
      "minimum": 0
    }
  },
  "required": [
    "note",
    "mood",
    "version"
  ]
}
```

### ShareInput

| 字段 | 类型/引用 | 必需 | 限制及说明 |
|---|---|---|---|
| shared | boolean | 是 | — |

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "shared": {
      "type": "boolean"
    }
  },
  "required": [
    "shared"
  ]
}
```

### AIInput

requestId用于同一次尝试的幂等重试；旧客户端省略时按readingId派生稳定ID。真正失败的新尝试需新requestId。

| 字段 | 类型/引用 | 必需 | 限制及说明 |
|---|---|---|---|
| consent | boolean | 是 | 固定：true |
| requestId | string | 否 | 格式：uuid |

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "consent": {
      "type": "boolean",
      "const": true
    },
    "requestId": {
      "type": "string",
      "format": "uuid"
    }
  },
  "required": [
    "consent"
  ],
  "description": "requestId用于同一次尝试的幂等重试；旧客户端省略时按readingId派生稳定ID。真正失败的新尝试需新requestId。"
}
```

### ReadingMetadata

| 字段 | 类型/引用 | 必需 | 限制及说明 |
|---|---|---|---|
| favorite | boolean | 是 | — |
| tags | array<string> | 是 | 最多项：8；每项(最短：1；最长：24) |
| note | string | 是 | 最长：1000 |
| version | integer | 是 | 最小：0 |

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "favorite": {
      "type": "boolean"
    },
    "tags": {
      "type": "array",
      "items": {
        "type": "string",
        "minLength": 1,
        "maxLength": 24
      },
      "maxItems": 8
    },
    "note": {
      "type": "string",
      "maxLength": 1000
    },
    "version": {
      "type": "integer",
      "minimum": 0
    }
  },
  "required": [
    "favorite",
    "tags",
    "note",
    "version"
  ]
}
```

### ConversationInput

| 字段 | 类型/引用 | 必需 | 限制及说明 |
|---|---|---|---|
| prompt | string | 是 | 最短：2；最长：1000 |
| consent | boolean | 是 | 固定：true |
| requestId | string | 是 | 格式：uuid |

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "prompt": {
      "type": "string",
      "minLength": 2,
      "maxLength": 1000
    },
    "consent": {
      "type": "boolean",
      "const": true
    },
    "requestId": {
      "type": "string",
      "format": "uuid"
    }
  },
  "required": [
    "prompt",
    "consent",
    "requestId"
  ]
}
```

### UserStatus

| 字段 | 类型/引用 | 必需 | 限制及说明 |
|---|---|---|---|
| disabled | boolean | 是 | — |

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "disabled": {
      "type": "boolean"
    }
  },
  "required": [
    "disabled"
  ]
}
```

### TarotReading

| 字段 | 类型/引用 | 必需 | 限制及说明 |
|---|---|---|---|
| version | integer | 是 | 固定：1；最小：0 |
| id | string | 是 | 正则：^[a-zA-Z0-9-]{8,80}$ |
| createdAt | string | 是 | 格式：date-time |
| question | string | 是 | 最短：2；最长：500 |
| scenario | string | 否 | 枚举：["general","relationship","career","decision","resources","study","self","growth","communication","transition","creative","weekly","monthly","annual","lunar"] |
| kind | string | 是 | 枚举：["tarot"] |
| spread | string | 是 | 枚举：["single","three","past-present-future","mind-heart-action","relationship-five","relationship-cross","relationship-bridge","reconciliation","self-love","career-path","career-cross","job-change","project-launch","business-five","money-budget","study-plan","exam-preparation","decision-two","decision-three","crossroads","obstacle-breakthrough","shadow-work","balance-five","new-moon","full-moon","week-ahead","month-ahead","year-wheel","celtic-cross","purpose","creative-spark","travel-transition"] |
| cards | array<object> | 是 | 最少项：1；最多项：13；说明：不重复，数量须恰好等于牌阵位置数量；每项(不接受未知字段) |

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "version": {
      "type": "integer",
      "minimum": 0,
      "const": 1
    },
    "id": {
      "type": "string",
      "pattern": "^[a-zA-Z0-9-]{8,80}$"
    },
    "createdAt": {
      "type": "string",
      "format": "date-time"
    },
    "question": {
      "type": "string",
      "minLength": 2,
      "maxLength": 500
    },
    "scenario": {
      "type": "string",
      "enum": [
        "general",
        "relationship",
        "career",
        "decision",
        "resources",
        "study",
        "self",
        "growth",
        "communication",
        "transition",
        "creative",
        "weekly",
        "monthly",
        "annual",
        "lunar"
      ]
    },
    "kind": {
      "type": "string",
      "enum": [
        "tarot"
      ]
    },
    "spread": {
      "type": "string",
      "enum": [
        "single",
        "three",
        "past-present-future",
        "mind-heart-action",
        "relationship-five",
        "relationship-cross",
        "relationship-bridge",
        "reconciliation",
        "self-love",
        "career-path",
        "career-cross",
        "job-change",
        "project-launch",
        "business-five",
        "money-budget",
        "study-plan",
        "exam-preparation",
        "decision-two",
        "decision-three",
        "crossroads",
        "obstacle-breakthrough",
        "shadow-work",
        "balance-five",
        "new-moon",
        "full-moon",
        "week-ahead",
        "month-ahead",
        "year-wheel",
        "celtic-cross",
        "purpose",
        "creative-spark",
        "travel-transition"
      ]
    },
    "cards": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "id": {
            "type": "string",
            "enum": [
              "major-fool",
              "major-magician",
              "major-priestess",
              "major-empress",
              "major-emperor",
              "major-hierophant",
              "major-lovers",
              "major-chariot",
              "major-strength",
              "major-hermit",
              "major-wheel",
              "major-justice",
              "major-hanged-man",
              "major-death",
              "major-temperance",
              "major-devil",
              "major-tower",
              "major-star",
              "major-moon",
              "major-sun",
              "major-judgement",
              "major-world",
              "wands-ace",
              "wands-2",
              "wands-3",
              "wands-4",
              "wands-5",
              "wands-6",
              "wands-7",
              "wands-8",
              "wands-9",
              "wands-10",
              "wands-page",
              "wands-knight",
              "wands-queen",
              "wands-king",
              "cups-ace",
              "cups-2",
              "cups-3",
              "cups-4",
              "cups-5",
              "cups-6",
              "cups-7",
              "cups-8",
              "cups-9",
              "cups-10",
              "cups-page",
              "cups-knight",
              "cups-queen",
              "cups-king",
              "swords-ace",
              "swords-2",
              "swords-3",
              "swords-4",
              "swords-5",
              "swords-6",
              "swords-7",
              "swords-8",
              "swords-9",
              "swords-10",
              "swords-page",
              "swords-knight",
              "swords-queen",
              "swords-king",
              "pentacles-ace",
              "pentacles-2",
              "pentacles-3",
              "pentacles-4",
              "pentacles-5",
              "pentacles-6",
              "pentacles-7",
              "pentacles-8",
              "pentacles-9",
              "pentacles-10",
              "pentacles-page",
              "pentacles-knight",
              "pentacles-queen",
              "pentacles-king"
            ]
          },
          "reversed": {
            "type": "boolean"
          }
        },
        "required": [
          "id",
          "reversed"
        ]
      },
      "minItems": 1,
      "maxItems": 13,
      "description": "不重复，数量须恰好等于牌阵位置数量",
      "uniqueItems": true
    }
  },
  "required": [
    "version",
    "id",
    "createdAt",
    "question",
    "kind",
    "spread",
    "cards"
  ],
  "allOf": [
    {
      "if": {
        "properties": {
          "spread": {
            "const": "single"
          }
        },
        "required": [
          "spread"
        ]
      },
      "then": {
        "properties": {
          "cards": {
            "minItems": 1,
            "maxItems": 1
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "spread": {
            "const": "three"
          }
        },
        "required": [
          "spread"
        ]
      },
      "then": {
        "properties": {
          "cards": {
            "minItems": 3,
            "maxItems": 3
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "spread": {
            "const": "past-present-future"
          }
        },
        "required": [
          "spread"
        ]
      },
      "then": {
        "properties": {
          "cards": {
            "minItems": 3,
            "maxItems": 3
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "spread": {
            "const": "mind-heart-action"
          }
        },
        "required": [
          "spread"
        ]
      },
      "then": {
        "properties": {
          "cards": {
            "minItems": 3,
            "maxItems": 3
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "spread": {
            "const": "relationship-five"
          }
        },
        "required": [
          "spread"
        ]
      },
      "then": {
        "properties": {
          "cards": {
            "minItems": 5,
            "maxItems": 5
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "spread": {
            "const": "relationship-cross"
          }
        },
        "required": [
          "spread"
        ]
      },
      "then": {
        "properties": {
          "cards": {
            "minItems": 5,
            "maxItems": 5
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "spread": {
            "const": "relationship-bridge"
          }
        },
        "required": [
          "spread"
        ]
      },
      "then": {
        "properties": {
          "cards": {
            "minItems": 5,
            "maxItems": 5
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "spread": {
            "const": "reconciliation"
          }
        },
        "required": [
          "spread"
        ]
      },
      "then": {
        "properties": {
          "cards": {
            "minItems": 5,
            "maxItems": 5
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "spread": {
            "const": "self-love"
          }
        },
        "required": [
          "spread"
        ]
      },
      "then": {
        "properties": {
          "cards": {
            "minItems": 5,
            "maxItems": 5
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "spread": {
            "const": "career-path"
          }
        },
        "required": [
          "spread"
        ]
      },
      "then": {
        "properties": {
          "cards": {
            "minItems": 5,
            "maxItems": 5
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "spread": {
            "const": "career-cross"
          }
        },
        "required": [
          "spread"
        ]
      },
      "then": {
        "properties": {
          "cards": {
            "minItems": 5,
            "maxItems": 5
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "spread": {
            "const": "job-change"
          }
        },
        "required": [
          "spread"
        ]
      },
      "then": {
        "properties": {
          "cards": {
            "minItems": 5,
            "maxItems": 5
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "spread": {
            "const": "project-launch"
          }
        },
        "required": [
          "spread"
        ]
      },
      "then": {
        "properties": {
          "cards": {
            "minItems": 5,
            "maxItems": 5
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "spread": {
            "const": "business-five"
          }
        },
        "required": [
          "spread"
        ]
      },
      "then": {
        "properties": {
          "cards": {
            "minItems": 5,
            "maxItems": 5
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "spread": {
            "const": "money-budget"
          }
        },
        "required": [
          "spread"
        ]
      },
      "then": {
        "properties": {
          "cards": {
            "minItems": 5,
            "maxItems": 5
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "spread": {
            "const": "study-plan"
          }
        },
        "required": [
          "spread"
        ]
      },
      "then": {
        "properties": {
          "cards": {
            "minItems": 5,
            "maxItems": 5
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "spread": {
            "const": "exam-preparation"
          }
        },
        "required": [
          "spread"
        ]
      },
      "then": {
        "properties": {
          "cards": {
            "minItems": 5,
            "maxItems": 5
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "spread": {
            "const": "decision-two"
          }
        },
        "required": [
          "spread"
        ]
      },
      "then": {
        "properties": {
          "cards": {
            "minItems": 6,
            "maxItems": 6
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "spread": {
            "const": "decision-three"
          }
        },
        "required": [
          "spread"
        ]
      },
      "then": {
        "properties": {
          "cards": {
            "minItems": 7,
            "maxItems": 7
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "spread": {
            "const": "crossroads"
          }
        },
        "required": [
          "spread"
        ]
      },
      "then": {
        "properties": {
          "cards": {
            "minItems": 5,
            "maxItems": 5
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "spread": {
            "const": "obstacle-breakthrough"
          }
        },
        "required": [
          "spread"
        ]
      },
      "then": {
        "properties": {
          "cards": {
            "minItems": 5,
            "maxItems": 5
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "spread": {
            "const": "shadow-work"
          }
        },
        "required": [
          "spread"
        ]
      },
      "then": {
        "properties": {
          "cards": {
            "minItems": 5,
            "maxItems": 5
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "spread": {
            "const": "balance-five"
          }
        },
        "required": [
          "spread"
        ]
      },
      "then": {
        "properties": {
          "cards": {
            "minItems": 5,
            "maxItems": 5
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "spread": {
            "const": "new-moon"
          }
        },
        "required": [
          "spread"
        ]
      },
      "then": {
        "properties": {
          "cards": {
            "minItems": 4,
            "maxItems": 4
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "spread": {
            "const": "full-moon"
          }
        },
        "required": [
          "spread"
        ]
      },
      "then": {
        "properties": {
          "cards": {
            "minItems": 4,
            "maxItems": 4
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "spread": {
            "const": "week-ahead"
          }
        },
        "required": [
          "spread"
        ]
      },
      "then": {
        "properties": {
          "cards": {
            "minItems": 5,
            "maxItems": 5
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "spread": {
            "const": "month-ahead"
          }
        },
        "required": [
          "spread"
        ]
      },
      "then": {
        "properties": {
          "cards": {
            "minItems": 6,
            "maxItems": 6
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "spread": {
            "const": "year-wheel"
          }
        },
        "required": [
          "spread"
        ]
      },
      "then": {
        "properties": {
          "cards": {
            "minItems": 13,
            "maxItems": 13
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "spread": {
            "const": "celtic-cross"
          }
        },
        "required": [
          "spread"
        ]
      },
      "then": {
        "properties": {
          "cards": {
            "minItems": 10,
            "maxItems": 10
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "spread": {
            "const": "purpose"
          }
        },
        "required": [
          "spread"
        ]
      },
      "then": {
        "properties": {
          "cards": {
            "minItems": 5,
            "maxItems": 5
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "spread": {
            "const": "creative-spark"
          }
        },
        "required": [
          "spread"
        ]
      },
      "then": {
        "properties": {
          "cards": {
            "minItems": 5,
            "maxItems": 5
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "spread": {
            "const": "travel-transition"
          }
        },
        "required": [
          "spread"
        ]
      },
      "then": {
        "properties": {
          "cards": {
            "minItems": 5,
            "maxItems": 5
          }
        }
      }
    }
  ]
}
```

### NumberCasting

| 字段 | 类型/引用 | 必需 | 限制及说明 |
|---|---|---|---|
| numbers | tuple[integer, integer, integer] | 是 | 最少项：3；最多项：3；各项约束：[{"type":"integer","minimum":1,"maximum":1000000000},{"type":"integer","minimum":1,"maximum":1000000000},{"type":"integer","minimum":1,"maximum":1000000000}] |

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "numbers": {
      "type": "array",
      "prefixItems": [
        {
          "type": "integer",
          "minimum": 1,
          "maximum": 1000000000
        },
        {
          "type": "integer",
          "minimum": 1,
          "maximum": 1000000000
        },
        {
          "type": "integer",
          "minimum": 1,
          "maximum": 1000000000
        }
      ],
      "items": false,
      "minItems": 3,
      "maxItems": 3
    }
  },
  "required": [
    "numbers"
  ]
}
```

### TimeCasting

| 字段 | 类型/引用 | 必需 | 限制及说明 |
|---|---|---|---|
| timestamp | string | 是 | 格式：date-time |
| timeZone | string | 是 | 固定：Asia/Shanghai；说明：业务API当前以此时区起卦；领域函数可接受其它有效IANA时区 |

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "timestamp": {
      "type": "string",
      "format": "date-time"
    },
    "timeZone": {
      "type": "string",
      "const": "Asia/Shanghai",
      "description": "业务API当前以此时区起卦；领域函数可接受其它有效IANA时区"
    }
  },
  "required": [
    "timestamp",
    "timeZone"
  ]
}
```

### IChingReading

兼容旧记录不带method；新数字/时间记录有casting，后端重新计算核对六爻。

| 字段 | 类型/引用 | 必需 | 限制及说明 |
|---|---|---|---|
| version | integer | 是 | 固定：1；最小：0 |
| id | string | 是 | 正则：^[a-zA-Z0-9-]{8,80}$ |
| createdAt | string | 是 | 格式：date-time |
| question | string | 是 | 最短：2；最长：500 |
| scenario | string | 否 | 枚举：["general","relationship","career","decision","resources","study","self","growth","communication","transition","creative","weekly","monthly","annual","lunar"] |
| kind | string | 是 | 枚举：["iching"] |
| lines | array<integer> | 是 | 最少项：6；最多项：6；说明：从下到上；6和9动爻；每项(枚举：[6,7,8,9]；最小：6；最大：9) |
| method | string | 否 | 枚举：["coins","numbers","time"] |
| casting | oneOf(NumberCasting, TimeCasting) | 否 | — |

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "version": {
      "type": "integer",
      "minimum": 0,
      "const": 1
    },
    "id": {
      "type": "string",
      "pattern": "^[a-zA-Z0-9-]{8,80}$"
    },
    "createdAt": {
      "type": "string",
      "format": "date-time"
    },
    "question": {
      "type": "string",
      "minLength": 2,
      "maxLength": 500
    },
    "scenario": {
      "type": "string",
      "enum": [
        "general",
        "relationship",
        "career",
        "decision",
        "resources",
        "study",
        "self",
        "growth",
        "communication",
        "transition",
        "creative",
        "weekly",
        "monthly",
        "annual",
        "lunar"
      ]
    },
    "kind": {
      "type": "string",
      "enum": [
        "iching"
      ]
    },
    "lines": {
      "type": "array",
      "items": {
        "type": "integer",
        "minimum": 6,
        "enum": [
          6,
          7,
          8,
          9
        ],
        "maximum": 9
      },
      "minItems": 6,
      "maxItems": 6,
      "description": "从下到上；6和9动爻"
    },
    "method": {
      "type": "string",
      "enum": [
        "coins",
        "numbers",
        "time"
      ]
    },
    "casting": {
      "oneOf": [
        {
          "$ref": "#/components/schemas/NumberCasting"
        },
        {
          "$ref": "#/components/schemas/TimeCasting"
        }
      ]
    }
  },
  "required": [
    "version",
    "id",
    "createdAt",
    "question",
    "kind",
    "lines"
  ],
  "description": "兼容旧记录不带method；新数字/时间记录有casting，后端重新计算核对六爻。",
  "allOf": [
    {
      "if": {
        "properties": {
          "method": {
            "const": "numbers"
          }
        },
        "required": [
          "method"
        ]
      },
      "then": {
        "required": [
          "casting"
        ],
        "properties": {
          "casting": {
            "$ref": "#/components/schemas/NumberCasting"
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "method": {
            "const": "time"
          }
        },
        "required": [
          "method"
        ]
      },
      "then": {
        "required": [
          "casting"
        ],
        "properties": {
          "casting": {
            "$ref": "#/components/schemas/TimeCasting"
          }
        }
      }
    },
    {
      "if": {
        "anyOf": [
          {
            "not": {
              "required": [
                "method"
              ]
            }
          },
          {
            "properties": {
              "method": {
                "const": "coins"
              }
            },
            "required": [
              "method"
            ]
          }
        ]
      },
      "then": {
        "not": {
          "required": [
            "casting"
          ]
        }
      }
    }
  ]
}
```

### Reading

| 字段 | 类型/引用 | 必需 | 限制及说明 |
|---|---|---|---|
| 整体 | oneOf(TarotReading, IChingReading) | — | — |

```json
{
  "oneOf": [
    {
      "$ref": "#/components/schemas/TarotReading"
    },
    {
      "$ref": "#/components/schemas/IChingReading"
    }
  ]
}
```

### Interpretation

| 字段 | 类型/引用 | 必需 | 限制及说明 |
|---|---|---|---|
| summary | string | 是 | 最短：1；最长：1600 |
| insights | array<object> | 是 | 最少项：1；最多项：128；说明：每条本次固定证据恰好一次，不得添加其他牌、卦或记录；每项(不接受未知字段) |
| actions | array<string> | 是 | 最少项：2；最多项：4；每项(最短：1；最长：500) |
| reflection | string | 是 | 最短：1；最长：500 |

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "summary": {
      "type": "string",
      "minLength": 1,
      "maxLength": 1600
    },
    "insights": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "reference": {
            "type": "string",
            "minLength": 1,
            "maxLength": 100
          },
          "text": {
            "type": "string",
            "minLength": 1,
            "maxLength": 1400
          }
        },
        "required": [
          "reference",
          "text"
        ]
      },
      "minItems": 1,
      "maxItems": 128,
      "description": "每条本次固定证据恰好一次，不得添加其他牌、卦或记录"
    },
    "actions": {
      "type": "array",
      "items": {
        "type": "string",
        "minLength": 1,
        "maxLength": 500
      },
      "minItems": 2,
      "maxItems": 4
    },
    "reflection": {
      "type": "string",
      "minLength": 1,
      "maxLength": 500
    }
  },
  "required": [
    "summary",
    "insights",
    "actions",
    "reflection"
  ]
}
```

### ReadingRecord

| 字段 | 类型/引用 | 必需 | 限制及说明 |
|---|---|---|---|
| id | string | 是 | 格式：uuid |
| reading | Reading | 是 | — |
| interpretation | Interpretation | 是 | — |
| ai | boolean | 是 | — |
| shared | boolean | 是 | — |
| createdAt | string | 是 | 格式：date-time |
| favorite | boolean | 是 | — |
| tags | array<string> | 是 | 最多项：8；每项(最短：1；最长：24) |
| note | string | 是 | 最长：1000 |
| metadataVersion | integer | 是 | 最小：0 |

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "id": {
      "type": "string",
      "format": "uuid"
    },
    "reading": {
      "$ref": "#/components/schemas/Reading"
    },
    "interpretation": {
      "$ref": "#/components/schemas/Interpretation"
    },
    "ai": {
      "type": "boolean"
    },
    "shared": {
      "type": "boolean"
    },
    "createdAt": {
      "type": "string",
      "format": "date-time"
    },
    "favorite": {
      "type": "boolean"
    },
    "tags": {
      "type": "array",
      "items": {
        "type": "string",
        "minLength": 1,
        "maxLength": 24
      },
      "maxItems": 8
    },
    "note": {
      "type": "string",
      "maxLength": 1000
    },
    "metadataVersion": {
      "type": "integer",
      "minimum": 0
    }
  },
  "required": [
    "id",
    "reading",
    "interpretation",
    "ai",
    "shared",
    "createdAt",
    "favorite",
    "tags",
    "note",
    "metadataVersion"
  ]
}
```

### DailyRecord

| 字段 | 类型/引用 | 必需 | 限制及说明 |
|---|---|---|---|
| id | string | 是 | 格式：uuid |
| date | string | 是 | 格式：date；说明：真实公历日期；由后端按上海日界解释 |
| reading | TarotReading | 是 | — |
| message | object | 是 | 不接受未知字段 |
| journal | object | 是 | 不接受未知字段 |

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "id": {
      "type": "string",
      "format": "uuid"
    },
    "date": {
      "type": "string",
      "format": "date",
      "description": "真实公历日期；由后端按上海日界解释"
    },
    "reading": {
      "$ref": "#/components/schemas/TarotReading"
    },
    "message": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "title": {
          "type": "string"
        },
        "text": {
          "type": "string"
        },
        "action": {
          "type": "string"
        },
        "reflection": {
          "type": "string"
        }
      },
      "required": [
        "title",
        "text",
        "action",
        "reflection"
      ]
    },
    "journal": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "note": {
          "type": "string",
          "maxLength": 600
        },
        "mood": {
          "anyOf": [
            {
              "type": "string",
              "enum": [
                "calm",
                "hopeful",
                "tired",
                "restless",
                "low"
              ]
            },
            {
              "type": "null"
            }
          ]
        },
        "version": {
          "type": "integer",
          "minimum": 0
        }
      },
      "required": [
        "note",
        "mood",
        "version"
      ]
    }
  },
  "required": [
    "id",
    "date",
    "reading",
    "message",
    "journal"
  ]
}
```

### Conversation

| 字段 | 类型/引用 | 必需 | 限制及说明 |
|---|---|---|---|
| id | string | 是 | 格式：uuid |
| prompt | string | 是 | 最长：1000 |
| answer | Interpretation 或 null | 是 | — |
| status | string | 是 | 枚举：["pending","done","failed"] |
| createdAt | string | 是 | 格式：date-time |

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "id": {
      "type": "string",
      "format": "uuid"
    },
    "prompt": {
      "type": "string",
      "maxLength": 1000
    },
    "answer": {
      "anyOf": [
        {
          "$ref": "#/components/schemas/Interpretation"
        },
        {
          "type": "null"
        }
      ]
    },
    "status": {
      "type": "string",
      "enum": [
        "pending",
        "done",
        "failed"
      ]
    },
    "createdAt": {
      "type": "string",
      "format": "date-time"
    }
  },
  "required": [
    "id",
    "prompt",
    "answer",
    "status",
    "createdAt"
  ]
}
```

### ActionCreate

| 字段 | 类型/引用 | 必需 | 限制及说明 |
|---|---|---|---|
| title | string | 是 | 最短：1；最长：160 |
| detail | string | 否 | 最长：1000 |
| readingId | string | 否 | 格式：uuid |
| dueDate | string 或 null | 否 | — |

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "title": {
      "type": "string",
      "minLength": 1,
      "maxLength": 160
    },
    "detail": {
      "type": "string",
      "maxLength": 1000
    },
    "readingId": {
      "type": "string",
      "format": "uuid"
    },
    "dueDate": {
      "anyOf": [
        {
          "type": "string",
          "format": "date",
          "pattern": "^20\\d\\d-\\d{2}-\\d{2}$",
          "description": "2000..2099 的真实公历日期"
        },
        {
          "type": "null"
        }
      ]
    }
  },
  "required": [
    "title"
  ]
}
```

### ActionEdit

| 字段 | 类型/引用 | 必需 | 限制及说明 |
|---|---|---|---|
| title | string | 是 | 最短：1；最长：160 |
| detail | string | 是 | 最长：1000 |
| dueDate | string 或 null | 是 | — |
| completed | boolean | 是 | — |
| version | integer | 是 | 最小：0 |

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "title": {
      "type": "string",
      "minLength": 1,
      "maxLength": 160
    },
    "detail": {
      "type": "string",
      "maxLength": 1000
    },
    "dueDate": {
      "anyOf": [
        {
          "type": "string",
          "format": "date",
          "pattern": "^20\\d\\d-\\d{2}-\\d{2}$",
          "description": "2000..2099 的真实公历日期"
        },
        {
          "type": "null"
        }
      ]
    },
    "completed": {
      "type": "boolean"
    },
    "version": {
      "type": "integer",
      "minimum": 0
    }
  },
  "required": [
    "title",
    "detail",
    "dueDate",
    "completed",
    "version"
  ]
}
```

### Action

| 字段 | 类型/引用 | 必需 | 限制及说明 |
|---|---|---|---|
| id | string | 是 | 格式：uuid |
| title | string | 是 | 最长：160 |
| detail | string | 是 | 最长：1000 |
| readingId | string 或 null | 是 | — |
| dueDate | string 或 null | 是 | — |
| completedAt | string 或 null | 是 | — |
| version | integer | 是 | 最小：0 |
| createdAt | string | 是 | 格式：date-time |
| updatedAt | string | 是 | 格式：date-time |

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "id": {
      "type": "string",
      "format": "uuid"
    },
    "title": {
      "type": "string",
      "maxLength": 160
    },
    "detail": {
      "type": "string",
      "maxLength": 1000
    },
    "readingId": {
      "anyOf": [
        {
          "type": "string",
          "format": "uuid"
        },
        {
          "type": "null"
        }
      ]
    },
    "dueDate": {
      "anyOf": [
        {
          "type": "string",
          "format": "date",
          "pattern": "^20\\d\\d-\\d{2}-\\d{2}$",
          "description": "2000..2099 的真实公历日期"
        },
        {
          "type": "null"
        }
      ]
    },
    "completedAt": {
      "anyOf": [
        {
          "type": "string",
          "format": "date-time"
        },
        {
          "type": "null"
        }
      ]
    },
    "version": {
      "type": "integer",
      "minimum": 0
    },
    "createdAt": {
      "type": "string",
      "format": "date-time"
    },
    "updatedAt": {
      "type": "string",
      "format": "date-time"
    }
  },
  "required": [
    "id",
    "title",
    "detail",
    "readingId",
    "dueDate",
    "completedAt",
    "version",
    "createdAt",
    "updatedAt"
  ]
}
```

### FeedbackCreate

| 字段 | 类型/引用 | 必需 | 限制及说明 |
|---|---|---|---|
| category | string | 是 | 枚举：["bug","idea","account","other"] |
| body | string | 是 | 最短：2；最长：2000 |

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "category": {
      "type": "string",
      "enum": [
        "bug",
        "idea",
        "account",
        "other"
      ]
    },
    "body": {
      "type": "string",
      "minLength": 2,
      "maxLength": 2000
    }
  },
  "required": [
    "category",
    "body"
  ]
}
```

### FeedbackReply

| 字段 | 类型/引用 | 必需 | 限制及说明 |
|---|---|---|---|
| status | string | 是 | 枚举：["open","in_progress","resolved"] |
| reply | string | 是 | 最长：2000 |
| version | integer | 是 | 最小：0 |

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "status": {
      "type": "string",
      "enum": [
        "open",
        "in_progress",
        "resolved"
      ]
    },
    "reply": {
      "type": "string",
      "maxLength": 2000
    },
    "version": {
      "type": "integer",
      "minimum": 0
    }
  },
  "required": [
    "status",
    "reply",
    "version"
  ]
}
```

### Feedback

| 字段 | 类型/引用 | 必需 | 限制及说明 |
|---|---|---|---|
| id | string | 是 | 格式：uuid |
| category | string | 是 | 枚举：["bug","idea","account","other"] |
| body | string | 是 | 最长：2000 |
| status | string | 是 | 枚举：["open","in_progress","resolved"] |
| adminReply | string 或 null | 是 | — |
| version | integer | 是 | 最小：0 |
| createdAt | string | 是 | 格式：date-time |
| updatedAt | string | 是 | 格式：date-time |

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "id": {
      "type": "string",
      "format": "uuid"
    },
    "category": {
      "type": "string",
      "enum": [
        "bug",
        "idea",
        "account",
        "other"
      ]
    },
    "body": {
      "type": "string",
      "maxLength": 2000
    },
    "status": {
      "type": "string",
      "enum": [
        "open",
        "in_progress",
        "resolved"
      ]
    },
    "adminReply": {
      "anyOf": [
        {
          "type": "string",
          "maxLength": 2000
        },
        {
          "type": "null"
        }
      ]
    },
    "version": {
      "type": "integer",
      "minimum": 0
    },
    "createdAt": {
      "type": "string",
      "format": "date-time"
    },
    "updatedAt": {
      "type": "string",
      "format": "date-time"
    }
  },
  "required": [
    "id",
    "category",
    "body",
    "status",
    "adminReply",
    "version",
    "createdAt",
    "updatedAt"
  ]
}
```

### AdminFeedback

| 字段 | 类型/引用 | 必需 | 限制及说明 |
|---|---|---|---|
| id | string | 是 | 格式：uuid |
| category | string | 是 | 枚举：["bug","idea","account","other"] |
| body | string | 是 | 最长：2000 |
| status | string | 是 | 枚举：["open","in_progress","resolved"] |
| adminReply | string 或 null | 是 | — |
| version | integer | 是 | 最小：0 |
| createdAt | string | 是 | 格式：date-time |
| updatedAt | string | 是 | 格式：date-time |
| userId | string | 是 | — |

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "id": {
      "type": "string",
      "format": "uuid"
    },
    "category": {
      "type": "string",
      "enum": [
        "bug",
        "idea",
        "account",
        "other"
      ]
    },
    "body": {
      "type": "string",
      "maxLength": 2000
    },
    "status": {
      "type": "string",
      "enum": [
        "open",
        "in_progress",
        "resolved"
      ]
    },
    "adminReply": {
      "anyOf": [
        {
          "type": "string",
          "maxLength": 2000
        },
        {
          "type": "null"
        }
      ]
    },
    "version": {
      "type": "integer",
      "minimum": 0
    },
    "createdAt": {
      "type": "string",
      "format": "date-time"
    },
    "updatedAt": {
      "type": "string",
      "format": "date-time"
    },
    "userId": {
      "type": "string"
    }
  },
  "required": [
    "id",
    "category",
    "body",
    "status",
    "adminReply",
    "version",
    "createdAt",
    "updatedAt",
    "userId"
  ]
}
```

### ReportCreate

| 字段 | 类型/引用 | 必需 | 限制及说明 |
|---|---|---|---|
| period | string | 是 | 枚举：["week","month"] |
| date | string | 是 | 格式：date；正则：^20\d\d-\d{2}-\d{2}$；说明：2000..2099 的真实公历日期 |
| includeJournal | boolean | 否 | 默认：false |
| consent | boolean | 是 | 固定：true |
| requestId | string | 是 | 格式：uuid |

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "period": {
      "type": "string",
      "enum": [
        "week",
        "month"
      ]
    },
    "date": {
      "type": "string",
      "format": "date",
      "pattern": "^20\\d\\d-\\d{2}-\\d{2}$",
      "description": "2000..2099 的真实公历日期"
    },
    "includeJournal": {
      "type": "boolean",
      "default": false
    },
    "consent": {
      "type": "boolean",
      "const": true
    },
    "requestId": {
      "type": "string",
      "format": "uuid"
    }
  },
  "required": [
    "period",
    "date",
    "consent",
    "requestId"
  ]
}
```

### Report

历史快照回顾；不返回inputCipher或内部AI缓存。本人可删除，管理员不可读取。

| 字段 | 类型/引用 | 必需 | 限制及说明 |
|---|---|---|---|
| id | string | 是 | 格式：uuid |
| period | string | 是 | 枚举：["week","month"] |
| startDate | string | 是 | 格式：date；说明：真实公历日期；由后端按上海日界解释 |
| endDate | string | 是 | 格式：date；说明：真实公历日期；由后端按上海日界解释 |
| includeJournal | boolean | 是 | — |
| status | string | 是 | 枚举：["pending","done","failed"] |
| result | Interpretation 或 null | 是 | — |
| createdAt | string | 是 | 格式：date-time |

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "id": {
      "type": "string",
      "format": "uuid"
    },
    "period": {
      "type": "string",
      "enum": [
        "week",
        "month"
      ]
    },
    "startDate": {
      "type": "string",
      "format": "date",
      "description": "真实公历日期；由后端按上海日界解释"
    },
    "endDate": {
      "type": "string",
      "format": "date",
      "description": "真实公历日期；由后端按上海日界解释"
    },
    "includeJournal": {
      "type": "boolean"
    },
    "status": {
      "type": "string",
      "enum": [
        "pending",
        "done",
        "failed"
      ]
    },
    "result": {
      "anyOf": [
        {
          "$ref": "#/components/schemas/Interpretation"
        },
        {
          "type": "null"
        }
      ]
    },
    "createdAt": {
      "type": "string",
      "format": "date-time"
    }
  },
  "required": [
    "id",
    "period",
    "startDate",
    "endDate",
    "includeJournal",
    "status",
    "result",
    "createdAt"
  ],
  "description": "历史快照回顾；不返回inputCipher或内部AI缓存。本人可删除，管理员不可读取。"
}
```

### RedeemInput

| 字段 | 类型/引用 | 必需 | 限制及说明 |
|---|---|---|---|
| code | string | 是 | 最短：18；最长：80；正则：^[A-Za-z0-9-]+$；说明：服务端移除连字符、转大写后SHA-256匹配；同用户同码只能兑换一次 |

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "code": {
      "type": "string",
      "minLength": 18,
      "maxLength": 80,
      "pattern": "^[A-Za-z0-9-]+$",
      "description": "服务端移除连字符、转大写后SHA-256匹配；同用户同码只能兑换一次"
    }
  },
  "required": [
    "code"
  ]
}
```

### Membership

| 字段 | 类型/引用 | 必需 | 限制及说明 |
|---|---|---|---|
| tier | string | 是 | 枚举：["free","plus"] |
| expiresAt | string 或 null | 是 | — |
| credits | integer | 是 | 最小：0；最大：100000000 |
| dailyLimit | integer | 是 | 枚举：[5,20]；最小：0 |
| usedToday | integer | 是 | 最小：0 |
| remainingToday | integer | 是 | 最小：0 |
| paymentEnabled | boolean | 是 | 固定：false |

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "tier": {
      "type": "string",
      "enum": [
        "free",
        "plus"
      ]
    },
    "expiresAt": {
      "anyOf": [
        {
          "type": "string",
          "format": "date-time"
        },
        {
          "type": "null"
        }
      ]
    },
    "credits": {
      "type": "integer",
      "minimum": 0,
      "maximum": 100000000
    },
    "dailyLimit": {
      "type": "integer",
      "minimum": 0,
      "enum": [
        5,
        20
      ]
    },
    "usedToday": {
      "type": "integer",
      "minimum": 0
    },
    "remainingToday": {
      "type": "integer",
      "minimum": 0
    },
    "paymentEnabled": {
      "type": "boolean",
      "const": false
    }
  },
  "required": [
    "tier",
    "expiresAt",
    "credits",
    "dailyLimit",
    "usedToday",
    "remainingToday",
    "paymentEnabled"
  ]
}
```

### Ledger

| 字段 | 类型/引用 | 必需 | 限制及说明 |
|---|---|---|---|
| id | string | 是 | 格式：uuid |
| kind | string | 是 | 枚举：["ai.consume","redeem.credits","admin.adjust"] |
| amount | integer | 是 | — |
| balance | integer | 是 | 最小：0 |
| createdAt | string | 是 | 格式：date-time |

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "id": {
      "type": "string",
      "format": "uuid"
    },
    "kind": {
      "type": "string",
      "enum": [
        "ai.consume",
        "redeem.credits",
        "admin.adjust"
      ]
    },
    "amount": {
      "type": "integer"
    },
    "balance": {
      "type": "integer",
      "minimum": 0
    },
    "createdAt": {
      "type": "string",
      "format": "date-time"
    }
  },
  "required": [
    "id",
    "kind",
    "amount",
    "balance",
    "createdAt"
  ]
}
```

### Redemption

| 字段 | 类型/引用 | 必需 | 限制及说明 |
|---|---|---|---|
| id | string | 是 | 格式：uuid |
| codeId | string | 是 | 格式：uuid |
| codeHint | string | 是 | 最长：20 |
| kind | string | 是 | 枚举：["credits","membership"] |
| amount | integer | 是 | 最小：1 |
| durationDays | integer 或 null | 是 | — |
| createdAt | string | 是 | 格式：date-time |

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "id": {
      "type": "string",
      "format": "uuid"
    },
    "codeId": {
      "type": "string",
      "format": "uuid"
    },
    "codeHint": {
      "type": "string",
      "maxLength": 20
    },
    "kind": {
      "type": "string",
      "enum": [
        "credits",
        "membership"
      ]
    },
    "amount": {
      "type": "integer",
      "minimum": 1
    },
    "durationDays": {
      "anyOf": [
        {
          "type": "integer",
          "minimum": 1
        },
        {
          "type": "null"
        }
      ]
    },
    "createdAt": {
      "type": "string",
      "format": "date-time"
    }
  },
  "required": [
    "id",
    "codeId",
    "codeHint",
    "kind",
    "amount",
    "durationDays",
    "createdAt"
  ]
}
```

### PaymentOptions

| 字段 | 类型/引用 | 必需 | 限制及说明 |
|---|---|---|---|
| enabled | boolean | 是 | 固定：false |
| providers | array<string> | 是 | 最多项：0；每项(—) |
| message | string | 是 | — |

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "enabled": {
      "type": "boolean",
      "const": false
    },
    "providers": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "maxItems": 0
    },
    "message": {
      "type": "string"
    }
  },
  "required": [
    "enabled",
    "providers",
    "message"
  ]
}
```

### ContentInput

| 字段 | 类型/引用 | 必需 | 限制及说明 |
|---|---|---|---|
| slug | string | 是 | 最长：80；正则：^[a-z0-9]+(?:-[a-z0-9]+)*$ |
| kind | string | 是 | 枚举：["announcement","guide"] |
| title | string | 是 | 最短：1；最长：160 |
| body | string | 是 | 最长：10000；说明：纯文本，不作为HTML渲染 |
| published | boolean | 是 | — |

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "slug": {
      "type": "string",
      "maxLength": 80,
      "pattern": "^[a-z0-9]+(?:-[a-z0-9]+)*$"
    },
    "kind": {
      "type": "string",
      "enum": [
        "announcement",
        "guide"
      ]
    },
    "title": {
      "type": "string",
      "minLength": 1,
      "maxLength": 160
    },
    "body": {
      "type": "string",
      "maxLength": 10000,
      "description": "纯文本，不作为HTML渲染"
    },
    "published": {
      "type": "boolean"
    }
  },
  "required": [
    "slug",
    "kind",
    "title",
    "body",
    "published"
  ]
}
```

### ContentUpdate

| 字段 | 类型/引用 | 必需 | 限制及说明 |
|---|---|---|---|
| slug | string | 是 | 最长：80；正则：^[a-z0-9]+(?:-[a-z0-9]+)*$ |
| kind | string | 是 | 枚举：["announcement","guide"] |
| title | string | 是 | 最短：1；最长：160 |
| body | string | 是 | 最长：10000；说明：纯文本，不作为HTML渲染 |
| published | boolean | 是 | — |
| version | integer | 是 | 最小：0 |

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "slug": {
      "type": "string",
      "maxLength": 80,
      "pattern": "^[a-z0-9]+(?:-[a-z0-9]+)*$"
    },
    "kind": {
      "type": "string",
      "enum": [
        "announcement",
        "guide"
      ]
    },
    "title": {
      "type": "string",
      "minLength": 1,
      "maxLength": 160
    },
    "body": {
      "type": "string",
      "maxLength": 10000,
      "description": "纯文本，不作为HTML渲染"
    },
    "published": {
      "type": "boolean"
    },
    "version": {
      "type": "integer",
      "minimum": 0
    }
  },
  "required": [
    "slug",
    "kind",
    "title",
    "body",
    "published",
    "version"
  ]
}
```

### Content

| 字段 | 类型/引用 | 必需 | 限制及说明 |
|---|---|---|---|
| id | string | 是 | 格式：uuid |
| slug | string | 是 | 最长：80；正则：^[a-z0-9]+(?:-[a-z0-9]+)*$ |
| kind | string | 是 | 枚举：["announcement","guide"] |
| title | string | 是 | 最短：1；最长：160 |
| body | string | 是 | 最长：10000；说明：纯文本，不作为HTML渲染 |
| published | boolean | 是 | — |
| version | integer | 是 | 最小：0 |
| createdAt | string | 是 | 格式：date-time |
| updatedAt | string | 是 | 格式：date-time |

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "id": {
      "type": "string",
      "format": "uuid"
    },
    "slug": {
      "type": "string",
      "maxLength": 80,
      "pattern": "^[a-z0-9]+(?:-[a-z0-9]+)*$"
    },
    "kind": {
      "type": "string",
      "enum": [
        "announcement",
        "guide"
      ]
    },
    "title": {
      "type": "string",
      "minLength": 1,
      "maxLength": 160
    },
    "body": {
      "type": "string",
      "maxLength": 10000,
      "description": "纯文本，不作为HTML渲染"
    },
    "published": {
      "type": "boolean"
    },
    "version": {
      "type": "integer",
      "minimum": 0
    },
    "createdAt": {
      "type": "string",
      "format": "date-time"
    },
    "updatedAt": {
      "type": "string",
      "format": "date-time"
    }
  },
  "required": [
    "id",
    "slug",
    "kind",
    "title",
    "body",
    "published",
    "version",
    "createdAt",
    "updatedAt"
  ]
}
```

### RedeemCreate

membership未传durationDays时以amount作为天数（最多3650）；credits金额最多1000000。

| 字段 | 类型/引用 | 必需 | 限制及说明 |
|---|---|---|---|
| kind | string | 是 | 枚举：["credits","membership"] |
| amount | integer | 是 | 最小：1；最大：1000000 |
| durationDays | integer | 否 | 最小：1；最大：3650 |
| expiresAt | string 或 null | 否 | — |
| maxUses | integer | 否 | 默认：1；最小：1；最大：10000 |

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "kind": {
      "type": "string",
      "enum": [
        "credits",
        "membership"
      ]
    },
    "amount": {
      "type": "integer",
      "minimum": 1,
      "maximum": 1000000
    },
    "durationDays": {
      "type": "integer",
      "minimum": 1,
      "maximum": 3650
    },
    "expiresAt": {
      "anyOf": [
        {
          "type": "string",
          "format": "date-time"
        },
        {
          "type": "null"
        }
      ]
    },
    "maxUses": {
      "type": "integer",
      "minimum": 1,
      "maximum": 10000,
      "default": 1
    }
  },
  "required": [
    "kind",
    "amount"
  ],
  "allOf": [
    {
      "if": {
        "properties": {
          "kind": {
            "const": "membership"
          }
        },
        "required": [
          "kind"
        ],
        "not": {
          "required": [
            "durationDays"
          ]
        }
      },
      "then": {
        "properties": {
          "amount": {
            "maximum": 3650
          }
        }
      }
    }
  ],
  "description": "membership未传durationDays时以amount作为天数（最多3650）；credits金额最多1000000。"
}
```

### CodeStatus

| 字段 | 类型/引用 | 必需 | 限制及说明 |
|---|---|---|---|
| disabled | boolean | 是 | — |

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "disabled": {
      "type": "boolean"
    }
  },
  "required": [
    "disabled"
  ]
}
```

### Code

| 字段 | 类型/引用 | 必需 | 限制及说明 |
|---|---|---|---|
| id | string | 是 | 格式：uuid |
| codeHint | string | 是 | 最长：20 |
| kind | string | 是 | 枚举：["credits","membership"] |
| amount | integer | 是 | 最小：1 |
| durationDays | integer 或 null | 是 | — |
| expiresAt | string 或 null | 是 | — |
| maxUses | integer | 是 | 最小：1 |
| usedCount | integer | 是 | 最小：0 |
| disabled | boolean | 是 | — |
| createdAt | string | 是 | 格式：date-time |

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "id": {
      "type": "string",
      "format": "uuid"
    },
    "codeHint": {
      "type": "string",
      "maxLength": 20
    },
    "kind": {
      "type": "string",
      "enum": [
        "credits",
        "membership"
      ]
    },
    "amount": {
      "type": "integer",
      "minimum": 1
    },
    "durationDays": {
      "anyOf": [
        {
          "type": "integer",
          "minimum": 1
        },
        {
          "type": "null"
        }
      ]
    },
    "expiresAt": {
      "anyOf": [
        {
          "type": "string",
          "format": "date-time"
        },
        {
          "type": "null"
        }
      ]
    },
    "maxUses": {
      "type": "integer",
      "minimum": 1
    },
    "usedCount": {
      "type": "integer",
      "minimum": 0
    },
    "disabled": {
      "type": "boolean"
    },
    "createdAt": {
      "type": "string",
      "format": "date-time"
    }
  },
  "required": [
    "id",
    "codeHint",
    "kind",
    "amount",
    "durationDays",
    "expiresAt",
    "maxUses",
    "usedCount",
    "disabled",
    "createdAt"
  ]
}
```

### CodeCreated

| 字段 | 类型/引用 | 必需 | 限制及说明 |
|---|---|---|---|
| code | string | 是 | 说明：新建时仅此响应展示完整随机码，不存储明文 |
| item | Code | 是 | — |

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "code": {
      "type": "string",
      "description": "新建时仅此响应展示完整随机码，不存储明文"
    },
    "item": {
      "$ref": "#/components/schemas/Code"
    }
  },
  "required": [
    "code",
    "item"
  ]
}
```

### MemberUpdate

plus必须提供未来expiresAt；credits为绝对目标余额，账本记录差额。free清空会员到期时间。

| 字段 | 类型/引用 | 必需 | 限制及说明 |
|---|---|---|---|
| tier | string | 是 | 枚举：["free","plus"] |
| expiresAt | string 或 null | 否 | — |
| credits | integer | 否 | 最小：0；最大：100000000 |

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "tier": {
      "type": "string",
      "enum": [
        "free",
        "plus"
      ]
    },
    "expiresAt": {
      "anyOf": [
        {
          "type": "string",
          "format": "date-time"
        },
        {
          "type": "null"
        }
      ]
    },
    "credits": {
      "type": "integer",
      "minimum": 0,
      "maximum": 100000000
    }
  },
  "required": [
    "tier"
  ],
  "description": "plus必须提供未来expiresAt；credits为绝对目标余额，账本记录差额。free清空会员到期时间。",
  "allOf": [
    {
      "if": {
        "properties": {
          "tier": {
            "const": "plus"
          }
        },
        "required": [
          "tier"
        ]
      },
      "then": {
        "required": [
          "expiresAt"
        ],
        "properties": {
          "expiresAt": {
            "type": "string",
            "format": "date-time",
            "description": "须严格晚于当前服务器时间"
          }
        }
      }
    }
  ]
}
```

### AdminUser

| 字段 | 类型/引用 | 必需 | 限制及说明 |
|---|---|---|---|
| id | string | 是 | — |
| name | string | 是 | — |
| email | string | 是 | 格式：email |
| role | string | 是 | 枚举：["user","admin"] |
| disabled | boolean | 是 | — |
| createdAt | string | 是 | 格式：date-time |
| membership | object 或 null | 是 | — |
| username | string 或 null | 是 | — |

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "id": {
      "type": "string"
    },
    "name": {
      "type": "string"
    },
    "email": {
      "type": "string",
      "format": "email"
    },
    "role": {
      "type": "string",
      "enum": [
        "user",
        "admin"
      ]
    },
    "disabled": {
      "type": "boolean"
    },
    "createdAt": {
      "type": "string",
      "format": "date-time"
    },
    "membership": {
      "anyOf": [
        {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "tier": {
              "type": "string",
              "enum": [
                "free",
                "plus"
              ]
            },
            "expiresAt": {
              "anyOf": [
                {
                  "type": "string",
                  "format": "date-time"
                },
                {
                  "type": "null"
                }
              ]
            },
            "credits": {
              "type": "integer",
              "minimum": 0
            }
          },
          "required": [
            "tier",
            "expiresAt",
            "credits"
          ]
        },
        {
          "type": "null"
        }
      ]
    },
    "username": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ]
    }
  },
  "required": [
    "id",
    "name",
    "email",
    "role",
    "disabled",
    "createdAt",
    "membership",
    "username"
  ]
}
```

### Audit

| 字段 | 类型/引用 | 必需 | 限制及说明 |
|---|---|---|---|
| id | string | 是 | 格式：uuid |
| actorId | string 或 null | 是 | — |
| action | string | 是 | — |
| targetId | string 或 null | 是 | — |
| requestId | string | 是 | 格式：uuid |
| createdAt | string | 是 | 格式：date-time |

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "id": {
      "type": "string",
      "format": "uuid"
    },
    "actorId": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ]
    },
    "action": {
      "type": "string"
    },
    "targetId": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ]
    },
    "requestId": {
      "type": "string",
      "format": "uuid"
    },
    "createdAt": {
      "type": "string",
      "format": "date-time"
    }
  },
  "required": [
    "id",
    "actorId",
    "action",
    "targetId",
    "requestId",
    "createdAt"
  ]
}
```

### Calendar

| 字段 | 类型/引用 | 必需 | 限制及说明 |
|---|---|---|---|
| month | string | 是 | 正则：^20\d\d-(0[1-9]\|1[0-2])$ |
| days | array<object> | 是 | 每项(不接受未知字段) |
| summary | object | 是 | 不接受未知字段 |

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "month": {
      "type": "string",
      "pattern": "^20\\d\\d-(0[1-9]|1[0-2])$"
    },
    "days": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "id": {
            "type": "string",
            "format": "uuid"
          },
          "date": {
            "type": "string",
            "format": "date",
            "description": "真实公历日期；由后端按上海日界解释"
          },
          "mood": {
            "anyOf": [
              {
                "type": "string",
                "enum": [
                  "calm",
                  "hopeful",
                  "tired",
                  "restless",
                  "low"
                ]
              },
              {
                "type": "null"
              }
            ]
          },
          "notePresent": {
            "type": "boolean"
          }
        },
        "required": [
          "id",
          "date",
          "mood",
          "notePresent"
        ]
      }
    },
    "summary": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "entries": {
          "type": "integer",
          "minimum": 0
        },
        "moods": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "mood": {
                "type": "string",
                "enum": [
                  "calm",
                  "hopeful",
                  "tired",
                  "restless",
                  "low"
                ]
              },
              "count": {
                "type": "integer",
                "minimum": 0
              }
            },
            "required": [
              "mood",
              "count"
            ]
          }
        }
      },
      "required": [
        "entries",
        "moods"
      ]
    }
  },
  "required": [
    "month",
    "days",
    "summary"
  ]
}
```

### Insights

| 字段 | 类型/引用 | 必需 | 限制及说明 |
|---|---|---|---|
| period | string | 是 | 枚举：["week","month"] |
| startDate | string | 是 | 格式：date；说明：真实公历日期；由后端按上海日界解释 |
| endDate | string | 是 | 格式：date；说明：真实公历日期；由后端按上海日界解释 |
| summary | object | 是 | 不接受未知字段 |
| readingKinds | array<object> | 是 | 每项(不接受未知字段) |
| journalIncluded | boolean | 是 | 固定：false |
| reflection | object | 是 | 不接受未知字段 |

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "period": {
      "type": "string",
      "enum": [
        "week",
        "month"
      ]
    },
    "startDate": {
      "type": "string",
      "format": "date",
      "description": "真实公历日期；由后端按上海日界解释"
    },
    "endDate": {
      "type": "string",
      "format": "date",
      "description": "真实公历日期；由后端按上海日界解释"
    },
    "summary": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "readings": {
          "type": "integer",
          "minimum": 0
        },
        "dailyEntries": {
          "type": "integer",
          "minimum": 0
        },
        "completedActions": {
          "type": "integer",
          "minimum": 0
        },
        "moods": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "mood": {
                "type": "string",
                "enum": [
                  "calm",
                  "hopeful",
                  "tired",
                  "restless",
                  "low"
                ]
              },
              "count": {
                "type": "integer",
                "minimum": 0
              }
            },
            "required": [
              "mood",
              "count"
            ]
          }
        }
      },
      "required": [
        "readings",
        "dailyEntries",
        "completedActions",
        "moods"
      ]
    },
    "readingKinds": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "kind": {
            "type": "string",
            "enum": [
              "tarot",
              "iching"
            ]
          },
          "count": {
            "type": "integer",
            "minimum": 0
          }
        },
        "required": [
          "kind",
          "count"
        ]
      }
    },
    "journalIncluded": {
      "type": "boolean",
      "const": false
    },
    "reflection": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "summary": {
          "type": "string"
        },
        "actions": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "reflection": {
          "type": "string"
        }
      },
      "required": [
        "summary",
        "actions",
        "reflection"
      ]
    }
  },
  "required": [
    "period",
    "startDate",
    "endDate",
    "summary",
    "readingKinds",
    "journalIncluded",
    "reflection"
  ]
}
```

### AdminOverview

| 字段 | 类型/引用 | 必需 | 限制及说明 |
|---|---|---|---|
| users | integer | 是 | 最小：0 |
| readings | integer | 是 | 最小：0 |
| dailyEntries | integer | 是 | 最小：0 |
| aiRequestsToday | integer | 是 | 最小：0 |
| aiDailyLimit | integer | 是 | 最小：0 |
| aiConfigured | boolean | 是 | — |
| database | string | 是 | 枚举：["ready"] |
| redis | string | 是 | 枚举：["ready","unavailable"] |

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "users": {
      "type": "integer",
      "minimum": 0
    },
    "readings": {
      "type": "integer",
      "minimum": 0
    },
    "dailyEntries": {
      "type": "integer",
      "minimum": 0
    },
    "aiRequestsToday": {
      "type": "integer",
      "minimum": 0
    },
    "aiDailyLimit": {
      "type": "integer",
      "minimum": 0
    },
    "aiConfigured": {
      "type": "boolean"
    },
    "database": {
      "type": "string",
      "enum": [
        "ready"
      ]
    },
    "redis": {
      "type": "string",
      "enum": [
        "ready",
        "unavailable"
      ]
    }
  },
  "required": [
    "users",
    "readings",
    "dailyEntries",
    "aiRequestsToday",
    "aiDailyLimit",
    "aiConfigured",
    "database",
    "redis"
  ]
}
```

### AdminStatistics

| 字段 | 类型/引用 | 必需 | 限制及说明 |
|---|---|---|---|
| days | integer | 是 | 枚举：[30,90]；最小：0 |
| startDate | string | 是 | 格式：date；说明：真实公历日期；由后端按上海日界解释 |
| endDate | string | 是 | 格式：date；说明：真实公历日期；由后端按上海日界解释 |
| series | array<object> | 是 | 每项(不接受未知字段) |
| readingKinds | array<object> | 是 | 每项(不接受未知字段) |
| totals | object | 是 | 不接受未知字段 |
| feedback | object | 是 | 不接受未知字段 |

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "days": {
      "type": "integer",
      "minimum": 0,
      "enum": [
        30,
        90
      ]
    },
    "startDate": {
      "type": "string",
      "format": "date",
      "description": "真实公历日期；由后端按上海日界解释"
    },
    "endDate": {
      "type": "string",
      "format": "date",
      "description": "真实公历日期；由后端按上海日界解释"
    },
    "series": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "date": {
            "type": "string",
            "format": "date",
            "description": "真实公历日期；由后端按上海日界解释"
          },
          "users": {
            "type": "integer",
            "minimum": 0
          },
          "readings": {
            "type": "integer",
            "minimum": 0
          },
          "dailyEntries": {
            "type": "integer",
            "minimum": 0
          },
          "aiRequests": {
            "type": "integer",
            "minimum": 0
          }
        },
        "required": [
          "date",
          "users",
          "readings",
          "dailyEntries",
          "aiRequests"
        ]
      }
    },
    "readingKinds": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "kind": {
            "type": "string",
            "enum": [
              "tarot",
              "iching"
            ]
          },
          "count": {
            "type": "integer",
            "minimum": 0
          }
        },
        "required": [
          "kind",
          "count"
        ]
      }
    },
    "totals": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "users": {
          "type": "integer",
          "minimum": 0
        },
        "readings": {
          "type": "integer",
          "minimum": 0
        },
        "dailyEntries": {
          "type": "integer",
          "minimum": 0
        },
        "aiRequests": {
          "type": "integer",
          "minimum": 0
        }
      },
      "required": [
        "users",
        "readings",
        "dailyEntries",
        "aiRequests"
      ]
    },
    "feedback": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "open": {
          "type": "integer",
          "minimum": 0
        },
        "inProgress": {
          "type": "integer",
          "minimum": 0
        },
        "resolved": {
          "type": "integer",
          "minimum": 0
        }
      },
      "required": [
        "open",
        "inProgress",
        "resolved"
      ]
    }
  },
  "required": [
    "days",
    "startDate",
    "endDate",
    "series",
    "readingKinds",
    "totals",
    "feedback"
  ]
}
```

### Config

| 字段 | 类型/引用 | 必需 | 限制及说明 |
|---|---|---|---|
| aiEnabled | boolean | 是 | — |
| aiProvider | string | 是 | — |
| timeZone | string | 是 | 枚举：["Asia/Shanghai"] |
| privacy | string | 是 | 枚举：["shared-only"] |
| features | object | 是 | 不接受未知字段 |
| paymentEnabled | boolean | 是 | 固定：false |
| deploymentMode | string | 是 | 枚举：["https","ssh-only"] |

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "aiEnabled": {
      "type": "boolean"
    },
    "aiProvider": {
      "type": "string"
    },
    "timeZone": {
      "type": "string",
      "enum": [
        "Asia/Shanghai"
      ]
    },
    "privacy": {
      "type": "string",
      "enum": [
        "shared-only"
      ]
    },
    "features": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "tarot": {
          "type": "boolean"
        },
        "iching": {
          "type": "boolean"
        },
        "conversations": {
          "type": "boolean"
        },
        "privateMetadata": {
          "type": "boolean"
        }
      },
      "required": [
        "tarot",
        "iching",
        "conversations",
        "privateMetadata"
      ]
    },
    "paymentEnabled": {
      "type": "boolean",
      "const": false
    },
    "deploymentMode": {
      "type": "string",
      "enum": [
        "https",
        "ssh-only"
      ]
    }
  },
  "required": [
    "aiEnabled",
    "aiProvider",
    "timeZone",
    "privacy",
    "features",
    "paymentEnabled",
    "deploymentMode"
  ]
}
```

### Catalog

| 字段 | 类型/引用 | 必需 | 限制及说明 |
|---|---|---|---|
| spreads | object | 是 | 说明：32种牌阵的动态目录；键为SpreadId；动态键值：object |
| scenarios | array<object> | 是 | 每项(不接受未知字段) |
| ichingMethods | array<object> | 是 | 每项(不接受未知字段) |
| timeZone | string | 是 | 枚举：["Asia/Shanghai"] |

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "spreads": {
      "type": "object",
      "additionalProperties": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "name": {
            "type": "string"
          },
          "positions": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "description": {
            "type": "string"
          },
          "category": {
            "type": "string"
          }
        },
        "required": [
          "name",
          "positions",
          "description",
          "category"
        ]
      },
      "description": "32种牌阵的动态目录；键为SpreadId"
    },
    "scenarios": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "id": {
            "type": "string",
            "enum": [
              "general",
              "relationship",
              "career",
              "decision",
              "resources",
              "study",
              "self",
              "growth",
              "communication",
              "transition",
              "creative",
              "weekly",
              "monthly",
              "annual",
              "lunar"
            ]
          },
          "name": {
            "type": "string"
          },
          "description": {
            "type": "string"
          },
          "prompts": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "recommendedSpreads": {
            "type": "array",
            "items": {
              "type": "string",
              "enum": [
                "single",
                "three",
                "past-present-future",
                "mind-heart-action",
                "relationship-five",
                "relationship-cross",
                "relationship-bridge",
                "reconciliation",
                "self-love",
                "career-path",
                "career-cross",
                "job-change",
                "project-launch",
                "business-five",
                "money-budget",
                "study-plan",
                "exam-preparation",
                "decision-two",
                "decision-three",
                "crossroads",
                "obstacle-breakthrough",
                "shadow-work",
                "balance-five",
                "new-moon",
                "full-moon",
                "week-ahead",
                "month-ahead",
                "year-wheel",
                "celtic-cross",
                "purpose",
                "creative-spark",
                "travel-transition"
              ]
            }
          }
        },
        "required": [
          "id",
          "name",
          "description",
          "prompts",
          "recommendedSpreads"
        ]
      }
    },
    "ichingMethods": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "id": {
            "type": "string",
            "enum": [
              "coins",
              "numbers",
              "time"
            ]
          },
          "name": {
            "type": "string"
          },
          "description": {
            "type": "string"
          },
          "rule": {
            "type": "string"
          }
        },
        "required": [
          "id",
          "name",
          "description",
          "rule"
        ]
      }
    },
    "timeZone": {
      "type": "string",
      "enum": [
        "Asia/Shanghai"
      ]
    }
  },
  "required": [
    "spreads",
    "scenarios",
    "ichingMethods",
    "timeZone"
  ]
}
```

### ReadingRecordPage

| 字段 | 类型/引用 | 必需 | 限制及说明 |
|---|---|---|---|
| items | array<ReadingRecord> | 是 | 每项(—) |
| nextCursor | string 或 null | 是 | — |

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "items": {
      "type": "array",
      "items": {
        "$ref": "#/components/schemas/ReadingRecord"
      }
    },
    "nextCursor": {
      "anyOf": [
        {
          "type": "string",
          "format": "uuid"
        },
        {
          "type": "null"
        }
      ]
    }
  },
  "required": [
    "items",
    "nextCursor"
  ]
}
```

### DailyRecordPage

| 字段 | 类型/引用 | 必需 | 限制及说明 |
|---|---|---|---|
| items | array<DailyRecord> | 是 | 每项(—) |
| nextCursor | string 或 null | 是 | — |

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "items": {
      "type": "array",
      "items": {
        "$ref": "#/components/schemas/DailyRecord"
      }
    },
    "nextCursor": {
      "anyOf": [
        {
          "type": "string",
          "format": "uuid"
        },
        {
          "type": "null"
        }
      ]
    }
  },
  "required": [
    "items",
    "nextCursor"
  ]
}
```

### ConversationPage

| 字段 | 类型/引用 | 必需 | 限制及说明 |
|---|---|---|---|
| items | array<Conversation> | 是 | 每项(—) |
| nextCursor | string 或 null | 是 | — |

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "items": {
      "type": "array",
      "items": {
        "$ref": "#/components/schemas/Conversation"
      }
    },
    "nextCursor": {
      "anyOf": [
        {
          "type": "string",
          "format": "uuid"
        },
        {
          "type": "null"
        }
      ]
    }
  },
  "required": [
    "items",
    "nextCursor"
  ]
}
```

### ActionPage

| 字段 | 类型/引用 | 必需 | 限制及说明 |
|---|---|---|---|
| items | array<Action> | 是 | 每项(—) |
| nextCursor | string 或 null | 是 | — |

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "items": {
      "type": "array",
      "items": {
        "$ref": "#/components/schemas/Action"
      }
    },
    "nextCursor": {
      "anyOf": [
        {
          "type": "string",
          "format": "uuid"
        },
        {
          "type": "null"
        }
      ]
    }
  },
  "required": [
    "items",
    "nextCursor"
  ]
}
```

### FeedbackPage

| 字段 | 类型/引用 | 必需 | 限制及说明 |
|---|---|---|---|
| items | array<Feedback> | 是 | 每项(—) |
| nextCursor | string 或 null | 是 | — |

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "items": {
      "type": "array",
      "items": {
        "$ref": "#/components/schemas/Feedback"
      }
    },
    "nextCursor": {
      "anyOf": [
        {
          "type": "string",
          "format": "uuid"
        },
        {
          "type": "null"
        }
      ]
    }
  },
  "required": [
    "items",
    "nextCursor"
  ]
}
```

### AdminFeedbackPage

| 字段 | 类型/引用 | 必需 | 限制及说明 |
|---|---|---|---|
| items | array<AdminFeedback> | 是 | 每项(—) |
| nextCursor | string 或 null | 是 | — |

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "items": {
      "type": "array",
      "items": {
        "$ref": "#/components/schemas/AdminFeedback"
      }
    },
    "nextCursor": {
      "anyOf": [
        {
          "type": "string",
          "format": "uuid"
        },
        {
          "type": "null"
        }
      ]
    }
  },
  "required": [
    "items",
    "nextCursor"
  ]
}
```

### ReportPage

| 字段 | 类型/引用 | 必需 | 限制及说明 |
|---|---|---|---|
| items | array<Report> | 是 | 每项(—) |
| nextCursor | string 或 null | 是 | — |

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "items": {
      "type": "array",
      "items": {
        "$ref": "#/components/schemas/Report"
      }
    },
    "nextCursor": {
      "anyOf": [
        {
          "type": "string",
          "format": "uuid"
        },
        {
          "type": "null"
        }
      ]
    }
  },
  "required": [
    "items",
    "nextCursor"
  ]
}
```

### LedgerPage

| 字段 | 类型/引用 | 必需 | 限制及说明 |
|---|---|---|---|
| items | array<Ledger> | 是 | 每项(—) |
| nextCursor | string 或 null | 是 | — |

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "items": {
      "type": "array",
      "items": {
        "$ref": "#/components/schemas/Ledger"
      }
    },
    "nextCursor": {
      "anyOf": [
        {
          "type": "string",
          "format": "uuid"
        },
        {
          "type": "null"
        }
      ]
    }
  },
  "required": [
    "items",
    "nextCursor"
  ]
}
```

### RedemptionPage

| 字段 | 类型/引用 | 必需 | 限制及说明 |
|---|---|---|---|
| items | array<Redemption> | 是 | 每项(—) |
| nextCursor | string 或 null | 是 | — |

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "items": {
      "type": "array",
      "items": {
        "$ref": "#/components/schemas/Redemption"
      }
    },
    "nextCursor": {
      "anyOf": [
        {
          "type": "string",
          "format": "uuid"
        },
        {
          "type": "null"
        }
      ]
    }
  },
  "required": [
    "items",
    "nextCursor"
  ]
}
```

### ContentPage

| 字段 | 类型/引用 | 必需 | 限制及说明 |
|---|---|---|---|
| items | array<Content> | 是 | 每项(—) |
| nextCursor | string 或 null | 是 | — |

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "items": {
      "type": "array",
      "items": {
        "$ref": "#/components/schemas/Content"
      }
    },
    "nextCursor": {
      "anyOf": [
        {
          "type": "string",
          "format": "uuid"
        },
        {
          "type": "null"
        }
      ]
    }
  },
  "required": [
    "items",
    "nextCursor"
  ]
}
```

### CodePage

| 字段 | 类型/引用 | 必需 | 限制及说明 |
|---|---|---|---|
| items | array<Code> | 是 | 每项(—) |
| nextCursor | string 或 null | 是 | — |

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "items": {
      "type": "array",
      "items": {
        "$ref": "#/components/schemas/Code"
      }
    },
    "nextCursor": {
      "anyOf": [
        {
          "type": "string",
          "format": "uuid"
        },
        {
          "type": "null"
        }
      ]
    }
  },
  "required": [
    "items",
    "nextCursor"
  ]
}
```

### AdminUserPage

| 字段 | 类型/引用 | 必需 | 限制及说明 |
|---|---|---|---|
| items | array<AdminUser> | 是 | 每项(—) |
| nextCursor | string 或 null | 是 | — |

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "items": {
      "type": "array",
      "items": {
        "$ref": "#/components/schemas/AdminUser"
      }
    },
    "nextCursor": {
      "anyOf": [
        {
          "type": "string",
          "format": "uuid"
        },
        {
          "type": "null"
        }
      ]
    }
  },
  "required": [
    "items",
    "nextCursor"
  ]
}
```

### AuditPage

| 字段 | 类型/引用 | 必需 | 限制及说明 |
|---|---|---|---|
| items | array<Audit> | 是 | 每项(—) |
| nextCursor | string 或 null | 是 | — |

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "items": {
      "type": "array",
      "items": {
        "$ref": "#/components/schemas/Audit"
      }
    },
    "nextCursor": {
      "anyOf": [
        {
          "type": "string",
          "format": "uuid"
        },
        {
          "type": "null"
        }
      ]
    }
  },
  "required": [
    "items",
    "nextCursor"
  ]
}
```

### Export

一次导出本人全部可见关联记录（无静默截断）。总行数>20000、预估内容>12MB或实际JSON>20MB时拒绝413；每用户2次/300秒。无密码/TOTP/兑换码明文/内部AI缓存/回顾输入快照。

| 字段 | 类型/引用 | 必需 | 限制及说明 |
|---|---|---|---|
| version | integer | 是 | 固定：2；最小：0 |
| exportedAt | string | 是 | 格式：date-time |
| readings | array<ReadingRecord> | 是 | 每项(—) |
| daily | array<DailyRecord> | 是 | 每项(—) |
| actions | array<Action> | 是 | 每项(—) |
| reports | array<Report> | 是 | 每项(—) |
| conversations | array<object> | 是 | 每项(不接受未知字段) |
| feedback | array<Feedback> | 是 | 每项(—) |
| membership | Membership | 是 | — |
| creditLedger | array<Ledger> | 是 | 每项(—) |
| redemptions | array<Redemption> | 是 | 每项(—) |

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "version": {
      "type": "integer",
      "minimum": 0,
      "const": 2
    },
    "exportedAt": {
      "type": "string",
      "format": "date-time"
    },
    "readings": {
      "type": "array",
      "items": {
        "$ref": "#/components/schemas/ReadingRecord"
      }
    },
    "daily": {
      "type": "array",
      "items": {
        "$ref": "#/components/schemas/DailyRecord"
      }
    },
    "actions": {
      "type": "array",
      "items": {
        "$ref": "#/components/schemas/Action"
      }
    },
    "reports": {
      "type": "array",
      "items": {
        "$ref": "#/components/schemas/Report"
      }
    },
    "conversations": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "id": {
            "type": "string",
            "format": "uuid"
          },
          "prompt": {
            "type": "string",
            "maxLength": 1000
          },
          "answer": {
            "anyOf": [
              {
                "$ref": "#/components/schemas/Interpretation"
              },
              {
                "type": "null"
              }
            ]
          },
          "status": {
            "type": "string",
            "enum": [
              "pending",
              "done",
              "failed"
            ]
          },
          "createdAt": {
            "type": "string",
            "format": "date-time"
          },
          "readingId": {
            "type": "string",
            "format": "uuid"
          }
        },
        "required": [
          "id",
          "prompt",
          "answer",
          "status",
          "createdAt",
          "readingId"
        ]
      }
    },
    "feedback": {
      "type": "array",
      "items": {
        "$ref": "#/components/schemas/Feedback"
      }
    },
    "membership": {
      "$ref": "#/components/schemas/Membership"
    },
    "creditLedger": {
      "type": "array",
      "items": {
        "$ref": "#/components/schemas/Ledger"
      }
    },
    "redemptions": {
      "type": "array",
      "items": {
        "$ref": "#/components/schemas/Redemption"
      }
    }
  },
  "required": [
    "version",
    "exportedAt",
    "readings",
    "daily",
    "actions",
    "reports",
    "conversations",
    "feedback",
    "membership",
    "creditLedger",
    "redemptions"
  ],
  "description": "一次导出本人全部可见关联记录（无静默截断）。总行数>20000、预估内容>12MB或实际JSON>20MB时拒绝413；每用户2次/300秒。无密码/TOTP/兑换码明文/内部AI缓存/回顾输入快照。"
}
```

## 跨字段约束与实现语义补充

- CreateReading：塔罗只接受默认coins method且不能带numbers/time；易经numbers必须带3个正整数且不能带time；time必须带带偏移时间且不能带numbers；coins不能带numbers/time。每次创建均以服务端生成的固定结果为准。
- question、prompt、title等按具体请求模型trim；note/标签在保存服务里再trim，标签去重，服务端返回规范化值。
- ReportCreate.period仅week/month；date确定期间；includeJournal默认false；consent必须true。模型输入只在第一次生成时固定，恢复时不可重新采样当前资料。
- MemberUpdate.plus需未来expiresAt；free清空会员到期；credits是目标绝对余额，审计账本记差额。
- RedeemCreate.membership未传durationDays时取amount且不超过3650；code原文仅创建响应返回一次，后续列表只返回codeHint，不返回codeHash。
- AdminStatistics.feedback是当前所有反馈状态计数，series/totals为选中30或90天的日计数；不要误把feedback也按日期截取。
- Export并非cursor分页：限制内一次返回本人全部关联数据，超过2万行、12MB预估密文或20MB输出拒绝413。
- 常规删除返回Ok；来源Reading删除会删conversation/ai_request，ActionPlan关联readingId置null；ReviewReport删除清理其含内容AI缓存；AI allowance/积分消费历史保留。普通账号删除级联本人数据，管理员账号不能自助删除。
- Java迁移阶段任何endpoint完成都需对应HTTP/权限/状态机测试，不能仅以Spring路由已注册更新为implemented。

## 检查范围

本文按当前固定源码与依赖审查，未调用生产接口、未读取真实用户数据、未发送真实模型请求。原版本CI/本地基线证据见审查报告。所有Java实现状态仍pending，未来以backend/migration-status.json的逐操作证据更新。
