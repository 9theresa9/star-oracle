import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
Object.assign(process.env,{NODE_ENV:'test',DATABASE_URL:'mysql://fixture:fixture@127.0.0.1:1/fixture',REDIS_URL:'redis://127.0.0.1:1',AUTH_SECRET:'session-binding-test-fixture-only-secret',DATA_ENCRYPTION_KEY:'ab'.repeat(32)});
const {db,redis}=await import('../src/infrastructure.js');redis.disconnect();
const {auth}=await import('../src/auth.js');const {SessionGuard}=await import('../src/security.js');
after(async()=>db.$disconnect());
test('guard rejects stale page actor or session before a private handler can run',async(t)=>{
 const original=auth.api.getSession;auth.api.getSession=async()=>({user:{id:'B'},session:{id:'session-B'}}) as any;t.after(()=>{auth.api.getSession=original;});
 const originalUser=db.user.findUnique,originalSession=db.session.findUnique;
 db.user.findUnique=(async()=>({id:'B',name:'B',username:'synthetic-b',email:'b@example.test',role:'user',disabled:false,twoFactorEnabled:false})) as any;
 db.session.findUnique=(async()=>({id:'session-B',expiresAt:new Date(Date.now()+60_000)})) as any;
 t.after(()=>{db.user.findUnique=originalUser;db.session.findUnique=originalSession;});
 const binding=createHmac('sha256',process.env.AUTH_SECRET!).update('browser-session:session-B').digest('hex');
 const call=(headers:Record<string,string>)=>{const request:any={headers},response={setHeader:()=>{}};return {request,run:()=>new SessionGuard().canActivate({switchToHttp:()=>({getRequest:()=>request,getResponse:()=>response})} as any)};};
 await assert.rejects(call({'x-expected-actor':'A','x-expected-session':'old'}).run(),error=>error instanceof Error&&'getStatus' in error&&(error as any).getStatus()===409);
 await assert.rejects(call({'x-expected-actor':'B','x-expected-session':'old-session-B'}).run(),error=>error instanceof Error&&'getStatus' in error&&(error as any).getStatus()===409);
 const current=call({'x-expected-actor':'B','x-expected-session':binding});assert.equal(await current.run(),true);assert.equal(current.request.actor.sessionBinding,binding);
});
