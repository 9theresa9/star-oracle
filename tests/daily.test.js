import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { TAROT_DECK } from '../packages/domain/engine.js';
import { createDailyStore, dailyMessage, localDateKey, validateDailyEntry, DAILY_STORAGE_KEY } from '../packages/domain/daily.js';

function memoryStorage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}
test('calendar dates follow device timezone rather than UTC', () => {
  const script = "import { localDateKey } from './packages/domain/daily.js'; console.log(localDateKey(new Date('2026-10-02T16:05:00Z')));";
  const run = TZ => execFileSync(process.execPath, ['--input-type=module', '-e', script],
    { encoding: 'utf8', env: { ...process.env, TZ } }).trim();
  assert.equal(run('Asia/Shanghai'), '2026-10-03');
  assert.equal(run('America/Los_Angeles'), '2026-10-02');
  assert.throws(() => localDateKey(new Date('invalid')));
});
test('one fixed card per local day survives reload and repeated draws', () => {
  const storage = memoryStorage(), now = () => new Date(2026, 9, 2, 12);
  let calls = 0;
  const first = createDailyStore({ storage, now, chooseCard: () => { calls++; return 'major-star'; } });
  const entry = first.ensureToday();
  assert.deepEqual(first.ensureToday(), entry); assert.equal(calls, 1);
  const reloaded = createDailyStore({ storage, now, chooseCard: () => { throw new Error('Must not redraw'); } });
  assert.deepEqual(reloaded.ensureToday(), entry); assert.equal(reloaded.get().reading.cards[0].reversed, false);
});
test('midnight creates a new entry and retains the previous card and diary', () => {
  const storage = memoryStorage(); let instant = new Date(2026, 9, 2, 23, 59), calls = 0;
  const store = createDailyStore({ storage, now: () => instant,
    chooseCard: () => ++calls === 1 ? 'major-star' : 'major-sun' });
  const first = store.ensureToday(); store.saveJournal(first.date, { mood: 'calm', note: '昨天的感受' });
  instant = new Date(2026, 9, 3, 0, 1); const second = store.ensureToday();
  assert.equal(second.date, '2026-10-03'); assert.equal(store.entries().length, 2); assert.equal(calls, 2);
  assert.deepEqual(store.get(first.date).reading, first.reading);
  assert.equal(store.get(first.date).note, '昨天的感受');
  store.saveJournal(first.date, { mood: 'hopeful', note: '回看昨天' });
  assert.equal(store.entries()[0].date, second.date);
});
test('clearing individual and all diaries preserves daily draw locks', () => {
  const storage = memoryStorage(), now = () => new Date(2026, 9, 2);
  const store = createDailyStore({ storage, now, chooseCard: () => 'major-moon' });
  const first = store.ensureToday();
  store.saveJournal(first.date, { mood: 'tired', note: '  给自己休息  ' });
  assert.equal(store.get().note, '给自己休息');
  store.clearJournal(first.date); assert.deepEqual(store.ensureToday().reading, first.reading);
  store.saveJournal(first.date, { mood: 'calm', note: '第二次记录' });
  store.clearAllJournals(); assert.equal(store.get().note, ''); assert.equal(store.get().mood, null);
  assert.deepEqual(store.ensureToday().reading, first.reading);
});
test('stale tabs reread the same persisted card before drawing', () => {
  const storage = memoryStorage(), now = () => new Date(2026, 9, 2);
  const a = createDailyStore({ storage, now, chooseCard: () => 'major-star' });
  const b = createDailyStore({ storage, now, chooseCard: () => 'major-sun' });
  assert.equal(b.get(), null);
  const entry = a.ensureToday(); assert.deepEqual(b.ensureToday(), entry);
});
test('storage failures keep the card in memory and expose persistence status', () => {
  let calls = 0;
  const storage = { getItem: () => null, setItem: () => { throw new Error('Quota exceeded'); } };
  const store = createDailyStore({ storage, now: () => new Date(2026, 9, 2),
    chooseCard: () => { calls++; return 'major-star'; } });
  const entry = store.ensureToday(); assert.equal(store.isPersistent(), false);
  assert.deepEqual(store.ensureToday(), entry); assert.equal(calls, 1);
  store.saveJournal(entry.date, { mood: 'low', note: '暂存文字' });
  assert.equal(store.get().note, '暂存文字');
});
test('invalid date, mood, text or non-daily cards cannot replace a record', () => {
  const store = createDailyStore({ storage: memoryStorage(), now: () => new Date(2026, 9, 2),
    chooseCard: () => 'major-star' });
  const entry = store.ensureToday();
  for (const patch of [{ date: '2026-02-30' }, { mood: 'unknown' }, { note: 'x'.repeat(601) },
    { reading: { ...entry.reading, cards: [{ id: 'major-star', reversed: true }] } }]) {
    assert.throws(() => validateDailyEntry({ ...entry, ...patch }));
  }
  assert.throws(() => store.saveJournal(entry.date, { mood: 'unknown', note: '文本' }));
  assert.deepEqual(store.get(), entry);
  assert.throws(() => store.saveJournal('2026-10-01', { mood: null, note: '文本' }));
});
test('malformed storage and unknown cards are ignored safely', () => {
  const storage = memoryStorage(), now = () => new Date(2026, 9, 2);
  storage.setItem(DAILY_STORAGE_KEY, '{broken');
  const store = createDailyStore({ storage, now, chooseCard: () => 'major-star' });
  assert.deepEqual(store.entries(), []); const entry = store.ensureToday();
  storage.setItem(DAILY_STORAGE_KEY, JSON.stringify([{ ...entry, reading: {
    ...entry.reading, cards: [{ id: 'unknown', reversed: false }] } }, entry, entry, null]));
  assert.deepEqual(store.entries(), [entry]);
});
test('the newest 90 dates are retained, including after editing an old note', () => {
  let instant = new Date(2026, 0, 1);
  const store = createDailyStore({ storage: memoryStorage(), now: () => instant, chooseCard: () => 'major-star' });
  for (let i = 0; i < 100; i++) { store.ensureToday(); instant = new Date(2026, 0, i + 2); }
  const entries = store.entries(); assert.equal(entries.length, 90);
  assert.equal(entries.at(-1).date, '2026-01-11');
  store.saveJournal(entries.at(-1).date, { mood: 'calm', note: '旧日回看' });
  assert.equal(store.entries().at(-1).date, '2026-01-11');
  assert.deepEqual(store.entries().map(x => x.date), entries.map(x => x.date));
});
test('all 78 cards have complete editorial daily prompts', () => {
  for (const card of TAROT_DECK) {
    const prompt = dailyMessage(card.id);
    for (const key of ['title', 'text', 'action', 'reflection']) assert.ok(prompt[key].trim().length >= 6, card.id + ': ' + key);
    assert.ok(!Object.values(prompt).some(value => value.includes('undefined')));
  }
  assert.throws(() => dailyMessage('unknown'));
});
