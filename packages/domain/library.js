import { TAROT_DECK, KING_WEN_BY_MASK } from './data.js';
import { getHexagram } from './engine.js';

// Original modern summaries, not classical scripture or historical quotations.
const CARD_GUIDES = {
  "major-fool": {
    "description": "踏上未知之前，愚者让人注意开放心态与现实准备之间的平衡。",
    "uprightMeaning": "新旅程、好奇和试验的勇气。",
    "reversedMeaning": "冲动承诺、准备不足，或因害怕犯错而不敢开始。",
    "symbolism": "旅人、行囊与边缘意象，象征开始时的轻盈与风险。",
    "element": "风",
    "reflection": "如果只迈出可撤回的一小步，我会做什么？",
    "practice": "列出一次尝试的成本、退出条件与第一步。"
  },
  "major-magician": {
    "description": "魔术师关注如何把已有资源、技能与意图转化为行动。",
    "uprightMeaning": "明确目标，组合资源，主动实施。",
    "reversedMeaning": "注意力分散、夸大能力，或用言语代替执行。",
    "symbolism": "桌上的四类工具，提醒能力需要被实际使用。",
    "element": "风",
    "reflection": "我已有的哪项能力可以马上派上用场？",
    "practice": "选一项现有技能，在今天完成一个可见的小成果。"
  },
  "major-priestess": {
    "description": "女祭司邀请人在信息尚不完整时，留出观察与倾听的空间。",
    "uprightMeaning": "安静观察，尊重直觉，也核对事实。",
    "reversedMeaning": "把猜测当事实、隐藏重要问题，或过度隔离自己。",
    "symbolism": "帷幕、书卷与月色，提示已知与未知之间的界限。",
    "element": "水",
    "reflection": "哪些是我的感受，哪些是已经确认的事实？",
    "practice": "把已知事实与自己的推测分成两列。"
  },
  "major-empress": {
    "description": "皇后体现照顾、创造与让事物慢慢生长的条件。",
    "uprightMeaning": "创造、滋养、关系中的温度与支持。",
    "reversedMeaning": "过度照顾、依赖认同，或忽略自己的需求。",
    "symbolism": "生长的植物与舒展的环境，象征成长需要空间与资源。",
    "element": "土",
    "reflection": "我在照顾什么，又有什么需要被照顾？",
    "practice": "为一项正在成长的计划提供一份具体支持。"
  },
  "major-emperor": {
    "description": "皇帝提醒人建立清晰结构，让责任、规则与边界可以被理解。",
    "uprightMeaning": "稳定组织，承担责任，订立可执行的边界。",
    "reversedMeaning": "过度控制、僵化规则，或缺少可靠的组织。",
    "symbolism": "座位与秩序意象，提示权威需要责任与限制。",
    "element": "火",
    "reflection": "哪条规则可以带来清晰，而不是压迫？",
    "practice": "把一个模糊约定写成双方可确认的规则。"
  },
  "major-hierophant": {
    "description": "教皇涉及学习、传承与共同规则，也邀请人检视规则的来源。",
    "uprightMeaning": "向可靠经验学习，理解制度与共同价值。",
    "reversedMeaning": "机械遵循、盲从权威，或为了反对而忽略有效经验。",
    "symbolism": "教导与仪式意象，提示知识需要理解后再运用。",
    "element": "土",
    "reflection": "我遵循的规则仍适合当前情况吗？",
    "practice": "查明一条常用做法的理由，并保留可调整之处。"
  },
  "major-lovers": {
    "description": "恋人关注选择与一致：行动是否与自己的价值、关系中的承诺相符。",
    "uprightMeaning": "价值一致，坦诚沟通，主动选择。",
    "reversedMeaning": "期待不一致、回避选择，或牺牲自身边界。",
    "symbolism": "相对而立的角色，象征关系与决定中的互相回应。",
    "element": "风",
    "reflection": "我的选择与真实价值一致吗？",
    "practice": "写下决定时不能忽略的三个价值标准。"
  },
  "major-chariot": {
    "description": "战车呈现推进的力量，也提醒人先协调相互拉扯的方向。",
    "uprightMeaning": "明确方向，在条件允许时持续行动。",
    "reversedMeaning": "强行推进、失去方向，或把意志等同于控制。",
    "symbolism": "两种不同牵引力量，提示行动前需要协调。",
    "element": "水",
    "reflection": "推进这件事前，哪两股力量需要对齐？",
    "practice": "为目标写一条路线，并标出需要停下来校准的点。"
  },
  "major-strength": {
    "description": "力量强调耐心、勇气与温和的自我约束，而非压服一切。",
    "uprightMeaning": "以耐心应对压力，在边界内坚持。",
    "reversedMeaning": "自我怀疑、用力过度，或忽视恢复的需要。",
    "symbolism": "人与野性力量的相处，象征克制与合作。",
    "element": "火",
    "reflection": "我可以怎样坚定，又不苛待自己？",
    "practice": "把一项过高要求改成今天能持续完成的标准。"
  },
  "major-hermit": {
    "description": "隐者适合暂时减少噪音，寻找亲自验证过的理解。",
    "uprightMeaning": "独处、学习、整理经验与核心问题。",
    "reversedMeaning": "长期隔离、回避交流，或反复思考却不行动。",
    "symbolism": "灯与行路者，提示看清脚下的一段路。",
    "element": "土",
    "reflection": "我最需要弄清的一个问题是什么？",
    "practice": "留出二十分钟，写下经验、疑问与下一项求证。"
  },
  "major-wheel": {
    "description": "命运之轮把注意力带向周期、变化与控制范围。",
    "uprightMeaning": "识别阶段变化，准备适应新的条件。",
    "reversedMeaning": "抗拒变化、重复惯性，或把选择全部交给运气。",
    "symbolism": "转动的轮与循环意象，提示环境会改变。",
    "element": "火",
    "reflection": "哪些变化我能准备，哪些只能接纳？",
    "practice": "分别列出可控制、可影响和不可控制的事项。"
  },
  "major-justice": {
    "description": "正义聚焦事实、责任与一致的判断标准。",
    "uprightMeaning": "核对事实，用同一标准评估自己与他人。",
    "reversedMeaning": "选择性看待事实、推卸责任，或标准失衡。",
    "symbolism": "天平与清晰边界意象，象征衡量与后果。",
    "element": "风",
    "reflection": "如果采用同一标准，我会怎样重新判断？",
    "practice": "找出一个结论的证据、反证和待确认部分。"
  },
  "major-hanged-man": {
    "description": "倒吊人提示暂停惯常反应，从不同位置重新看问题。",
    "uprightMeaning": "有意识地停顿，调整视角，接受暂时的不确定。",
    "reversedMeaning": "无目的拖延、固守旧视角，或长期过度牺牲。",
    "symbolism": "倒置的观察姿态，象征角度变化。",
    "element": "水",
    "reflection": "换一个角度，这件事还可能意味着什么？",
    "practice": "用朋友的视角重新写一次当前问题。"
  },
  "major-death": {
    "description": "死神主要象征结束与转变，不指向现实死亡或健康诊断。",
    "uprightMeaning": "结束失效的阶段，为新的做法腾出空间。",
    "reversedMeaning": "难以告别、惧怕变化，或保留已经失效的安排。",
    "symbolism": "收割与更替意象，提示结束也是过程的一部分。",
    "element": "水",
    "reflection": "哪件已经结束的事仍占用我的注意力？",
    "practice": "为一个待结束事项安排明确的收尾步骤。"
  },
  "major-temperance": {
    "description": "节制强调组合、分量与渐进调整。",
    "uprightMeaning": "通过协调与小幅校准形成可持续的节奏。",
    "reversedMeaning": "节奏失衡、追求速成，或忽略不同条件的差异。",
    "symbolism": "容器之间的流动，象征配比与持续调整。",
    "element": "火",
    "reflection": "什么调整足够小，却能改善整体节奏？",
    "practice": "选择一项日常安排，试行一个可持续的小调整。"
  },
  "major-devil": {
    "description": "恶魔邀请人看清依附、惯性与被忽略的选择空间。",
    "uprightMeaning": "觉察欲望与依附如何影响决定。",
    "reversedMeaning": "开始松开束缚，或仍用否认回避问题。",
    "symbolism": "束缚意象，提示先识别限制的来源。",
    "element": "土",
    "reflection": "我把哪种习惯误当成唯一选择？",
    "practice": "为一个惯性反应写出两个可以尝试的替代做法。"
  },
  "major-tower": {
    "description": "高塔象征既有假设受到冲击时的重整，不意味着灾难一定发生。",
    "uprightMeaning": "旧认知被修正，重新检视基础是否可靠。",
    "reversedMeaning": "回避证据、拖延必要调整，或害怕失去熟悉的结构。",
    "symbolism": "结构与突然变化的意象，提示先保护基本需求。",
    "element": "火",
    "reflection": "哪些新证据要求我更新原来的判断？",
    "practice": "区分必须马上处理的事项与可以慢慢重建的部分。"
  },
  "major-star": {
    "description": "星星表现希望、恢复信心与重新建立联系的可能，不承诺治疗效果。",
    "uprightMeaning": "看见支持和长程方向，温和恢复日常节奏。",
    "reversedMeaning": "灰心、失去连接，或把希望寄托在不可验证的承诺上。",
    "symbolism": "星光与水的意象，象征清明、分享与长远方向。",
    "element": "风",
    "reflection": "我身边有哪些真实、可触及的支持？",
    "practice": "联系一项可靠支持，或完成一件让自己恢复节奏的小事。"
  },
  "major-moon": {
    "description": "月亮关注信息不明时的感受、想象与事实之间的距离。",
    "uprightMeaning": "承认不确定，倾听感受并谨慎求证。",
    "reversedMeaning": "迷雾开始消散，或仍用否认压住焦虑。",
    "symbolism": "夜色、道路与倒影，提示感受真实但解释需要核对。",
    "element": "水",
    "reflection": "我正在担心什么，它有多少事实依据？",
    "practice": "写下一个担忧，并标出能验证它的现实信息。"
  },
  "major-sun": {
    "description": "太阳象征清晰、表达与可以被分享的活力。",
    "uprightMeaning": "让成果被看见，清楚表达自己的需要。",
    "reversedMeaning": "表达受抑、过度曝光，或把积极当成必须维持的状态。",
    "symbolism": "光照与开放空间，象征透明与真实表达。",
    "element": "火",
    "reflection": "什么成果或感受值得清楚表达？",
    "practice": "以具体事实分享一项进展，不夸大也不贬低。"
  },
  "major-judgement": {
    "description": "审判是一种复盘与回应：如何从过去经验中选择新的行动。",
    "uprightMeaning": "回顾经验，承担自己的部分，回应重要方向。",
    "reversedMeaning": "苛责自己、回避复盘，或总等待他人认可。",
    "symbolism": "回应召唤的意象，提示选择可以从反思开始。",
    "element": "火",
    "reflection": "哪项过去经验能帮助我调整下一步？",
    "practice": "写下一次经历的收获、遗憾和可改变的一项做法。"
  },
  "major-world": {
    "description": "世界关注阶段完成、经验整合与更广阔的连接。",
    "uprightMeaning": "完成一个阶段，确认收获与下一段的起点。",
    "reversedMeaning": "缺少收尾、忽略成果，或仍有一环需要整合。",
    "symbolism": "环与整体结构意象，象征完成后的整合。",
    "element": "土",
    "reflection": "怎样才算真正完成，而不只是停止？",
    "practice": "为当前阶段列出验收、感谢和交接三项收尾。"
  },
  "wands-ace": {
    "description": "新的行动冲动需要一个具体出口。",
    "uprightMeaning": "创意与启动意愿出现，适合小规模试验。",
    "reversedMeaning": "兴奋尚未转成行动，或开始前缺少方向。",
    "symbolism": "火种与生长的枝条。",
    "reflection": "我想开始的事可以如何缩小到今天？",
    "practice": "完成一次十五分钟的初步尝试。",
    "element": "火"
  },
  "wands-2": {
    "description": "已有方向后，需要把愿景放回现实条件。",
    "uprightMeaning": "比较路线、规划下一步，并保留选择空间。",
    "reversedMeaning": "犹疑不决，或计划脱离了现有资源。",
    "symbolism": "远望与两种路线的意象。",
    "reflection": "我还缺什么信息才能迈出下一步？",
    "practice": "列出两条路线的必要条件。",
    "element": "火"
  },
  "wands-3": {
    "description": "开始之后，关注协作、反馈与后续安排。",
    "uprightMeaning": "行动逐步展开，适合等待反馈并协调资源。",
    "reversedMeaning": "预期过早，或后续支持没有跟上。",
    "symbolism": "向远方观察与延伸的意象。",
    "reflection": "我能怎样接住已经到来的反馈？",
    "practice": "检查一次行动后的真实反馈。",
    "element": "火"
  },
  "wands-4": {
    "description": "阶段性稳定值得庆祝，也需要可靠基础。",
    "uprightMeaning": "建立共同节奏，确认已完成的小成果。",
    "reversedMeaning": "表面热闹却缺少支持，或难以融入共同安排。",
    "symbolism": "门廊、聚会与稳定的支点。",
    "reflection": "哪些小成果值得共同确认？",
    "practice": "庆祝一项进展，并确认接下来谁负责什么。",
    "element": "火"
  },
  "wands-5": {
    "description": "不同意见碰撞时，可以先明确共同问题。",
    "uprightMeaning": "观点竞争带来练习机会，也暴露协调需要。",
    "reversedMeaning": "冲突被压下，或争论已经失去共同目标。",
    "symbolism": "多股力量相互交错的意象。",
    "reflection": "大家是在争事实、方法还是认可？",
    "practice": "为一次讨论写出共同目标。",
    "element": "火"
  },
  "wands-6": {
    "description": "被看见之后，如何承担认可带来的责任。",
    "uprightMeaning": "成果获得确认，适合清楚表达贡献。",
    "reversedMeaning": "过分依赖掌声，或贡献被忽略而产生失衡。",
    "symbolism": "公开展示与群体回应。",
    "reflection": "认可之外，我还愿意坚持什么标准？",
    "practice": "整理一项成果及其可验证证据。",
    "element": "火"
  },
  "wands-7": {
    "description": "守住立场，也要区分边界与过度防御。",
    "uprightMeaning": "坚持重要方向，对必要边界明确回应。",
    "reversedMeaning": "处处防御、耗费过多力气，或缺乏支持。",
    "symbolism": "高处守位与多重挑战。",
    "reflection": "哪些挑战值得回应，哪些可以放过？",
    "practice": "挑选一个真正重要的边界来表达。",
    "element": "火"
  },
  "wands-8": {
    "description": "节奏加快时，信息和行动需要同步。",
    "uprightMeaning": "迅速沟通与推进，适合减少不必要的环节。",
    "reversedMeaning": "仓促、延误或信息没有及时对齐。",
    "symbolism": "流动、方向与速度的意象。",
    "reflection": "速度变快后，哪里最容易遗漏？",
    "practice": "核对一次快速行动的关键细节。",
    "element": "火"
  },
  "wands-9": {
    "description": "坚持到后段，要照看已经累积的疲惫。",
    "uprightMeaning": "经验与韧性提供保护，也需要合理休息。",
    "reversedMeaning": "警惕过度、心力不足，或不愿接受帮助。",
    "symbolism": "经历过磨损仍保持的支点。",
    "reflection": "继续之前，我需要怎样的恢复与支持？",
    "practice": "给一项长期任务加入休息或协助。",
    "element": "火"
  },
  "wands-10": {
    "description": "责任累积过多时，需要重新分配负荷。",
    "uprightMeaning": "承认负担，并看见哪些责任可以调整。",
    "reversedMeaning": "开始卸下负担，或仍拒绝放弃不必要的承诺。",
    "symbolism": "重物与有限承载的意象。",
    "reflection": "哪些任务真的必须由我来完成？",
    "practice": "委托、缩减或暂停一项低优先级任务。",
    "element": "火"
  },
  "wands-page": {
    "description": "从好奇开始，把新意变成学习与实践。",
    "uprightMeaning": "探索新点子，愿意尝试和接受反馈。",
    "reversedMeaning": "只有热情而缺少基础，或反复开始却不练习。",
    "symbolism": "消息、学习者与嫩芽。",
    "reflection": "这份好奇可以转成哪一次试验？",
    "practice": "为新兴趣完成一次基础练习。",
    "element": "火"
  },
  "wands-knight": {
    "description": "投入行动之前，检查速度是否适合条件。",
    "uprightMeaning": "主动推进，勇于承担尝试的成本。",
    "reversedMeaning": "冲动、方向反复，或只追逐新鲜感。",
    "symbolism": "移动与强烈意愿。",
    "reflection": "我的速度与现实准备相符吗？",
    "practice": "为一次行动设定停止和复盘条件。",
    "element": "火"
  },
  "wands-queen": {
    "description": "把创造力与温暖落实到稳定的表达。",
    "uprightMeaning": "自信参与、鼓励他人，并保持自主边界。",
    "reversedMeaning": "过分依赖认可、嫉妒，或持续输出导致耗竭。",
    "symbolism": "稳定火焰与自我表达。",
    "reflection": "我如何表达热情，又保留自己的余量？",
    "practice": "选择一件有热情也有边界的参与方式。",
    "element": "火"
  },
  "wands-king": {
    "description": "把方向感转化为能被团队理解的行动。",
    "uprightMeaning": "带领、组织和承担责任，允许不同能力参与。",
    "reversedMeaning": "强势推进、夸大目标，或缺少对执行条件的照看。",
    "symbolism": "成熟的火与明确方向。",
    "reflection": "我设定的方向能否让他人清楚理解？",
    "practice": "写明目标、分工与可衡量的下一步。",
    "element": "火"
  },
  "cups-ace": {
    "description": "新的感受需要被承认，也需要适合的容器。",
    "uprightMeaning": "开放感受，接受温柔连接与创造。",
    "reversedMeaning": "情绪难以表达，或付出没有照看自身需要。",
    "symbolism": "水与承接的容器。",
    "reflection": "此刻哪种感受值得被认真听见？",
    "practice": "写下一种感受及其对应的需要。",
    "element": "水"
  },
  "cups-2": {
    "description": "平等的交流来自彼此确认，而非单方面想象。",
    "uprightMeaning": "互惠、对话与清楚的关系约定。",
    "reversedMeaning": "期待不一致、付出失衡，或真实需要未被说出。",
    "symbolism": "两个容器的相互回应。",
    "reflection": "双方已经明确同意的部分是什么？",
    "practice": "邀请对方确认一个实际约定。",
    "element": "水"
  },
  "cups-3": {
    "description": "共同支持与愉快连接，也需要独处的空间。",
    "uprightMeaning": "友谊、协作和分享阶段收获。",
    "reversedMeaning": "群体压力、过度迎合，或社交节奏失衡。",
    "symbolism": "相聚与共享的意象。",
    "reflection": "哪些关系让我更有空间做自己？",
    "practice": "安排一次轻松、边界清楚的交流。",
    "element": "水"
  },
  "cups-4": {
    "description": "兴趣降低时，先辨认疲惫与真正的不合适。",
    "uprightMeaning": "暂停回应，审视需要与现有机会。",
    "reversedMeaning": "开始重新参与，或仍忽略已经出现的支持。",
    "symbolism": "停顿与尚未被接纳的容器。",
    "reflection": "我是不想要，还是暂时没有余力？",
    "practice": "比较休息之后与疲惫时的感受。",
    "element": "水"
  },
  "cups-5": {
    "description": "失落值得被看见，同时仍可注意保留下来的资源。",
    "uprightMeaning": "承认遗憾，寻找仍能继续的支持。",
    "reversedMeaning": "开始接受失落，或长期只看见缺少的部分。",
    "symbolism": "倒下与仍站立的容器。",
    "reflection": "哪些已经失去，哪些仍然存在？",
    "practice": "分别记录遗憾与现有支持。",
    "element": "水"
  },
  "cups-6": {
    "description": "记忆可以提供温暖，也可能遮住当下的差异。",
    "uprightMeaning": "熟悉、善意与旧经验中的滋养。",
    "reversedMeaning": "过分怀旧，或过去模式不再适合现在。",
    "symbolism": "赠予与童年记忆的意象。",
    "reflection": "我想保留过去的什么，而不是复制全部？",
    "practice": "把一项美好记忆转成今天可做的小事。",
    "element": "水"
  },
  "cups-7": {
    "description": "选项很多时，需要区分愿望、想象与可执行条件。",
    "uprightMeaning": "探索多种可能，并明确自己的标准。",
    "reversedMeaning": "幻想过多、选项混乱，或仓促压缩选择。",
    "symbolism": "多种想象中的容器。",
    "reflection": "哪些选项已经有现实条件支持？",
    "practice": "用一个具体标准筛选当前选项。",
    "element": "水"
  },
  "cups-8": {
    "description": "离开一个不再滋养自己的模式，可以带着清楚理由。",
    "uprightMeaning": "承认阶段已变，主动寻找更合适的方向。",
    "reversedMeaning": "回避告别，或尚未核实就匆忙离开。",
    "symbolism": "离开既有排列与继续行路。",
    "reflection": "我离开的是事实，还是暂时的失望？",
    "practice": "写出离开、调整与继续的条件。",
    "element": "水"
  },
  "cups-9": {
    "description": "满足感适合被享受，也需要照看长期真实需要。",
    "uprightMeaning": "确认个人收获，允许适度的满足与感谢。",
    "reversedMeaning": "短期满足替代真实需要，或总觉得仍不够。",
    "symbolism": "整齐摆放与个人收获。",
    "reflection": "什么已经足够让我承认今天的收获？",
    "practice": "记下一项具体满足，而非只增加愿望。",
    "element": "水"
  },
  "cups-10": {
    "description": "共同的幸福来自持续经营，不是外观上的完美。",
    "uprightMeaning": "关系中的支持、归属和共享安排。",
    "reversedMeaning": "理想图景压过真实感受，或成员需要不一致。",
    "symbolism": "共同生活与连接的意象。",
    "reflection": "我们怎样让每个人的需要都能被表达？",
    "practice": "发起一次关于共同生活安排的对话。",
    "element": "水"
  },
  "cups-page": {
    "description": "细微感受与创意需要安全的表达练习。",
    "uprightMeaning": "好奇地接触感受，尝试新的表达。",
    "reversedMeaning": "消息误读、情绪幼稚，或不敢承认感受。",
    "symbolism": "小容器与新鲜联想。",
    "reflection": "哪种感受可以先以温和的方式表达？",
    "practice": "用一句具体的话表达当前感受。",
    "element": "水"
  },
  "cups-knight": {
    "description": "温柔的提议要与稳定行动相互配合。",
    "uprightMeaning": "表达心意、推动有情感价值的计划。",
    "reversedMeaning": "只有承诺而少执行，或情绪主导全部决定。",
    "symbolism": "携带容器的行路者。",
    "reflection": "我的表达与行动是否一致？",
    "practice": "为一句承诺安排对应的实际行动。",
    "element": "水"
  },
  "cups-queen": {
    "description": "理解感受，也要知道哪些责任不属于自己。",
    "uprightMeaning": "细致倾听，稳定承接，尊重界限。",
    "reversedMeaning": "吸收过多情绪、过度照顾，或忽略自身需求。",
    "symbolism": "安静承接与深水的意象。",
    "reflection": "我能关心他人，而不替他人承担什么？",
    "practice": "写明一次倾听时可提供和不可承担的部分。",
    "element": "水"
  },
  "cups-king": {
    "description": "成熟的情感表达能够容纳波动而不失去边界。",
    "uprightMeaning": "平稳沟通，以理解和责任回应情绪。",
    "reversedMeaning": "压抑感受、控制他人，或承诺超出能力。",
    "symbolism": "稳定容器与流动水面。",
    "reflection": "我如何既表达感受又承担行动责任？",
    "practice": "先说感受，再说一项具体请求。",
    "element": "水"
  },
  "swords-ace": {
    "description": "清楚的问题与事实能帮助思考打开缺口。",
    "uprightMeaning": "澄清重点，用证据与明确语言判断。",
    "reversedMeaning": "仓促结论、话语伤害，或忽略关键背景。",
    "symbolism": "锋刃与分辨的意象。",
    "reflection": "我能否用一句话准确描述问题？",
    "practice": "写出问题、证据与待验证点。",
    "element": "风"
  },
  "swords-2": {
    "description": "僵持时，先承认不愿面对的信息与价值冲突。",
    "uprightMeaning": "暂缓判断，比较两种立场的真实条件。",
    "reversedMeaning": "长期逃避、选择压力，或过早排除另一种可能。",
    "symbolism": "两条路径与暂时的遮蔽。",
    "reflection": "我不愿看见的是哪一条信息？",
    "practice": "找一条能让判断更清楚的事实。",
    "element": "风"
  },
  "swords-3": {
    "description": "难受的表达需要被承认，而不是被证明应该立刻消失。",
    "uprightMeaning": "面对关系或沟通中的伤害，明确事实与感受。",
    "reversedMeaning": "开始修复，或持续反刍却缺少支持。",
    "symbolism": "交错的锋刃与脆弱处。",
    "reflection": "发生了什么，我需要怎样的支持与边界？",
    "practice": "把事实、感受和需要分别写下来。",
    "element": "风"
  },
  "swords-4": {
    "description": "休息与暂停可以让思考恢复有效性。",
    "uprightMeaning": "有意识地停止消耗，给整理与恢复留时间。",
    "reversedMeaning": "休息被打断，或以拖延回避必要回应。",
    "symbolism": "暂停行动与安静空间。",
    "reflection": "什么事可以晚一点，换来更清楚的回应？",
    "practice": "安排一段不处理当前争议的休息。",
    "element": "风"
  },
  "swords-5": {
    "description": "争胜之后，仍需考量关系成本与真正目标。",
    "uprightMeaning": "看见冲突的代价，决定是否继续争论。",
    "reversedMeaning": "愿意停止对抗，或仍保留未说清的怨气。",
    "symbolism": "争夺与失去连接。",
    "reflection": "赢得争论是否有助于真正目标？",
    "practice": "为一场分歧设定适合的止步点。",
    "element": "风"
  },
  "swords-6": {
    "description": "过渡需要时间，也需要带着现实资源前行。",
    "uprightMeaning": "逐步离开耗损的局面，寻找可支持的安排。",
    "reversedMeaning": "回头纠缠，或缺少过渡所需的条件。",
    "symbolism": "渡行与携带经验。",
    "reflection": "过渡的下一段需要哪些支持？",
    "practice": "为转变写出一个可执行的过渡计划。",
    "element": "风"
  },
  "swords-7": {
    "description": "策略与保留信息之间，需要清楚的诚信边界。",
    "uprightMeaning": "灵活安排，审慎处理信息与风险。",
    "reversedMeaning": "隐瞒带来后果，或策略无法支撑长期关系。",
    "symbolism": "分步行动与信息不对称。",
    "reflection": "我采取的策略是否经得起明确说明？",
    "practice": "核对一次计划的信息公开与保密边界。",
    "element": "风"
  },
  "swords-8": {
    "description": "限制有现实部分，也可能有尚未验证的假设。",
    "uprightMeaning": "辨认受限处，寻找仍可自主选择的一小步。",
    "reversedMeaning": "开始松开限制，或否认现实条件仍然存在。",
    "symbolism": "围绕的锋刃与受限姿态。",
    "reflection": "我目前仍能选择什么？",
    "practice": "寻找一个不依赖所有条件改变的小行动。",
    "element": "风"
  },
  "swords-9": {
    "description": "反复担忧时，先把想象与事实分开。",
    "uprightMeaning": "承认压力，并寻求可靠信息与现实支持。",
    "reversedMeaning": "忧虑有所松动，或仍独自承担太多。",
    "symbolism": "夜间思绪与累积的压力。",
    "reflection": "哪些担忧可求证，哪些需要有人一起面对？",
    "practice": "整理一项担忧，并联系可靠支持。",
    "element": "风"
  },
  "swords-10": {
    "description": "承认一个阶段难以继续，可以帮助开始收尾。",
    "uprightMeaning": "正视失效的模式，减少继续消耗。",
    "reversedMeaning": "开始恢复，或仍不愿接受已经变化的条件。",
    "symbolism": "终点与新阶段的边缘。",
    "reflection": "什么已经无法按原计划继续？",
    "practice": "写出一项必要收尾与一项新的尝试。",
    "element": "风"
  },
  "swords-page": {
    "description": "好奇与批判思考需要与负责的表达并行。",
    "uprightMeaning": "提出问题，核对信息，练习清楚沟通。",
    "reversedMeaning": "道听途说、过度监视，或言语先于求证。",
    "symbolism": "警觉的学习者与观察。",
    "reflection": "这条信息的来源可靠吗？",
    "practice": "核实一条自己准备转述的信息。",
    "element": "风"
  },
  "swords-knight": {
    "description": "迅速判断也要给不同背景留出空间。",
    "uprightMeaning": "明确立场，集中处理优先问题。",
    "reversedMeaning": "冲动争辩、过度武断，或忽略行动代价。",
    "symbolism": "迅速前行与集中的思考。",
    "reflection": "我的结论有没有忽略必要背景？",
    "practice": "在行动前检查一条反对意见。",
    "element": "风"
  },
  "swords-queen": {
    "description": "清楚界限与直接表达可以同时保持尊重。",
    "uprightMeaning": "独立判断，以事实说明界限。",
    "reversedMeaning": "刻薄、僵化，或因害怕受伤而隔绝沟通。",
    "symbolism": "清晰锋刃与成熟判断。",
    "reflection": "我能怎样直接，又不贬低对方？",
    "practice": "把一个评价改写成事实与具体请求。",
    "element": "风"
  },
  "swords-king": {
    "description": "成熟判断需要证据、透明标准与责任。",
    "uprightMeaning": "建立公平标准，并说明判断依据。",
    "reversedMeaning": "滥用逻辑、过度控制，或隐藏真正标准。",
    "symbolism": "秩序与公共判断。",
    "reflection": "我的标准是否透明且一致？",
    "practice": "为一次决定写明依据和例外条件。",
    "element": "风"
  },
  "pentacles-ace": {
    "description": "一个具体机会需要落实为时间、资源与练习。",
    "uprightMeaning": "新的资源或稳定计划值得小规模开始。",
    "reversedMeaning": "机会尚未落实，或忽略维护所需的成本。",
    "symbolism": "种子与可耕作的土地。",
    "reflection": "我能怎样为这个机会建立实际基础？",
    "practice": "安排时间或预算完成第一步。",
    "element": "土"
  },
  "pentacles-2": {
    "description": "多项责任并行时，需要可调整的节奏。",
    "uprightMeaning": "灵活协调时间、开支与优先级。",
    "reversedMeaning": "长期超负荷，或不同事项争夺同一资源。",
    "symbolism": "循环与两个负荷的协调。",
    "reflection": "什么可以重新排序，而不是同时完成？",
    "practice": "重新排列今天的三项优先任务。",
    "element": "土"
  },
  "pentacles-3": {
    "description": "协作的质量来自技能、分工与共同验收标准。",
    "uprightMeaning": "学习、合作和认真的执行开始发挥作用。",
    "reversedMeaning": "职责不清、缺少反馈，或标准不一致。",
    "symbolism": "共同建造与专业分工。",
    "reflection": "怎样才算大家都理解了完成标准？",
    "practice": "与合作者确认一项具体验收条件。",
    "element": "土"
  },
  "pentacles-4": {
    "description": "保存资源能带来安全，也可能变成过度防守。",
    "uprightMeaning": "建立预算与边界，保护必要基础。",
    "reversedMeaning": "害怕失去而僵住，或缺少稳定的管理。",
    "symbolism": "握持与有限资源。",
    "reflection": "我是在保护需要，还是阻止所有变化？",
    "practice": "为资源安排保留、使用与试验三部分。",
    "element": "土"
  },
  "pentacles-5": {
    "description": "困难中先识别可求助的渠道与基本需要。",
    "uprightMeaning": "承认资源缺口，并寻找可靠支持。",
    "reversedMeaning": "支持逐渐出现，或羞于求助而继续孤立。",
    "symbolism": "门外与未被注意的支持。",
    "reflection": "有哪些帮助渠道我还没有认真核实？",
    "practice": "列出一项现实支持并确认申请条件。",
    "element": "土"
  },
  "pentacles-6": {
    "description": "给予与接受需要双方理解的边界。",
    "uprightMeaning": "合理分配资源，形成互惠与清楚约定。",
    "reversedMeaning": "权力不对等、附带隐性条件，或交换失衡。",
    "symbolism": "分配与衡量的意象。",
    "reflection": "这份给予是否带着未说出的期待？",
    "practice": "明确一次帮助的范围与条件。",
    "element": "土"
  },
  "pentacles-7": {
    "description": "长期投入需要定期检查，而非无限等待。",
    "uprightMeaning": "耐心观察成果，核对投入是否有效。",
    "reversedMeaning": "投入回报不明，或因急躁忽略必要积累。",
    "symbolism": "栽培与阶段评估。",
    "reflection": "哪些指标能说明做法正在起作用？",
    "practice": "为长期任务设置一个复盘日期和指标。",
    "element": "土"
  },
  "pentacles-8": {
    "description": "进步来自有反馈的重复练习。",
    "uprightMeaning": "认真打磨技能，让小步积累产生质量。",
    "reversedMeaning": "机械重复、过分追求完美，或练习方法无效。",
    "symbolism": "工具、工序与反复制作。",
    "reflection": "我的练习是否得到了有效反馈？",
    "practice": "完成一次练习，并只改进一个重点。",
    "element": "土"
  },
  "pentacles-9": {
    "description": "独立与成果值得确认，也需要知道支持的来源。",
    "uprightMeaning": "享受稳定成果，维护自主生活的基础。",
    "reversedMeaning": "外观富足却压力很大，或把价值全绑在成果上。",
    "symbolism": "成熟园地与自主安排。",
    "reflection": "我已建立的哪项基础值得维护？",
    "practice": "安排一项维护既有成果的小行动。",
    "element": "土"
  },
  "pentacles-10": {
    "description": "长期稳定需要可交接的制度与共同安排。",
    "uprightMeaning": "重视家庭、组织与资源的持续维护。",
    "reversedMeaning": "旧规则与新需要冲突，或只看物质而忽略关系。",
    "symbolism": "延续、共同资源与日常结构。",
    "reflection": "哪些安排需要说明或交接给他人？",
    "practice": "记录一项长期资源的维护和使用规则。",
    "element": "土"
  },
  "pentacles-page": {
    "description": "学习务实技能，从可持续的小目标开始。",
    "uprightMeaning": "专注基础，把想法转为练习与计划。",
    "reversedMeaning": "只收集知识而不练习，或目标过于松散。",
    "symbolism": "种子、学习者与清楚的对象。",
    "reflection": "下一项基本功是什么？",
    "practice": "安排一次有明确完成标准的基础练习。",
    "element": "土"
  },
  "pentacles-knight": {
    "description": "可靠的推进有时缓慢，但应保留检查与调整。",
    "uprightMeaning": "按节奏落实责任，维护已有进展。",
    "reversedMeaning": "僵化重复、停滞，或工作占据全部生活。",
    "symbolism": "稳定行进与可维护的土地。",
    "reflection": "我能怎样坚持又不陷入机械惯性？",
    "practice": "检查一项固定流程是否仍然有效。",
    "element": "土"
  },
  "pentacles-queen": {
    "description": "实际照顾需要兼顾生活资源与个人边界。",
    "uprightMeaning": "务实、温暖地安排日常和支持他人。",
    "reversedMeaning": "过度承担、资源焦虑，或用付出替代自我照看。",
    "symbolism": "生活空间与资源承接。",
    "reflection": "我的照顾方式是否也照看了自己？",
    "practice": "给一次付出设定适合的时间或资源边界。",
    "element": "土"
  },
  "pentacles-king": {
    "description": "成熟的资源管理来自长期维护与透明责任。",
    "uprightMeaning": "稳健安排资源，重视持续性和可信赖。",
    "reversedMeaning": "固执、以资源控制关系，或忽略变化中的条件。",
    "symbolism": "稳定结构与长期经营。",
    "reflection": "我的安排是否能长期维护并被他人理解？",
    "practice": "核对一项长期计划的预算、责任和风险余量。",
    "element": "土"
  }
};
export const TAROT_LIBRARY = /* @__PURE__ */ (()=>Object.freeze(TAROT_DECK.map(card => Object.freeze({ ...card,
  upright: Object.freeze([...card.upright]), reversed: Object.freeze([...card.reversed]), ...CARD_GUIDES[card.id] }))))();

const HEXAGRAM_DESCRIPTIONS = [
  "主动创造需要节律与自律；先辨别什么值得持续投入，再确定行动的分寸。",
  "承载并不等于被动。观察需要支持的事物，为成长建立适合的条件。",
  "新的开始常有混乱与阻力。先稳住基础，避免期待所有事情同时成熟。",
  "面对未知时，好的提问与可靠指导比急着得到确定答案更有帮助。",
  "等待也可以包含准备。分清暂时不能推进的部分与现在能补足的条件。",
  "争议需要事实与边界。适时停止争胜，也可能保护真正重要的目标。",
  "共同任务需要明确组织、角色与纪律，力量才能被可靠地使用。",
  "亲近与合作需要可信赖的基础。观察相互承诺是否有实际行动支撑。",
  "小规模积蓄适合耐心推进。不要因暂时不显眼就忽略微小进展。",
  "处在敏感环境中，谨慎、尊重与清晰表达能够减少不必要的摩擦。",
  "沟通顺畅时也需持续维护。让不同位置的人能表达真实情况。",
  "外部不通时，先保全核心原则，寻找可以维护的内部基础。",
  "共同目标能够凝聚力量，但真正的协作也要容纳差异与边界。",
  "资源充足需要负责任地使用。丰有的意义也来自维护与合理分享。",
  "谦逊不是否定自己，而是把成果放在现实比例中，为他人留出空间。",
  "热情适合转为有准备的行动，避免情绪带动超过实际承载能力。",
  "顺应变化时仍需辨别方向，保留重要原则，调整具体做法。",
  "积累的问题需要回到根源。修复旧弊时要安排责任、步骤和复盘。",
  "机会与责任靠近时，亲自观察并持续照看，比一次性的热情更可靠。",
  "先观察整体与自己的示范作用，再决定如何回应眼前局面。",
  "阻碍需要清楚处理。明确事实、规则与后果，减少反复绕行。",
  "表达形式可以增添理解，但应服务真实内容，避免只有外观。",
  "结构开始松动时，先保护必要基础，评估什么可以暂停或减少。",
  "细小的回返值得关注。恢复从一个能够重复的小步骤开始。",
  "真诚回应现实条件，减少预设、侥幸与为了结果而扭曲事实。",
  "增长中的力量需要学习与约束，才能在合适的时机可靠地发挥。",
  "输入、言语与日常习惯都在滋养某种生活方式，值得认真选择。",
  "承载超过结构能力时，需要重新分配负担，而不是继续硬撑。",
  "反复的困难要求清楚的判断与实际支持，先建立能够走过一段的办法。",
  "清晰需要合适的依托。辨别你依赖的信息、关系与结构是否可靠。",
  "影响与回应来自相互感受。倾听与空间通常比控制更能建立连接。",
  "持续并不等于一成不变。建立经得起时间，也能够校准的节律。",
  "主动退守可能保护长程方向。区分有计划的保存与没有目的的回避。",
  "力量充足时，更需要审视边界，避免因为能够做到就忽略后果。",
  "进展被看见之后，保持稳健，继续维护实际能力与合作条件。",
  "环境不利时，保护内在判断与必要资源，让重要事情不被过度消耗。",
  "亲近关系需要可理解的分工与规则。让责任与期待可以被说清楚。",
  "立场不同并不排除局部合作。辨别真正的分歧与仍可连接的部分。",
  "正面受阻时，停下来重新评估方向、帮助来源与行动条件。",
  "局面缓和后，抓住释放旧结的机会，也重新建立可持续的安排。",
  "减少并非只意味着损失。选择舍去非必要部分，可以保护核心目标。",
  "增益需要考虑共同受益与长期维护，避免只顾短期扩大。",
  "需要说清的事情应坚定公开，同时避免让表达变成新的对抗。",
  "突然相遇的因素需要观察与边界，不必因新鲜就马上接受全部影响。",
  "汇聚之后仍需共同中心、角色和规则，才能把热情转成持续合作。",
  "逐级上升适合稳定积累。关注今天能完成的小台阶与真实反馈。",
  "条件受限时，先辨认仍能守住的承诺与可求助的现实渠道。",
  "共享资源依赖持续维护与公平使用，不能只在需要时才照看基础。",
  "变革应有现实证据、合适时机与可执行步骤，避免只为改变而改变。",
  "新的容器要与新的内容相匹配；制度、能力与用途需要一起调整。",
  "意外会打断惯常节奏，先恢复基本秩序，再解释事件与安排后续。",
  "停止也是一种行动。明确何时该停，在哪里建立稳定边界。",
  "循序渐进尊重条件成熟的过程，小步连续比跳过必要环节更可靠。",
  "进入新的关系或角色之前，需要对齐位置、承诺与双方期待。",
  "高峰同样包含变化。珍惜当前成果，也为后续调整预留余地。",
  "身在暂时环境中，保持适合过渡期的轻装与可携带的原则。",
  "温和持续的影响需要清楚方向，通过细小入口逐步发挥作用。",
  "愉悦的交流应容纳真实表达，避免只为取悦而隐藏自己的需要。",
  "分散与隔阂需要重新连接。明确共同中心，同时尊重必要界限。",
  "规则与尺度应提供支持，而不是无限增加束缚；检查其实际作用。",
  "可信赖来自内心、言语与行动的一致，而不是一次性的保证。",
  "大动作不适合时，把注意力放在关键小事、细节与谨慎的调整上。",
  "看似完成仍需维护。观察哪些细节可能反复，安排交接与检查。",
  "尚未完成并不自动等于失败。校准次序、条件与节奏，再继续下一段。"
];
export const HEXAGRAM_LIBRARY = /* @__PURE__ */ (()=>Object.freeze(Array.from({ length: 64 }, (_, i) => {
  const hexagram = getHexagram(KING_WEN_BY_MASK.indexOf(i + 1));
  return Object.freeze({ ...hexagram, description: HEXAGRAM_DESCRIPTIONS[i],
    guidance: '结合实际处境写下回应：' + hexagram.prompt,
    keywords: Object.freeze([hexagram.theme, hexagram.lower.image, hexagram.upper.image]) });
})))();

export const TUTORIALS = /* @__PURE__ */ (()=>Object.freeze([
  {
    "id": "tarot-first",
    "title": "第一次抽塔罗",
    "description": "从一个具体问题与少量牌面开始。",
    "category": "tarot",
    "steps": [
      "写下一个与你有关、可以采取行动的问题，例如“我该如何准备这次沟通？”",
      "选择单张聚焦或情境·提醒·行动；初次可以关闭逆位。",
      "抽牌后先读位置含义，再观察牌面关键词与自己的经历有什么联系。",
      "写下一条能验证的小行动，之后回顾真实反馈。"
    ]
  },
  {
    "id": "tarot-positions",
    "title": "如何理解牌阵位置",
    "description": "同一张牌会因问题和位置而有不同侧重点。",
    "category": "tarot",
    "steps": [
      "先阅读每个位置代表的观察角度，不急着逐张套用结论。",
      "将牌意与对应位置组合：优势位置关注已有条件，阻力位置关注需要调整的部分。",
      "比较牌面之间的共性与张力，再回到原问题。",
      "保持结果可修正；牌阵不读取他人真实想法，也不提供确定的未来。"
    ]
  },
  {
    "id": "tarot-reversed",
    "title": "认识正位与逆位",
    "description": "逆位提供另一种观察角度，并非简单的好坏翻转。",
    "category": "tarot",
    "steps": [
      "正位先看核心主题正在怎样表现。",
      "逆位可以理解为阻滞、过量、内化或需要调整，结合具体事实辨别。",
      "如果逆位让你难以阅读，可暂时关闭逆位，学习核心牌义。",
      "不用单张牌给自己或他人下人格、健康或命运结论。"
    ]
  },
  {
    "id": "tarot-arcana",
    "title": "大牌、花色与宫廷牌",
    "description": "用结构建立78张牌的初步地图。",
    "category": "tarot",
    "steps": [
      "22张大阿尔卡纳用于观察阶段主题与重要经验。",
      "权杖偏行动、圣杯偏情感、宝剑偏思考沟通、星币偏资源与日常；这些只是观察分类。",
      "数字牌可从开始、发展、稳定、调整到完成理解，但每张也有自己的语境。",
      "宫廷牌作为表达与行动方式阅读，不自动等同于某种性别、年龄或具体人物。"
    ]
  },
  {
    "id": "iching-coins",
    "title": "三枚硬币起卦",
    "description": "理解六爻、阴阳和动爻的记录规则。",
    "category": "iching",
    "steps": [
      "每枚硬币用2或3记录；三枚相加得到6、7、8或9。",
      "按从下到上顺序记录六次：6老阴、7少阳、8少阴、9老阳。",
      "6和9是动爻；老阴变阳，老阳变阴，7和8保持不变。",
      "先看本卦主题与动爻位置，再把变卦作为变化观察角度，而不是必然结果。"
    ]
  },
  {
    "id": "iching-numbers",
    "title": "数字起卦规则",
    "description": "三数字的当代简化梅花法，算法公开可复现。",
    "category": "iching",
    "steps": [
      "输入三个1到1000000000的正整数；它们依次用于上卦、下卦和动爻。",
      "上、下卦各取数字除以8的余数，余0算8；先天序为乾、兑、离、震、巽、坎、艮、坤。",
      "第三数除以6取余，余0算6，确定从下到上的第几爻变化。",
      "此规则是本项目采用的现代简化约定，不声称唯一传统方法，也不制造随机概率承诺。"
    ]
  },
  {
    "id": "iching-time",
    "title": "时间起卦规则",
    "description": "使用公历与选定时区的当代简化梅花法。",
    "category": "iching",
    "steps": [
      "选择明确时间与时区，默认Asia/Shanghai；系统保存标准ISO时间用于复现。",
      "以公历年+月+日定上卦；再加时辰序数定下卦与动爻，分别对8或6取余。",
      "子时23:00至00:59为1，丑时01:00至02:59为2，依次至亥时21:00至22:59为12；余0算8或6。",
      "使用公历而非传统农历；相同时间与时区得到相同结果，分钟不参与这一简化算法。"
    ]
  },
  {
    "id": "iching-related",
    "title": "本卦、变卦、互卦、错卦与综卦",
    "description": "区分五种结构与它们在本项目中的观察用途。",
    "category": "iching",
    "steps": [
      "本卦来自六条原始爻；变卦只翻转动爻的阴阳。",
      "互卦取原卦第2、3、4爻作下卦，第3、4、5爻作上卦，用来观察内部结构。",
      "错卦把六条爻全部阴阳翻转；综卦把六条爻上下倒置，可提供对照视角。",
      "互、错、综是派生结构，不是又抽到的新结果；默认AI基础解读仍只引用本卦与有动爻时的变卦。"
    ]
  },
  {
    "id": "question-writing",
    "title": "提出有帮助的问题",
    "description": "让问题围绕事实、需要与自己的行动。",
    "category": "practice",
    "steps": [
      "从“会不会发生”转为“我可以怎样准备或回应”。",
      "从“别人真实想什么”转为“我观察到哪些互动，哪些需要通过对话确认”。",
      "把过大的问题拆成一个当前阶段和一个具体选择。",
      "健康、法律、财务与安全决定应求助合适的专业渠道，象征解读仅作书写与思考辅助。"
    ]
  },
  {
    "id": "reflection-journal",
    "title": "把解读转成复盘",
    "description": "用真实反馈更新理解，避免为了得到期待答案而重复抽取。",
    "category": "practice",
    "steps": [
      "保存问题、结果与当时的理解，区分事实与联想。",
      "选择一个成本低、可以调整的行动，标明何时回顾。",
      "回顾时写下实际发生的反馈，允许原来的理解不适用。",
      "同一个问题先实践和收集信息，再决定是否需要新的角度。"
    ]
  }
].map(tutorial => Object.freeze({ ...tutorial, steps: Object.freeze(tutorial.steps) }))))();
