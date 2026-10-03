import test from 'node:test';
import assert from 'node:assert/strict';
import { SPREADS, SCENARIOS, TAROT_LIBRARY, HEXAGRAM_LIBRARY, TUTORIALS,
  drawTarot, validateReading, evidenceFor, basicInterpretation, validateInterpretation,
  validateInterpretationForEvidence, castNumberLines, castTimeLines, analyseLines } from '../packages/domain/index.js';

const base = { version: 1, id: 'reading-expanded-001', createdAt: '2026-10-03T00:00:00Z', question: '面对这件事，我可以如何准备下一步？' };
const toReading = cast => ({ ...base, kind: 'iching', lines: cast.lines, method: cast.method, casting: cast.inputs });

test('32 explicit layouts preserve old records and produce exactly their positional evidence', () => {
  assert.equal(Object.keys(SPREADS).length, 32);
  assert.deepEqual(SPREADS.single.positions, ['此刻的焦点']);
  assert.deepEqual(SPREADS.three.positions, ['当前情境', '需要留意', '可以尝试的行动']);
  for (const [spread, layout] of Object.entries(SPREADS)) {
    assert.ok(layout.description && layout.category);
    assert.equal(new Set(layout.positions).size, layout.positions.length);
    const cards = drawTarot(spread, false, () => 0);
    const reading = validateReading({ ...base, kind: 'tarot', scenario: 'growth', spread, cards });
    assert.equal(cards.length, layout.positions.length);
    assert.equal(new Set(cards.map(c => c.id)).size, cards.length);
    assert.ok(cards.every(c => !c.reversed));
    assert.deepEqual(evidenceFor(reading).map(e => e.position), layout.positions);
    assert.deepEqual(validateInterpretation(basicInterpretation(reading), reading), basicInterpretation(reading));
  }
  assert.throws(() => validateReading({ ...base, kind: 'tarot', spread: '__proto__', cards: [] }));
});

test('scenario recommendations, 78 unique card guides, 64 ordered hexagram guides and tutorials are complete', () => {
  assert.equal(SCENARIOS.length, 15);
  assert.equal(new Set(SCENARIOS.map(s => s.id)).size, 15);
  for (const scenario of SCENARIOS) {
    assert.ok(scenario.prompts.length >= 2);
    assert.ok(scenario.recommendedSpreads.every(id => Object.hasOwn(SPREADS, id)));
  }
  assert.equal(TAROT_LIBRARY.length, 78);
  assert.equal(new Set(TAROT_LIBRARY.map(c => c.id)).size, 78);
  for (const card of TAROT_LIBRARY) {
    for (const key of ['description', 'uprightMeaning', 'reversedMeaning', 'reflection', 'practice', 'symbolism', 'element']) assert.ok(card[key], card.id + ' ' + key);
  }
  assert.equal(HEXAGRAM_LIBRARY.length, 64);
  assert.deepEqual(HEXAGRAM_LIBRARY.map(h => h.number), Array.from({ length: 64 }, (_, i) => i + 1));
  assert.equal(new Set(HEXAGRAM_LIBRARY.map(h => h.description)).size, 64);
  assert.equal(TUTORIALS.length, 10);
  assert.ok(TUTORIALS.every(t => t.steps.length >= 4));
  assert.throws(() => SPREADS.single.positions.push('新增'));
});

test('number convention uses early-heaven upper/lower order, zero remainders and one moving line', () => {
  assert.deepEqual(castNumberLines([1, 1, 1]).lines, [9, 7, 7, 7, 7, 7]);
  assert.deepEqual(castNumberLines([8, 8, 6]).lines, [8, 8, 8, 8, 8, 6]);
  const masks = [7, 3, 5, 1, 6, 2, 4, 0];
  for (let upper = 1; upper <= 8; upper++) for (let lower = 1; lower <= 8; lower++) for (let moving = 1; moving <= 6; moving++) {
    const result = analyseLines(castNumberLines([upper, lower, moving]).lines);
    assert.equal(result.original.mask, (masks[upper - 1] << 3) | masks[lower - 1]);
    assert.deepEqual(result.moving, [moving]);
  }
  for (const bad of [[0, 1, 1], [-1, 2, 3], [1.5, 2, 3], [1, 2], [1, 2, NaN], [1000000001, 1, 1]]) assert.throws(() => castNumberLines(bad));
});

test('time casting is timezone explicit, reproducible and rejects impossible solar dates', () => {
  const cast = castTimeLines('2026-10-03T00:00:00Z');
  assert.deepEqual(cast.lines, [7, 8, 8, 6, 8, 7]);
  assert.deepEqual(castTimeLines('2026-10-03T08:00:00+08:00'), cast);
  assert.deepEqual(castTimeLines('2026-10-03T00:00:00Z', 'UTC').lines, [8, 8, 8, 8, 8, 9]);
  assert.notDeepEqual(castTimeLines('2026-10-03T00:00:00Z', 'UTC').lines, cast.lines);
  for (const bad of ['2026-02-30T00:00:00Z', '2026-10-03T24:00:00Z', '2026-10-03T00:00:00', 'invalid']) assert.throws(() => castTimeLines(bad));
  assert.throws(() => castTimeLines('2026-10-03T00:00:00Z', 'fake/timezone'));
  assert.doesNotThrow(() => castTimeLines('2024-02-29T00:00:00Z'));
});

test('old coin archives remain valid, and new casting metadata cannot contradict the result', () => {
  const old = { ...base, kind: 'iching', lines: [7, 8, 7, 8, 7, 8] };
  assert.deepEqual(validateReading(old), { ...old, question: base.question, createdAt: '2026-10-03T00:00:00.000Z' });
  for (const cast of [castNumberLines([5, 6, 7]), castTimeLines('2026-10-03T00:00:00Z')]) {
    const reading = toReading(cast);
    assert.deepEqual(validateReading(reading).casting, cast.inputs);
    const bad = structuredClone(reading); bad.lines[0] = bad.lines[0] % 2 ? 8 : 7;
    assert.throws(() => validateReading(bad));
  }
  assert.throws(() => validateReading({ ...old, method: 'unknown' }));
  assert.throws(() => validateReading({ ...old, method: 'numbers' }));
  assert.throws(() => validateReading({ ...old, casting: { numbers: [1, 1, 1] } }));
  assert.throws(() => validateReading({ ...old, scenario: 'fake' }));
});

test('all 64 related structures obey mutual extraction and opposite/reversal involutions', () => {
  for (let mask = 0; mask < 64; mask++) {
    const lines = Array.from({ length: 6 }, (_, i) => (mask >> i) & 1 ? 7 : 8);
    const result = analyseLines(lines);
    assert.equal(result.mutual.mask, ((mask >> 1) & 7) | (((mask >> 2) & 7) << 3));
    assert.equal(result.opposite.mask, mask ^ 63);
    const reverseLines = Array.from({ length: 6 }, (_, i) => (result.reversed.mask >> i) & 1 ? 7 : 8);
    assert.equal(analyseLines(reverseLines).reversed.mask, mask);
    assert.equal(analyseLines(lines.map(v => v === 7 ? 8 : 7)).opposite.mask, mask);
  }
  const tai = analyseLines([7, 7, 7, 8, 8, 8]);
  assert.equal(tai.original.number, 11); assert.equal(tai.reversed.number, 12); assert.equal(tai.mutual.number, 54);
  // Derived structures are context, not extra randomly drawn AI references.
  assert.deepEqual(evidenceFor({ ...base, kind: 'iching', lines: [7, 7, 7, 8, 8, 8] }).map(e => e.reference), ['hexagram:11']);
});

test('general AI evidence validation requires exact nonduplicated coverage', () => {
  const evidence = [{ reference: 'turn:1', name: '一次观察', position: '观察' }, { reference: 'turn:2', name: '一次回应', position: '回应' }];
  const good = { summary: '可结合事实继续观察。', insights: evidence.map(e => ({ reference: e.reference, text: '核对实际条件。' })), actions: ['收集事实。', '复盘行动。'], reflection: '下一步需要确认什么？' };
  assert.deepEqual(validateInterpretationForEvidence(good, evidence), good);
  assert.throws(() => validateInterpretationForEvidence({ ...good, insights: good.insights.slice(0, 1) }, evidence));
  assert.throws(() => validateInterpretationForEvidence({ ...good, insights: [good.insights[0], good.insights[0]] }, evidence));
  assert.throws(() => validateInterpretationForEvidence({ ...good, insights: [{ reference: 'foreign', text: '错误。' }, good.insights[1]] }, evidence));
  assert.throws(() => validateInterpretationForEvidence(good, [evidence[0], evidence[0]]));
  assert.throws(() => validateInterpretationForEvidence({ ...good, summary: 'a'.repeat(1601) }, evidence));
});
