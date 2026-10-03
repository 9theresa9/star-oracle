import { test,before,after,beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn,type ChildProcess } from 'node:child_process';
import { createServer as httpsServer,type Server as HTTPSServer } from 'node:https';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { db,redis,seal,open,chinaDate,connectRedis } from '../src/infrastructure.js';
import { SPREADS,SCENARIOS,castNumberLines,castTimeLines,drawTarot,evidenceFor,type Reading } from '@star-oracle/domain';
import { requestModel } from '../src/model.service.js';
let child:ChildProcess,model:HTTPSServer,providerCalls=0;
const base='http://127.0.0.1:3113',origin='http://localhost:5173';
const createdUsers:string[]=[];
let budgetSnapshot:{date:string;requests:number|null};
function assertEphemeralInfrastructure(){
 if(process.env.NODE_ENV!=='test')throw new Error('Redis test isolation requires NODE_ENV=test');
 for(const name of ['DATABASE_URL','REDIS_URL']){
  const hostname=new URL(process.env[name]??'').hostname;
  if(!['localhost','127.0.0.1','[::1]','::1'].includes(hostname))throw new Error('Redis test isolation requires loopback database and Redis URLs');
 }
}
const providerInputs:{question:string;evidence:{reference:string}[];context?:string}[]=[];
async function request(path:string,{cookie='',method='GET',body}:{cookie?:string;method?:string;body?:unknown}={}){
 return fetch(base+path,{method,headers:{'Content-Type':'application/json',Origin:origin,...(cookie?{Cookie:cookie}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
}
async function register(label:string){
 const email=label+'-'+randomUUID()+'@example.com';
 const response=await request('/api/auth/sign-up/email',{method:'POST',body:{name:label,email,password:'oracle-expansion-strong-password-123'}});
 assert.equal(response.status,200);
 const data=await response.json(),cookie=response.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
 createdUsers.push(data.user.id);return {id:data.user.id as string,cookie};
}
async function draw(cookie:string,overrides:Record<string,unknown>={}){
 const response=await request('/api/v1/readings',{cookie,method:'POST',body:{kind:'tarot',question:'我可以怎样整理自己的选择？',spread:'three',allowReversed:true,requestId:randomUUID(),...overrides}});
 assert.equal(response.status,201);return response.json();
}
before(async()=>{
 assertEphemeralInfrastructure();
 await connectRedis();
 const budgetDate=chinaDate(),budget=await db.aIUsage.findUnique({where:{date:budgetDate}});
 budgetSnapshot={date:budgetDate,requests:budget?.requests??null};
 if(process.env.MOCK_TLS_CERT&&process.env.MOCK_TLS_KEY){
  model=httpsServer({cert:readFileSync(process.env.MOCK_TLS_CERT),key:readFileSync(process.env.MOCK_TLS_KEY)},async(req,res)=>{
   let body='';for await(const chunk of req)body+=chunk;
   const input=JSON.parse(JSON.parse(body).messages[1].content);providerInputs.push(input);providerCalls++;
   if(input.question.includes('oversized-response')){res.end('x'.repeat(110000));return;}
   const interpretation={summary:'围绕既定结果继续整理下一步。',insights:input.evidence.map((e:{reference:string})=>({reference:input.question.includes('坏引用')?'forged-reference':e.reference,text:'结合当前问题，观察可以亲自确认的事实。'})),actions:['记录一个可验证的小行动。','过一段时间回顾实际反馈。'],reflection:'你愿意先确认哪一件事？'};
   res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(interpretation)}}]}));
  });
  await new Promise<void>(resolve=>model.listen(3444,resolve));
 }
 child=spawn(process.execPath,['dist/main.js'],{cwd:process.cwd(),env:{...process.env,PORT:'3113',AI_DAILY_LIMIT:'100',AI_BASE_URL:'https://localhost:3444/v1'},stdio:['ignore','ignore','pipe']});
 child.stderr?.on('data',()=>{/* Provider, request contents and credentials are never logged by the test. */});
 for(let i=0;i<100;i++){try{if((await request('/api/v1/health')).ok)return;}catch{}await new Promise(r=>setTimeout(r,100));}
 throw new Error('Oracle expansion API failed to start');
});
beforeEach(async()=>{assertEphemeralInfrastructure();await redis.flushdb();});
after(async()=>{
 child?.kill('SIGTERM');if(model)await new Promise<void>(resolve=>model.close(()=>resolve()));
 if(createdUsers.length)await db.user.deleteMany({where:{id:{in:createdUsers}}});
 if(budgetSnapshot){
  if(budgetSnapshot.requests===null)await db.aIUsage.deleteMany({where:{date:budgetSnapshot.date}});
  else await db.aIUsage.upsert({where:{date:budgetSnapshot.date},create:{date:budgetSnapshot.date,requests:budgetSnapshot.requests},update:{requests:budgetSnapshot.requests}});
 }
 await db.$disconnect();redis.disconnect();
});
test('expanded casts preserve legacy requests and canonical server results',async()=>{
 const owner=await register('cast-owner');
 const catalog=await request('/api/v1/oracle/catalog').then(r=>r.json());
 assert.equal(Object.keys(catalog.spreads).length,32);assert.equal(Object.keys(catalog.scenarios).length,15);
 assert.equal(Object.keys(SPREADS).length,32);assert.equal(Object.keys(SCENARIOS).length,15);
 const legacy=await draw(owner.cookie,{spread:'single'});assert.equal(legacy.reading.cards.length,1);
 const full=await draw(owner.cookie,{spread:'celtic-cross',scenario:'decision'});assert.equal(full.reading.cards.length,10);assert.equal(full.reading.scenario,'decision');
 const annual=await draw(owner.cookie,{spread:'year-wheel',scenario:'annual'});assert.equal(annual.reading.cards.length,13);assert.equal(new Set(annual.reading.cards.map((x:{id:string})=>x.id)).size,13);
 const input={kind:'iching',question:'我可以如何面对当前的转变？',method:'numbers',numbers:[12,36,5],requestId:randomUUID()};
 const numberResponse=await request('/api/v1/readings',{cookie:owner.cookie,method:'POST',body:input});
 assert.equal(numberResponse.status,201);const number=await numberResponse.json();
 assert.deepEqual(number.reading.lines,castNumberLines([12,36,5]).lines);
 assert.equal((await request('/api/v1/readings',{cookie:owner.cookie,method:'POST',body:input}).then(r=>r.json())).id,number.id);
 assert.equal((await request('/api/v1/readings',{cookie:owner.cookie,method:'POST',body:{...input,numbers:[12,36,6]}})).status,409);
 const time='2026-10-03T09:30:00+08:00';
 const timed=await draw(owner.cookie,{kind:'iching',method:'time',time,scenario:'transition'});
 assert.deepEqual(timed.reading.lines,castTimeLines(time).lines);assert.equal(timed.reading.casting.timestamp,new Date(time).toISOString());
 assert.equal((await request('/api/v1/readings',{cookie:owner.cookie,method:'POST',body:{...input,requestId:randomUUID(),lines:[9,9,9,9,9,9]}})).status,400,'clients cannot inject the cast');
 assert.equal((await request('/api/v1/readings',{cookie:owner.cookie,method:'POST',body:{...input,requestId:randomUUID(),numbers:[0,2,3]}})).status,400);
 const tarotInput={kind:'tarot',question:'同一次请求是否保持原结果？',spread:'three',allowReversed:false,requestId:randomUUID()};
 await request('/api/v1/readings',{cookie:owner.cookie,method:'POST',body:tarotInput});
 assert.equal((await request('/api/v1/readings',{cookie:owner.cookie,method:'POST',body:{...tarotInput,allowReversed:true}})).status,409);
});
test('private metadata, optimistic updates and bounded encrypted search keep every continuation',async()=>{
 const owner=await register('search-owner'),other=await register('search-other');
 const record=await draw(owner.cookie);
 const input={favorite:true,tags:['工作','PRIVATE-TAG'],note:'PRIVATE-ANNOTATION-SEARCH',version:0};
 assert.equal((await request('/api/v1/readings/'+record.id+'/metadata',{cookie:other.cookie,method:'PATCH',body:input})).status,404);
 const changed=await request('/api/v1/readings/'+record.id+'/metadata',{cookie:owner.cookie,method:'PATCH',body:input});
 assert.equal(changed.status,200);assert.equal((await changed.json()).metadataVersion,1);
 assert.equal((await request('/api/v1/readings/'+record.id+'/metadata',{cookie:owner.cookie,method:'PATCH',body:input})).status,409);
 const stored=await db.reading.findUniqueOrThrow({where:{id:record.id}});
 assert.ok(!stored.annotation!.includes(input.note));assert.ok(!stored.tagsCipher!.includes('PRIVATE-TAG'));
 assert.equal(open(stored.annotation!,'reading-note:'+owner.id+':'+record.id),input.note);
 assert.throws(()=>open(stored.annotation!,'reading-note:'+other.id+':'+record.id));
 const match=await request('/api/v1/readings?q=ANNOTATION&favorite=true&tag='+encodeURIComponent('工作'),{cookie:owner.cookie}).then(r=>r.json());
 assert.deepEqual(match.items.map((x:{id:string})=>x.id),[record.id]);
 assert.equal((await request('/api/v1/readings?cursor='+record.id,{cookie:other.cookie})).status,404);
 const dateId=randomUUID(),timestamp='2026-03-01T20:30:00.000Z';
 const dated:Reading={version:1,id:dateId,createdAt:timestamp,question:'上海日期边界的记录',kind:'tarot',spread:'single',cards:drawTarot('single',false)};
 await db.reading.create({data:{id:dateId,userId:owner.id,kind:'tarot',payload:{...dated,question:''},question:seal(dated.question,'question:'+owner.id+':'+dateId),requestId:randomUUID(),createdAt:new Date(timestamp)}});
 const day=await request('/api/v1/readings?dateFrom=2026-03-02&dateTo=2026-03-02',{cookie:owner.cookie}).then(r=>r.json());
 assert.deepEqual(day.items.map((x:{id:string})=>x.id),[dateId]);
 const pageOwner=await register('continuation-owner'),rows=[];
 const oldest=Date.now()-1000000;
 for(let i=0;i<606;i++){
  const id=randomUUID(),question=i===0?'UNIQUE-LATE-MATCH':'其他较新的记录';
  const reading:Reading={version:1,id,createdAt:new Date(oldest+i*1000).toISOString(),question,kind:'tarot',spread:'single',cards:[{id:record.reading.cards[0].id,reversed:false}]};
  rows.push({id,userId:pageOwner.id,kind:'tarot',payload:{...reading,question:''},question:seal(question,'question:'+pageOwner.id+':'+id),requestId:randomUUID(),createdAt:new Date(reading.createdAt)});
 }
 await db.reading.createMany({data:rows});
 const first=await request('/api/v1/readings?q=UNIQUE-LATE-MATCH&limit=10',{cookie:pageOwner.cookie}).then(r=>r.json());
 assert.equal(first.items.length,0);assert.ok(first.nextCursor,'a full bounded scan must return progress instead of falsely ending search');
 const second=await request('/api/v1/readings?q=UNIQUE-LATE-MATCH&limit=10&cursor='+first.nextCursor,{cookie:pageOwner.cookie}).then(r=>r.json());
 assert.equal(second.items.length,1);assert.equal(second.items[0].id,rows[0]!.id);assert.equal(second.nextCursor,null);
 const daily=await request('/api/v1/daily/today',{cookie:owner.cookie,method:'POST',body:{}}).then(r=>r.json());
 assert.equal((await request('/api/v1/daily/'+daily.id,{cookie:owner.cookie})).status,200);
 assert.equal((await request('/api/v1/daily/'+daily.id,{cookie:other.cookie})).status,404);
});
test('follow-up AI remains on the owned cast, is idempotent, encrypted and budgeted atomically',{skip:!process.env.MOCK_TLS_CERT},async()=>{
 const owner=await register('follow-up-owner'),other=await register('follow-up-other'),record=await draw(owner.cookie);
 const initialRequestId=randomUUID();
 const initial=await request('/api/v1/readings/'+record.id+'/interpret',{cookie:owner.cookie,method:'POST',body:{consent:true,requestId:initialRequestId}});
 assert.equal(initial.status,200);assert.equal((await initial.json()).ai,true);
 const before=providerCalls;
 const cached=await db.aIRequest.findUniqueOrThrow({where:{userId_requestId:{userId:owner.id,requestId:initialRequestId}}});
 assert.equal(cached.status,'done');assert.equal(cached.readingId,record.id);
 const allowanceForRestore=await db.aIAllowance.count({where:{userId:owner.id}});
 // Emulate a process interruption after the provider result was committed but
 // before the reading projection was saved. Retrying restores the cache only.
 await db.reading.update({where:{id:record.id},data:{ai:false,aiStatus:'idle',aiStartedAt:null,interpretation:null}});
 const restored=await request('/api/v1/readings/'+record.id+'/interpret',{cookie:owner.cookie,method:'POST',body:{consent:true,requestId:initialRequestId}});
 assert.equal(restored.status,200);assert.equal((await restored.json()).ai,true);
 assert.equal(providerCalls,before);assert.equal(await db.aIAllowance.count({where:{userId:owner.id}}),allowanceForRestore);
 assert.equal((await request('/api/v1/readings/'+record.id+'/interpret',{cookie:owner.cookie,method:'POST',body:{consent:true,requestId:randomUUID()}})).status,200);
 assert.equal(providerCalls,before);
 const input={prompt:'围绕刚才的结果，我怎样安排第一步？',consent:true,requestId:randomUUID()};
 assert.equal((await request('/api/v1/readings/'+record.id+'/conversation',{cookie:other.cookie,method:'POST',body:input})).status,404);
 assert.equal((await request('/api/v1/readings/'+record.id+'/conversation',{cookie:owner.cookie,method:'POST',body:{...input,consent:false}})).status,400);
 const response=await request('/api/v1/readings/'+record.id+'/conversation',{cookie:owner.cookie,method:'POST',body:input});
 assert.equal(response.status,200);const turn=await response.json();assert.equal(turn.status,'done');
 const after=providerCalls;
 assert.equal((await request('/api/v1/readings/'+record.id+'/conversation',{cookie:owner.cookie,method:'POST',body:input}).then(r=>r.json())).id,turn.id);
 assert.equal(providerCalls,after);
 assert.equal((await request('/api/v1/readings/'+record.id+'/conversation',{cookie:owner.cookie,method:'POST',body:{...input,prompt:'改变了的问题'}})).status,409);
 const payload=providerInputs.at(-1)!;
 assert.deepEqual(new Set(payload.evidence.map(x=>x.reference)),new Set(record.reading.cards.map((x:{id:string})=>x.id)));
 assert.equal(JSON.parse(payload.context!).originalQuestion,record.reading.question);
 const original=await request('/api/v1/readings/'+record.id,{cookie:owner.cookie}).then(r=>r.json());assert.deepEqual(original.reading.cards,record.reading.cards,'follow-up cannot redraw the cast');
 const persisted=await db.readingConversation.findUniqueOrThrow({where:{id:turn.id}});
 assert.ok(!persisted.promptCipher.includes(input.prompt));assert.ok(!persisted.answerCipher!.includes(turn.answer.summary));
 assert.equal(open(persisted.promptCipher,'conversation-prompt:'+owner.id+':'+turn.id),input.prompt);
 const listed=await request('/api/v1/readings/'+record.id+'/conversation',{cookie:owner.cookie}).then(r=>r.json());assert.equal(listed.items[0].id,turn.id);
 assert.equal((await request('/api/v1/readings/'+record.id+'/conversation',{cookie:other.cookie})).status,404);
 const otherRecord=await draw(other.cookie);
 const sourceRequestId=randomUUID(),allowanceBeforeSource=await db.aIAllowance.count({where:{userId:owner.id}});
 await assert.rejects(requestModel({userId:owner.id,requestId:sourceRequestId,readingId:otherRecord.id,question:'不得使用他人的记录',evidence:evidenceFor(record.reading)}),(error:unknown)=>(error as {getStatus?:()=>number}).getStatus?.()===404);
 assert.equal(await db.aIRequest.count({where:{userId:owner.id,requestId:sourceRequestId}}),0);assert.equal(await db.aIAllowance.count({where:{userId:owner.id}}),allowanceBeforeSource);
 await redis.del('limit:ai:user:'+owner.id);
 assert.equal((await request('/api/v1/readings/'+otherRecord.id+'/conversation?cursor='+turn.id,{cookie:other.cookie})).status,404);
 const invalid={prompt:'请返回坏引用用于验证固定证据',consent:true,requestId:randomUUID()};
 const bad=await request('/api/v1/readings/'+record.id+'/conversation',{cookie:owner.cookie,method:'POST',body:invalid});assert.equal(bad.status,503);
 const failureCount=providerCalls,globalBefore=await db.aIUsage.findUniqueOrThrow({where:{date:chinaDate()}});
 assert.equal((await request('/api/v1/readings/'+record.id+'/conversation',{cookie:owner.cookie,method:'POST',body:invalid})).status,503);
 assert.equal(providerCalls,failureCount,'a failed requestId must not resend or charge again');
 assert.equal((await db.aIUsage.findUniqueOrThrow({where:{date:chinaDate()}})).requests,globalBefore.requests);
 await redis.del('limit:ai:user:'+owner.id);
 const allowanceBefore=await db.aIAllowance.count({where:{userId:owner.id}});
 await db.aIUsage.update({where:{date:chinaDate()},data:{requests:100}});
 try{
  const blockedId=randomUUID();
  const blocked=await request('/api/v1/readings/'+record.id+'/conversation',{cookie:owner.cookie,method:'POST',body:{prompt:'全站额度不足时不应该扣个人额度',consent:true,requestId:blockedId}});
  assert.equal(blocked.status,429);assert.equal(providerCalls,failureCount);
  assert.equal(await db.aIAllowance.count({where:{userId:owner.id}}),allowanceBefore);
  assert.equal(await db.aIRequest.count({where:{userId:owner.id,requestId:blockedId}}),0,'global-budget rejection rolls back the entire reservation');
 }finally{await db.aIUsage.update({where:{date:chinaDate()},data:{requests:globalBefore.requests}});}
 await redis.del('limit:ai:user:'+owner.id);
 const oversized={prompt:'oversized-response 验证响应大小限制',consent:true,requestId:randomUUID()};
 assert.equal((await request('/api/v1/readings/'+record.id+'/conversation',{cookie:owner.cookie,method:'POST',body:oversized})).status,503);
 const concurrent={prompt:'同一追问并发只生成一次',consent:true,requestId:randomUUID()},callCount=providerCalls;
 await redis.del('limit:ai:user:'+owner.id);
 const results=await Promise.all([1,2].map(()=>request('/api/v1/readings/'+record.id+'/conversation',{cookie:owner.cookie,method:'POST',body:concurrent})));
 assert.ok(results.every(r=>r.status===200||r.status===409));assert.ok(results.some(r=>r.status===200));assert.equal(providerCalls,callCount+1);
 const staleId=randomUUID();
 await db.readingConversation.create({data:{id:staleId,userId:owner.id,readingId:record.id,requestId:randomUUID(),promptCipher:seal('中断的追问','conversation-prompt:'+owner.id+':'+staleId),status:'pending',pendingSince:new Date(Date.now()-130000)}});
 const history=await request('/api/v1/readings/'+record.id+'/conversation',{cookie:owner.cookie}).then(r=>r.json());
 assert.equal(history.items.find((x:{id:string})=>x.id===staleId).status,'failed');
 const privateCaches=await db.aIRequest.findMany({where:{readingId:record.id,userId:owner.id},select:{requestId:true}});
 assert.ok(privateCaches.some(row=>row.requestId===initialRequestId));assert.ok(privateCaches.some(row=>row.requestId===input.requestId));
 const allowancesBeforeDelete=await db.aIAllowance.count({where:{userId:owner.id}});
 await request('/api/v1/readings/'+record.id,{cookie:owner.cookie,method:'DELETE',body:{}});
 assert.equal(await db.aIRequest.count({where:{userId:owner.id,readingId:record.id}}),0,'deleting a reading removes its private initial and follow-up model cache');
 assert.equal(await db.aIAllowance.count({where:{userId:owner.id}}),allowancesBeforeDelete,'deletion retains non-content accounting entries');
 const replacement=await draw(owner.cookie,{question:'删除原记录后新建的另一项问题'});
 await redis.del('limit:ai:user:'+owner.id);
 const replayCalls=providerCalls,replayBudget=(await db.aIUsage.findUniqueOrThrow({where:{date:chinaDate()}})).requests;
 const replay=await request('/api/v1/readings/'+replacement.id+'/interpret',{cookie:owner.cookie,method:'POST',body:{consent:true,requestId:initialRequestId}});
 assert.equal(replay.status,409,'deleting a source must not make its consumed nonce available for another free AI call');
 assert.equal(providerCalls,replayCalls);assert.equal((await db.aIUsage.findUniqueOrThrow({where:{date:chinaDate()}})).requests,replayBudget);
 assert.equal(await db.aIAllowance.count({where:{userId:owner.id}}),allowancesBeforeDelete);
 assert.equal(await db.aIRequest.count({where:{userId:owner.id,readingId:replacement.id}}),0);
 assert.equal(await db.readingConversation.count({where:{readingId:record.id}}),0,'deleting an owned cast cascades its private conversation');
});
