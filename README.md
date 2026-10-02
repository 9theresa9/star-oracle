# 照见 · Star Oracle

中文塔罗与易经探索网站。深紫、香槟金与克制的星空氛围；桌面与手机分别排版，支持减少动态效果。

## 运行

需要 Node.js 22.13 或更新版本。应用运行无需安装第三方依赖。

```sh
npm start
```

打开 http://localhost:3000。开发时运行 npm run dev。

## 首版功能

- 78 张塔罗牌；单张或“情境 · 提醒 · 行动”三张牌阵，可选逆位。
- 加密随机源、拒绝采样与 Fisher–Yates 洗牌；同一牌阵不重复。
- 三枚硬币起六爻，从下向上；标准文王卦序、本卦、动爻与变卦。
- 点选翻牌、逐次起爻，支持系统“减少动态效果”。
- 基础象征解读，以及可选的服务端 AI 解读和追问。
- 本机最近十次记录，支持重看、复制、删除和清空。
- 无账号系统、支付、数据库或完整纳甲排盘。

## AI 配置

复制 .env.example 为 .env，在服务器上填写：

```dotenv
AI_API_KEY=你的模型服务密钥
AI_MODEL=gpt-4o-mini
AI_BASE_URL=https://api.openai.com/v1
```

使用 DeepSeek 时，把 AI_MODEL 改为 deepseek-chat，AI_BASE_URL 改为 https://api.deepseek.com/v1。兼容提供 chat/completions 和 JSON 对象输出的服务。

模型密钥只在后端使用；.env 已忽略。未配置密钥时，抽牌、起卦、基础解读和历史记录都能使用，界面明确显示 AI 未配置。AI 服务会产生该服务的调用费用。

服务器根据牌 ID 或六爻值重建依据，丢弃客户端自带的牌名和关键词。追问与重试沿用原结果。响应必须包含所有固定 reference 且不能新增或重复 reference；这项验证检查格式和关联，不能证明解释内容正确。

## 验证

```sh
npm test
npm run build
```

npm run preview:build 生成独立的 artifacts/preview.html，可用于 GPT 内交互预览；该预览不连接 AI 后端。

GitHub Actions 还运行 Chromium 与 WebKit 的桌面及 390 × 844 手机尺寸流程，产出首页、塔罗结果和易经结果截图。AI 测试使用模拟服务；真实密钥与付费模型需部署后验证。详见 [review 说明](docs/REVIEW.md)。

## 部署

普通服务器：npm start；容器：Dockerfile 已提供，需要通过环境变量传入密钥。

Sites：npm run build 生成 dist/server/index.js（Cloudflare Worker），同一产物包含前端静态资源与后端 API。详见 [Sites 部署说明](docs/DEPLOYMENT.md)。GitHub 上传、CI 构建和 Sites 发布是不同步骤；访问链接以成功部署返回的实际 URL 为准。

## 内容与许可

牌面为符号设计。大阿卡纳使用简短关键词，小阿卡纳使用花色与阶位组合提示。易经提供现代主题与反思问题，不含古籍卦辞、爻辞原文。

数据改编自 MIT 项目 [Xuandu](https://github.com/cnc876297794-arch/xuandu)。上游版权声明保存在 licenses/xuandu-MIT.txt；来源见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
