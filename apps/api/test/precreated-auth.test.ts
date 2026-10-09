import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {createApp} from '../dist/main.js';
import {db,redis,connectRedis} from '../dist/infrastructure.js';
let app:Awaited<ReturnType<typeof createApp>>,base:string;
const origin='http://localhost:5173';
async function startApp(){app=await createApp();const server=await app.listen(0,'127.0.0.1');base='http://127.0.0.1:'+server.address().port;}
before(async()=>{
 const database=new URL(process.env.DATABASE_URL??''),cache=new URL(process.env.REDIS_URL??'');
 if(process.env.NODE_ENV!=='test'||!['localhost','127.0.0.1'].includes(database.hostname)||!['localhost','127.0.0.1'].includes(cache.hostname)||database.pathname!=='/star_oracle')throw new Error('Isolated loopback test services required');
 await connectRedis();await redis.flushdb();await startApp();
});
after(async()=>{await app?.close();await db.$disconnect();redis.disconnect();});
test('public signup is closed in server auth dispatcher, not only hidden by the UI',async()=>{
 const email=crypto.randomUUID()+'@closed-signup.invalid';
 const r=await fetch(base+'/api/auth/sign-up/email',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({name:'Synthetic disabled signup',email,password:'synthetic-password-only-123'})});
 assert.equal(r.status,404);assert.equal(await db.user.count({where:{email}}),0);
});
test('email and profile mutation endpoints are disabled, including query and trailing slash forms',async()=>{
 for(const path of ['/sign-in/email','/request-password-reset','/reset-password','/send-verification-email','/verify-email','/change-email','/change-password','/update-user','/is-username-available','/two-factor/send-otp','/sign-up/email/']){
  const r=await fetch(base+'/api/auth'+path+'?token=synthetic-rejected-token',{method:path==='/verify-email'?'GET':'POST',headers:{Origin:origin,'Content-Type':'application/json'},...(path==='/verify-email'?{}:{body:'{}'})});assert.equal(r.status,404,path);
 }
});

test('username sign-in preserves TOTP boundaries and rejects disabled or unassigned legacy users',async()=>{
 await redis.flushdb();
 const {provisionAccount}=await import('../src/maintenance/account-service.js');
 const username='contract-'+crypto.randomUUID().slice(0,12),password='Synthetic-new-user-password-123';
 const user=await provisionAccount(db,{username,name:'Synthetic username contract',password});
 const send=(path:string,body:unknown,cookie='')=>fetch(base+'/api/auth'+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)});
 try{
  assert.equal(user.emailVerified,false);assert.ok(user.email.endsWith('@accounts.invalid'));
  let response=await send('/sign-in/username',{username:username.toUpperCase(),password});assert.equal(response.status,200);
  const cookie=response.headers.getSetCookie().map((v:string)=>v.split(';')[0]).join('; ');assert.ok(cookie);
  assert.equal((await fetch(base+'/api/v1/me',{headers:{Cookie:cookie}})).status,200);
  assert.equal((await send('/sign-in/username',{username,password:'Wrong-synthetic-password'})).status,401);
  assert.ok((await send('/sign-in/username',{username:'Kelvin-user',password})).status>=400);
  await db.user.update({where:{id:user.id},data:{disabled:true}});
  assert.equal((await send('/sign-in/username',{username,password})).status,401);
  for(const path of ['/api/v1/me','/api/auth/get-session'])assert.equal((await fetch(base+path,{headers:{Cookie:cookie}})).status,401,path);
  await db.user.update({where:{id:user.id},data:{disabled:false,username:null}});
  assert.equal((await fetch(base+'/api/v1/me',{headers:{Cookie:cookie}})).status,401);
  assert.equal((await send('/sign-in/username',{username,password})).status,401);
 }finally{await db.user.delete({where:{id:user.id}});}
});

test('stale Redis session cannot mutate account security without expected-actor headers',async()=>{
 await redis.flushdb();
 const {provisionAccount}=await import('../src/maintenance/account-service.js');
 const username='stale-'+crypto.randomUUID().slice(0,12),password='Synthetic-stale-password-123';
 const user=await provisionAccount(db,{username,name:'Synthetic stale session',password});
 const send=(path:string,body:unknown,cookie='')=>fetch(base+'/api/auth'+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)});
 try{
  const signed=await send('/sign-in/username',{username,password});assert.equal(signed.status,200);
  const cookie=signed.headers.getSetCookie().map((v:string)=>v.split(';')[0]).join('; ');
  await db.session.deleteMany({where:{userId:user.id}});
  for(const path of ['/two-factor/enable','/two-factor/disable','/two-factor/verify-totp','/two-factor/verify-backup-code','/delete-user'])assert.equal((await send(path,{password,method:'totp',code:'000000'},cookie)).status,401,path);
  assert.equal((await fetch(base+'/api/auth/get-session',{headers:{Cookie:cookie}})).status,401);
  assert.equal((await db.user.findUniqueOrThrow({where:{id:user.id}})).twoFactorEnabled,false);
 }finally{await db.user.delete({where:{id:user.id}});}
});

test('username sign-in is rate limited independently of removed email routes',async()=>{
 await redis.flushdb();const statuses:number[]=[];
 for(let i=0;i<6;i++)statuses.push((await fetch(base+'/api/auth/sign-in/username',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({username:'synthetic-missing',password:'Synthetic-non-account-password-123'})})).status);
 assert.deepEqual(statuses,[401,401,401,401,401,429]);
});

function totp(secret:string){
 const chars='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';let bits='';for(const char of secret.toUpperCase().replace(/=+$/,''))bits+=chars.indexOf(char).toString(2).padStart(5,'0');
 const bytes=Buffer.from(bits.match(/.{8}/g)!.map(b=>parseInt(b,2))),counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));
 const hash=createHmac('sha1',bytes).update(counter).digest(),offset=hash[hash.length-1]!&15;return ((hash.readUInt32BE(offset)&0x7fffffff)%1000000).toString().padStart(6,'0');
}
test('offline reset revokes actual sessions, pending TOTP and trusted devices while retaining TOTP and another user',async()=>{
 await redis.flushdb();
 const {provisionAccount,resetAccountPassword}=await import('../src/maintenance/account-service.js');
 const password='Synthetic-offline-old-password',newPassword='Synthetic-offline-new-password';
 const username='reset-'+crypto.randomUUID().slice(0,12),othername='other-'+crypto.randomUUID().slice(0,12);
 const user=await provisionAccount(db,{username,name:'Synthetic reset contract',password}),other=await provisionAccount(db,{username:othername,name:'Synthetic reset other',password});
 const send=(path:string,body:unknown,cookie='')=>fetch(base+'/api/auth'+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)});
 const cookies=(r:Response)=>r.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');
 try{
  const otherLogin=await send('/sign-in/username',{username:othername,password});assert.equal(otherLogin.status,200);const otherCookie=cookies(otherLogin);
  const login=await send('/sign-in/username',{username,password});assert.equal(login.status,200);const initialCookie=cookies(login);
  const enable=await send('/two-factor/enable',{password,method:'totp'},initialCookie);assert.equal(enable.status,200);const setup=await enable.json(),secret=new URL(setup.totpURI).searchParams.get('secret')!;
  const verified=await send('/two-factor/verify-totp',{code:totp(secret),trustDevice:false},initialCookie);assert.equal(verified.status,200);const verifiedCookie=cookies(verified)||initialCookie;
  await send('/sign-out',{},verifiedCookie);
  const firstChallenge=await send('/sign-in/username',{username,password});assert.equal((await firstChallenge.json()).twoFactorRedirect,true);
  const trusted=await send('/two-factor/verify-totp',{code:totp(secret),trustDevice:true},cookies(firstChallenge));assert.equal(trusted.status,200);const oldCookie=cookies(trusted);
  assert.match(oldCookie,/trust_device/);
  const pending=await send('/sign-in/username',{username,password});assert.equal((await pending.json()).twoFactorRedirect,true);const pendingCookie=cookies(pending);
  const priorFactor=await db.twoFactor.findFirstOrThrow({where:{userId:user.id}});
  // Deliberately stop the only app before exercising the supported offline reset.
  await app.close();await resetAccountPassword(db,redis,{username,password:newPassword});
  // Keep real login/TOTP limits intact: the setup above consumes the same IP's
  // 5/min password allowance. Do not FLUSH Redis and accidentally weaken the
  // reset revocation assertions; wait for both rate windows to expire.
  await new Promise(resolve=>setTimeout(resolve,61_000));await startApp();
  assert.equal((await fetch(base+'/api/v1/me',{headers:{Cookie:oldCookie}})).status,401);
  assert.equal((await fetch(base+'/api/v1/me',{headers:{Cookie:otherCookie}})).status,200);
  assert.equal((await send('/two-factor/verify-totp',{code:totp(secret),trustDevice:false},pendingCookie)).status,401);
  assert.equal((await send('/sign-in/username',{username,password})).status,401);
  const next=await send('/sign-in/username',{username,password:newPassword},oldCookie);assert.equal(next.status,200);assert.equal((await next.json()).twoFactorRedirect,true,'old trusted device must not bypass the second factor');
  const afterFactor=await db.twoFactor.findFirstOrThrow({where:{userId:user.id}});assert.equal(afterFactor.secret,priorFactor.secret);assert.equal(afterFactor.backupCodes,priorFactor.backupCodes);
  const complete=await send('/two-factor/verify-totp',{code:totp(secret),trustDevice:false},cookies(next));assert.equal(complete.status,200);assert.equal((await fetch(base+'/api/v1/me',{headers:{Cookie:cookies(complete)}})).status,200);
 }finally{await db.user.deleteMany({where:{id:{in:[user.id,other.id]}}});}
});
