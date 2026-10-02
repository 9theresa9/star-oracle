import { SPREADS, drawTarot, castCoinLine, validateReading, evidenceFor, analyseLines,
  basicInterpretation, validateInterpretation, readingText, getHexagram } from '/shared/engine.js';

import { createDailyExperience } from '/daily.js';

const app = document.querySelector('#app');
const storageKey = 'star-oracle.history.v1';
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const e = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pause = ms => new Promise(resolve => setTimeout(resolve, reducedMotion() ? 0 : ms));
const state = { page: 'home', mode: 'tarot', question: '', spread: 'three', reversed: true,
  reading: null, ai: null, followups: [], revealed: new Set(), lines: [], coins: null,
  coinBusy: false, aiBusy: false, aiError: '', followupDraft: '', aiEnabled: null, storageOK: true, sequence: 0 };
let controller = null, toastTimer;
function newReadingId() {
  return typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, '0')).join('');
}
function toast(message) {
  const node = document.querySelector('#toast'); node.textContent = message; node.classList.add('visible');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => node.classList.remove('visible'), 4000);
}
function cleanEntry(entry) {
  const reading = validateReading(entry.reading);
  let ai = null;
  try { if (entry.ai) ai = validateInterpretation(entry.ai, reading); } catch { /* Keep the reading. */ }
  const followups = Array.isArray(entry.followups) ? entry.followups.slice(-3).flatMap(item => {
    try {
      if (typeof item.question !== 'string' || item.question.length > 500) return [];
      return [{ question: item.question, interpretation: validateInterpretation(item.interpretation, reading) }];
    } catch { return []; }
  }) : [];
  return { reading, ai, followups };
}
function loadHistory() {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return [];
    if (raw.length > 500000) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, 10).flatMap(entry => {
      try { return [cleanEntry(entry)]; } catch { return []; }
    }) : [];
  } catch { state.storageOK = false; return []; }
}
let history = loadHistory();
function persist() {
  try { localStorage.setItem(storageKey, JSON.stringify(history)); state.storageOK = true; }
  catch { state.storageOK = false; toast('浏览器暂时无法保存记录，你仍可复制这次解读。'); }
}
function saveCurrent() {
  if (!state.reading) return;
  const entry = { reading: state.reading, ai: state.ai, followups: state.followups };
  history = [entry, ...history.filter(item => item.reading.id !== state.reading.id)].slice(0, 10); persist();
}
function cancelPending() {
  state.sequence++; controller?.abort(); controller = null; state.aiBusy = false; state.coinBusy = false;
}
function home() {
  cancelPending(); state.page = 'home'; state.aiError = ''; state.question = ''; state.followupDraft = ''; render(true);
}
function cardFace(card) {
  const suit = card.reference.split('-')[0];
  const symbol = suit === 'wands' ? '✦' : suit === 'cups' ? '◡' : suit === 'swords' ? '†' :
    suit === 'pentacles' ? '⟡' : card.reference === 'major-moon' ? '☾' : card.reference === 'major-sun' ? '☉' : '✧';
  return '<div class="card-face ' + (card.reversed ? 'reversed' : '') + '"><span class="card-mark">' +
    e(card.mark) + '</span><div class="card-emblem" aria-hidden="true"><span class="emblem-ring"></span><span class="emblem-core">' +
    symbol + '</span><span class="emblem-dot">·</span></div><div class="card-names"><strong>' +
    e(card.name) + '</strong><span>' + e(card.english) + '</span></div></div>';
}
function demoCard(id, name, english, mark) {
  return cardFace({ reference: id, name, english, mark, reversed: false });
}
function homeView() {
  return '<section class="home-section"><div class="intro"><p class="eyebrow">A MOMENT FOR YOURSELF</p><h1>向内看。<br><span>向前走。</span></h1>' +
    '<p class="intro-copy">带着一个问题，给自己一点看清的空间。</p><button class="daily-home-link" data-action="daily"><span aria-hidden="true">✧</span><span>每日星笺<small>给今天留一点光</small></span><span aria-hidden="true">↗</span></button></div>' +
    '<div class="hero-deck" aria-hidden="true"><div class="orbit"></div><div class="showcase-card showcase-left">' +
    demoCard('major-moon', '月亮', 'THE MOON', 'XVIII') + '</div><div class="showcase-card showcase-right">' +
    demoCard('major-sun', '太阳', 'THE SUN', 'XIX') + '</div><div class="showcase-card showcase-center">' +
    demoCard('major-star', '星星', 'THE STAR', 'XVII') + '</div><p class="deck-note">留一点空白，让新的视角进来。</p></div>' +
    '<form id="question-form" class="question-panel"><fieldset class="mode-picker"><legend class="sr-only">选择探索方式</legend>' +
    ['tarot', 'iching'].map(mode => '<label class="mode-choice"><input type="radio" name="mode" value="' + mode +
      '" ' + (state.mode === mode ? 'checked' : '') + '><span>' + (mode === 'tarot' ? '塔罗' : '易经') +
      '</span><small>' + (mode === 'tarot' ? '从牌面看见线索' : '从变化理解处境') + '</small></label>').join('') +
    '</fieldset><label class="question-label" for="question">你想探索什么？</label><textarea id="question" name="question" rows="2" required minlength="2" maxlength="500" placeholder="比如：面对新的工作机会，我需要看清什么？">' +
    e(state.question) + '</textarea><div class="suggestions"><button type="button" class="chip" data-action="suggest" data-topic="work">工作与方向</button>' +
    '<button type="button" class="chip" data-action="suggest" data-topic="relationship">关系与沟通</button><button type="button" class="chip" data-action="suggest" data-topic="self">认识自己</button></div>' +
    (state.mode === 'tarot' ? '<fieldset class="spread-picker"><legend class="sr-only">选择牌阵</legend>' +
      '<label><input type="radio" name="spread" value="single" ' + (state.spread === 'single' ? 'checked' : '') + '><span>单张聚焦</span></label>' +
      '<label><input type="radio" name="spread" value="three" ' + (state.spread === 'three' ? 'checked' : '') + '><span>三张探索</span></label></fieldset>' +
      '<label class="switch-row"><span>包含逆位<span class="muted small">让牌义多一个观察角度</span></span><input type="checkbox" name="reversed" ' +
      (state.reversed ? 'checked' : '') + '><span class="switch-track" aria-hidden="true"></span></label>' :
      '<div class="method-note"><span class="method-symbol" aria-hidden="true">☯</span><p>三枚硬币，六次抛掷。<br><span class="muted small">从下往上，慢慢看见一个卦象。</span></p></div>') +
    '<button class="primary full" type="submit">' + (state.mode === 'tarot' ? '开始抽牌' : '开始起卦') +
    '</button><p class="panel-note">问题只在本机保留，主动请求 AI 解读时才会发送。</p></form></section>';
}
function tarotView() {
  const evidence = evidenceFor(state.reading), all = state.revealed.size === evidence.length;
  return '<section class="ritual-section"><button class="text-button" data-action="home">重新提问</button><p class="eyebrow">YOUR CARDS</p>' +
    '<h1>让线索，慢慢展开。</h1><p class="ritual-question">' + e(state.reading.question) + '</p>' +
    '<p class="muted" id="reveal-status" role="status">已翻开 ' + state.revealed.size + ' / ' + evidence.length + ' 张。点选卡牌，查看你的结果。</p>' +
    '<div class="ritual-cards ' + (evidence.length === 1 ? 'single-card' : '') + '">' +
    evidence.map((card, index) => '<div class="ritual-card"><p class="position-label">' + e(card.position) + '</p><button type="button" class="flip-card ' +
      (state.revealed.has(index) ? 'is-revealed' : '') + '" data-action="flip" data-index="' + index + '" aria-label="' +
      e(state.revealed.has(index) ? card.position + '，' + card.name + (card.reversed ? '，逆位' : '，正位') : '翻开第 ' + (index + 1) + ' 张牌，' + card.position) +
      '"><span class="card-inner"><span class="card-back" aria-hidden="' + state.revealed.has(index) + '"><span class="back-orbit">✧</span><span class="back-word">照见</span><span class="back-caption">STAR ORACLE</span></span>' +
      '<span class="card-front" aria-hidden="' + !state.revealed.has(index) + '">' + cardFace(card) + '</span></span></button>' +
      '<p class="orientation" data-orientation="' + index + '">' + (state.revealed.has(index) ? e(card.name) + ' · ' + (card.reversed ? '逆位' : '正位') : '轻触翻开') +
      '</p></div>').join('') + '</div><div class="ritual-actions"><button class="secondary" id="reveal-all" data-action="flip-all" ' + (all ? 'disabled' : '') +
      '>全部翻开</button><button class="primary" id="view-result" data-action="result" ' + (all ? '' : 'disabled') +
      '>查看解读</button></div><p class="panel-note">结果已在抽牌时固定，翻牌顺序不会改变牌面。</p></section>';
}
function lineDiagram(lines, allowEmpty = false) {
  return '<div class="hex-lines">' + Array.from({ length: 6 }, (_, reverse) => {
    const index = 5 - reverse, value = lines[index];
    const empty = value === undefined;
    return '<div class="hex-row ' + (empty ? 'empty-line' : '') + '"><span class="line-number">' + (index + 1) +
      '</span><span class="yao ' + (value % 2 ? 'yang' : 'yin') + ' ' + ([6, 9].includes(value) ? 'moving' : '') +
      '" aria-hidden="true"><i></i><i></i></span><span class="line-state">' +
      (empty ? (allowEmpty ? '待起' : '') : [6, 9].includes(value) ? '动' : '静') + '</span></div>';
  }).join('') + '</div>';
}
function coinView() {
  const ready = state.lines.length === 6;
  return '<section class="ritual-section coin-section"><button class="text-button" data-action="home">重新提问</button><p class="eyebrow">IN THE MOMENT OF CHANGE</p>' +
    '<h1>一爻一爻，看见变化。</h1><p class="ritual-question">' + e(state.question) + '</p><div class="coin-layout"><div class="coin-control">' +
    '<div class="coins ' + (state.coinBusy ? 'tossing' : '') + '" aria-label="三枚硬币">' +
    [0, 1, 2].map(index => '<div class="coin"><span>' + (state.coins ? state.coins[index] === 2 ? '阴' : '阳' : '☯') +
      '</span><small>' + (state.coins ? state.coins[index] : '照见') + '</small></div>').join('') +
    '</div><p id="coin-status" role="status" class="coin-status">' + (state.coinBusy ? '硬币正在落定…' : ready ? '六爻已成。' :
      '第 ' + (state.lines.length + 1) + ' 次抛掷 · ' + (state.lines.length === 0 ? '从初爻开始' : '继续向上')) +
    '</p><button class="primary full" id="toss-button" data-action="' + (ready ? 'coin-result' : 'toss') + '" ' +
    (state.coinBusy ? 'disabled aria-busy="true"' : '') + '>' + (ready ? '查看卦象与解读' : state.coinBusy ? '正在起爻…' : '抛掷三枚硬币') +
    '</button><p class="panel-note">阴面 2，阳面 3。相加得到一爻。<br>6 和 9 为动爻。</p></div><div class="forming-hexagram" role="img" aria-label="' +
    e('已从下向上生成 ' + state.lines.length + ' 爻；数值依次为 ' + (state.lines.join('、') || '暂无')) + '">' +
    lineDiagram(state.lines, true) + '<p class="panel-note">初爻在下，上爻在上</p></div></div></section>';
}
function hexagramView(item) {
  const lines = Array.from({ length: 6 }, (_, i) => (item.mask >> i) & 1 ? 7 : 8);
  return '<div class="hexagram-card"><span class="eyebrow">' + e(item.position) + ' · 第 ' + item.number + ' 卦</span>' +
    '<div role="img" aria-label="' + e(item.name + '卦，上' + item.upper.name + '下' + item.lower.name) + '">' + lineDiagram(lines) +
    '</div><h3>' + e(item.name) + '</h3><p>' + e(item.upper.image + '上' + item.lower.image + '下') +
    '<span class="muted"> · ' + e(item.theme) + '</span></p></div>';
}
function interpretationView(value, reading) {
  const map = new Map(evidenceFor(reading).map(item => [item.reference, item]));
  return '<p class="summary-text">' + e(value.summary) + '</p><div class="insights">' +
    value.insights.map(item => '<section class="insight"><p class="insight-reference">' + e(map.get(item.reference)?.position) +
      ' · ' + e(map.get(item.reference)?.name) + '</p><p>' + e(item.text) + '</p></section>').join('') +
    '</div><section class="action-section"><h3>可以尝试</h3><ol>' + value.actions.map(item => '<li>' + e(item) + '</li>').join('') +
    '</ol></section><div class="reflection"><span class="eyebrow">留给自己一个问题</span><p>' + e(value.reflection) + '</p></div>';
}
function resultView() {
  const reading = state.reading, evidence = evidenceFor(reading), basic = basicInterpretation(reading);
  const hex = reading.kind === 'iching' ? analyseLines(reading.lines) : null;
  return '<section class="result-section"><div class="result-top"><div><p class="eyebrow">A NEW PERSPECTIVE</p><h1>你的照见时刻。</h1></div>' +
    '<button class="secondary compact" data-action="home">新的探索</button></div><p class="result-question">' + e(reading.question) + '</p>' +
    '<div class="result-layout"><aside class="result-evidence" aria-label="本次固定结果">' +
    (reading.kind === 'tarot' ? '<div class="result-cards ' + (evidence.length === 1 ? 'single-result' : '') + '">' +
      evidence.map(card => '<div class="result-card"><p class="position-label">' + e(card.position) + '</p>' + cardFace(card) +
        '<p class="orientation">' + (card.reversed ? '逆位' : '正位') + '</p><p class="keywords">' + e(card.keywords.join(' · ')) + '</p></div>').join('') +
      '</div>' : '<div class="result-hexagrams">' + evidence.map(hexagramView).join('') +
      '</div><div class="moving-note"><strong>' + (hex.moving.length ? '动爻：第 ' + hex.moving.join('、') + ' 爻' : '无动爻') +
      '</strong><p class="muted">六爻从下到上：' + reading.lines.join(' · ') + '</p>' +
      (hex.moving.length ? '<div role="img" aria-label="' + e('本卦六爻，动爻为第 ' + hex.moving.join('、') + ' 爻') + '">' +
        lineDiagram(reading.lines) + '</div>' : '') + '</div>') +
    '<div class="reading-meta"><span>' + e(new Date(reading.createdAt).toLocaleString('zh-CN')) +
    '</span><button class="text-button" data-action="copy">复制解读</button></div>' +
    '<p class="panel-note">' + (state.storageOK && history.some(item => item.reading.id === reading.id) ? '已保存在本机最近十次记录中。' : '这次结果未保存在本机，可以复制留存。') +
    '</p></aside><div class="result-reading"><div class="reading-heading"><h2>' + (state.ai ? 'AI 解读' : '基础解读') +
    '</h2><span class="source-badge">' + (state.ai ? '依据本次结果' : '象征与反思') + '</span></div>' +
    interpretationView(state.ai || basic, reading) +
    '<div class="ai-panel"><button class="primary full" id="ai-button" data-action="ai" ' +
      (state.aiBusy || !state.aiEnabled ? 'disabled' : '') + (state.aiBusy ? ' aria-busy="true"' : '') + '>' +
      (state.aiBusy ? '正在整理你的解读…' : state.aiEnabled === null ? '正在检查 AI 服务…' : !state.aiEnabled ? 'AI 解读尚未配置' : state.ai ? '重新生成 AI 解读' : '用 AI 深入解读') +
    '</button><p class="panel-note">' + (state.aiEnabled ? '问题与固定结果会发送至 AI 服务；重试沿用同一牌面或卦象。' :
      '基础解读可直接使用。') + '</p>' +
    (state.aiError ? '<p class="error-text" role="alert">' + e(state.aiError) + '</p>' : '') + '</div>' +
    (state.ai ? '<details class="basic-details"><summary>查看基础解读</summary>' + interpretationView(basic, reading) + '</details>' : '') +
    (state.followups.length ? '<section class="followup-list"><h3>继续探索</h3>' + state.followups.map(item =>
      '<article class="followup-answer"><p class="followup-question">' + e(item.question) + '</p>' +
      interpretationView(item.interpretation, reading) + '</article>').join('') + '</section>' : '') +
    (state.ai && state.aiEnabled ? '<form id="followup-form" class="followup-form"><label for="followup">关于这次结果，你还想了解什么？</label>' +
      '<textarea id="followup" name="followup" rows="2" required minlength="2" maxlength="500" placeholder="比如：我可以从哪一个小行动开始？">' + e(state.followupDraft) + '</textarea>' +
      '<button class="secondary full" type="submit" ' + (state.aiBusy ? 'disabled' : '') +
      '>继续追问</button><p class="panel-note">追问沿用本次结果。</p></form>' : '') + '</div></div></section>';
}
function render(focusMain = false) {
  const focused = document.activeElement, focusedId = focused?.id;
  const selection = focused instanceof HTMLTextAreaElement ? [focused.selectionStart, focused.selectionEnd] : null;
  app.innerHTML = state.page === 'daily' ? daily.view() : state.page === 'home' ? homeView() : state.page === 'tarot' ? tarotView() :
    state.page === 'coins' ? coinView() : resultView();
  if (focusMain) { app.focus({ preventScroll: true }); window.scrollTo({ top: 0, behavior: 'instant' }); }
  else if (focusedId) {
    const target = document.getElementById(focusedId);
    target?.focus({ preventScroll: true }); if (selection && target instanceof HTMLTextAreaElement) target.setSelectionRange(...selection);
  }
}
function flip(index) {
  const cards = evidenceFor(state.reading);
  if (!Number.isInteger(index) || !cards[index] || state.revealed.has(index)) return;
  state.revealed.add(index);
  const card = cards[index], button = app.querySelector('[data-action="flip"][data-index="' + index + '"]');
  button.classList.add('is-revealed'); button.setAttribute('aria-label', card.position + '，' + card.name + (card.reversed ? '，逆位' : '，正位'));
  button.querySelector('.card-back').setAttribute('aria-hidden', 'true');
  button.querySelector('.card-front').setAttribute('aria-hidden', 'false');
  app.querySelector('[data-orientation="' + index + '"]').textContent = card.name + ' · ' + (card.reversed ? '逆位' : '正位');
  const all = state.revealed.size === cards.length;
  document.querySelector('#view-result').disabled = !all; document.querySelector('#reveal-all').disabled = all;
  document.querySelector('#reveal-status').textContent = all ? '牌面已展开，可以查看解读。' : '已翻开 ' + state.revealed.size + ' / ' + cards.length + ' 张。';
}
function showResult() {
  state.page = 'result'; saveCurrent(); render(true);
}
async function toss() {
  if (state.coinBusy || state.lines.length >= 6) return;
  const seq = state.sequence; const line = castCoinLine(); state.coinBusy = true; render();
  await pause(600);
  if (seq !== state.sequence || state.page !== 'coins') return;
  state.coins = line.coins; state.lines.push(line.value); state.coinBusy = false; render();
}
async function requestAI(followUp = '') {
  if (state.aiBusy || !state.reading || !state.aiEnabled) return;
  const reading = state.reading, seq = state.sequence;
  state.aiBusy = true; state.aiError = ''; controller = new AbortController(); render();
  const conversation = [
    ...(state.ai ? [{ role: 'assistant', content: state.ai.summary.slice(0, 1000) }] : []),
    ...state.followups.slice(-2).flatMap(item => [
      { role: 'user', content: item.question }, { role: 'assistant', content: item.interpretation.summary.slice(0, 1000) }
    ])
  ];
  try {
    const response = await fetch('/api/interpret', {
      method: 'POST', headers: { 'content-type': 'application/json' }, signal: controller.signal,
      body: JSON.stringify({ reading, followUp, conversation })
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || '解读未完成，请稍后重试。');
    if (seq !== state.sequence || state.reading?.id !== reading.id) return;
    if (body.readingId !== reading.id || body.source !== 'ai') throw new Error('解读与本次结果不一致，请重试。');
    const interpretation = validateInterpretation(body.interpretation, reading);
    if (followUp) { state.followups = [...state.followups, { question: followUp, interpretation }].slice(-3); state.followupDraft = ''; }
    else state.ai = interpretation;
    saveCurrent();
  } catch (error) {
    if (seq !== state.sequence || error.name === 'AbortError') return;
    state.aiError = error.message || '解读未完成，请稍后重试。';
  } finally {
    if (seq === state.sequence) { state.aiBusy = false; controller = null; render(); }
  }
}
async function copy() {
  const text = readingText(state.reading, state.ai || basicInterpretation(state.reading));
  try { await navigator.clipboard.writeText(text); toast('解读已复制。'); }
  catch { const field = document.querySelector('#copy-text'); field.value = text; document.querySelector('#copy-dialog').showModal(); field.select(); }
}
function renderHistory() {
  const list = document.querySelector('#history-list');
  list.innerHTML = history.length ? history.map(item =>
    '<article class="history-item"><button class="history-open" data-history="' + e(item.reading.id) +
    '"><span class="eyebrow">' + (item.reading.kind === 'tarot' ? '塔罗' : '易经') + ' · ' +
    e(new Date(item.reading.createdAt).toLocaleDateString('zh-CN')) + '</span><strong>' +
    e(item.reading.question) + '</strong><span class="muted">' + e(evidenceFor(item.reading).map(x => x.name).join(' · ')) +
    '</span></button><button class="icon-button history-delete" data-delete="' + e(item.reading.id) +
    '" aria-label="' + e('删除记录：' + item.reading.question) + '">×</button></article>').join('') :
    '<div class="empty-history"><span aria-hidden="true">✧</span><h3>还没有记录</h3><p class="muted">完成一次探索后，可以在这里重新查看。</p></div>';
  document.querySelector('#clear-history').disabled = !history.length;
}
app.addEventListener('input', event => {
  if (event.target.id === 'question') state.question = event.target.value;
  if (event.target.id === 'followup') state.followupDraft = event.target.value;
});
app.addEventListener('change', event => {
  if (event.target.name === 'mode') { state.mode = event.target.value; render(); }
  if (event.target.name === 'spread') state.spread = event.target.value;
  if (event.target.name === 'reversed') state.reversed = event.target.checked;
});
app.addEventListener('submit', event => {
  event.preventDefault();
  if (event.target.id === 'question-form') {
    if (!event.target.reportValidity()) return;
    state.question = document.querySelector('#question').value.trim();
    if (state.question.length < 2) return;
    cancelPending(); state.ai = null; state.followups = []; state.aiError = ''; state.followupDraft = '';
    if (state.mode === 'tarot') {
      state.reading = validateReading({ version: 1, id: newReadingId(), createdAt: new Date().toISOString(),
        question: state.question, kind: 'tarot', spread: state.spread, cards: drawTarot(state.spread, state.reversed) });
      state.revealed = new Set(); state.page = 'tarot';
    } else { state.lines = []; state.coins = null; state.reading = null; state.page = 'coins'; }
    render(true);
  } else if (event.target.id === 'followup-form') {
    if (!event.target.reportValidity()) return;
    const text = document.querySelector('#followup').value.trim();
    if (text.length >= 2) requestAI(text);
  }
});
app.addEventListener('click', event => {
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled) return;
  const action = button.dataset.action;
  if (action === 'home') home();
  if (action === 'daily') daily.open();
  if (action === 'suggest') {
    state.question = { work: '面对新的工作机会，我需要看清什么？', relationship: '在这段关系里，我可以怎样更好地沟通？', self: '此刻，我最需要照顾自己的哪一部分？' }[button.dataset.topic];
    document.querySelector('#question').value = state.question; document.querySelector('#question').focus();
  }
  if (action === 'flip') flip(Number(button.dataset.index));
  if (action === 'flip-all') evidenceFor(state.reading).forEach((_, i) => flip(i));
  if (action === 'result' && state.revealed.size === state.reading.cards.length) showResult();
  if (action === 'toss') toss();
  if (action === 'coin-result' && state.lines.length === 6) {
    state.reading = validateReading({ version: 1, id: newReadingId(), createdAt: new Date().toISOString(),
      question: state.question, kind: 'iching', lines: [...state.lines] }); showResult();
  }
  if (action === 'ai') requestAI();
  if (action === 'copy') copy();
});
const daily = createDailyExperience({
  mount: app, renderCard: cardFace, toast,
  onShow: () => { cancelPending(); state.page = 'daily'; render(true); },
  onRender: () => { if (state.page === 'daily') render(); },
  onInterpret: reading => {
    cancelPending(); state.reading = structuredClone(reading); state.ai = null; state.followups = [];
    state.aiError = ''; state.followupDraft = ''; showResult();
  }
});
document.querySelector('#daily-button').addEventListener('click', () => daily.open());
document.querySelector('#home-button').addEventListener('click', home);
document.querySelector('#about-button').addEventListener('click', () => document.querySelector('#about-dialog').showModal());
document.querySelector('#history-button').addEventListener('click', () => { renderHistory(); document.querySelector('#history-dialog').showModal(); });
document.querySelector('#clear-history').addEventListener('click', () => {
  cancelPending(); history = []; persist(); renderHistory(); if (state.page === 'result') render(); toast('本机记录已清空。');
});
document.addEventListener('click', event => {
  const close = event.target.closest('[data-close]');
  if (close) document.getElementById(close.dataset.close).close();
  const open = event.target.closest('[data-history]');
  if (open) {
    const item = history.find(x => x.reading.id === open.dataset.history); if (!item) return;
    cancelPending(); state.reading = structuredClone(item.reading); state.ai = structuredClone(item.ai);
    state.followups = structuredClone(item.followups); state.aiError = ''; state.followupDraft = ''; state.page = 'result';
    document.querySelector('#history-dialog').close(); render(true);
  }
  const remove = event.target.closest('[data-delete]');
  if (remove) {
    if (state.reading?.id === remove.dataset.delete) cancelPending();
    history = history.filter(x => x.reading.id !== remove.dataset.delete); persist(); renderHistory();
    if (state.page === 'result') render();
  }
});
render();
fetch('/api/config').then(response => response.ok ? response.json() : Promise.reject()).then(body => {
  state.aiEnabled = body.aiEnabled === true; if (state.page === 'result') render();
}).catch(() => { state.aiEnabled = false; if (state.page === 'result') render(); });
