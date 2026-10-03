/** Modern reflection layouts. Original single/three semantics are preserved. */
export const SPREADS = Object.freeze(Object.fromEntries(Object.entries({
  "single": {
    "name": "单张聚焦",
    "positions": [
      "此刻的焦点"
    ],
    "category": "general",
    "description": "用一张牌整理一个具体问题。"
  },
  "three": {
    "name": "情境 · 提醒 · 行动",
    "positions": [
      "当前情境",
      "需要留意",
      "可以尝试的行动"
    ],
    "category": "general",
    "description": "以三个角度观察当下，选择能验证的下一步。"
  },
  "past-present-future": {
    "name": "过去 · 当下 · 可能走向",
    "positions": [
      "过去的影响",
      "当下的状态",
      "保持当前做法的可能走向"
    ],
    "category": "general",
    "description": "观察过程与趋势，第三张并非确定预言。"
  },
  "mind-heart-action": {
    "name": "理智 · 感受 · 行动",
    "positions": [
      "理智的判断",
      "真实的感受",
      "协调后的行动"
    ],
    "category": "self",
    "description": "让思考、情绪与实际选择相互对照。"
  },
  "relationship-five": {
    "name": "关系五角",
    "positions": [
      "我的状态",
      "我观察到的互动",
      "共同的连接",
      "需要澄清的边界",
      "我可以尝试的沟通"
    ],
    "category": "relationship",
    "description": "只从已知互动与自己的行动出发，不声称读取他人内心。"
  },
  "relationship-cross": {
    "name": "关系十字",
    "positions": [
      "关系的现状",
      "滋养关系的条件",
      "正在消耗的模式",
      "我的责任与边界",
      "下一次对话的方向"
    ],
    "category": "relationship",
    "description": "识别关系中的支持、摩擦与可谈的议题。"
  },
  "relationship-bridge": {
    "name": "沟通之桥",
    "positions": [
      "我想表达的需要",
      "我愿意倾听的内容",
      "沟通的障碍",
      "共同可确认的事实",
      "一个温和的开场"
    ],
    "category": "relationship",
    "description": "为一次真实对话准备，而不是代替对方回答。"
  },
  "reconciliation": {
    "name": "修复与边界",
    "positions": [
      "尚未消化的经历",
      "我能承担的部分",
      "需要守住的边界",
      "修复需要的条件",
      "我现在可选择的行动"
    ],
    "category": "relationship",
    "description": "评估修复条件，也保留结束或保持距离的选择。"
  },
  "self-love": {
    "name": "自我关怀",
    "positions": [
      "当前的需求",
      "忽略自己的方式",
      "已有的支持",
      "可以松开的要求",
      "今天的关怀行动"
    ],
    "category": "self",
    "description": "从生活层面的关怀与边界开始。"
  },
  "career-path": {
    "name": "职业方向",
    "positions": [
      "当前定位",
      "已有优势",
      "需要补足的能力",
      "可利用的资源",
      "下一步探索"
    ],
    "category": "career",
    "description": "把职业思考转成可验证的信息与小实验。"
  },
  "career-cross": {
    "name": "工作局面十字",
    "positions": [
      "工作现状",
      "主要阻力",
      "可发挥的能力",
      "沟通与协作",
      "一项优先行动"
    ],
    "category": "career",
    "description": "梳理工作中的角色、条件与推进方式。"
  },
  "job-change": {
    "name": "转职评估",
    "positions": [
      "留下的价值",
      "离开的动机",
      "新方向的吸引",
      "尚未核实的风险",
      "做决定前的准备"
    ],
    "category": "career",
    "description": "评估转职条件，结合真实薪资、合同与生活安排。"
  },
  "project-launch": {
    "name": "项目启动",
    "positions": [
      "目标与初衷",
      "资源与基础",
      "关键假设",
      "可能的阻碍",
      "第一轮验证"
    ],
    "category": "career",
    "description": "为新项目找到范围小、成本可控的启动方式。"
  },
  "business-five": {
    "name": "合作与经营",
    "positions": [
      "核心价值",
      "目标用户的已知需要",
      "执行资源",
      "合作边界",
      "下一项验证"
    ],
    "category": "career",
    "description": "帮助形成待验证假设，不替代经营分析。"
  },
  "money-budget": {
    "name": "资源与预算",
    "positions": [
      "当前资源状态",
      "支出的动机",
      "可调整的习惯",
      "应保留的余量",
      "一项预算行动"
    ],
    "category": "resources",
    "description": "关注预算和习惯，不生成投资承诺或收益预测。"
  },
  "study-plan": {
    "name": "学习路径",
    "positions": [
      "学习目标",
      "已有基础",
      "注意力的障碍",
      "适合的练习方式",
      "本周的学习行动"
    ],
    "category": "study",
    "description": "用可执行的学习安排代替成绩预测。"
  },
  "exam-preparation": {
    "name": "备考校准",
    "positions": [
      "准备的现状",
      "优势部分",
      "需要补足的环节",
      "压力管理的方式",
      "下一轮复习重点"
    ],
    "category": "study",
    "description": "帮助复盘准备过程，结果仍取决于现实学习与考试。"
  },
  "decision-two": {
    "name": "双路径选择",
    "positions": [
      "共同的目标",
      "选择 A 的支持条件",
      "选择 A 的代价与未知",
      "选择 B 的支持条件",
      "选择 B 的代价与未知",
      "决定前应核实的事实"
    ],
    "category": "decision",
    "description": "并列观察两条路径的条件，不代替本人选择。"
  },
  "decision-three": {
    "name": "三路径选择",
    "positions": [
      "决策的核心标准",
      "选择 A 的机会",
      "选择 A 的限制",
      "选择 B 的机会",
      "选择 B 的限制",
      "选择 C 的机会",
      "选择 C 的限制"
    ],
    "category": "decision",
    "description": "把三条路径放在同一标准下比较。"
  },
  "crossroads": {
    "name": "岔路口",
    "positions": [
      "真正想守住的价值",
      "当前路径的惯性",
      "新路径的可能",
      "暂缓决定的价值",
      "下一项信息收集"
    ],
    "category": "decision",
    "description": "先发现决策标准，再考虑方向。"
  },
  "obstacle-breakthrough": {
    "name": "阻力与突破",
    "positions": [
      "表面的困难",
      "深层的惯性",
      "可用的支持",
      "需要调整的策略",
      "最小的突破行动"
    ],
    "category": "growth",
    "description": "找出行动中的卡点与替代做法。"
  },
  "shadow-work": {
    "name": "内在模式",
    "positions": [
      "反复出现的模式",
      "触发我的情境",
      "正在保护的需要",
      "更温和的回应",
      "一次新的练习"
    ],
    "category": "self",
    "description": "作为自我书写提示，不进行心理诊断。"
  },
  "balance-five": {
    "name": "生活平衡",
    "positions": [
      "当下的节奏",
      "正在过量的部分",
      "被忽视的部分",
      "能够提供支持的条件",
      "一项平衡调整"
    ],
    "category": "self",
    "description": "观察作息、资源与边界的分配。"
  },
  "new-moon": {
    "name": "新月意图",
    "positions": [
      "想开始的方向",
      "开始前可放下的负担",
      "已有的种子",
      "第一步行动"
    ],
    "category": "cycle",
    "description": "以新月为生活仪式标记，不认为月相决定结果。"
  },
  "full-moon": {
    "name": "满月回顾",
    "positions": [
      "已发生的成长",
      "需要看见的感受",
      "可以结束的习惯",
      "愿意保留的收获"
    ],
    "category": "cycle",
    "description": "以满月为阶段回顾提示。"
  },
  "week-ahead": {
    "name": "一周安排",
    "positions": [
      "本周的焦点",
      "值得投入的事",
      "需要留白的地方",
      "能获得的支持",
      "本周的可行计划"
    ],
    "category": "cycle",
    "description": "把一周的意图整理成现实安排。"
  },
  "month-ahead": {
    "name": "月度规划",
    "positions": [
      "本月的主题",
      "第一阶段的重点",
      "第二阶段的重点",
      "第三阶段的重点",
      "第四阶段的重点",
      "月底的复盘问题"
    ],
    "category": "cycle",
    "description": "各阶段是规划角度，不预言某周发生何事。"
  },
  "year-wheel": {
    "name": "年度十二宫格",
    "positions": [
      "年度核心主题",
      "一月的规划角度",
      "二月的规划角度",
      "三月的规划角度",
      "四月的规划角度",
      "五月的规划角度",
      "六月的规划角度",
      "七月的规划角度",
      "八月的规划角度",
      "九月的规划角度",
      "十月的规划角度",
      "十一月的规划角度",
      "十二月的规划角度"
    ],
    "category": "cycle",
    "description": "十三张牌用于年度规划与定期校准，不对应占星十二宫。"
  },
  "celtic-cross": {
    "name": "凯尔特十字",
    "positions": [
      "当下的核心情境",
      "横向交织的挑战",
      "已知的目标与意识",
      "基础与背景",
      "过去仍在发挥的影响",
      "近期可尝试的方向",
      "我的态度与行动",
      "环境与已知的外部因素",
      "期待与担忧",
      "按当前条件发展的可能走向"
    ],
    "category": "general",
    "description": "十张牌的综合梳理；位置采用本项目明确列出的现代常见版本。"
  },
  "purpose": {
    "name": "价值与方向",
    "positions": [
      "让我在意的价值",
      "已有的才能",
      "想服务的需要",
      "可承受的投入",
      "下一次探索"
    ],
    "category": "growth",
    "description": "通过具体行动逐步探索方向。"
  },
  "creative-spark": {
    "name": "创意火花",
    "positions": [
      "创作的种子",
      "惯性带来的限制",
      "可以借用的素材",
      "值得试验的形式",
      "最小作品的行动"
    ],
    "category": "growth",
    "description": "为写作、设计和其他创作提供联想。"
  },
  "travel-transition": {
    "name": "旅途与转变",
    "positions": [
      "过渡中的状态",
      "可以随身携带的资源",
      "需要提前核实的条件",
      "变化中的边界",
      "安顿自己的行动"
    ],
    "category": "transition",
    "description": "观察搬家、旅行或生活过渡的准备。"
  }
}).map(([id, spread]) => [id, Object.freeze({ ...spread, positions: Object.freeze(spread.positions) })])));

export const SCENARIOS = Object.freeze([
  {
    "id": "general",
    "name": "综合探索",
    "description": "把一个具体问题拆成情境、提醒和行动。",
    "prompts": [
      "这件事中，我现在最需要看清什么？",
      "面对当前局面，我可以先做哪一步？"
    ],
    "recommendedSpreads": [
      "single",
      "three",
      "celtic-cross"
    ]
  },
  {
    "id": "relationship",
    "name": "感情与关系",
    "description": "从自己的需要、互动事实与边界出发。",
    "prompts": [
      "我怎样更清楚地表达关系中的需要？",
      "这段关系中，我能承担什么、又应守住什么边界？",
      "想修复沟通，我可以先改变哪一种做法？"
    ],
    "recommendedSpreads": [
      "relationship-five",
      "relationship-cross",
      "relationship-bridge",
      "reconciliation"
    ]
  },
  {
    "id": "career",
    "name": "工作与事业",
    "description": "整理方向、协作和职业行动。",
    "prompts": [
      "我当前的职业方向有哪些值得验证的假设？",
      "转职前，我还需要核实哪些条件？",
      "怎样让当前项目推进得更扎实？"
    ],
    "recommendedSpreads": [
      "career-path",
      "career-cross",
      "job-change",
      "project-launch",
      "business-five"
    ]
  },
  {
    "id": "decision",
    "name": "选择与决策",
    "description": "比较路径的条件、代价和未知。",
    "prompts": [
      "选择 A 和 B 时，我最应依据什么标准？",
      "做决定之前，我还缺少哪些事实？",
      "暂缓决定对我有什么实际价值？"
    ],
    "recommendedSpreads": [
      "decision-two",
      "decision-three",
      "crossroads"
    ]
  },
  {
    "id": "resources",
    "name": "金钱与资源",
    "description": "观察预算、资源安排与日常习惯。",
    "prompts": [
      "我怎样调整支出，让生活更有余量？",
      "有哪些资源已经具备，却没有被好好使用？"
    ],
    "recommendedSpreads": [
      "money-budget",
      "balance-five"
    ]
  },
  {
    "id": "study",
    "name": "学习与备考",
    "description": "定位练习重点与可持续的节奏。",
    "prompts": [
      "接下来一周，我该优先补足哪一环？",
      "什么学习方法值得我实际试验？"
    ],
    "recommendedSpreads": [
      "study-plan",
      "exam-preparation"
    ]
  },
  {
    "id": "self",
    "name": "自我探索",
    "description": "理解感受、需求与重复出现的模式。",
    "prompts": [
      "我最近反复出现的感受在提醒什么？",
      "我能怎样温和地回应自己的需要？"
    ],
    "recommendedSpreads": [
      "mind-heart-action",
      "self-love",
      "shadow-work",
      "balance-five"
    ]
  },
  {
    "id": "growth",
    "name": "成长与突破",
    "description": "识别阻力，设计小规模的改变。",
    "prompts": [
      "我卡住的地方，有哪些可以调整的策略？",
      "如果只做一个小实验，我可以从哪里开始？"
    ],
    "recommendedSpreads": [
      "obstacle-breakthrough",
      "purpose"
    ]
  },
  {
    "id": "communication",
    "name": "沟通与合作",
    "description": "把揣测转为可以验证的对话。",
    "prompts": [
      "这次对话里，哪些事实与期待需要分开？",
      "我可以怎样表达分歧，同时保留合作空间？"
    ],
    "recommendedSpreads": [
      "relationship-bridge",
      "business-five",
      "three"
    ]
  },
  {
    "id": "transition",
    "name": "搬迁与过渡",
    "description": "为环境变化、角色更替做准备。",
    "prompts": [
      "进入新的环境之前，我需要准备什么？",
      "过渡期里，有哪些原则和资源可以带走？"
    ],
    "recommendedSpreads": [
      "travel-transition",
      "crossroads"
    ]
  },
  {
    "id": "creative",
    "name": "创作与灵感",
    "description": "通过象征联想找到可尝试的表达。",
    "prompts": [
      "这个创作有什么值得重新组合的素材？",
      "我可以先完成怎样一个小作品？"
    ],
    "recommendedSpreads": [
      "creative-spark",
      "project-launch"
    ]
  },
  {
    "id": "weekly",
    "name": "一周安排",
    "description": "设定近期焦点，并为休息留白。",
    "prompts": [
      "本周什么最值得投入？",
      "我需要为哪些事情保留时间和空间？"
    ],
    "recommendedSpreads": [
      "week-ahead",
      "three"
    ]
  },
  {
    "id": "monthly",
    "name": "月度回顾",
    "description": "观察阶段节奏和待校准的习惯。",
    "prompts": [
      "本月我想练习什么，月底怎样复盘？",
      "哪些习惯可以在接下来一个月做小幅调整？"
    ],
    "recommendedSpreads": [
      "month-ahead",
      "full-moon"
    ]
  },
  {
    "id": "annual",
    "name": "年度规划",
    "description": "围绕价值建立可持续的年度安排。",
    "prompts": [
      "这一年我最想守住什么核心价值？",
      "每个阶段，我可以用什么现实行动来校准方向？"
    ],
    "recommendedSpreads": [
      "year-wheel",
      "purpose"
    ]
  },
  {
    "id": "lunar",
    "name": "月相仪式",
    "description": "用时间标记进行书写与回顾。",
    "prompts": [
      "新的阶段，我愿意开始哪一个小行动？",
      "这一阶段，有什么可以结束，有什么值得保留？"
    ],
    "recommendedSpreads": [
      "new-moon",
      "full-moon"
    ]
  }
].map(scenario => Object.freeze({ ...scenario, prompts: Object.freeze(scenario.prompts), recommendedSpreads: Object.freeze(scenario.recommendedSpreads) })));

export const ICHING_METHODS = Object.freeze([
  Object.freeze({ id: 'coins', name: '三枚硬币', description: '逐爻投三枚硬币，从初爻到上爻记录六次。6、9为动爻。', rule: 'coin-three-v1' }),
  Object.freeze({ id: 'numbers', name: '数字起卦', description: '当代简化梅花法：三数依次定上卦、下卦、动爻。先天卦序取余，余0按8或6。', rule: 'modern-numbers-v1' }),
  Object.freeze({ id: 'time', name: '时间起卦', description: '当代简化梅花法：使用选定时区的公历年月日与时辰，不采用传统农历年月。', rule: 'modern-solar-time-v1' })
]);
