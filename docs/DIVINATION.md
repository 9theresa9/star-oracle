# 占卜领域与知识库

此模块为前端与后端共用的纯 JavaScript 领域包，不依赖网络、数据库或新增 npm 包。实际随机抽牌在浏览器/Node Web Crypto 中采用拒绝采样。所有结果和 AI 引用仍使用固定牌面 ID / 文王卦序，旧 version:1 存档继续有效。

## 塔罗

78 张牌沿用既有固定 ID；新增逐牌独立的说明、正逆位含义、象征观察、反思问题与实践建议，可通过 TAROT_LIBRARY 查询。说明为现代原创摘要，不伪称历史引文或疗效。

SPREADS 提供 32 个具有明确位置的布局：

- `single`：单张聚焦，1 张。
- `three`：情境 · 提醒 · 行动，3 张。
- `past-present-future`：过去 · 当下 · 可能走向，3 张。
- `mind-heart-action`：理智 · 感受 · 行动，3 张。
- `relationship-five`：关系五角，5 张。
- `relationship-cross`：关系十字，5 张。
- `relationship-bridge`：沟通之桥，5 张。
- `reconciliation`：修复与边界，5 张。
- `self-love`：自我关怀，5 张。
- `career-path`：职业方向，5 张。
- `career-cross`：工作局面十字，5 张。
- `job-change`：转职评估，5 张。
- `project-launch`：项目启动，5 张。
- `business-five`：合作与经营，5 张。
- `money-budget`：资源与预算，5 张。
- `study-plan`：学习路径，5 张。
- `exam-preparation`：备考校准，5 张。
- `decision-two`：双路径选择，6 张。
- `decision-three`：三路径选择，7 张。
- `crossroads`：岔路口，5 张。
- `obstacle-breakthrough`：阻力与突破，5 张。
- `shadow-work`：内在模式，5 张。
- `balance-five`：生活平衡，5 张。
- `new-moon`：新月意图，4 张。
- `full-moon`：满月回顾，4 张。
- `week-ahead`：一周安排，5 张。
- `month-ahead`：月度规划，6 张。
- `year-wheel`：年度十二宫格，13 张。
- `celtic-cross`：凯尔特十字，10 张。
- `purpose`：价值与方向，5 张。
- `creative-spark`：创意火花，5 张。
- `travel-transition`：旅途与转变，5 张。

single / three 的名称、位置与抽牌语义保持不变。所有牌阵使用同一78张牌、无重复抽取，正逆位设置一致。凯尔特十字采用目录中明示的现代常见版本；年度十二宫格为年度规划，并非占星十二宫或未来事件预测。

SCENARIOS 提供 15 个主题、问题示例与推荐牌阵；存在 Reading.scenario 时须匹配主题枚举。主题仅提供问题上下文，不改变随机抽牌或牌义，也不推断第三方内心。

## 易经算法与复现

六爻全部按 **从下到上** 存储。6=老阴、7=少阳、8=少阴、9=老阳；仅6、9翻转成变卦。KING_WEN_BY_MASK 沿用已经验证的文王六十四卦映射。

三枚硬币法保持现有实现与6:7:8:9的1:3:3:1分布。

### 数字起卦：modern-numbers-v1

castNumberLines([a,b,c]) 接受三个1..1000000000的安全正整数。本项目明确采用以下当代简化梅花法：

- a 决定上卦，b 决定下卦，各除8取余，余0按8。
- 先天卦序为1乾、2兑、3离、4震、5巽、6坎、7艮、8坤。
- **c 本身**除6取余决定动爻，余0按6；不取三数之和。
- 固定只有一条动爻，其他爻记录为7或8。

例如 [1,1,1] 为乾卦初九；[8,8,6] 为坤卦上六。相同数字得到相同结果，其概率不等同于硬币法，也不声称这是唯一传统规则。

### 时间起卦：modern-solar-time-v1

castTimeLines(timestamp,timeZone='Asia/Shanghai') 要求带Z或数值时区偏移的ISO时间，拒绝无时区、无效公历日期。系统按选定时区读取年月日与小时：

- 年+月+日除8取余定上卦。
- 年+月+日+时辰序数除8取余定下卦，除6取余定动爻。
- 子时23:00..00:59为1，丑时01:00..02:59为2，以此类推至亥时21:00..22:59为12。
- 余0分别按8和6；**23时仍采用该时区的当日公历日期**，不在23时提前更换日期。
- 分钟和秒不参与这一简化规则。

使用公历年数和公历月日，而非传统农历、干支年份或农历转换。因此界面、图鉴与文档统一标明“当代简化梅花法”。时区、标准ISO时间保存在 casting 中，相同输入可复现。

## 派生卦象

analyseLines 保留 original / resulting / moving / lines，并新增：

- mutual：互卦。原第2、3、4爻为下卦，第3、4、5爻为上卦。
- opposite：错卦。原卦六爻阴阳全部翻转。
- reversed：综卦。原卦六爻上下倒置。

这些结构属于原卦的推导，不是新的随机起卦。evidenceFor 默认仍只提供本卦及有动爻时的变卦，避免改变旧固定 AI 引用范围。HEXAGRAM_LIBRARY 按文王卦序1..64提供名称、上下卦、主题、独立现代说明与反思提示，没有伪造经文。

## 存档与 AI 输出验证

Reading.version 继续为1：

- tarot.spread 扩展为 SpreadId。
- 所有记录可选 scenario:ScenarioId。
- 易经可选 method:'coins'|'numbers'|'time'；旧记录没有method时仍然合法。
- 数字 / 时间记录必须含对应 casting；validateReading 按公开规则重新计算并要求与六条爻完全一致，拒绝参数伪造和错配。
- 硬币记录不接受数字 / 时间参数。

castNumberLines / castTimeLines 返回 {method,rule,lines,inputs}，Reading.casting 使用 inputs，不保存任意客户端元数据。

validateInterpretationForEvidence 允许同次追问与月回顾使用预先确定的证据，但要求证据reference不重复、输出完整覆盖、不越界，并执行既有文本长度与行动数量限制。旧validateInterpretation通过相同校验器处理牌阵/卦象引用。

## 初学教程与验证

TUTORIALS 提供10篇逐步教程：第一次抽塔罗、位置含义、正逆位、牌组结构、硬币法、数字法、时间法、派生卦、提问方式、行动复盘。

新增 tests/divination.test.js 覆盖32牌阵及固定引用、完整目录、384种上下卦/动爻数字组合、时区与无效日期、旧存档、新参数反篡改、64卦派生结构与通用AI证据校验。原 tests/engine.test.js 的既有随机分布、4096组六爻与引用测试保持不变。

健康、法律、财务与安全决定仍应基于事实与合适的专业支持，网站的象征解读用于思考、书写和生活规划，不能承诺事件必然发生。
