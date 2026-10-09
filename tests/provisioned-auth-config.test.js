import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const env={...process.env,NODE_ENV:'production',WEB_ORIGIN:'https://oracle.example.test',API_PUBLIC_URL:'https://oracle.example.test',DATABASE_URL:'mysql://fixture:unused@localhost/star_oracle',REDIS_URL:'redis://:fixture-only-password@localhost:6379',AUTH_SECRET:'fixture-auth-secret-for-config-test-1234567890',DATA_ENCRYPTION_KEY:'1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',ADMIN_REQUIRE_2FA:'true'};
for(const key of Object.keys(env))if(key.startsWith('SMTP_')||key==='REQUIRE_EMAIL_VERIFICATION')delete env[key];
function check(overrides={}){return spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',"await import('./apps/api/src/config.ts')"],{env:{...env,...overrides},encoding:'utf8'});}
test('precreated production accounts require no SMTP configuration',()=>{const result=check();assert.equal(result.status,0,'production without SMTP must start safely');});
test('precreated mode retains HTTPS, administrator 2FA and authenticated Redis',()=>{
 for(const overrides of [{WEB_ORIGIN:'http://oracle.example.test'},{API_PUBLIC_URL:'http://oracle.example.test'},{ADMIN_REQUIRE_2FA:'false'},{REDIS_URL:'redis://localhost:6379'}])assert.notEqual(check(overrides).status,0);
});
