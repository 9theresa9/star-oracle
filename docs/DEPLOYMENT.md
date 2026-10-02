# 部署说明

## 当前可部署的内容

前端：public/index.html、styles.css、app.js。
后端：server/api.js 使用 Web 标准 Request/Response/fetch；server/index.js 是 Node.js 适配器。
共享规则：shared/engine.js 与 shared/data.js，前后端使用同一数据和验证逻辑。

npm run build 把共享规则、API 与静态资源合并为 dist/server/index.js，无构建依赖，符合 Sites Worker ESM 入口结构。dist/.openai/hosting.json 保留逻辑绑定声明。

## Sites 发布流程（供开发助手执行）

1. 在具有文件系统、Node、Git 和终端工具的任务里检出本功能分支。
2. 读取 .openai/hosting.json；存在 project_id 时复用，当前文件尚未注册站点。
3. 使用已安装 Sites 的 sites-building 与 sites-hosting 流程注册私有站点，立即原子写回返回的 project_id。
4. 在该站点的配置中保存 AI_API_KEY 为服务器秘密变量；也可以先发布基础解读版本，再配置 AI。
5. 使用 Sites site-workflow.mjs 对源码做检查、构建、推送及归档；临时源码凭据只通过内存/stdin 传递。
6. 发布这个已推送提交对应的版本；新站点保持仅所有者可访问。
7. 查询部署状态，只有 succeeded 且返回实际 URL 才算发布完成。

当前任务的 GitHub 连接能够写入代码，但没有终端/本地打包执行工具。GitHub Actions 的构建产物用于验证和交付，不表示源码已同步到 Sites 源码仓库。尚未发布时不能给出或推测访问 URL。

## 普通服务器与容器

本机 npm start 默认仅监听 127.0.0.1:3000。
外部部署设置 HOST=0.0.0.0 与平台提供的 PORT，并在平台配置 AI_API_KEY、AI_MODEL、AI_BASE_URL。

Docker：
```sh
docker build -t star-oracle .
docker run --rm -p 3000:3000 --env-file .env star-oracle
```

AI 使用 30 秒超时、请求体限制、每客户端每分钟 6 次和最多 4 个并发。限流保存在进程或 Worker isolate 内存中，不是跨实例计费限额；公开运营前应按实际部署补充共享限流和预算控制。Node 在代理后按 socket 地址识别客户端，可能让访客共用代理的配额；不会信任任意 X-Forwarded-For。

没有数据库、服务器历史记录或问题日志。模型服务仍会收到用户主动提交的解读请求。HTTPS 应由部署平台提供。
