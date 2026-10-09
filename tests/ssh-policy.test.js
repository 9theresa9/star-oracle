import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

const env={...process.env,NODE_ENV:'production',DEPLOYMENT_MODE:'ssh-only',SSH_ONLY_CONTAINER:'false',WEB_ORIGIN:'http://localhost:17777',API_PUBLIC_URL:'http://localhost:17777',DATABASE_URL:'mysql://fixture:unused@localhost/star_oracle',REDIS_URL:'redis://:synthetic-only-password@localhost:6379',AUTH_SECRET:'synthetic-auth-secret-for-config-test-1234567890',DATA_ENCRYPTION_KEY:'1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',ADMIN_REQUIRE_2FA:'true',TRUST_PROXY:'false'};
function check(overrides={}){return spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',"const {config}=await import('./apps/api/src/config.ts');console.log(JSON.stringify({mode:config.DEPLOYMENT_MODE,bind:config.LISTEN_HOST,secure:config.SECURE_COOKIES,prefix:config.COOKIE_PREFIX}))"],{env:{...env,...overrides},encoding:'utf8'});}
test('explicit production SSH mode has loopback listener and a separate non-Secure cookie family',()=>{
 const result=check();assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout),{mode:'ssh-only',bind:'127.0.0.1',secure:false,prefix:'star-oracle-ssh'});
});
test('SSH origins reject normalized aliases, paths, IPv6, public and LAN addresses',()=>{
 for(const origin of ['http://localhost:17777/','http://LOCALHOST:17777','http://localhost.:17777','http://127.0.0.1:17777','http://[::1]:17777','http://[::ffff:127.0.0.1]:17777','http://2130706433:17777','http://localhost:80','https://localhost:17777','http://localhost:17777?x=1','http://localhost:17777#x','http://a@localhost:17777','http://localhost:17777/path','http://localhost:17777\\@evil.test','http://0.0.0.0:17777','http://192.168.1.1:17777','http://oracle.test:17777','http://*.localhost:17777']){
  for(const key of ['WEB_ORIGIN','API_PUBLIC_URL'])assert.notEqual(check({[key]:origin}).status,0,key+' '+origin);
 }
});
test('SSH mode cannot disable production security controls or trust client proxy headers',()=>{
 for(const overrides of [{NODE_ENV:'development'},{NODE_ENV:'test'},{ADMIN_REQUIRE_2FA:'false'},{TRUST_PROXY:'loopback'},{TRUST_PROXY:'linklocal,uniquelocal'},{REDIS_URL:'redis://localhost:6379'},{AUTH_SECRET:'development-secret-at-least-32-characters'},{DEPLOYMENT_MODE:'ssh_only'},{SSH_ONLY_CONTAINER:'yes'}])assert.notEqual(check(overrides).status,0,JSON.stringify(overrides));
});
test('default HTTPS production policy remains Secure and rejects HTTP and SSH-only options',()=>{
 const secure=check({DEPLOYMENT_MODE:'https',WEB_ORIGIN:'https://oracle.example.test',API_PUBLIC_URL:'https://oracle.example.test'});assert.equal(secure.status,0,secure.stderr);assert.deepEqual(JSON.parse(secure.stdout),{mode:'https',bind:'0.0.0.0',secure:true,prefix:'better-auth'});
 for(const overrides of [{DEPLOYMENT_MODE:'https'},{DEPLOYMENT_MODE:'https',WEB_ORIGIN:'https://oracle.example.test',API_PUBLIC_URL:'https://oracle.example.test',SSH_ONLY_CONTAINER:'true'}])assert.notEqual(check(overrides).status,0);
});
test('Better Auth applies the transport policy to sessions, TOTP and trusted-device cookie families',()=>{
 const script="const {auth}=await import('./apps/api/src/auth.ts');const {redis,db}=await import('./apps/api/src/infrastructure.ts');try{const ctx=await auth.$context;console.log(JSON.stringify(['session_token','two_factor','trust_device','dont_remember'].map(name=>ctx.createAuthCookie(name))));}finally{redis.disconnect();await db.$disconnect();}";
 for(const mode of ['ssh-only','https']){
  const https=mode==='https';
  const result=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',script],{env:{...env,DEPLOYMENT_MODE:mode,...(https?{WEB_ORIGIN:'https://oracle.example.test',API_PUBLIC_URL:'https://oracle.example.test'}:{}),REDIS_URL:'redis://:synthetic-only-password@127.0.0.1:1'},encoding:'utf8',timeout:15000});
  assert.equal(result.status,0,result.stderr);
  for(const cookie of JSON.parse(result.stdout)){
   assert.ok(cookie.name.startsWith(https?'__Secure-better-auth.':'star-oracle-ssh.'));
   assert.deepEqual(cookie.attributes,{secure:https,sameSite:'lax',path:'/',httpOnly:true});
   assert.equal(cookie.attributes.domain,undefined);
  }
 }
});
