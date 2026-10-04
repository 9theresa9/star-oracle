import test from 'node:test';
import assert from 'node:assert/strict';
import { QueryClient } from '@tanstack/react-query';
import { patchLoadedPages,captureOwner,patchPrivatePages } from '../apps/web/src/lib/personal-cache.ts';

const fixture=()=>({pages:[{items:[{id:'one',metadataVersion:1,note:'old',interpretation:{summary:'keep AI'}}],nextCursor:'cursor-one'},{items:[{id:'two',metadataVersion:1,note:''}],nextCursor:null}],pageParams:[null,'cursor-one']});
test('confirmed record patch preserves page cursors, other pages and AI',()=>{
 const before=fixture(),after=patchLoadedPages(before,'one',row=>({...row,note:'saved',metadataVersion:2}));
 assert.notEqual(after,before);assert.equal(after.pageParams,before.pageParams);assert.equal(after.pages[1],before.pages[1]);
 assert.equal(after.pages[0].nextCursor,'cursor-one');assert.equal(after.pages[0].items[0].interpretation,before.pages[0].items[0].interpretation);
 assert.equal(after.pages[0].items[0].note,'saved');
});
test('older versions, missing records and absent data remain unchanged',()=>{
 const data=fixture();
 assert.equal(patchLoadedPages(data,'one',row=>row.metadataVersion>0?row:{...row,note:'stale'}),data);
 assert.equal(patchLoadedPages(data,'absent',row=>({...row,note:'absent'})),data);
 assert.equal(patchLoadedPages(undefined,'one',row=>row),undefined);
});
test('account changes and cache clear cannot recreate private pages',async()=>{
 const client=new QueryClient();
 try{
  client.setQueryData(['me'],{id:'owner'});
  client.setQueryData(['history','owner',{}],fixture());
  const token=captureOwner(client,'owner');
  client.setQueryData(['me'],{id:'other'});
  assert.equal(await patchPrivatePages(client,token,'history','one',row=>({...row,note:'private'})),false);
  client.setQueryData(['me'],{id:'owner'});const second=captureOwner(client,'owner');
  client.cancelQueries=async()=>{client.clear();client.setQueryData(['me'],{id:'owner'});};
  assert.equal(await patchPrivatePages(client,second,'history','one',row=>({...row,note:'private'})),false);
  assert.equal(client.getQueryData(['history','owner',{}]),undefined);
 }finally{client.clear();}
});
test('cancelled older GET cannot overwrite confirmed private edits',async()=>{
 const client=new QueryClient(),key=['history','owner',{}],before=fixture();
 try{
  client.setQueryData(['me'],{id:'owner'});client.setQueryData(key,before);
  let finish,aborted=false,started;
  const ready=new Promise(resolve=>{started=resolve;});
  const reading=client.fetchQuery({queryKey:key,staleTime:0,queryFn:({signal})=>new Promise(resolve=>{
   finish=resolve;signal.addEventListener('abort',()=>{aborted=true;},{once:true});started();
  })}).catch(()=>{});
  await ready;
  assert.equal(await patchPrivatePages(client,captureOwner(client,'owner'),'history','one',row=>({...row,note:'confirmed',metadataVersion:2})),true);
  assert.equal(aborted,true);finish(before);await reading;
  assert.equal(client.getQueryData(key).pages[0].items[0].note,'confirmed');
 }finally{client.clear();}
});
