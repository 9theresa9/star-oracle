import { test,before,after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn,type ChildProcess } from 'node:child_process';
import { db,redis,seal,open,chinaDate } from '../src/infrastructure.js';
let child:ChildProcess;
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
 child=spawn(process.execPath,['dist/main.js'],{cwd:process.cwd(),env:process.env,stdio:['ignore','pipe','pipe']});
 // Never print child errors that could contain connection strings.
 for(let i=0;i<100;i++){try{const r=await request('/api/v1/health');if(r.ok)return;}catch{}await new Promise(r=>setTimeout(r,100));}
 throw new Error('Integration API failed to start');
});
after(async()=>{child?.kill('SIGTERM');await db.$disconnect();redis.disconnect();});
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
