import { evidenceFor } from '/shared/engine.js';
import { createDailyStore, dailyMessage, DAILY_MOODS, DAILY_STORAGE_KEY } from '/shared/daily.js';

export function createDailyExperience({ mount, renderCard, toast, onShow, onRender, onInterpret }) {
  const escapeDaily = value => String(value ?? '').replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = createDailyStore({ storage: {
    getItem: key => localStorage.getItem(key),
    setItem: (key, value) => localStorage.setItem(key, value)
  } });
  const dialog = document.querySelector('#daily-journal-dialog');
  let selectedDate = null, animatedDate = null, busy = false, lastDate = store.today(), renderedDate = lastDate;
  const drafts = new Map();
  const activeDate = () => selectedDate || store.today();
  const dateLabel = key => {
    const [year, month, day] = key.split('-').map(Number);
    return new Date(year, month - 1, day).toLocaleDateString('zh-CN',
      { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
  };
  function draftFor(entry) {
    if (!drafts.has(entry.date)) drafts.set(entry.date, { mood: entry.mood, note: entry.note, dirty: false });
    return drafts.get(entry.date);
  }
  function withLock(task) {
    return navigator.locks?.request ? navigator.locks.request('star-oracle.daily.v1', task) : Promise.resolve().then(task);
  }
  function cardMarkup(entry) {
    const card = entry ? evidenceFor(entry.reading)[0] :
      { reference: 'major-star', mark: 'XVII', name: '星星', english: 'THE STAR', reversed: false };
    return '<button type="button" id="daily-card" class="flip-card daily-card ' +
      (entry ? 'is-revealed ' : '') + (animatedDate === entry?.date ? 'daily-flipping' : '') +
      '" data-daily="draw" ' + (entry || busy ? 'disabled' : '') +
      ' aria-label="' + escapeDaily(entry ? dateLabel(entry.date) + '，' + card.name + '，正位' : '翻开今日星笺') +
      '"><span class="card-inner"><span class="card-back" aria-hidden="' + !!entry +
      '"><span class="daily-back-stars" aria-hidden="true">· ✧ ·</span><span class="back-orbit">✧</span>' +
      '<span class="back-word">照见</span><span class="back-caption">A LITTLE LIGHT, EVERY DAY</span></span>' +
      '<span class="card-front" aria-hidden="' + !entry + '">' + renderCard(card) + '</span></span></button>';
  }
  function view() {
    const date = activeDate(), entry = store.get(date), today = date === store.today();
    renderedDate = date;
    const card = entry ? evidenceFor(entry.reading)[0] : null;
    const message = card ? dailyMessage(card.reference) : null, draft = entry ? draftFor(entry) : null;
    return '<section class="daily-section"><div class="daily-topline"><span class="eyebrow">DAILY LETTER · 每日星笺</span>' +
      '<button class="text-button" id="daily-journal-button" data-daily="journal">星笺日记 <span aria-hidden="true">↗</span></button></div>' +
      '<header class="daily-heading"><p class="daily-date">' + escapeDaily(dateLabel(date)) + '</p><h1>' +
      (today ? '给今天，<span>留一点光。</span>' : '回看那天，<span>也看见自己。</span>') +
      '</h1><p class="muted">' + (today ? '一张牌，一个提醒。一件可以为自己做的小事。' : '当时的牌面和文字仍在这里，你可以继续写下新的感受。') +
      '</p></header><div class="daily-stage ' + (entry ? 'daily-has-letter' : '') + '">' +
      '<aside class="daily-visual"><div class="daily-aura" aria-hidden="true"></div><span class="daily-spark spark-one" aria-hidden="true">✧</span>' +
      '<span class="daily-spark spark-two" aria-hidden="true">·</span>' + cardMarkup(entry) +
      '<p class="daily-card-caption">' + (card ? escapeDaily(card.name + ' · ' + card.keywords.join(' · ')) : '轻触卡片，让今天的提醒展开') +
      '</p><p class="daily-edition">照见 · DAILY LETTER</p></aside><div class="daily-letter" id="daily-letter">' +
      (message ? '<div class="daily-letter-content"><span class="eyebrow">给自己的小小来信</span><h2 id="daily-message-title" tabindex="-1">' +
        escapeDaily(message.title) + '</h2><p class="daily-message">' + escapeDaily(message.text) +
        '</p><section class="daily-action"><span class="daily-action-symbol" aria-hidden="true">✦</span><div><h3>今天可以做的一件小事</h3><p>' +
        escapeDaily(message.action) + '</p></div></section><div class="daily-reflection"><span class="eyebrow">留给自己一个问题</span><p>' +
        escapeDaily(message.reflection) + '</p></div><div class="daily-letter-actions"><button class="text-button" data-daily="copy">复制星笺</button>' +
        '<button class="text-button" data-daily="interpret">继续探索这张牌 <span aria-hidden="true">→</span></button></div></div>' :
        '<div class="daily-invitation"><span class="eyebrow">A SMALL MOMENT, JUST FOR YOU</span><h2>先把这一刻，<br>留给自己。</h2>' +
        '<p class="muted">不用先想好问题。<br>安静一下，看看今天想带走什么。</p>' +
        '<button class="primary daily-draw-button" data-daily="draw" ' + (busy ? 'disabled aria-busy="true"' : '') +
        '>' + (busy ? '正在展开…' : '领取今日星笺') + '</button><p class="panel-note">每天一张 · 当天再次打开，保留同一张牌</p></div>') +
      '</div></div>' +
      (entry ? '<section class="daily-journal-editor" aria-labelledby="daily-note-title"><div class="daily-editor-head"><div><span class="eyebrow">A MOMENT TO KEEP</span>' +
        '<h2 id="daily-note-title">把此刻，轻轻记下来。</h2><p class="muted">不用写很多，一句话也可以。</p></div><span class="daily-note-mark" aria-hidden="true">✎</span></div>' +
        '<form id="daily-note-form"><fieldset class="daily-moods"><legend>现在的心情</legend>' +
        DAILY_MOODS.map(mood => '<label class="daily-mood"><input type="radio" name="daily-mood" value="' + mood.id +
          '" ' + (draft.mood === mood.id ? 'checked' : '') + '><span><i aria-hidden="true">' + mood.symbol +
          '</i>' + mood.label + '</span></label>').join('') +
        '</fieldset><label class="daily-note-label" for="daily-note">今天想留住的一句话</label><textarea id="daily-note" rows="3" maxlength="600" placeholder="此刻的感受、今天想做的小事，或者想对自己说的话…">' +
        escapeDaily(draft.note) + '</textarea><div class="daily-editor-bottom"><p id="daily-save-status" role="status">' +
        (draft.dirty ? '有尚未保存的修改' : entry.note || entry.mood ? '已保存这份心情' : '只留给自己，在这个浏览器里') +
        '</p><span id="daily-note-count" class="muted">' + draft.note.length + ' / 600</span><button class="secondary compact" type="submit">保存这份心情</button></div></form></section>' : '') +
      '<div class="daily-bottom"><p>' + (store.isPersistent() ?
        '星笺按设备本地日期更新，留存最近 90 张。清除浏览器数据会重置；记录不会跨设备同步。' :
        '浏览器暂时无法保存：这次星笺仅在当前页面保留，请复制留存。') +
      '</p><p>短句来自牌面象征与编辑提示，可作为今天的反思角度。</p>' +
      (!today ? '<button class="secondary compact" data-daily="today">回到今日星笺</button>' : '') + '</div></section>';
  }
  function open(date = null) { selectedDate = date; animatedDate = null; onShow(); }
  async function draw() {
    if (busy || selectedDate || store.get()) return;
    busy = true; onRender();
    try {
      const entry = await withLock(() => store.ensureToday());
      animatedDate = entry.date; lastDate = store.today(); onRender();
      mount.querySelector('#daily-message-title')?.focus({ preventScroll: true });
      if (!store.isPersistent()) toast('这次星笺暂时无法保存，请复制留存。');
    } catch { toast('星笺暂时未能展开，请稍后重试。'); }
    finally { busy = false; if (!store.get(activeDate())) onRender(); }
  }
  function renderJournal() {
    const entries = store.entries();
    document.querySelector('#daily-journal-list').innerHTML = entries.length ? entries.map(entry => {
      const card = evidenceFor(entry.reading)[0], mood = DAILY_MOODS.find(item => item.id === entry.mood);
      return '<article class="daily-history-item"><button class="daily-history-open" data-daily="open-entry" data-date="' +
        entry.date + '"><span class="eyebrow">' + escapeDaily(dateLabel(entry.date)) +
        '</span><strong>' + escapeDaily(card.name) + '</strong><span class="daily-history-note">' +
        escapeDaily(entry.note || '还没写下感受，随时可以回来。') + '</span>' +
        (mood ? '<span class="daily-history-mood">' + escapeDaily(mood.symbol + ' ' + mood.label) + '</span>' : '') +
        '</button>' + (entry.note || entry.mood ? '<button class="icon-button" data-daily="delete-note" data-date="' + entry.date +
        '" aria-label="' + escapeDaily('清除 ' + entry.date + ' 的日记，保留牌面') + '">×</button>' : '') + '</article>';
    }).join('') : '<div class="empty-history"><span aria-hidden="true">✧</span><h3>这里会慢慢装下你的日子</h3><p class="muted">领取一张星笺，就可以开始记录。</p></div>';
    document.querySelector('#daily-clear-journal').disabled = !entries.some(entry => entry.note || entry.mood);
  }
  async function save(event) {
    if (event.target.id !== 'daily-note-form') return;
    event.preventDefault();
    const date = renderedDate, entry = store.get(date); if (!entry) return;
    const draft = draftFor(entry);
    if (!draft.mood && !draft.note.trim()) { toast('选一个心情，或写下一句话。'); return; }
    try {
      const saved = await withLock(() => store.saveJournal(date, draft));
      drafts.set(date, { mood: saved.mood, note: saved.note, dirty: false });
      animatedDate = null; onRender();
      toast(store.isPersistent() ? '这份心情，已经替你收好。' : '浏览器暂时无法保存，请复制留存。');
    } catch (error) { toast(error.message); }
  }
  mount.addEventListener('submit', save);
  mount.addEventListener('input', event => {
    if (event.target.id !== 'daily-note') return;
    const entry = store.get(renderedDate); if (!entry) return;
    const draft = draftFor(entry); draft.note = event.target.value; draft.dirty = true;
    mount.querySelector('#daily-note-count').textContent = draft.note.length + ' / 600';
    mount.querySelector('#daily-save-status').textContent = '有尚未保存的修改';
  });
  mount.addEventListener('change', event => {
    if (event.target.name !== 'daily-mood') return;
    const entry = store.get(renderedDate); if (!entry) return;
    const draft = draftFor(entry); draft.mood = event.target.value; draft.dirty = true;
    mount.querySelector('#daily-save-status').textContent = '有尚未保存的修改';
  });
  document.addEventListener('click', async event => {
    const button = event.target.closest('[data-daily]'); if (!button || button.disabled) return;
    const action = button.dataset.daily, date = button.dataset.date;
    if (action === 'draw') await draw();
    if (action === 'journal') { renderJournal(); dialog.showModal(); }
    if (action === 'open-entry') { if (!store.get(date)) return; dialog.close(); open(date === store.today() ? null : date); }
    if (action === 'today') open();
    if (action === 'interpret') {
      const entry = store.get(renderedDate); if (entry) onInterpret(entry.reading);
    }
    if (action === 'copy') {
      const entry = store.get(renderedDate); if (!entry) return;
      const card = evidenceFor(entry.reading)[0], message = dailyMessage(card.reference), draft = draftFor(entry);
      const mood = DAILY_MOODS.find(item => item.id === draft.mood);
      const text = ['照见 · 每日星笺', dateLabel(entry.date), card.name + ' · 正位', message.title, message.text,
        '今天可以做的一件小事：' + message.action, message.reflection,
        ...(mood ? ['此刻心情：' + mood.label] : []), ...(draft.note.trim() ? ['留给自己的话：' + draft.note.trim()] : [])].join('\n\n');
      try { await navigator.clipboard.writeText(text); toast('星笺已复制。'); }
      catch {
        const field = document.querySelector('#copy-text'); field.value = text;
        document.querySelector('#copy-dialog').showModal(); field.select();
      }
    }
    if (action === 'delete-note') {
      try { await withLock(() => store.clearJournal(date)); drafts.delete(date); animatedDate = null;
        renderJournal(); onRender(); toast(store.isPersistent() ? '日记已清除，这一天的牌面保留。' : '浏览器暂时无法保存这次修改。'); }
      catch (error) { toast(error.message); }
    }
    if (action === 'clear-notes' && confirm('清空已保存的心情和日记？每天的牌面会保留。')) {
      try {
        await withLock(() => store.clearAllJournals()); drafts.clear(); animatedDate = null;
        renderJournal(); onRender(); toast(store.isPersistent() ? '日记已清空，星笺牌面保留。' : '浏览器暂时无法保存这次修改。');
      } catch { toast('日记暂时未能清空，请稍后重试。'); }
    }
  });
  function sync() {
    const date = store.today();
    if (date !== lastDate) {
      lastDate = date; animatedDate = null; onRender();
      if (!selectedDate && mount.querySelector('.daily-section')) toast('新的一天到了，可以领取新的星笺。');
    }
  }
  window.addEventListener('focus', sync);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });
  // Recheck local date after midnight and timezone changes without a long-running animation.
  setInterval(() => { if (!document.hidden) sync(); }, 30000);
  window.addEventListener('storage', event => {
    if (event.key !== DAILY_STORAGE_KEY && event.key !== null) return;
    for (const [date, draft] of drafts) { if (!draft.dirty) drafts.delete(date); }
    animatedDate = null; onRender(); if (dialog.open) renderJournal();
  });
  return { view, open };
}
