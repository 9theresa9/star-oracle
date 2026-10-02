import { test,before,after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn,type ChildProcess } from 'node:child_process';
import { createServer as httpsServer,type Server as HTTPSServer } from 'node:https';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { Redis } from 'ioredis';
import { db,redis,seal,open,chinaDate,consumeLimit,connectRedis } from '../src/infrastructure.js';
let child:ChildProcess,mailChild:ChildProcess,model:HTTPSServer;
let providerCalls=0,startupEvent='none',healthStatus=0;
const base='http://127.0.0.1:3111',origin='http://localhost:5173';
async function request(path:string,{cookie='',method='GET',body,originOverride=origin}:{cookie?:string;method?:string;body?:unknown;originOverride?:string}={}) {
 return fetch(base+path,{method,headers:{'Content-Type':'application/json',Origin:originOverride,...(cookie?{Cookie:cookie}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
}
async function register(label:string) {
 const email=label+'-'+crypto.randomUUID()+'@example.com';
 const r=await request('/api/auth/sign-up/email',{method:'POST',body:{name:label,email,password:'a-strong-test-password-123',role:'admin',disabled:false}});
 assert.equal(r.status,200);const data=await r.json();
 const cookie=r.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
 assert.ok(cookie);return {id:data.user.id as string,cookie,email};
}
before(async()=>{
 await connectRedis();
 if(process.env.MOCK_TLS_CERT&&process.env.MOCK_TLS_KEY){
 model=httpsServer({cert:readFileSync(process.env.MOCK_TLS_CERT),key:readFileSync(process.env.MOCK_TLS_KEY)},async(req,res)=>{
  let text='';for await(const chunk of req)text+=chunk;
  const body=JSON.parse(text),input=JSON.parse(body.messages[1].content);providerCalls++;
  const interpretation={summary:'围绕本次结果整理当下的选择。',insights:input.evidence.map((e:{reference:string})=>({reference:input.question.includes('坏引用')?'forged-reference':e.reference,text:'留意可以由自己影响的部分。'})),actions:['写下一个可以调整的小步骤。','先观察事实，再决定下一步。'],reflection:'此刻你最需要看清什么？'};
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(interpretation)}}]}));
 });await new Promise<void>(resolve=>model.listen(3443,resolve));
 }
 child=spawn(process.execPath,['dist/main.js'],{cwd:process.cwd(),env:process.env,stdio:['ignore','pipe','pipe']});
 child.stdout?.on('data',chunk=>{if(String(chunk).includes('api_ready'))startupEvent='ready';});
 child.stderr?.on('data',chunk=>{for(const line of String(chunk).split('\n')){try{const value=JSON.parse(line);if(value.event==='api_start_failed')startupEvent=JSON.stringify({errorClass:value.errorClass,code:value.code});}catch{}}});
 // Only structured startup event/class/code and HTTP status are reported.
 for(let i=0;i<100;i++){try{const r=await request('/api/v1/health');healthStatus=r.status;if(r.ok)return;}catch{}await new Promise(r=>setTimeout(r,100));}
 throw new Error('Integration API failed to start: '+startupEvent+', health='+healthStatus);
});
after(async()=>{child?.kill('SIGTERM');mailChild?.kill('SIGTERM');if(model)await new Promise<void>(resolve=>model.close(()=>resolve()));await db.$disconnect();redis.disconnect();});
test('authenticated records, ownership, sharing and diary isolation',async()=>{
 await redis.flushdb();
 const a=await register('owner'),b=await register('other');
 const me=await request('/api/v1/me',{cookie:a.cookie});assert.equal((await me.json()).role,'user','client role injection must fail');
 const input={kind:'tarot',question:'我可以怎样整理今天的安排？',spread:'three',allowReversed:true,requestId:crypto.randomUUID()};
 const first=await request('/api/v1/readings',{cookie:a.cookie,method:'POST',body:input});assert.equal(first.status,201);const record=await first.json();
 const duplicate=await request('/api/v1/readings',{cookie:a.cookie,method:'POST',body:input});assert.equal((await duplicate.json()).id,record.id);
 for(const [method,path,body] of [['GET','/api/v1/readings/'+record.id,undefined],['DELETE','/api/v1/readings/'+record.id,{}],['PATCH','/api/v1/readings/'+record.id+'/sharing',{shared:true}],['POST','/api/v1/readings/'+record.id+'/interpret',{consent:true}]] as const) {
  const r=await request(path,{cookie:b.cookie,method,body});assert.equal(r.status,404);
 }
 assert.equal((await request('/api/v1/admin/overview',{cookie:b.cookie})).status,403);
 assert.equal((await request('/api/v1/readings?cursor='+record.id,{cookie:b.cookie})).status,404,'pagination cursor must belong to the current user');
 assert.equal((await request('/api/v1/readings',{cookie:a.cookie,method:'POST',body:{...input,cards:[{id:'major-fool'}],requestId:crypto.randomUUID()}})).status,400);
 assert.equal((await request('/api/v1/readings',{cookie:a.cookie,method:'POST',body:input,originOverride:'https://evil.example'})).status,403);
 const sameDay=await Promise.all(Array.from({length:8},()=>request('/api/v1/daily/today',{cookie:a.cookie,method:'POST',body:{}}).then(r=>r.json())));
 assert.equal(new Set(sameDay.map(x=>x.id)).size,1,'database uniqueness must prevent repeat draws');
 const daily=sameDay[0];
 const journal=await request('/api/v1/daily/'+daily.id+'/journal',{cookie:a.cookie,method:'PATCH',body:{note:'PRIVATE-DIARY-CONTENT',mood:'calm',version:0}});
 assert.equal(journal.status,200);
 assert.equal((await request('/api/v1/daily/'+daily.id+'/journal',{cookie:a.cookie,method:'PATCH',body:{note:'stale',mood:null,version:0}})).status,409);
 assert.equal((await request('/api/v1/daily/'+daily.id+'/journal',{cookie:b.cookie,method:'PATCH',body:{note:'intrusion',mood:null,version:1}})).status,404);
 const stored=await db.dailyEntry.findUniqueOrThrow({where:{id:daily.id}});assert.ok(!stored.note.includes('PRIVATE-DIARY-CONTENT'));
 const saved=await db.reading.findUniqueOrThrow({where:{id:record.id}});assert.ok(!saved.question.includes(input.question));assert.equal(open(saved.question,'question:'+a.id+':'+record.id),input.question);
 await db.user.update({where:{id:b.id},data:{role:'admin'}});
 let shared=await request('/api/v1/admin/shared-readings',{cookie:b.cookie});assert.equal((await shared.json()).items.length,0);
 await request('/api/v1/readings/'+record.id+'/sharing',{cookie:a.cookie,method:'PATCH',body:{shared:true}});
 shared=await request('/api/v1/admin/shared-readings',{cookie:b.cookie});const sharedText=await shared.text();assert.ok(sharedText.includes(record.id));assert.ok(!sharedText.includes('PRIVATE-DIARY-CONTENT'));
 assert.equal((await request('/api/v1/daily/'+daily.id+'/journal',{cookie:b.cookie,method:'PATCH',body:{note:'admin intrusion',mood:null,version:1}})).status,404);
 await request('/api/v1/readings/'+record.id+'/sharing',{cookie:a.cookie,method:'PATCH',body:{shared:false}});
 shared=await request('/api/v1/admin/shared-readings',{cookie:b.cookie});assert.equal((await shared.json()).items.length,0);
 const disabled=await request('/api/v1/admin/users/'+a.id+'/status',{cookie:b.cookie,method:'PATCH',body:{disabled:true}});assert.equal(disabled.status,200);
 assert.equal((await request('/api/v1/me',{cookie:a.cookie})).status,401,'disabled sessions must be invalidated immediately');
 await db.user.update({where:{id:b.id},data:{role:'user'}});
 assert.equal((await request('/api/v1/admin/overview',{cookie:b.cookie})).status,403,'role removal must apply without waiting for a token expiry');
 await request('/api/auth/sign-out',{cookie:b.cookie,method:'POST',body:{}});
 assert.equal((await request('/api/v1/me',{cookie:b.cookie})).status,401);
});
test('encryption authenticates ciphertext and Shanghai calendar boundary',()=>{
 const ciphertext=seal('private');
 assert.equal(open(ciphertext),'private');
 const parts=ciphertext.split('.');parts[2]=Buffer.alloc(16).toString('base64');assert.throws(()=>open(parts.join('.')));
 assert.equal(chinaDate(new Date('2026-10-02T15:59:59Z')),'2026-10-02');
 assert.equal(chinaDate(new Date('2026-10-02T16:00:00Z')),'2026-10-03');
});

test('AI uses owned evidence, validates references and persists a global daily request budget',{skip:!process.env.MOCK_TLS_CERT},async()=>{
 await redis.flushdb();
 const owner=await register('ai-owner');
 async function draw(question:string){
  const r=await request('/api/v1/readings',{cookie:owner.cookie,method:'POST',body:{kind:'tarot',question,spread:'single',allowReversed:false,requestId:crypto.randomUUID()}});
  assert.equal(r.status,201);return r.json();
 }
 const record=await draw('今天有什么可以调整？');
 assert.equal((await request('/api/v1/readings/'+record.id+'/interpret',{cookie:owner.cookie,method:'POST',body:{consent:false}})).status,400);
 const first=await request('/api/v1/readings/'+record.id+'/interpret',{cookie:owner.cookie,method:'POST',body:{consent:true}});
 assert.equal(first.status,200);assert.equal((await first.json()).ai,true);
 const calls=providerCalls;
 assert.equal((await request('/api/v1/readings/'+record.id+'/interpret',{cookie:owner.cookie,method:'POST',body:{consent:true}})).status,200);
 assert.equal(providerCalls,calls,'completed AI must be idempotent');
 const invalid=await draw('请返回一个坏引用用于测试');
 assert.equal((await request('/api/v1/readings/'+invalid.id+'/interpret',{cookie:owner.cookie,method:'POST',body:{consent:true}})).status,503);
 assert.equal((await db.reading.findUniqueOrThrow({where:{id:invalid.id}})).ai,false);
 const valid=await draw('还可以采取什么小行动？');
 assert.equal((await request('/api/v1/readings/'+valid.id+'/interpret',{cookie:owner.cookie,method:'POST',body:{consent:true}})).status,200);
 await redis.del('limit:ai:user:'+owner.id);
 const overBudget=await draw('今天还有什么方向值得观察？');
 const count=providerCalls;
 assert.equal((await request('/api/v1/readings/'+overBudget.id+'/interpret',{cookie:owner.cookie,method:'POST',body:{consent:true}})).status,429);
 assert.equal(providerCalls,count,'budget rejection must happen before calling provider');
 assert.equal((await db.aIUsage.findUniqueOrThrow({where:{date:chinaDate()}})).requests,3);
});
function totpCode(secret:string):string {
 const chars='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';let bits='';
 for(const char of secret.toUpperCase().replace(/=+$/,''))bits+=chars.indexOf(char).toString(2).padStart(5,'0');
 const bytes=Buffer.from(bits.match(/.{8}/g)!.map(b=>parseInt(b,2)));
 const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));
 const hash=createHmac('sha1',bytes).update(counter).digest(),offset=hash[hash.length-1]!&15;
 return ((hash.readUInt32BE(offset)&0x7fffffff)%1000000).toString().padStart(6,'0');
}
test('TOTP enrollment, pending login and one-time recovery codes',async()=>{
 await redis.flushdb();
 const owner=await register('totp-owner');
 const enable=await request('/api/auth/two-factor/enable',{cookie:owner.cookie,method:'POST',body:{password:'a-strong-test-password-123',method:'totp'}});
 assert.equal(enable.status,200);const setup=await enable.json();assert.equal(setup.method,'totp');
 const secret=new URL(setup.totpURI).searchParams.get('secret')!;
 const verified=await request('/api/auth/two-factor/verify-totp',{cookie:owner.cookie,method:'POST',body:{code:totpCode(secret),trustDevice:false}});
 assert.equal(verified.status,200);
 const updated=verified.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ')||owner.cookie;
 await request('/api/auth/sign-out',{cookie:updated,method:'POST',body:{}});
 const login=await request('/api/auth/sign-in/email',{method:'POST',body:{email:owner.email,password:'a-strong-test-password-123'}});
 assert.equal(login.status,200);assert.equal((await login.json()).twoFactorRedirect,true);
 const pending=login.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');
 assert.equal((await request('/api/v1/me',{cookie:pending})).status,401,'password alone must not create an authenticated 2FA session');
 const recovery=await request('/api/auth/two-factor/verify-backup-code',{cookie:pending,method:'POST',body:{code:setup.backupCodes[0],trustDevice:false}});
 assert.equal(recovery.status,200);
 const recovered=recovery.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');
 assert.equal((await request('/api/v1/me',{cookie:recovered})).status,200);
 const repeated=await request('/api/auth/two-factor/verify-backup-code',{cookie:recovered,method:'POST',body:{code:setup.backupCodes[0],trustDevice:false}});
 assert.ok(repeated.status>=400,'a consumed recovery code cannot be reused');
});
test('rate limit counter is shared across independent Redis connections',async()=>{
 const key='integration:'+crypto.randomUUID(),second=new Redis(process.env.REDIS_URL!,{maxRetriesPerRequest:1});
 try{
  assert.equal(await consumeLimit(key,1,30),true);
  const count=await second.incr('limit:'+key);
  assert.equal(count,2);assert.equal(await consumeLimit(key,1,30),false);
 }finally{second.disconnect();}
});

test('verified email registration and password reset revoke prior sessions',{skip:!process.env.MAILPIT_URL},async()=>{
 await redis.flushdb();
 const mailBase='http://127.0.0.1:3112',mailpit=process.env.MAILPIT_URL!;
 mailChild=spawn(process.execPath,['dist/main.js'],{cwd:process.cwd(),env:{...process.env,PORT:'3112',API_PUBLIC_URL:mailBase,REQUIRE_EMAIL_VERIFICATION:'true',SMTP_HOST:'127.0.0.1',SMTP_PORT:'1025',SMTP_SECURE:'false',SMTP_FROM:'Oracle <oracle@example.com>'},stdio:['ignore','pipe','pipe']});
 for(let i=0;i<100;i++){try{if((await fetch(mailBase+'/api/v1/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 const send=(path:string,body:unknown,cookie='')=>fetch(mailBase+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)});
 const email='verified-'+crypto.randomUUID()+'@example.com',password='verified-test-password-123';
 const signup=await send('/api/auth/sign-up/email',{name:'Email fixture',email,password,callbackURL:origin+'/account'});
 assert.equal(signup.status,200);
 const unverified=await send('/api/auth/sign-in/email',{email,password});assert.equal(unverified.status,403);
 async function messageLink(fragment:string){
  for(let i=0;i<100;i++){
   const list=await fetch(mailpit+'/api/v1/messages').then(r=>r.json());
   for(const m of list.messages??[]){
    if(!m.To?.some((to:{Address:string})=>to.Address===email))continue;
    const message=await fetch(mailpit+'/api/v1/message/'+m.ID).then(r=>r.json());
    const link=(message.Text as string).match(/https?:\/\/[^\s]+/g)?.find(url=>url.includes(fragment));
    if(link)return link;
   }
   await new Promise(r=>setTimeout(r,100));
  }
  throw new Error('Expected verification/reset email was not delivered');
 }
 const verified=await fetch(await messageLink('verify-email'),{redirect:'manual'});
 assert.equal(verified.status,302);
 const login=await send('/api/auth/sign-in/email',{email,password});assert.equal(login.status,200);
 const cookie=login.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');
 assert.equal((await fetch(mailBase+'/api/v1/me',{headers:{Cookie:cookie}})).status,200);
 const reset=await send('/api/auth/request-password-reset',{email,redirectTo:origin+'/account'});assert.equal(reset.status,200);
 const resetLink=await messageLink('reset-password');
 const redirected=await fetch(resetLink,{redirect:'manual'});
 const token=new URL(redirected.headers.get('location')??resetLink).searchParams.get('token');
 assert.ok(token);
 const changed=await send('/api/auth/reset-password',{token,newPassword:'a-new-verified-password-456'});assert.equal(changed.status,200);
 assert.equal((await fetch(mailBase+'/api/v1/me',{headers:{Cookie:cookie}})).status,401);
 assert.equal((await send('/api/auth/sign-in/email',{email,password})).status,401);
 assert.equal((await send('/api/auth/sign-in/email',{email,password:'a-new-verified-password-456'})).status,200);
 const user=await db.user.findUniqueOrThrow({where:{email}});
 // Ordinary users can delete their account; the server cascades all owned records.
 await db.dailyEntry.create({data:{id:crypto.randomUUID(),userId:user.id,date:'2026-01-01',payload:{},note:seal('fixture')}});
 const signed=await send('/api/auth/sign-in/email',{email,password:'a-new-verified-password-456'});
 const finalCookie=signed.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');
 const deleted=await send('/api/auth/delete-user',{password:'a-new-verified-password-456'},finalCookie);assert.equal(deleted.status,200);
 assert.equal(await db.user.count({where:{id:user.id}}),0);assert.equal(await db.dailyEntry.count({where:{userId:user.id}}),0);
});
