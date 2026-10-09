import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {createCipheriv,randomBytes} from 'node:crypto';
import {tsImport} from 'tsx/esm/api';
import {symmetricEncrypt} from 'better-auth/crypto';
const path='../apps/api/src/maintenance/shared-recovery.ts';
const recovery=existsSync(new URL(path,import.meta.url))?await tsImport(path,import.meta.url):{};
const key='2'.repeat(64),secret='original-legacy-auth-secret-unchanged';
function seal(text,context){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',Buffer.from(key,'hex'),iv);cipher.setAAD(Buffer.from(context));const body=Buffer.concat([cipher.update(text),cipher.final()]);return ['v1',iv.toString('base64'),cipher.getAuthTag().toString('base64'),body.toString('base64')].join('.')}
test('candidate ciphertext validation authenticates original key and row ownership context without exposing content',async()=>{
 assert.equal(typeof recovery.validateEncryptedRecoveryRow,'function');
 const row={id:'r1',userId:'u1',question:seal('private test question','question:u1:r1'),interpretation:null,tagsCipher:null,annotation:null};
 assert.equal(await recovery.validateEncryptedRecoveryRow('reading',row,key,secret),1);
 for(const changed of [{...row,userId:'u2'},{...row,id:'r2'},{...row,question:'malformed-private-record'}])await assert.rejects(recovery.validateEncryptedRecoveryRow('reading',changed,key,secret),error=>error.message==='SHARED_RESTORE_CIPHERTEXT');
 await assert.rejects(recovery.validateEncryptedRecoveryRow('reading',row,'3'.repeat(64),secret),/SHARED_RESTORE_CIPHERTEXT/);
});
test('candidate TOTP and backup codes require the original authentication secret',async()=>{
 assert.equal(typeof recovery.validateEncryptedRecoveryRow,'function');
 const row={id:'t1',userId:'u1',secret:await symmetricEncrypt({key:secret,data:'JBSWY3DPEHPK3PXP'}),backupCodes:await symmetricEncrypt({key:secret,data:JSON.stringify(['abcde-fghij'])})};
 assert.equal(await recovery.validateEncryptedRecoveryRow('twoFactor',row,key,secret),2);
 await assert.rejects(recovery.validateEncryptedRecoveryRow('twoFactor',row,key,'replacement-secret-that-breaks-totp'),/SHARED_RESTORE_CIPHERTEXT/);
});
test('candidate full-data pass rejects orphan and cross-owner relations even if imported foreign keys were disabled',async()=>{
 assert.equal(typeof recovery.verifyCandidateData,'function');
 for(const bad of [false,true]){
  let queries=0;const db={$queryRawUnsafe:async sql=>{queries++;assert.match(sql,/LEFT JOIN/);return [{invalid:bad&&queries===1?1n:0n}];}};
  for(const model of ['reading','dailyEntry','actionPlan','feedback','reviewReport','aIRequest','readingConversation','twoFactor'])db[model]={findMany:async()=>[]};
  if(bad)await assert.rejects(recovery.verifyCandidateData(db,{dataKey:key,authSecret:secret}),/SHARED_RESTORE_OWNERSHIP/);
  else{const result=await recovery.verifyCandidateData(db,{dataKey:key,authSecret:secret});assert.ok(result.ownershipChecks>=18);assert.equal(result.ciphertextsChecked,0);assert.equal(result.rowsChecked,0);}
 }
});
test('offline recovery uses only a fresh candidate Redis and the existing session revocation service',async()=>{
 assert.equal(typeof recovery.verifyCandidateRecovery,'function');
 const env={SHARED_CANDIDATE_DATABASE:'staroraclerestoreabc',DATA_ENCRYPTION_KEY:key,AUTH_SECRET_BASE64:Buffer.from(secret).toString('base64'),REDIS_URL:'redis://:'+'4'.repeat(64)+'@candidate-redis:6379'};
 for(const nonempty of [false,true]){
  let closed=false,removed=false;
  const db={$queryRawUnsafe:async()=>[{invalid:0n}],user:{findMany:async()=>[]},session:{count:async()=>0},verification:{count:async()=>0,deleteMany:async()=>{removed=true;return {count:0}}}};
  for(const model of ['reading','dailyEntry','actionPlan','feedback','reviewReport','aIRequest','readingConversation','twoFactor'])db[model]={findMany:async()=>[]};
  const createRedis=async url=>{assert.equal(url,env.REDIS_URL);return {on(){},connect:async()=>{},dbsize:async()=>nonempty?1:0,disconnect(){closed=true}}};
  if(nonempty)await assert.rejects(recovery.verifyCandidateRecovery(db,env,{createRedis}),/SHARED_RESTORE_CACHE/);
  else{const result=await recovery.verifyCandidateRecovery(db,env,{createRedis});assert.equal(result.automatedOfflineVerified,true);assert.equal(removed,true);assert.ok(result.ownershipChecks>=18);}
  assert.equal(closed,true);
 }
 let connected=false;await assert.rejects(recovery.verifyCandidateRecovery({}, {...env,REDIS_URL:env.REDIS_URL.replace('candidate-redis','redis')},{createRedis:async()=>{connected=true}}),/SHARED_RESTORE_CACHE/);assert.equal(connected,false);
});
