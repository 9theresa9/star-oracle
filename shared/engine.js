import { TAROT_DECK, KING_WEN_BY_MASK, KING_WEN_NAMES, REFLECTIONS, TRIGRAMS } from './data.js';

export const SPREADS = Object.freeze({
  single: { name: '单张聚焦', positions: ['此刻的焦点'] },
  three: { name: '情境 · 提醒 · 行动', positions: ['当前情境', '需要留意', '可以尝试的行动'] }
});
const cardsById = new Map(TAROT_DECK.map(card => [card.id, card]));
export { TAROT_DECK, KING_WEN_BY_MASK };

export function randomInt(max, source = () => crypto.getRandomValues(new Uint32Array(1))[0]) {
  if (!Number.isSafeInteger(max) || max < 1 || max > 0x100000000) throw new Error('随机范围无效');
  const limit = Math.floor(0x100000000 / max) * max;
  let value;
  do {
    value = source();
    if (!Number.isInteger(value) || value < 0 || value >= 0x100000000) throw new Error('随机源无效');
  } while (value >= limit);
  return value % max;
}

export function drawTarot(spread = 'three', allowReversed = true, rng = randomInt) {
  if (!Object.hasOwn(SPREADS, spread) || typeof allowReversed !== 'boolean') throw new Error('牌阵无效');
  const deck = [...TAROT_DECK];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = rng(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return SPREADS[spread].positions.map((_, i) => ({
    id: deck[i].id, reversed: allowReversed && rng(2) === 1
  }));
}

export function castCoinLine(rng = randomInt) {
  const coins = Array.from({ length: 3 }, () => rng(2) + 2);
  return { coins, value: coins.reduce((a, b) => a + b, 0) };
}

export function getHexagram(mask) {
  if (!Number.isInteger(mask) || mask < 0 || mask > 63) throw new Error('卦象无效');
  const number = KING_WEN_BY_MASK[mask];
  const [theme, prompt] = REFLECTIONS[number];
  return { mask, number, name: KING_WEN_NAMES[number], theme, prompt,
    lower: TRIGRAMS[mask & 7], upper: TRIGRAMS[(mask >> 3) & 7] };
}

export function analyseLines(lines) {
  if (!Array.isArray(lines) || lines.length !== 6 || lines.some(x => ![6, 7, 8, 9].includes(x))) {
    throw new Error('需要六条有效的爻，按从下到上的顺序');
  }
  let original = 0, movingMask = 0;
  lines.forEach((value, index) => {
    if (value % 2) original |= 1 << index;
    if (value === 6 || value === 9) movingMask |= 1 << index;
  });
  return { original: getHexagram(original), resulting: getHexagram(original ^ movingMask),
    moving: lines.flatMap((v, i) => v === 6 || v === 9 ? [i + 1] : []), lines: [...lines] };
}

export function validateReading(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 1 ||
      typeof value.id !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(value.id) ||
      typeof value.question !== 'string' || value.question.trim().length < 2 ||
      value.question.length > 500 || typeof value.createdAt !== 'string' ||
      !Number.isFinite(Date.parse(value.createdAt))) throw new Error('探索记录格式无效');
  const base = { version: 1, id: value.id, question: value.question.trim(),
    createdAt: new Date(value.createdAt).toISOString(), kind: value.kind };
  if (value.kind === 'tarot') {
    if (!Object.hasOwn(SPREADS, value.spread) || !Array.isArray(value.cards) ||
        value.cards.length !== SPREADS[value.spread].positions.length) throw new Error('牌阵无效');
    const seen = new Set();
    const cards = value.cards.map(item => {
      if (!item || !cardsById.has(item.id) || typeof item.reversed !== 'boolean' || seen.has(item.id)) {
        throw new Error('牌面无效或重复');
      }
      seen.add(item.id);
      return { id: item.id, reversed: item.reversed };
    });
    return { ...base, spread: value.spread, cards };
  }
  if (value.kind === 'iching') {
    analyseLines(value.lines);
    return { ...base, lines: [...value.lines] };
  }
  throw new Error('探索方式无效');
}

export function evidenceFor(input) {
  const reading = validateReading(input);
  if (reading.kind === 'tarot') return reading.cards.map((item, index) => {
    const card = cardsById.get(item.id);
    return { reference: card.id, name: card.name, english: card.en, mark: card.mark,
      position: SPREADS[reading.spread].positions[index], reversed: item.reversed,
      keywords: [...(item.reversed ? card.reversed : card.upright)] };
  });
  const result = analyseLines(reading.lines);
  const evidence = [{ reference: 'hexagram:' + result.original.number, position: '本卦', ...result.original }];
  if (result.moving.length) evidence.push({
    reference: 'hexagram:' + result.resulting.number, position: '变卦', ...result.resulting
  });
  return evidence;
}

export function basicInterpretation(input) {
  const reading = validateReading(input), evidence = evidenceFor(reading);
  if (reading.kind === 'tarot') return {
    summary: '从这组牌的象征出发，整理眼前的情境，找到一个可以亲自验证的小行动。',
    insights: evidence.map(item => ({ reference: item.reference,
      text: item.position + '：' + item.name + '（' + (item.reversed ? '逆位' : '正位') +
        '）提示你留意' + item.keywords.join('、') + '。把这些关键词与你的具体经历对照，保留有帮助的部分。' })),
    actions: ['写下问题中你能影响的一件事。', '选一个成本小、可调整的行动，做完后观察实际反馈。'],
    reflection: '如果暂时放下对答案的期待，你现在最需要看清的是什么？'
  };
  const result = analyseLines(reading.lines);
  return {
    summary: '本卦呈现“' + result.original.theme + '”的观察角度。' +
      (result.moving.length ? '第 ' + result.moving.join('、') + ' 爻为动爻，变化后的主题是“' +
        result.resulting.theme + '”。' : '这次没有动爻，可以先聚焦本卦的主题。'),
    insights: evidence.map(item => ({ reference: item.reference,
      text: item.position + '·' + item.name + '：' + item.prompt })),
    actions: ['区分当前处境里已经稳定和仍在变化的部分。', '围绕本卦的问题写一条回应，再选择一个今天能完成的小步骤。'],
    reflection: result.original.prompt
  };
}

export function validateInterpretation(value, reading) {
  const refs = new Set(evidenceFor(reading).map(item => item.reference));
  const textOK = (text, max) => typeof text === 'string' && text.trim().length > 0 && text.length <= max;
  if (!value || !textOK(value.summary, 1600) || !textOK(value.reflection, 500) ||
      !Array.isArray(value.insights) || value.insights.length !== refs.size ||
      !Array.isArray(value.actions) || value.actions.length < 2 || value.actions.length > 4 ||
      value.actions.some(x => !textOK(x, 500))) throw new Error('AI 解读格式无效');
  const seen = new Set();
  const insights = value.insights.map(item => {
    if (!item || !refs.has(item.reference) || seen.has(item.reference) || !textOK(item.text, 1400)) {
      throw new Error('AI 引用了本次结果以外的牌面或卦象');
    }
    seen.add(item.reference);
    return { reference: item.reference, text: item.text.trim() };
  });
  return { summary: value.summary.trim(), insights, actions: value.actions.map(x => x.trim()),
    reflection: value.reflection.trim() };
}

export function readingText(reading, interpretation = basicInterpretation(reading)) {
  const evidence = evidenceFor(reading);
  return ['照见 · Star Oracle', reading.question,
    ...evidence.map(x => x.position + '：' + x.name + (reading.kind === 'tarot' ?
      '（' + (x.reversed ? '逆位' : '正位') + '）' : ' · 第' + x.number + '卦')),
    interpretation.summary, ...interpretation.insights.map(x => x.text),
    '可以尝试：', ...interpretation.actions, interpretation.reflection].join('\n\n');
}
