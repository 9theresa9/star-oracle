import test from 'node:test';
import assert from 'node:assert/strict';
import { TAROT_DECK, randomInt, drawTarot, castCoinLine, getHexagram, analyseLines,
  validateReading, evidenceFor, basicInterpretation, validateInterpretation } from '../shared/engine.js';
const reading = () => ({ version: 1, id: 'reading-test-123', createdAt: '2026-10-02T00:00:00Z',
  question: '面对新机会，我需要留意什么？', kind: 'tarot', spread: 'three',
  cards: [{ id: 'major-star', reversed: false }, { id: 'major-strength', reversed: true },
    { id: 'major-hermit', reversed: false }] });
test('78 unique cards: 22 majors and 56 minors', () => {
  assert.equal(TAROT_DECK.length, 78); assert.equal(new Set(TAROT_DECK.map(x => x.id)).size, 78);
  assert.equal(TAROT_DECK.filter(x => x.arcana === 'major').length, 22);
  assert.equal(TAROT_DECK.filter(x => x.arcana === 'minor').length, 56);
});
test('rejection sampling discards the biased tail', () => {
  const values = [0xffffffff, 4]; assert.equal(randomInt(3, () => values.shift()), 1);
  assert.throws(() => randomInt(0)); assert.throws(() => randomInt(2, () => -1));
});
test('draws have no duplicates and honour the reversal setting', () => {
  for (let i = 0; i < 200; i++) {
    const cards = drawTarot('three', false); assert.equal(cards.length, 3);
    assert.equal(new Set(cards.map(x => x.id)).size, 3); assert.ok(cards.every(x => !x.reversed));
  }
  assert.equal(drawTarot('single', true).length, 1);
  assert.throws(() => drawTarot('unknown')); assert.throws(() => drawTarot('__proto__'));
});
test('three coins yield an exact 1:3:3:1 distribution', () => {
  const counts = { 6: 0, 7: 0, 8: 0, 9: 0 };
  for (let mask = 0; mask < 8; mask++) {
    let index = 0; counts[castCoinLine(() => (mask >> index++) & 1).value]++;
  }
  assert.deepEqual(counts, { 6: 1, 7: 3, 8: 3, 9: 1 });
});
test('King Wen fixtures establish the bottom-to-top convention', () => {
  for (const [mask, number, name] of [[63,1,'乾'],[0,2,'坤'],[7,11,'泰'],[56,12,'否'],
    [62,44,'姤'],[6,46,'升'],[21,63,'既济'],[42,64,'未济']]) {
    assert.equal(getHexagram(mask).number, number); assert.equal(getHexagram(mask).name, name);
  }
  assert.equal(new Set(Array.from({ length: 64 }, (_, i) => getHexagram(i).number)).size, 64);
});
test('moving lines invert polarity and stable lines preserve polarity', () => {
  const one = analyseLines([9,7,7,7,7,7]);
  assert.equal(one.original.number, 1); assert.equal(one.resulting.number, 44); assert.deepEqual(one.moving, [1]);
  const all = analyseLines([6,6,6,6,6,6]);
  assert.equal(all.original.number, 2); assert.equal(all.resulting.number, 1);
  assert.deepEqual(all.moving, [1,2,3,4,5,6]);
  const none = analyseLines([7,8,7,8,7,8]);
  assert.equal(none.original.number, 63); assert.equal(none.resulting.number, 63); assert.deepEqual(none.moving, []);
  assert.throws(() => analyseLines([6,7])); assert.throws(() => analyseLines([6,7,8,9,7,10]));
});
test('all 4096 six-line configurations resolve to valid hexagrams', () => {
  for (let code = 0; code < 4096; code++) {
    const result = analyseLines(Array.from({ length: 6 }, (_, i) => 6 + ((code >> (i * 2)) & 3)));
    assert.ok(result.original.number >= 1 && result.original.number <= 64);
    assert.ok(result.resulting.number >= 1 && result.resulting.number <= 64);
  }
});
test('server evidence ignores supplied names and rejects duplicate or forged cards', () => {
  const input = reading(); input.cards[0].name = '恶魔'; input.cards[0].keywords = ['一定成功'];
  assert.equal(evidenceFor(input)[0].name, '星星'); assert.ok(!evidenceFor(input)[0].keywords.includes('一定成功'));
  const duplicate = reading(); duplicate.cards[1] = duplicate.cards[0];
  assert.throws(() => validateReading(duplicate));
  const bogus = reading(); bogus.cards[0].id = 'fake';
  assert.throws(() => validateReading(bogus));
});
test('AI references match the fixed reading exactly', () => {
  const input = reading(), valid = basicInterpretation(input);
  assert.deepEqual(validateInterpretation(valid, input), valid);
  const bad = structuredClone(valid); bad.insights[0].reference = 'major-devil';
  assert.throws(() => validateInterpretation(bad, input));
  const duplicate = structuredClone(valid); duplicate.insights[1].reference = duplicate.insights[0].reference;
  assert.throws(() => validateInterpretation(duplicate, input));
});
