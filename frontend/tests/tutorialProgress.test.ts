import test from 'node:test';
import assert from 'node:assert/strict';
import {effectScope,ref} from 'vue';
import {useTutorialProgress,tutorialsFor,readProgress,type ProgressStorage} from '../src/tutorials/progress.ts';
import {TUTORIALS} from '../../packages/domain/index.js';
class MemoryStorage implements ProgressStorage {
 values=new Map<string,string>();writes:string[]=[];
 getItem(key:string){return this.values.get(key)??null;}
 setItem(key:string,value:string){this.writes.push(key);this.values.set(key,value);}
}
test('canonical ten tutorials retain forty steps and every original category',()=>{
 assert.equal(TUTORIALS.length,10);assert.equal(TUTORIALS.reduce((sum,item)=>sum+item.steps.length,0),40);
 assert.deepEqual(tutorialsFor('all'),TUTORIALS);
 for(const category of ['tarot','iching','practice'])assert.deepEqual(tutorialsFor(category),TUTORIALS.filter(item=>item.category===category));
});
test('original parser retains strings, unknown step IDs and insertion order, rejecting malformed/non-array values',()=>{
 const storage=new MemoryStorage();const key='star-oracle-tutorials-guest';
 for(const value of ['invalid','null','{}','1']){storage.values.set(key,value);assert.deepEqual([...readProgress(storage,key)],[]);}
 storage.values.set(key,JSON.stringify(['unknown',12,null,'known','known']));assert.deepEqual([...readProgress(storage,key)],['unknown','known']);
});
test('guest toggle is local, reversible and only known steps contribute to total',()=>{
 const storage=new MemoryStorage(),actor=ref<string|null>(null),scope=effectScope();
 scope.run(()=>{
  const progress=useTutorialProgress(actor,storage);const id=TUTORIALS[0]!.id+':0';
  assert.equal(progress.total,40);assert.equal(progress.done.value,0);
  progress.toggle(id);assert.equal(progress.done.value,1);assert.deepEqual(JSON.parse(storage.values.get('star-oracle-tutorials-guest')!),[id]);
  progress.toggle('unknown');assert.equal(progress.done.value,1);
  progress.toggle(id);assert.equal(progress.done.value,0);assert.deepEqual(JSON.parse(storage.values.get('star-oracle-tutorials-guest')!),['unknown']);
 });scope.stop();
});
test('actor changes synchronously reload the original namespace before another toggle',()=>{
 const storage=new MemoryStorage(),actor=ref<string|null>('alice'),scope=effectScope();const first=TUTORIALS[0]!.id+':0',second=TUTORIALS[0]!.id+':1';
 storage.values.set('star-oracle-tutorials-alice',JSON.stringify([first]));
 scope.run(()=>{
  const progress=useTutorialProgress(actor,storage);assert.equal(progress.done.value,1);
  actor.value='bob';assert.equal(progress.done.value,0);progress.toggle(second);assert.equal(progress.done.value,1);
  assert.deepEqual(JSON.parse(storage.values.get('star-oracle-tutorials-alice')!),[first]);assert.equal(storage.writes.at(-1),'star-oracle-tutorials-bob');
  actor.value=null;assert.equal(progress.done.value,0);progress.toggle(first);assert.equal(storage.writes.at(-1),'star-oracle-tutorials-guest');
  actor.value='alice';assert.deepEqual([...progress.completed.value],[first]);
 });scope.stop();
});
test('storage unavailable or throwing does not prevent in-memory learning',()=>{
 for(const storage of [null,{getItem(){throw Error('denied');},setItem(){throw Error('denied');}}]){
  const scope=effectScope();scope.run(()=>{const progress=useTutorialProgress(ref(null),storage);progress.toggle(TUTORIALS[0]!.id+':0');assert.equal(progress.done.value,1);});scope.stop();
 }
});
