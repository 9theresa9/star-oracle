# 分支与 review

当前保留两个分支：

- `main`：默认主分支。
- `feat/comprehensive-oracle`：包含当前全部需求、前后端代码、部署文档及界面截图，后续开发以此为准。

[PR #4](https://github.com/9theresa9/star-oracle/pull/4) 直接面向 `main`，完整包含 MVP、每日星笺、生产架构和本轮功能扩展。旧 PR #1–#3 被它取代并关闭，原有讨论与提交记录仍可查看。合并 PR #4 后再按部署说明上线；当前 GPT 站点是旧原型。

[当前界面与验证](REVIEW_SCREENSHOTS.md) · [完整功能](FEATURES.md) · [部署](DEPLOYMENT.md)

## 已归档的分支

删除前，下列分支的提交均作为整理提交的父提交保存，历史保持可追溯。最新截图已归入 `docs/screenshots/comprehensive`；架构阶段旧截图归入 `docs/screenshots/architecture`。仅移除分支引用，不丢弃这些代码与截图。

| 原分支 | 删除前提交 |
| --- | --- |
| `agent/comprehensive-docs` | `21a58ad84c6632c2232d2d0559eb546e078ba9c5` |
| `agent/divination-domain` | `4d914c32339c110867c7b7f70938fedd93869a95` |
| `agent/divination-ui` | `167f593a6609133e76829b22d36c750bb3e2abd2` |
| `agent/management-ui` | `c8461780c82d66555b97f0a75e91de1141d28468` |
| `agent/oracle-expansion` | `fba362311e76038842025217885ffbca94c50bbc` |
| `agent/personal-expansion` | `41d296a6ff84ae9f05a50c504ed9813b5ac58bba` |
| `agent/personal-ui` | `d56aed3f1ba5b40f927b8e2b7958529ea17bcc88` |
| `feat/daily-starlight` | `764f6786f7545f596109a1a1e2a71f997d95e605` |
| `feat/production-architecture` | `699cdc3fd7d01433290b5cb7fdca7368a391be3e` |
| `feat/star-oracle-mvp` | `c7db224627b4bbb588d9af6000c2ce224137c9a9` |
| `review/comprehensive-ui` | `19fac0effd84204faf3613cb6fe904ddc5584e99` |
| `review/production-ui` | `2a1a57539a14185e570c7615aa8d0d0a54466a26` |

需要查旧实现时，可以按上述 SHA 查看提交历史；日常只使用保留的开发分支。
