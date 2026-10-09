import { test,after,type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { basicInterpretation,type Reading } from '@star-oracle/domain';

// This regression suite deliberately uses no network services or real secrets.
// The services and accounting logic are real; only I/O is replaced in-process.
Object.assign(process.env,{
 NODE_ENV:'test',DATABASE_URL:'mysql://fixture:fixture@127.0.0.1:1/fixture',REDIS_URL:'redis://127.0.0.1:1',
 AUTH_SECRET:'follow-up-recovery-fixture-secret-only',DATA_ENCRYPTION_KEY:'ab'.repeat(32),
 AI_API_KEY:'fixture-only',AI_BASE_URL:'https://provider-fixture.invalid/v1',AI_DAILY_LIMIT:'200',
});
const {db,redis,seal,open,chinaDate}=await import('../src/infrastructure.js');
redis.disconnect();
const {OracleService}=await import('../src/oracle.service.js');
const {modelFingerprint,requestModel}=await import('../src/model.service.js');
after(async()=>{await db.$disconnect();});

type Row=Record<string,any>;
type Table='user'|'reading'|'readingConversation'|'aIRequest'|'aIUsage'|'aIAllowance'|'membership'|'userAIUsage'|'creditLedger'|'auditLog';
function matches(row:Row,where:Row={}):boolean {
 return Object.entries(where).every(([key,value])=>{
  if(key==='OR')return value.some((choice:Row)=>matches(row,choice));
  if(key==='userId_requestId'||key==='userId_date')return matches(row,value);
  if(value instanceof Date)return row[key] instanceof Date&&row[key].getTime()===value.getTime();
  if(value!==null&&typeof value==='object')return Object.entries(value).every(([operator,bound])=>{
   if(operator==='lt')return row[key]<bound!;
   if(operator==='gte')return row[key]>=bound!;
   if(operator==='gt')return row[key]>bound!;
   if(operator==='in')return (bound as unknown[]).includes(row[key]);
   throw new Error('Unsupported fixture comparison: '+operator);
  });
  return row[key]===value;
 });
}
function apply(row:Row,data:Row) {
 for(const [key,value] of Object.entries(data)){
  if(value&&typeof value==='object'&&'increment' in value)row[key]+=value.increment;
  else if(value&&typeof value==='object'&&'decrement' in value)row[key]-=value.decrement;
  else row[key]=value;
 }
 row.updatedAt=new Date();
}
function fixture(t:TestContext) {
 // Prisma delegates expose methods through a Proxy, not method descriptors.
 const replaceMethod=(target:any,name:string,implementation:(...args:any[])=>any)=>{
  const original=target[name];target[name]=implementation;t.after(()=>{target[name]=original;});
 };
 const userId=randomUUID(),readingId=randomUUID(),requestId=randomUUID();
 const reading:Reading={version:1,id:readingId,createdAt:new Date().toISOString(),question:'我可以怎样看清下一步？',kind:'tarot',spread:'single',cards:[{id:'major-fool',reversed:false}]};
 let state:Record<Table,Row[]>={
  user:[{id:userId,disabled:false}],
  reading:[{id:readingId,userId,payload:{...reading,question:''},question:seal(reading.question,'question:'+userId+':'+readingId),interpretation:null,ai:false,aiStatus:'idle',aiStartedAt:null,shared:false,createdAt:new Date()}],
  readingConversation:[],aIRequest:[],aIUsage:[],aIAllowance:[],
  membership:[{userId,tier:'free',expiresAt:null,credits:3}],
  userAIUsage:[{id:randomUUID(),userId,date:chinaDate(),requests:5}],creditLedger:[],auditLog:[],
 };
 let failProjection=1,failCleanup=false,providerCalls=0,providerFails=false;
 let afterModelCommit:(()=>Promise<void>)|undefined;
 for(const table of Object.keys(state) as Table[]){
  const delegate=db[table] as any;
  const defaults=()=>({id:randomUUID(),createdAt:new Date(),updatedAt:new Date(),requests:0,inputCipher:null,answerCipher:null,resultCipher:null,reportId:null,pendingSince:null});
  replaceMethod(delegate,'findUnique',async({where}:Row)=>structuredClone(state[table].find(row=>matches(row,where))??null));
  replaceMethod(delegate,'findFirst',async({where}:Row)=>structuredClone(state[table].find(row=>matches(row,where))??null));
  replaceMethod(delegate,'findUniqueOrThrow',async({where}:Row)=>{
   const row=state[table].find(row=>matches(row,where));if(!row)throw new Error('Fixture row missing');return structuredClone(row);
  });
  replaceMethod(delegate,'findMany',async({where,take}:Row={})=>structuredClone(state[table].filter(row=>matches(row,where)).slice(0,take)));
  replaceMethod(delegate,'create',async({data}:Row)=>{const row={...defaults(),...data};state[table].push(row);return structuredClone(row);});
  replaceMethod(delegate,'upsert',async({where,create,update}:Row)=>{
   let row=state[table].find(value=>matches(value,where));
   if(row)apply(row,update);else{row={...defaults(),...create};state[table].push(row);}
   return structuredClone(row);
  });
  replaceMethod(delegate,'updateMany',async({where,data}:Row)=>{
   if(table==='readingConversation'&&data.status==='failed'&&failCleanup)throw new Error('Simulated process interruption before cleanup');
   const rows=state[table].filter(row=>matches(row,where));rows.forEach(row=>apply(row,data));
   if(table==='aIRequest'&&data.status==='done')await afterModelCommit?.();
   return {count:rows.length};
  });
  replaceMethod(delegate,'update',async({where,data}:Row)=>{
   const row=state[table].find(row=>matches(row,where));if(!row)throw new Error('Fixture row missing');apply(row,data);return structuredClone(row);
  });
 }
 replaceMethod(db,'$transaction',async(work:(tx:typeof db)=>Promise<unknown>)=>{
  const saved=structuredClone(state);
  try{
   const result=await work(db);
   const projected=state.readingConversation.some(row=>row.status==='done'&&saved.readingConversation.find(old=>old.id===row.id)?.status!=='done');
   if(projected&&failProjection>0){failProjection--;throw new Error('Injected projection transaction failure after model commit');}
   return result;
  }catch(error){state=saved;throw error;}
 });
 t.mock.method(redis,'eval',async()=>1);
 t.mock.method(redis,'zrem',async()=>1);
 t.mock.method(globalThis,'fetch',async(_url:unknown,options?:RequestInit)=>{
  providerCalls++;
  if(providerFails)throw new Error('Injected provider failure');
  const input=JSON.parse(JSON.parse(String(options?.body)).messages[1].content);
  const answer={summary:'已付费的原始结果。',insights:input.evidence.map((item:{reference:string})=>({reference:item.reference,text:'观察可以亲自确认的事实。'})),actions:['记录一个小行动。','回顾实际反馈。'],reflection:'先确认哪一件事？'};
  return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(answer)}}]}),{status:200});
 });
 const service=new OracleService(),input={prompt:'围绕这次结果，我可以先做什么？',requestId,consent:true as const};
 return {userId,readingId,reading,requestId,input,service,get state(){return state;},get providerCalls(){return providerCalls;},
  set failCleanup(value:boolean){failCleanup=value;},set failProjection(value:number){failProjection=value;},set providerFails(value:boolean){providerFails=value;},
  set afterModelCommit(value:()=>Promise<void>){afterModelCommit=value;},
  follow:(overrides:Partial<typeof input>={})=>service.followUp(userId,readingId,{...input,...overrides},randomUUID()),
 };
}
const status=(code:number)=>(error:unknown)=>(error as {getStatus?:()=>number}).getStatus?.()===code;
const errorCode=(error:unknown)=>(error as {getResponse?:()=>{code?:string}}).getResponse?.()?.code;
function assertChargedOnce(f:ReturnType<typeof fixture>) {
 assert.equal(f.providerCalls,1);
 assert.equal(f.state.aIUsage[0]!.requests,1);
 assert.equal(f.state.userAIUsage[0]!.requests,6);
 assert.equal(f.state.membership[0]!.credits,2);
 assert.equal(f.state.aIAllowance.length,1);
 assert.equal(f.state.creditLedger.length,1);
 assert.equal(f.state.creditLedger[0]!.amount,-1);
}
for(const interrupted of [false,true])test('restores the original paid follow-up after projection failure leaves '+(interrupted?'pending':'failed'),async t=>{
 const f=fixture(t);f.failCleanup=interrupted;
 await assert.rejects(f.follow(),status(503));
 const row=f.state.readingConversation[0]!;
 assert.equal(row.status,interrupted?'pending':'failed');
 assert.equal(f.state.aIRequest[0]!.status,'done');
 assert.equal(row.answerCipher,null);assertChargedOnce(f);
 // Later history and an upgraded initial interpretation must not change the
 // input fingerprint used to recover this earlier provider result.
 const laterId=randomUUID(),answer={...basicInterpretation(f.reading),summary:'后来生成的另一条回答'};
 f.state.readingConversation.push({id:laterId,userId:f.userId,readingId:f.readingId,requestId:randomUUID(),status:'done',createdAt:new Date(),
  promptCipher:seal('这是之后的追问','conversation-prompt:'+f.userId+':'+laterId),answerCipher:seal(JSON.stringify(answer),'conversation-answer:'+f.userId+':'+laterId)});
 f.state.reading[0]!.interpretation=seal(JSON.stringify(answer),'interpretation:'+f.userId+':'+f.readingId);
 const recovered=await f.follow();
 assert.equal(recovered.id,row.id);assert.equal(recovered.status,'done');assert.equal(recovered.answer!.summary,'已付费的原始结果。');
 assertChargedOnce(f);assert.equal(f.state.auditLog.length,1);
 assert.equal((await f.follow()).id,row.id);assert.equal(f.state.auditLog.length,1);assertChargedOnce(f);
});

test('recovery rejects a changed prompt, another reading, and another account',async t=>{
 const f=fixture(t);await assert.rejects(f.follow(),status(503));
 await assert.rejects(f.follow({prompt:'冒用同一个请求但换了问题'}),status(409));
 const otherId=randomUUID();f.state.reading.push({...f.state.reading[0],id:otherId});
 await assert.rejects(f.service.followUp(f.userId,otherId,f.input,randomUUID()),status(409));
 await assert.rejects(f.service.followUp(randomUUID(),f.readingId,f.input,randomUUID()),status(404));
 assertChargedOnce(f);assert.equal(f.state.readingConversation[0]!.status,'failed');
});

test('recovery remains available after another projection transaction failure',async t=>{
 const f=fixture(t);f.failProjection=2;
 await assert.rejects(f.follow(),status(503));
 await assert.rejects(f.follow(),status(503));
 assert.equal(f.state.aIRequest[0]!.status,'done');assertChargedOnce(f);
 assert.equal((await f.follow()).status,'done');assertChargedOnce(f);assert.equal(f.state.auditLog.length,1);
});

test('a failed provider request is never resent with the same requestId',async t=>{
 const f=fixture(t);f.providerFails=true;
 await assert.rejects(f.follow(),error=>status(503)(error)&&errorCode(error)==='AI_ATTEMPT_FAILED');assert.equal(f.state.aIRequest[0]!.status,'failed');
 await assert.rejects(f.follow(),error=>status(503)(error)&&errorCode(error)==='AI_ATTEMPT_FAILED');assertChargedOnce(f);
});

test('a result cannot be reused by another conversation on the same reading',async t=>{
 const f=fixture(t);await assert.rejects(f.follow(),status(503));
 const original=f.state.readingConversation[0]!;
 assert.ok(original.inputCipher,'new follow-ups persist the original encrypted model input');
 assert.ok(!original.inputCipher.includes(f.input.prompt));
 const snapshot=JSON.parse(open(original.inputCipher,'conversation-input:'+f.userId+':'+original.id));
 // Preserve all content and the nonce, but replace the concrete conversation.
 const replacementId=randomUUID();
 original.id=replacementId;
 original.promptCipher=seal(f.input.prompt,'conversation-prompt:'+f.userId+':'+replacementId);
 original.inputCipher=seal(JSON.stringify(snapshot),'conversation-input:'+f.userId+':'+replacementId);
 await assert.rejects(f.follow(),status(409));assertChargedOnce(f);
});

test('legacy failed conversations without a verifiable snapshot stay closed',async t=>{
 const f=fixture(t);await assert.rejects(f.follow(),status(503));
 f.state.readingConversation[0]!.inputCipher=null;
 await assert.rejects(f.follow(),status(503));assertChargedOnce(f);
});

test('altering the saved context cannot recover a result from the old input',async t=>{
 const f=fixture(t);await assert.rejects(f.follow(),status(503));
 const row=f.state.readingConversation[0]!,aad='conversation-input:'+f.userId+':'+row.id;
 const snapshot=JSON.parse(open(row.inputCipher,aad));
 row.inputCipher=seal(JSON.stringify({...snapshot,context:'changed historical input'}),aad);
 await assert.rejects(f.follow(),status(409));assertChargedOnce(f);
});

for(const cacheState of ['missing','pending'] as const)test('recovery never starts a provider request when the model cache is '+cacheState,async t=>{
 const f=fixture(t);await assert.rejects(f.follow(),status(503));
 if(cacheState==='missing')f.state.aIRequest.length=0;
 else Object.assign(f.state.aIRequest[0]!,{status:'pending',pendingSince:new Date(),resultCipher:null});
 await assert.rejects(f.follow(),error=>status(503)(error)&&errorCode(error)===(cacheState==='missing'?'AI_ATTEMPT_FAILED':undefined));assertChargedOnce(f);
});

test('a committed result with a failed projection never reports a terminal model failure',async t=>{
 const f=fixture(t);f.failProjection=2;
 await assert.rejects(f.follow(),error=>status(503)(error)&&errorCode(error)===undefined);
 await assert.rejects(f.follow(),error=>status(503)(error)&&errorCode(error)===undefined);
 assert.equal(f.state.aIRequest[0]!.status,'done');assertChargedOnce(f);
});

test('a failed model-cache lookup never reports that starting another paid attempt is safe',async t=>{
 const f=fixture(t);await assert.rejects(f.follow(),status(503));
 const delegate=db.aIRequest,original=delegate.findUnique;
 delegate.findUnique=async()=>{throw new Error('Injected cache lookup failure');};
 try{await assert.rejects(f.follow(),error=>errorCode(error)===undefined);}
 finally{delegate.findUnique=original;}
 assertChargedOnce(f);
});

test('an unconfirmed model failure write does not unlock a new paid attempt',async t=>{
 const f=fixture(t);f.providerFails=true;
 const delegate=db.aIRequest,original=delegate.updateMany;
 delegate.updateMany=async(args:any)=>{if(args.data.status==='failed')throw new Error('Injected failure-state write failure');return original(args);};
 try{await assert.rejects(f.follow(),error=>status(503)(error)&&errorCode(error)===undefined);}
 finally{delegate.updateMany=original;}
 assert.equal(f.state.aIRequest[0]!.status,'pending');
 await assert.rejects(f.follow(),error=>status(503)(error)&&errorCode(error)===undefined);assertChargedOnce(f);
});

test('initial interpretations expose the same confirmed terminal failure code',async t=>{
 const f=fixture(t);f.providerFails=true;
 for(let attempt=0;attempt<2;attempt++)await assert.rejects(f.service.interpret(f.userId,f.readingId,randomUUID(),f.requestId),error=>status(503)(error)&&errorCode(error)==='AI_ATTEMPT_FAILED');
 assert.equal(f.state.aIRequest[0]!.status,'failed');assert.equal(f.state.reading[0]!.aiStatus,'idle');assertChargedOnce(f);
});

test('an abandoned model request becomes terminal only after a durable timeout transition',async t=>{
 const f=fixture(t);await assert.rejects(f.follow(),status(503));
 const expired=new Date(Date.now()-130000);
 Object.assign(f.state.aIRequest[0]!,{status:'pending',pendingSince:expired,resultCipher:null});
 Object.assign(f.state.readingConversation[0]!,{status:'pending',pendingSince:expired});
 for(let attempt=0;attempt<2;attempt++)await assert.rejects(f.follow(),error=>status(503)(error)&&errorCode(error)==='AI_ATTEMPT_FAILED');
 assert.equal(f.state.aIRequest[0]!.status,'failed');assertChargedOnce(f);
});

test('a completed result winning the timeout race is recovered rather than marked terminal',async t=>{
 const f=fixture(t);await assert.rejects(f.follow(),status(503));
 Object.assign(f.state.aIRequest[0]!,{status:'pending',pendingSince:new Date(Date.now()-130000)});
 const delegate=db.aIRequest,original=delegate.updateMany;
 delegate.updateMany=async(args:any)=>{
  if(args.data.status==='failed'){Object.assign(f.state.aIRequest[0]!,{status:'done',pendingSince:null});return {count:0};}
  return original(args);
 };
 try{assert.equal((await f.follow()).status,'done');}
 finally{delegate.updateMany=original;}
 assertChargedOnce(f);assert.equal(f.state.auditLog.length,1);
});

test('a late original model call cannot claim a failed conversation with no model row',async t=>{
 const f=fixture(t);await assert.rejects(f.follow(),status(503));
 const row=f.state.readingConversation[0]!,snapshot=JSON.parse(open(row.inputCipher,'conversation-input:'+f.userId+':'+row.id));
 f.state.aIRequest.length=0;f.state.aIAllowance.length=0;
 await assert.rejects(requestModel({userId:f.userId,requestId:f.requestId,readingId:f.readingId,conversationId:row.id,...snapshot}),status(409));
 assert.equal(f.providerCalls,1);assert.equal(f.state.aIRequest.length,0);
 assert.equal(f.state.membership[0]!.credits,2);assert.equal(f.state.creditLedger.length,1);
});

test('an in-flight attempt stays pending until stale and never gets resent',async t=>{
 const f=fixture(t);f.failCleanup=true;
 await assert.rejects(f.follow(),status(503));
 Object.assign(f.state.aIRequest[0]!,{status:'pending',pendingSince:new Date(),resultCipher:null});
 await assert.rejects(f.follow(),status(409));assertChargedOnce(f);
 f.failCleanup=false;f.state.readingConversation[0]!.pendingSince=new Date(Date.now()-130000);
 await assert.rejects(f.follow(),status(503));assertChargedOnce(f);
 assert.equal(f.state.readingConversation[0]!.status,'failed');
});

test('a retry can project a committed result while the original request is still returning',async t=>{
 const f=fixture(t);f.failProjection=0;
 let committed!:()=>void,release!:()=>void;
 const modelCommitted=new Promise<void>(resolve=>{committed=resolve;}),resume=new Promise<void>(resolve=>{release=resolve;});
 t.after(()=>release());
 f.afterModelCommit=async()=>{committed();await resume;};
 const first=f.follow();
 await modelCommitted;
 assert.equal(f.state.readingConversation[0]!.status,'pending');
 const recovered=await f.follow();
 release();
 assert.deepEqual(await first,recovered);
 assertChargedOnce(f);assert.equal(f.state.auditLog.length,1);
});

test('model request fingerprints bind a concrete follow-up and preserve initial-request compatibility',()=>{
 const input={userId:'owner',requestId:'nonce',readingId:'reading',question:'question',evidence:[{reference:'card',name:'card',position:'position',keywords:['keyword']}]};
 assert.equal(modelFingerprint(input),'b2435d0f078e627eb147421a5828b0f8bd72d30cd0cd9f5c3bf3bdc6361a68bd','pre-migration initial/report request fingerprints remain compatible');
 assert.notEqual(modelFingerprint({...input,conversationId:'first'}),modelFingerprint({...input,conversationId:'second'}));
 assert.notEqual(modelFingerprint(input),modelFingerprint({...input,conversationId:'first'}));
});
