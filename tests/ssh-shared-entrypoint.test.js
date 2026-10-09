import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {tsImport} from 'tsx/esm/api';
const path='../apps/api/src/maintenance/shared-entrypoint.ts';
const api=existsSync(new URL(path,import.meta.url))?await tsImport(path,import.meta.url):{};
const uuid='12345678-1234-4234-8234-123456789abc';
const env={DATABASE_URL:'mysql://staroracle_app:'+'a'.repeat(64)+'@oracle-mysql:3306/staroracle?connection_limit=5',SHARED_MYSQL_UUID:uuid,SHARED_MYSQL_VERSION:'8.4.9'};
const interfaces={eth0:[{family:'IPv4',address:'172.30.77.2',internal:false}],eth1:[{family:'IPv4',address:'172.30.78.2',internal:false}]};
function fakeDb({bad=false}={}) {const calls=[];return {calls,async $connect(){calls.push('connect');},async $disconnect(){calls.push('disconnect');},async $queryRawUnsafe(sql){calls.push(sql);if(sql==='SHOW GRANTS')return [{g:'GRANT USAGE ON *.* TO `staroracle_app`@`172.30.78.2`'},{g:'GRANT SELECT, INSERT, UPDATE, DELETE'+(bad?', DROP':'')+' ON `staroracle`.* TO `staroracle_app`@`172.30.78.2`'}];return [{currentUser:'staroracle_app@172.30.78.2',database:'staroracle',serverUuid:uuid,serverVersion:'8.4.9',currentRole:'NONE',mandatoryRoles:''}];}};}
test('shared entrypoint checks exact URL and local source before any DB connection',async()=>{
 assert.equal(typeof api.checkSharedDatabase,'function');
 for(const DATABASE_URL of [env.DATABASE_URL.replace('oracle-mysql','evil.invalid'),env.DATABASE_URL.replace('staroracle_app','root'),env.DATABASE_URL+'&sslaccept=accept_invalid_certs',env.DATABASE_URL.replace('staroracle?','fakejournal?'),env.DATABASE_URL.replace(':3306',':3307')]){
  const db=fakeDb();await assert.rejects(api.checkSharedDatabase({role:'app',env:{...env,DATABASE_URL},interfaces,db}),/SHARED_DB_/);assert.deepEqual(db.calls,[]);
 }
 const db=fakeDb();await assert.rejects(api.checkSharedDatabase({role:'app',env,interfaces:{eth0:[{family:'IPv4',address:'172.30.78.7',internal:false}]},db}),/SHARED_DB_SOURCE/);assert.deepEqual(db.calls,[]);
});
test('actual source connection verifies bare grants and withholds raw provider diagnostics',async()=>{
 assert.equal(typeof api.checkSharedDatabase,'function');
 const db=fakeDb();await api.checkSharedDatabase({role:'app',env,interfaces,db});assert.equal(db.calls[0],'connect');assert.ok(db.calls.includes('SHOW GRANTS'));
 const bad=fakeDb({bad:true});await assert.rejects(api.checkSharedDatabase({role:'app',env,interfaces,db:bad}),/SHARED_DB_GRANTS/);
 const broken=fakeDb();broken.$connect=async()=>{throw new Error('mysql://private-password.invalid')};await assert.rejects(api.checkSharedDatabase({role:'app',env,interfaces,db:broken}),error=>error.message==='SHARED_DB_CONNECTION');
});
test('server startup and migration execution remain unreachable after a failed identity check',async()=>{
 assert.equal(typeof api.runSharedEntrypoint,'function');
 let launched=false;const db=fakeDb({bad:true});
 await assert.rejects(api.runSharedEntrypoint(['app','serve'],{env,interfaces,createDatabase:()=>db,serve:async()=>{launched=true}}),/SHARED_DB_GRANTS/);
 assert.equal(launched,false);assert.ok(db.calls.includes('disconnect'));
 const valid=fakeDb();await api.runSharedEntrypoint(['app','serve'],{env,interfaces,createDatabase:()=>valid,serve:async()=>{launched=true;assert.equal(valid.calls.at(-1),'disconnect')}});assert.equal(launched,true);
});
