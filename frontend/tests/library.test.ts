import test from 'node:test';
import assert from 'node:assert/strict';
import {TAROT_LIBRARY,HEXAGRAM_LIBRARY} from '../../packages/domain/index.js';
import {filterCards,filterHexagrams,libraryTab,tabQuery,suits} from '../src/library/library.ts';

test('library preserves all142canonical records, suit grouping and original search fields',()=>{
 assert.deepEqual(filterCards('', 'all'),TAROT_LIBRARY);assert.equal(filterCards('','all').length,78);
 assert.deepEqual(filterHexagrams(''),HEXAGRAM_LIBRARY);assert.equal(filterHexagrams('').length,64);
 assert.deepEqual(suits,Array.from(new Set(TAROT_LIBRARY.map(card=>card.suit??'major'))));
 for(const suit of suits)assert.deepEqual(filterCards(' ',suit),TAROT_LIBRARY.filter(card=>(card.suit??'major')===suit));
 for(const card of TAROT_LIBRARY)for(const query of [card.name,card.en.toUpperCase(),card.description,...card.upright,...card.reversed])assert.ok(filterCards(' '+query+' ','all').some(item=>item.id===card.id));
 for(const hex of HEXAGRAM_LIBRARY)for(const query of [hex.name,String(hex.number),hex.theme,hex.description,...hex.keywords,hex.lower.name,hex.upper.name])assert.ok(filterHexagrams(' '+query+' ').some(item=>item.number===hex.number));
 assert.deepEqual(filterCards('synthetic-no-match-173','all'),[]);assert.deepEqual(filterHexagrams('synthetic-no-match-173'),[]);
});
test('tab query preserves unrelated and duplicate URL values and defaults exactly like the old page',()=>{
 for(const query of ['', 'tab=tarot','tab=ICHING','tab=bad'])assert.equal(libraryTab(query),'tarot');
 assert.equal(libraryTab('tab=iching&tab=tarot'),'iching');
 const next=tabQuery('keep=a&keep=b&tab=tarot','iching');assert.equal(next,'keep=a&keep=b&tab=iching');assert.equal(libraryTab(next),'iching');
});
