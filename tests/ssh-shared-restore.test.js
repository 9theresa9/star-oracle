import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdtempSync,rmSync,readFileSync,readdirSync,writeFileSync,statSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {gzipSync} from 'node:zlib';
const path='../scripts/ssh-shared-restore.mjs';
const restore=existsSync(new URL(path,import.meta.url))?await import(path):{};
const uuid='12345678-1234-4234-8234-123456789abc';
const audit=database=>({schema:database,tablesOnly:true,serverUuid:uuid,reviewedAt:'2026-10-08T00:00:00Z',noAnonymousAccounts:true,noFallbackAccounts:true,noRolesOrExtraGrants:true});
function offlineFixture(data=gzipSync('CREATE TABLE synthetic (id INT);\n')){
 const temporaryRoot=mkdtempSync(join(tmpdir(),'shared-restore-'));const archive=join(temporaryRoot,'backup.age'),identityFile=join(temporaryRoot,'identity');
 writeFileSync(archive,data,{mode:0o600});writeFileSync(identityFile,'# synthetic unit-test identity\nAGE-SECRET-KEY-1'+'Q'.repeat(58)+'\n',{mode:0o600});
 return {archive,identityFile,temporaryRoot,close:()=>rmSync(temporaryRoot,{recursive:true,force:true})};
}
function decryptProcess(fail=false){return(binary,args,options)=>{assert.equal(binary,'age');assert.ok(args.includes('/proc/self/fd/3'));assert.equal(args.at(-1),'/proc/self/fd/4');return spawn(process.execPath,['-e',"const fs=require('fs');process.stdout.write(fs.readFileSync(4));process.exitCode="+(fail?1:0)],options);};}
test('whole authentication and gzip integrity complete in private bounded storage before restore returns',async()=>{
 assert.equal(typeof restore.prepareAuthenticatedRestore,'function');const f=offlineFixture();
 try{const p=await restore.prepareAuthenticatedRestore({...f,spawnProcess:decryptProcess()});assert.equal(readFileSync(p.sqlPath,'utf8'),'CREATE TABLE synthetic (id INT);\n');assert.equal(statSync(p.privateDir).mode&0o777,0o700);assert.equal(statSync(p.sqlPath).mode&0o777,0o400);p.cleanup();assert.equal(existsSync(p.privateDir),false);}finally{f.close();}
});
test('final age failure invalid gzip and decompression limit publish no prepared restore',async()=>{
 assert.equal(typeof restore.prepareAuthenticatedRestore,'function');
 for(const mode of ['age','gzip','bound']){const f=offlineFixture(mode==='gzip'?Buffer.from('not gzip'):gzipSync('X'.repeat(4096)));
  try{await assert.rejects(restore.prepareAuthenticatedRestore({...f,spawnProcess:decryptProcess(mode==='age'),maxPlaintextBytes:mode==='bound'?32:8192}),error=>error.message==='SHARED_RESTORE_ARCHIVE');assert.deepEqual(readdirSync(f.temporaryRoot).sort(),['backup.age','identity']);}finally{f.close();}}
});
test('identity plugins symlinks loose secrets and unbounded options reject before any process',async()=>{
 assert.equal(typeof restore.prepareAuthenticatedRestore,'function');
 for(const mode of ['plugin','symlink','permissions','limit']){const f=offlineFixture();let spawned=false;
  if(mode==='plugin')writeFileSync(f.identityFile,'AGE-PLUGIN-UNTRUSTED-1XYZ\n');
  if(mode==='symlink'){const link=join(f.temporaryRoot,'link');symlinkSync(f.identityFile,link);f.identityFile=link;}
  if(mode==='permissions'){const {chmodSync}=await import('node:fs');chmodSync(f.identityFile,0o644);}
  try{await assert.rejects(restore.prepareAuthenticatedRestore({...f,maxPlaintextBytes:mode==='limit'?Infinity:10000,spawnProcess:()=>{spawned=true;throw new Error('must not spawn')}}),/SHARED_RESTORE_/);assert.equal(spawned,false);}finally{f.close();}}
});
test('candidate declaration requires a fresh bounded alphanumeric schema and its own trusted audit',()=>{
 assert.equal(typeof restore.validateCandidateInput,'function');
 const candidate={format:1,database:'staroraclerestoreabc123',provisioningAudit:audit('staroraclerestoreabc123')};
 assert.deepEqual(restore.validateCandidateInput(candidate,uuid),candidate);
 for(const value of [{...candidate,database:'staroracle'},{...candidate,database:'staroraclerestore_abc'},{...candidate,database:'staroraclerestore'+'x'.repeat(13)},{...candidate,provisioningAudit:audit('staroracle')},{...candidate,host:'elsewhere'},{format:1,database:candidate.database}])assert.throws(()=>restore.validateCandidateInput(value,uuid),/SHARED_/);
});
function candidateFixture(privateDir,{nonempty=false,importFails=false}={}){
 const database='staroraclerestoreabc123',candidate={format:1,database,provisioningAudit:audit(database)},candidateSettings={IMPORTER_PASSWORD:'1'.repeat(64),MIGRATOR_PASSWORD:'2'.repeat(64),APP_PASSWORD:'3'.repeat(64),REDIS_PASSWORD:'4'.repeat(64)};
 const calls=[];let redisExists=false;const redisId='d'.repeat(64),images=[{tag:'star-oracle-mysql-client:local',id:'sha256:'+'a'.repeat(64)},{tag:'star-oracle-api:local',id:'sha256:'+'b'.repeat(64)},{tag:'redis:7.4',id:'sha256:'+'c'.repeat(64)}];
 const context={privateDir,settings:{MYSQL_PASSWORD:'5'.repeat(64),MYSQL_MIGRATION_PASSWORD:'6'.repeat(64),MYSQL_BACKUP_PASSWORD:'7'.repeat(64),MYSQL_MAINTENANCE_PASSWORD:'8'.repeat(64),REDIS_PASSWORD:'9'.repeat(64),DATA_ENCRYPTION_KEY:'e'.repeat(64),AUTH_SECRET:'legacy-auth-secret-at-least-thirty-two-characters'},input:{externalMysql:{serverUuid:uuid,serverVersion:'8.4.9'}},manifest:{images},run(args){
  calls.push(args);
  if(args.includes('volume')&&args.includes('ls'))return '';
  if(args.includes('volume')&&args.includes('create'))return 'star-oracle-shared-candidate-abc123-redis';
  if(args.includes('ps')){assert.ok(args.includes('--no-trunc'),'cleanup needs full container IDs');return redisExists?redisId:'';}
  if(args.includes('inspect'))return JSON.stringify([{Id:redisId,Image:images[2].id,Name:'/star-oracle-shared-candidate-abc123',Config:{Labels:{'io.star-oracle.deployment':'ssh-shared','io.star-oracle.candidate':'true','com.docker.compose.project':'star-oracle-shared'}},State:{Running:true},NetworkSettings:{Networks:{'star-oracle-shared-backend':{IPAddress:'172.30.78.8'}}}}]);
  if(args.includes('stop'))return redisId;if(args.includes('rm')){redisExists=false;return redisId;}
  if(args.includes('exec'))return 'PONG';
  if(args.some(a=>a.startsWith('--name=star-oracle-shared-candidate-'))){redisExists=true;return redisId;}
  if(args.includes('mysql')){if(args.at(-1).includes('COUNT(*)'))return nonempty?'1':'0';return [JSON.stringify({currentUser:'sor_i_abc123@172.30.78.7',serverUuid:uuid,serverVersion:'8.4.9',database,currentRole:'NONE',mandatoryRoles:''}),'GRANT USAGE ON *.* TO `sor_i_abc123`@`172.30.78.7`','GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES, DROP ON `'+database+'`.* TO `sor_i_abc123`@`172.30.78.7`'].join('\n');}
  if(args.includes('verify'))return JSON.stringify({automatedOfflineVerified:true,rowsChecked:5,ciphertextsChecked:8,ownershipChecks:20,sessionsRemaining:0,verificationsRemaining:0});
  return '';
 }};
 const spawnProcess=(binary,args,options)=>{assert.equal(binary,'docker');assert.ok(args.includes('--log-driver=none'));assert.ok(args.includes('--binary-mode=1'));assert.ok(args.includes('--local-infile=0'));assert.ok(args.includes('--database='+database));assert.ok(!args.some(a=>a==='--force'||a==='--user=root'));calls.push(['import']);return spawn(process.execPath,['-e',"process.stdin.resume();process.stdin.on('end',()=>{process.exitCode="+(importFails?1:0)+"})"],options);};
 return {context,candidate,candidateSettings,calls,spawnProcess};
}
test('restore refuses forged preparation, original credentials, and nonempty candidates before importing',async()=>{
 assert.equal(typeof restore.restoreSharedCandidate,'function');
 const f=offlineFixture();try{
  const c=candidateFixture(f.temporaryRoot);await assert.rejects(restore.restoreSharedCandidate({...c,prepared:{sqlPath:f.archive}}),/SHARED_RESTORE_PREPARED/);assert.equal(c.calls.length,0);
  const prepared=await restore.prepareAuthenticatedRestore({...f,spawnProcess:decryptProcess()});
  try{const unsafe=candidateFixture(f.temporaryRoot);unsafe.candidateSettings.APP_PASSWORD=unsafe.context.settings.MYSQL_PASSWORD;await assert.rejects(restore.restoreSharedCandidate({...unsafe,prepared}),/SHARED_RESTORE_SECRETS/);assert.equal(unsafe.calls.length,0);
   const full=candidateFixture(f.temporaryRoot,{nonempty:true});await assert.rejects(restore.restoreSharedCandidate({...full,prepared}),/SHARED_RESTORE_NOT_EMPTY/);assert.ok(!full.calls.some(a=>a[0]==='import'));
  }finally{prepared.cleanup();}
 }finally{f.close();}
});
test('restore sequences restricted import, migrations, fresh isolated Redis, offline validation and owned cleanup',async()=>{
 assert.equal(typeof restore.restoreSharedCandidate,'function');const f=offlineFixture();
 try{const prepared=await restore.prepareAuthenticatedRestore({...f,spawnProcess:decryptProcess()});const c=candidateFixture(f.temporaryRoot);
  try{const result=await restore.restoreSharedCandidate({...c,prepared});assert.equal(result.automatedOfflineVerified,true);assert.equal(result.manualCutoverRequired,true);assert.equal(result.ciphertextsChecked,8);
   const importIndex=c.calls.findIndex(a=>a[0]==='import');for(const action of ['migrate','status','diff','verify'])assert.ok(c.calls.findIndex(a=>a.at(-1)===action)>importIndex,action);
   const redis=c.calls.find(a=>a.some(v=>v.startsWith('--name=star-oracle-shared-candidate-')));assert.ok(redis.includes('--ip=172.30.78.8'));assert.ok(redis.includes('--memory=64m'));assert.ok(redis.includes('--pull=never'));assert.ok(redis.includes('--log-driver=none'));
   assert.ok(c.calls.some(a=>a.includes('stop')&&a.at(-1)==='d'.repeat(64)));assert.ok(c.calls.some(a=>a.includes('rm')&&a.at(-1)==='d'.repeat(64)));
   assert.ok(!c.calls.some(a=>a.includes('network')||a.includes('FLUSHDB')||a.includes('FLUSHALL')));
  }finally{prepared.cleanup();}
 }finally{f.close();}
});
test('SQL importer failure blocks migrations and candidate Redis creation without touching the original',async()=>{
 assert.equal(typeof restore.restoreSharedCandidate,'function');const f=offlineFixture();try{const prepared=await restore.prepareAuthenticatedRestore({...f,spawnProcess:decryptProcess()});const c=candidateFixture(f.temporaryRoot,{importFails:true});try{await assert.rejects(restore.restoreSharedCandidate({...c,prepared}),/SHARED_RESTORE_IMPORT/);assert.ok(!c.calls.some(a=>a.at(-1)==='migrate'||a.some(v=>v.startsWith('--name=star-oracle-shared-candidate-'))));}finally{prepared.cleanup();}}finally{f.close();}
});
test('candidate secret file accepts only four independent role secrets with private-file enforcement',async()=>{
 assert.equal(typeof restore.loadCandidateSettings,'function');const f=offlineFixture();
 try{const path=join(f.temporaryRoot,'candidate.env'),settings={IMPORTER_PASSWORD:'1'.repeat(64),MIGRATOR_PASSWORD:'2'.repeat(64),APP_PASSWORD:'3'.repeat(64),REDIS_PASSWORD:'4'.repeat(64)};
  writeFileSync(path,Object.entries(settings).map(([k,v])=>k+'='+v).join('\n'),{mode:0o600});assert.deepEqual(restore.loadCandidateSettings(path),settings);
  for(const extra of ['\nDATABASE_URL=mysql://root@other','\nAPP_PASSWORD='+'3'.repeat(64),'\nSHELL=$(secret)']){writeFileSync(path,Object.entries(settings).map(([k,v])=>k+'='+v).join('\n')+extra);assert.throws(()=>restore.loadCandidateSettings(path),/SHARED_RESTORE_SECRETS/);}
 }finally{f.close();}
});
test('candidate API workers cannot serve ingress and carry only pinned .7 offline configuration',()=>{
 assert.equal(typeof restore.candidateApiArguments,'function');const base={envFile:'/private/role.env',imageId:'sha256:'+'a'.repeat(64),role:'candidateApp',action:'verify'};
 const args=restore.candidateApiArguments(base);for(const value of ['--log-driver=none','--pull=never','--ip=172.30.78.7','--memory=512m','--memory-swap=512m','--read-only','--user=1000:1000','--name=star-oracle-shared-worker'])assert.ok(args.includes(value));
 for(const change of [{action:'serve'},{role:'app'},{imageId:'arbitrary:latest'}])assert.throws(()=>restore.candidateApiArguments({...base,...change}),/SHARED_/);
});
test('restore CLI rejects ambiguous arguments without loading deployment files or contacting Docker',async()=>{
 assert.equal(typeof restore.restoreMain,'function');
 for(const args of [[],['relative'],Array(7).fill('/private/file')])await assert.rejects(restore.restoreMain(args),/SHARED_RESTORE_USAGE/);
});
test('archive abort cleans decrypted private data and never hands back a usable preparation',async()=>{
 const f=offlineFixture(),controller=new AbortController();
 const spawnProcess=(binary,args,options)=>spawn(process.execPath,['-e',"process.stdout.write(require('fs').readFileSync(4));setTimeout(()=>process.exit(0),200)"],options);
 try{const work=restore.prepareAuthenticatedRestore({...f,signal:controller.signal,spawnProcess});setTimeout(()=>controller.abort(),20);await assert.rejects(work,/SHARED_RESTORE_ARCHIVE/);assert.deepEqual(readdirSync(f.temporaryRoot).sort(),['backup.age','identity']);}finally{f.close();}
});
test('aborted maintenance never starts candidate probes or imports',async()=>{
 const f=offlineFixture();try{const prepared=await restore.prepareAuthenticatedRestore({...f,spawnProcess:decryptProcess()});try{const c=candidateFixture(f.temporaryRoot);c.context.signal=AbortSignal.abort();await assert.rejects(restore.restoreSharedCandidate({...c,prepared}),/SHARED_RESTORE_CANCELLED/);assert.deepEqual(c.calls,[]);}finally{prepared.cleanup();}}finally{f.close();}
});
test('offline verification result refuses extra fields and incomplete ownership evidence',async()=>{
 for(const extra of [{password:'should-never-be-reported'},{ownershipChecks:0}]){
  const f=offlineFixture();try{const prepared=await restore.prepareAuthenticatedRestore({...f,spawnProcess:decryptProcess()});try{const c=candidateFixture(f.temporaryRoot),run=c.context.run;c.context.run=args=>{const result=run(args);return args.includes('verify')?JSON.stringify({...JSON.parse(result),...extra}):result};await assert.rejects(restore.restoreSharedCandidate({...c,prepared}),/SHARED_RESTORE_VERIFICATION/);assert.ok(c.calls.some(a=>a.includes('rm')));}finally{prepared.cleanup();}}finally{f.close();}
 }
});
test('restore CLI cancellation between archive verification and lock entry cleans plaintext before any maintenance',async()=>{
 let prepared=false,cleaned=false,contact=false;
 await assert.rejects(restore.restoreMain(Array(6).fill('/private/fixture'),{
  prepareArchive:async()=>{prepared=true;return {cleanup(){cleaned=true}}},
  loadConfiguration:async()=>{process.emit('SIGTERM');return {}},
  maintenance:async()=>{contact=true},
 }),/SHARED_RESTORE_CANCELLED/);
 assert.equal(prepared,true);assert.equal(cleaned,true);assert.equal(contact,false);
});
