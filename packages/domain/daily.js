import { TAROT_DECK, randomInt, validateReading } from './engine.js';

export const DAILY_STORAGE_KEY = 'star-oracle.daily.v1';
export const DAILY_LIMIT = 90;
export const DAILY_MOODS = Object.freeze([
  { id: 'calm', label: '平静', symbol: '☾' },
  { id: 'hopeful', label: '期待', symbol: '✧' },
  { id: 'tired', label: '疲惫', symbol: '◡' },
  { id: 'restless', label: '不安', symbol: '≈' },
  { id: 'low', label: '低落', symbol: '☁' }
]);

export function localDateKey(date = new Date()) {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) throw new Error('日期无效');
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')].join('-');
}
function validDailyDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day;
}
export function validateDailyEntry(value) {
  if (!value || !validDailyDate(value.date)) throw new Error('星笺日期无效');
  const reading = validateReading(value.reading);
  if (reading.kind !== 'tarot' || reading.spread !== 'single' || reading.cards[0].reversed ||
      reading.id !== 'daily-' + value.date) throw new Error('星笺牌面无效');
  if (value.mood !== null && !DAILY_MOODS.some(item => item.id === value.mood)) throw new Error('心情无效');
  if (typeof value.note !== 'string' || value.note.length > 600 ||
      typeof value.updatedAt !== 'string' || !Number.isFinite(Date.parse(value.updatedAt))) throw new Error('日记无效');
  return { date: value.date, reading, mood: value.mood, note: value.note,
    updatedAt: new Date(value.updatedAt).toISOString() };
}

// Drawing and journaling share a record, so deleting a note never unlocks a second draw.
export function createDailyStore({ storage, now = () => new Date(),
  chooseCard = () => TAROT_DECK[randomInt(TAROT_DECK.length)].id } = {}) {
  let cache = [], storageOK = true;
  const clean = values => {
    const seen = new Set();
    return (Array.isArray(values) ? values : []).flatMap(value => {
      try {
        const entry = validateDailyEntry(value);
        if (seen.has(entry.date)) return [];
        seen.add(entry.date); return [entry];
      } catch { return []; }
    }).sort((a, b) => b.date.localeCompare(a.date)).slice(0, DAILY_LIMIT);
  };
  function read() {
    if (!storageOK) return cache;
    let raw;
    try { raw = storage.getItem(DAILY_STORAGE_KEY); }
    catch { storageOK = false; return cache; }
    try { cache = raw && raw.length <= 500000 ? clean(JSON.parse(raw)) : []; }
    catch { cache = []; }
    return cache;
  }
  function write(entries) {
    cache = clean(entries);
    try { storage.setItem(DAILY_STORAGE_KEY, JSON.stringify(cache)); storageOK = true; }
    catch { storageOK = false; }
  }
  const copy = entry => entry ? structuredClone(entry) : null;
  function get(date = localDateKey(now())) { return copy(read().find(entry => entry.date === date)); }
  function ensureToday() {
    const instant = now(), date = localDateKey(instant), entries = read();
    const existing = entries.find(entry => entry.date === date);
    if (existing) return copy(existing);
    const entry = validateDailyEntry({
      date, reading: { version: 1, id: 'daily-' + date, createdAt: instant.toISOString(),
        question: '今天，我可以怎样更好地照顾自己？', kind: 'tarot', spread: 'single',
        cards: [{ id: chooseCard(), reversed: false }] },
      mood: null, note: '', updatedAt: instant.toISOString()
    });
    write([entry, ...entries]); return copy(entry);
  }
  function saveJournal(date, { mood, note }) {
    const entries = read(), existing = entries.find(entry => entry.date === date);
    if (!existing) throw new Error('这张星笺已不在本机记录中。');
    const entry = validateDailyEntry({ ...existing, mood, note: note.trim(), updatedAt: now().toISOString() });
    write([entry, ...entries.filter(item => item.date !== date)]); return copy(entry);
  }
  function clearJournal(date) { return saveJournal(date, { mood: null, note: '' }); }
  function clearAllJournals() {
    const instant = now().toISOString();
    write(read().map(entry => ({ ...entry, mood: null, note: '', updatedAt: instant })));
  }
  return { get, ensureToday, saveJournal, clearJournal, clearAllJournals,
    entries: () => structuredClone(read()), today: () => localDateKey(now()),
    isPersistent: () => storageOK };
}

const DAILY_MAJOR = {
  'major-fool': ['给开始一点空间', '新的尝试不必一开始就完美。带着好奇，迈出你能承受的一小步。', '花十分钟，尝试一件一直想开始的小事。', '如果允许自己是初学者，你愿意试什么？'],
  'major-magician': ['你已经有一些答案', '先看见手里的资源。经验、时间和一个小技能，都可以成为今天的起点。', '列出你已有的三项资源，用其中一项推动一件小事。', '今天，哪一种能力值得被你用起来？'],
  'major-priestess': ['听见安静的声音', '给感受一点位置，也给事实一点时间。有些想法在安静下来后才会清楚。', '关掉通知五分钟，写下此刻最真实的一个感受。', '忙碌的声音之外，你听见了什么？'],
  'major-empress': ['照顾，让日子生长', '把滋养留一点给自己。身体、环境和喜欢的事，都值得你温柔地照看。', '为自己准备一顿舒服的饭，或整理一个常用的小角落。', '今天，你想怎样照顾自己？'],
  'major-emperor': ['为重要的事留位置', '清楚的结构可以让你轻松一点。先确定边界，再把注意力放在真正重要的事上。', '选出今天最重要的一件事，为它留一段不被打扰的时间。', '哪一条边界能帮你省下一点力气？'],
  'major-hierophant': ['向经验借一点光', '遇到不熟悉的事，可以向可信的经验求助，再判断什么适合你。', '找一个可靠来源，弄清今天困扰你的一个具体问题。', '哪条经验值得保留，又需要怎样调整？'],
  'major-lovers': ['让选择靠近内心', '选择之前，看看自己在乎什么。诚实的沟通和一致的行动，会让方向更清楚。', '写下一个选择，以及你最希望它保护的一项价值。', '哪个选择更接近你真正看重的东西？'],
  'major-chariot': ['朝一个方向前进', '把分散的力量收回来。今天只需要一个清楚、可完成的目标。', '把一件任务拆成三步，先完成第一步。', '你今天想把注意力带向哪里？'],
  'major-strength': ['柔软，也有力量', '耐心和温柔也能帮助你面对困难。允许自己慢一点，仍然可以继续。', '遇到急躁的时刻，先慢慢呼吸三次，再回应。', '今天，你能对自己温柔一点吗？'],
  'major-hermit': ['给自己一点独处', '暂时离开比较和催促。留一点安静的时间，看看什么方向仍值得你继续。', '独自散步十分钟，或写下最近反复想到的一个问题。', '没有外界评价时，你会怎样选择？'],
  'major-wheel': ['给变化留一点余地', '计划会遇见变化。看清能影响的部分，让今天的安排多一点弹性。', '为一项计划准备一个更轻量的备用方案。', '变化中，什么仍由你来决定？'],
  'major-justice': ['把事实看清一点', '先区分事实、感受和猜测。清楚地看见它们，有助于做出更公平的选择。', '写下一件困扰你的事，把事实与自己的推测分开。', '还有什么信息，值得在判断前确认？'],
  'major-hanged-man': ['换一个位置看看', '有时停顿能带来新的角度。暂缓一个结论，为不同的理解留位置。', '选一个卡住的问题，写下另一种可能的解释。', '换个角度，什么会变得不一样？'],
  'major-death': ['让旧的一页翻过去', '这张牌象征结束与过渡。看看什么已不再适合你，为新的生活方式腾一点空间。', '整理一件闲置物品，或结束一项已经不需要的小安排。', '你准备放下哪一种旧习惯？'],
  'major-temperance': ['找到舒服的节奏', '在用力与休息之间，试着找到更适合今天的比例。调整一点点也有意义。', '为一项工作安排一次真正的短休息。', '哪一点调整，能让今天更平衡？'],
  'major-devil': ['看见自己的选择', '留意那些让你不舒服却反复发生的习惯。看见它，是重新选择的第一步。', '找到一个消耗你的习惯，给它设置一个小小的暂停点。', '什么正在消耗你，又有什么替代方式？'],
  'major-tower': ['先找一个稳固的支点', '当预期被打乱，可以先照顾眼前的需要。允许自己重新整理，再决定下一步。', '写下当前仍然可靠的一件事，并完成一个小而确定的动作。', '此刻，有什么能帮你稳住自己？'],
  'major-star': ['为希望做一件小事', '希望可以是一件很小的事。给喜欢的方向一点时间，让它慢慢变得具体。', '为一件让你期待的事，投入十分钟。', '哪一点微小的期待，值得被你照看？'],
  'major-moon': ['让模糊慢慢清楚', '有些事情暂时没有答案。感受可以被听见，猜测也可以等待更多事实。', '写下一个担心，再找出其中可以确认的一条信息。', '你还需要什么，才能更安心地判断？'],
  'major-sun': ['留意日子里的光', '看看今天让你舒服、清楚或有活力的时刻。让它们成为可以主动照看的日常。', '做一件让你有精神的小事，并记下完成后的感受。', '今天有什么，值得你认真欣赏？'],
  'major-judgement': ['给自己一次回看', '回看一段经历，既看见做得好的地方，也看见能调整的部分。', '写下一件最近的经历：我学到了什么，下一次想怎样做？', '你愿意把哪一个发现带进今天？'],
  'major-world': ['认真收好这一程', '完成也值得被看见。给一个阶段做个收尾，承认自己走过的路。', '完成一项小任务的最后一步，再给自己一点肯定。', '最近哪一份努力，值得被你记住？']
};
const DAILY_SUITS = {
  wands: ['把注意力带向行动与创造。', '把想法写成一个可执行的小步骤。', '你想为哪件事投入一点热情？'],
  cups: ['给情绪和关系一点耐心。', '写下一个真实感受，或向在意的人表达一句关心。', '哪一种感受需要被你听见？'],
  swords: ['为思考和沟通留一点清楚。', '把一个想法整理成三句话，区分事实和推测。', '哪件事需要更清楚地说出来？'],
  pentacles: ['照看身体、时间和手里的资源。', '整理一项小开支、一个工作角落，或安排一段休息。', '今天能怎样把自己照顾得更踏实？']
};
const DAILY_RANKS = {
  ace: ['给一个想法发芽的机会', '新的可能，可以从很小的尝试开始。'],
  '2': ['为两种需要找个平衡', '看看手里的安排，把精力放到今天最需要的地方。'],
  '3': ['让交流带来一点进展', '一份协作、一个建议，可能让眼前的事更清楚。'],
  '4': ['稳住，也留一点空白', '看看什么需要守住，什么可以松动一点。'],
  '5': ['在摩擦中照顾自己', '分歧或不足可以被看见，再选择一个能够调整的部分。'],
  '6': ['让付出与接收流动', '看看有什么值得分享，也允许自己接受合适的帮助。'],
  '7': ['停一下，看看方向', '继续用力之前，留一点时间评估自己的选择。'],
  '8': ['把进步放进一次练习', '熟悉一件事，需要温和而持续的练习。'],
  '9': ['看见已经积累的力量', '走到这里已经做了不少，也记得照顾剩下的精力。'],
  '10': ['给一段努力做个收尾', '成果与负担都值得整理，让下一步轻一点。'],
  page: ['带着好奇学习', '允许自己不熟悉，从一个具体的问题开始。'],
  knight: ['把热情放进合适的步伐', '向前走的同时，确认节奏和方向是否适合自己。'],
  queen: ['温柔地承接今天', '留意内心与周围人的需要，也把自己放在照顾之中。'],
  king: ['为重要的事承担一点责任', '用清楚的安排和稳健的行动，照看你在意的事。']
};
export function dailyMessage(cardId) {
  const card = TAROT_DECK.find(item => item.id === cardId);
  if (!card) throw new Error('星笺牌面无效');
  const major = DAILY_MAJOR[cardId];
  if (major) return { title: major[0], text: major[1], action: major[2], reflection: major[3] };
  const rank = DAILY_RANKS[card.rank], suit = DAILY_SUITS[card.suit];
  return { title: rank[0], text: rank[1] + suit[0], action: suit[1], reflection: suit[2] };
}
