#!/usr/bin/env node
/** Real integration tests only in an empty disposable Docker >=28 CI runner. */
import assert from 'node:assert/strict';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {networkInterfaces,tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {writeFileSync,readFileSync,mkdtempSync,rmSync,chmodSync,mkdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {request} from 'node:http';
import {gzipSync} from 'node:zlib';
import {pathToFileURL} from 'node:url';
import {commandRunner,dockerEnvironment,inspectLocalDaemon,validateEngine} from './ssh-deploy.mjs';
import {inspectSharedImages,REQUIRED_CHECKS} from './ssh-shared-release.mjs';
const docker=['--host','unix:///var/run/docker.sock'];
let stage='preflight';
const checkpoint=name=>{stage=name;console.log('Shared synthetic check: '+name);};
export function guardExternalLifecycle(run,id,name){
 return args=>{const mutation=args.some(a=>['start','stop','restart','rm','remove','kill','pause','unpause','rename','update','connect','disconnect'].includes(a));assert.ok(!(mutation&&args.some(a=>a===id||a===name)),'Shared smoke: launcher attempted external lifecycle mutation');return run(args);};
}
export function externalFingerprint(c){
 const original=Object.fromEntries(Object.entries(c.NetworkSettings?.Networks??{}).filter(([name])=>name!=='star-oracle-shared-backend').sort(([a],[b])=>a.localeCompare(b)));
 return createHash('sha256').update(JSON.stringify({id:c.Id,image:c.Image,startedAt:c.State?.StartedAt,running:c.State?.Running,restarts:c.RestartCount,hostConfig:c.HostConfig,config:c.Config,mounts:c.Mounts,original})).digest('hex');
}
const delay=ms=>new Promise(ok=>setTimeout(ok,ms));
const token=()=>randomBytes(32).toString('hex');
function privateJson(path,value){writeFileSync(path,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});}
function privateEnv(path,value){writeFileSync(path,Object.entries(value).map(([k,v])=>`${k}=${v}`).join('\n')+'\n',{mode:0o600,flag:'wx'});}
function localCommand(command,args,options={}){const result=spawnSync(command,args,{encoding:'utf8',maxBuffer:32*1024**2,timeout:360000,...options});assert.equal(result.status,0,`Synthetic ${command} failed; captured output withheld`);return result.stdout.trim();}
function httpProbe(path='/api/v1/health',headers={},hostname='127.0.0.1'){
 return new Promise((ok,reject)=>{const req=request({hostname,port:17777,path,headers:{Host:'localhost:17777',...headers},timeout:4000},res=>{let body='';res.on('data',chunk=>body+=chunk);res.on('end',()=>ok({status:res.statusCode,headers:res.headers,body}));});req.on('timeout',()=>req.destroy(new Error('probe timed out')));req.on('error',reject);req.end();});
}
const isolatedNodeArgs=(network,ip,image,envFile,code)=>[...docker,'run','--rm','--pull','never','--network',network,'--ip',ip,'--memory','128m','--cpus','1','--pids-limit','128','--read-only','--tmpfs','/tmp:rw,noexec,nosuid,size=16m','--cap-drop','ALL','--security-opt','no-new-privileges:true',...(envFile?['--env-file',envFile]:[]),'--entrypoint','node',image,'--input-type=module','-e',code];

export async function runSharedSmoke(proofPath){
 assert.equal(process.env.CI,'true','Shared smoke requires a disposable CI runner');assert.ok(proofPath?.startsWith('/'));
 const root=resolve(import.meta.dirname,'..');const policy=await import('./ssh-shared-policy.mjs');const deploy=await import('./ssh-shared-deploy.mjs');
 const {PROJECT,EDGE,BACKEND,sharedDockerArgs}=policy;
 const settings=Object.fromEntries(['MYSQL_PASSWORD','MYSQL_MIGRATION_PASSWORD','MYSQL_BACKUP_PASSWORD','MYSQL_MAINTENANCE_PASSWORD','REDIS_PASSWORD','AUTH_SECRET','DATA_ENCRYPTION_KEY'].map(k=>[k,token()]));
 let raw=commandRunner(settings);const compose=sharedDockerArgs(root),manifest={images:inspectSharedImages(raw)};
 const engineVersion=raw([...docker,'version','--format','{{.Server.Version}}']);validateEngine(engineVersion);inspectLocalDaemon();const composeVersion=raw([...docker,'compose','version','--short']);
 const originalNetwork='star-oracle-shared-fixture-original',externalName='star-oracle-shared-fixture-mysql',journalName='star-oracle-shared-fixture-journal';
 for(const name of [PROJECT,externalName,journalName])assert.equal(raw([...docker,'ps','-aq','--filter',name===PROJECT?`label=com.docker.compose.project=${name}`:`name=^/${name}$`]),'','Existing containers forbidden in shared smoke');
 const networks=raw([...docker,'network','ls','--format','{{.Name}}']).split('\n');assert.ok(![EDGE,BACKEND,originalNetwork].some(n=>networks.includes(n)),'Existing test network forbidden');
 const volumes=raw([...docker,'volume','ls','--format','{{.Name}}']).split('\n');assert.ok(!volumes.some(v=>v===PROJECT+'-redis-data'||v.startsWith(PROJECT+'-candidate-')),'Existing Redis data forbidden');
 const dir=mkdtempSync(join(tmpdir(),'ssh-shared-synthetic-')),rootPassword=token(),journalPassword=token();const mysqlVolume='star-oracle-shared-fixture-'+randomUUID();
 let externalId,journalId,createdNetwork=false,externalBefore,journalBefore,journalConnection;
 const checks=new Set();
 const inspect=id=>JSON.parse(raw([...docker,'inspect',id]))[0];
 const sql=(statement)=>localCommand('docker',[...docker,'exec','-i','-e','MYSQL_PWD',externalId,'mysql','--no-defaults','--user=root','--batch','--raw','--skip-column-names'],{env:{...dockerEnvironment(),MYSQL_PWD:rootPassword},input:statement});
 const journalState=()=>sql("SELECT CONCAT(id,':',body) FROM fakejournal.entry ORDER BY id; SELECT CONCAT(id,':',token) FROM fakejournal.session ORDER BY id;");
 const verifyExternal=()=>{assert.equal(externalFingerprint(inspect(externalId)),externalBefore,'External container lifecycle/config drift');assert.equal(journalState(),journalBefore,'External Journal records changed');assert.equal(sql(`SELECT COUNT(*) FROM information_schema.PROCESSLIST WHERE ID=${journalConnection} AND USER='synthetic_journal'`),'1','Existing Journal database session was interrupted');};
 try{
  checkpoint('external fixture provisioning');
  raw([...docker,'network','create','--internal','--subnet','172.30.79.0/24','--label','io.star-oracle.synthetic=true',originalNetwork]);createdNetwork=true;
  const mysqlEnv=join(dir,'mysql.env');privateEnv(mysqlEnv,{MYSQL_ROOT_PASSWORD:rootPassword,MYSQL_ROOT_HOST:'localhost'});
  externalId=raw([...docker,'run','-d','--name',externalName,'--pull','never','--network',originalNetwork,'--ip','172.30.79.4','--memory','768m','--pids-limit','256','--cpus','2','--env-file',mysqlEnv,'--mount',`type=volume,source=${mysqlVolume},target=/var/lib/mysql`,'mysql:8.4']);
  let ready=false;for(let i=0;i<120;i++){try{if(sql('SELECT 1')==='1'){ready=true;break;}}catch{}await delay(1000);}assert.ok(ready,'Synthetic external MySQL did not become ready');
  const roles=[['staroracle_app','172.30.78.2',settings.MYSQL_PASSWORD,'SELECT,INSERT,UPDATE,DELETE'],['staroracle_migrator','172.30.78.6',settings.MYSQL_MIGRATION_PASSWORD,'SELECT,INSERT,UPDATE,DELETE,CREATE,ALTER,INDEX,REFERENCES'],['staroracle_backup','172.30.78.7',settings.MYSQL_BACKUP_PASSWORD,'SELECT'],['staroracle_maintenance','172.30.78.7',settings.MYSQL_MAINTENANCE_PASSWORD,'SELECT,INSERT,UPDATE,DELETE']];
  sql(`CREATE DATABASE staroracle CHARACTER SET utf8mb4; CREATE DATABASE fakejournal; CREATE TABLE fakejournal.entry(id INT PRIMARY KEY,body TEXT); INSERT INTO fakejournal.entry VALUES (1,'SYNTHETIC_JOURNAL_UNCHANGED'); CREATE TABLE fakejournal.session(id INT PRIMARY KEY,token VARCHAR(100)); INSERT INTO fakejournal.session VALUES (1,'SYNTHETIC_JOURNAL_SESSION'); CREATE USER 'synthetic_journal'@'172.30.79.3' IDENTIFIED BY '${journalPassword}'; GRANT SELECT ON fakejournal.* TO 'synthetic_journal'@'172.30.79.3'; ${roles.map(([u,h,p,g])=>`CREATE USER '${u}'@'${h}' IDENTIFIED BY '${p}'; GRANT ${g} ON staroracle.* TO '${u}'@'${h}';`).join('\n')}`);
  const [serverUuid,serverVersion]=sql('SELECT @@server_uuid,VERSION()').split('\t');assert.match(serverVersion,/^8\.4\.\d+$/);
  const initial=inspect(externalId);const originalNetworks=Object.entries(initial.NetworkSettings.Networks).map(([name,n])=>({name,id:n.NetworkID,ipv4Address:n.IPAddress,prefixLength:n.IPPrefixLen,gateway:n.Gateway,aliases:n.Aliases??[]}));
  const audit={schema:'staroracle',serverUuid,reviewedAt:new Date().toISOString(),tablesOnly:true,noAnonymousAccounts:true,noFallbackAccounts:true,noRolesOrExtraGrants:true};
  // A privileged synthetic provisioning audit, never a claim based on SELECT-only metadata.
  sql('CREATE TABLE staroracle.auditprobe (id INT); CREATE TRIGGER staroracle.hiddenprobe BEFORE INSERT ON staroracle.auditprobe FOR EACH ROW SET NEW.id=NEW.id;');
  assert.equal(sql("SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA='staroracle'"),'1');
  const input={format:1,externalMysql:{containerId:externalId,imageId:initial.Image,serverUuid,serverVersion,originalNetworks,defaultRoute:policy.parseDefaultRoute(raw([...docker,'exec',externalId,'cat','/proc/net/route']))},provisioningAudit:audit};
  policy.validateInput(input);assert.throws(()=>policy.validateInput({...input,provisioningAudit:{...audit,tablesOnly:false}}));sql('DROP TRIGGER staroracle.hiddenprobe; DROP TABLE staroracle.auditprobe;');
  assert.equal(sql("SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA='staroracle'"),'0');assert.equal(sql("SELECT COUNT(*) FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA='staroracle'"),'0');assert.equal(sql("SELECT COUNT(*) FROM information_schema.EVENTS WHERE EVENT_SCHEMA='staroracle'"),'0');assert.equal(sql("SELECT COUNT(*) FROM mysql.user WHERE User='' OR (User LIKE 'staroracle%' AND Host<>'172.30.78.2' AND Host<>'172.30.78.6' AND Host<>'172.30.78.7')"),'0');
  raw=commandRunner({...settings,SHARED_MYSQL_UUID:serverUuid,SHARED_MYSQL_VERSION:serverVersion});
  const inputPath=join(dir,'input.json'),envPath=join(dir,'settings.env');privateJson(inputPath,input);privateEnv(envPath,settings);
  const run=guardExternalLifecycle(raw,externalId,externalName);const action=action=>deploy.withSharedLock(()=>deploy.runSharedDeployment({action,root,input,settings,manifest,run}));
  checkpoint('reject bind-backed owned-volume drift');
  const bindDirectory=join(dir,'untrusted-volume');mkdirSync(bindDirectory,{mode:0o700});
  raw([...docker,'volume','create','--driver','local','--opt','type=none','--opt','o=bind','--opt',`device=${bindDirectory}`,'--label',`com.docker.compose.project=${PROJECT}`,'--label','com.docker.compose.volume=redis-data',PROJECT+'-redis-data']);
  await assert.rejects(()=>action('prepare'));
  assert.equal(raw([...docker,'ps','-aq','--filter',`label=com.docker.compose.project=${PROJECT}`]),'','Unsafe volume must reject before creating owned containers');
  assert.equal(externalFingerprint(inspect(externalId)),externalFingerprint(initial));
  raw([...docker,'volume','rm',PROJECT+'-redis-data']);checks.add('owned-volume-drift-rejected');
  checkpoint('owned topology preparation');await action('prepare');
  // Explicit fixture provisioning. The actual launcher never attaches external MySQL.
  raw([...docker,'network','connect','--ip','172.30.78.4','--alias','oracle-mysql',BACKEND,externalId]);
  const journalEnv=join(dir,'journal.env');privateEnv(journalEnv,{MYSQL_PWD:journalPassword});
  journalId=raw([...docker,'run','-d','--name',journalName,'--pull','never','--network',originalNetwork,'--ip','172.30.79.3','--read-only','--tmpfs','/tmp','--cap-drop','ALL','--security-opt','no-new-privileges:true','--memory','128m','--pids-limit','64','--env-file',journalEnv,'--entrypoint','mysql','star-oracle-mysql-client:local','--no-defaults','--protocol=TCP','--host',externalName,'--user=synthetic_journal','--batch','--execute','SELECT SLEEP(1800)']);
  for(let i=0;i<30;i++){journalConnection=sql("SELECT ID FROM information_schema.PROCESSLIST WHERE USER='synthetic_journal' LIMIT 1");if(journalConnection)break;await delay(500);}assert.match(journalConnection,/^\d+$/);
  externalBefore=externalFingerprint(inspect(externalId));journalBefore=journalState();
  checkpoint('exclusive migration');await action('migrate');verifyExternal();
  const apiImage=manifest.images.find(i=>i.tag==='star-oracle-api:local').id;
  const accounts=Array.from({length:6},(_,i)=>({username:'synthetic-shared-'+randomBytes(5).toString('hex'),name:'Synthetic reader '+i,password:token()}));
  const accountEnv=join(dir,'accounts.env');privateEnv(accountEnv,{SYNTHETIC_ACCOUNTS:JSON.stringify(accounts),NODE_ENV:'production',DATABASE_URL:`mysql://staroracle_maintenance:${settings.MYSQL_MAINTENANCE_PASSWORD}@oracle-mysql:3306/staroracle?connection_limit=5`,REDIS_URL:`redis://:${settings.REDIS_PASSWORD}@redis:6379`,AUTH_SECRET:settings.AUTH_SECRET,DATA_ENCRYPTION_KEY:settings.DATA_ENCRYPTION_KEY,WEB_ORIGIN:'http://localhost:17777',API_PUBLIC_URL:'http://localhost:17777',DEPLOYMENT_MODE:'ssh-only',ADMIN_REQUIRE_2FA:'true',TRUST_PROXY:'false'});
  checkpoint('offline synthetic accounts');
  // Fixture calls the same account service offline, under the launcher's lock.
  await deploy.withSharedMaintenance({root,input,settings,manifest,run,operation:async()=>{
   const stopped=JSON.parse(raw([...docker,'inspect',...raw([...compose,'ps','-aq']).split(/\s+/).filter(Boolean)]));assert.ok(stopped.filter(c=>['api','web','migrate'].includes(c.Config.Labels['com.docker.compose.service'])).every(c=>!c.State.Running));
   const code=`const {PrismaClient}=await import('@prisma/client');const {provisionAccount}=await import('./apps/api/dist/maintenance/account-service.js');const db=new PrismaClient();const accounts=JSON.parse(process.env.SYNTHETIC_ACCOUNTS);try{for(const a of accounts){const user=await provisionAccount(db,a);a.id=user.id;}console.log(JSON.stringify(accounts));}finally{await db.$disconnect();}`;
   const args=isolatedNodeArgs(BACKEND,'172.30.78.7',apiImage,accountEnv,code);args[args.indexOf('--memory')+1]='512m';const provisioned=JSON.parse(run(args));for(let i=0;i<accounts.length;i++)accounts[i].id=provisioned[i].id;
  }});verifyExternal();
  checkpoint('runtime resources and ingress');await action('start');await action('check');
  const containers=JSON.parse(raw([...docker,'inspect',...raw([...compose,'ps','-aq']).split(/\s+/).filter(Boolean)]));const byService=Object.fromEntries(containers.map(c=>[c.Config.Labels['com.docker.compose.service'],c]));
  assert.deepEqual(['api','web','redis'].map(s=>byService[s].HostConfig.Memory),[512*1024**2,128*1024**2,192*1024**2]);assert.equal(['api','web','redis'].reduce((a,s)=>a+byService[s].HostConfig.Memory,0),832*1024**2);assert.equal(byService.migrate.State.Running,false);for(const name of ['api','web','redis'])assert.equal(byService[name].HostConfig.MemorySwap,byService[name].HostConfig.Memory,'Standing memory/swap cap drift');checks.add('standing-memory-832mib');
  assert.deepEqual(byService.web.HostConfig.PortBindings,{'8080/tcp':[{HostIp:'127.0.0.1',HostPort:'17777'}]});for(const s of ['api','redis','migrate'])assert.equal(Object.keys(byService[s].HostConfig.PortBindings??{}).length,0);
  assert.equal((await httpProbe()).status,200);assert.equal((await httpProbe('/')).status,200);
  for(const host of ['127.0.0.1:17777','localhost','LOCALHOST:17777','localhost:17777.','hostile.invalid:17777'])assert.equal((await httpProbe(undefined,{Host:host})).status,421);
  for(const origin of ['null','https://localhost:17777','http://127.0.0.1:17777'])assert.equal((await httpProbe(undefined,{Origin:origin})).status,403);
  for(const header of ['Forwarded','X-Forwarded-For','X-Forwarded-Host','X-Forwarded-Proto','X-Real-IP','X-Forwarded-Unrecognized'])for(const value of ['', '127.0.0.1'])assert.equal((await httpProbe(undefined,{[header]:value})).status,403);checks.add('authority-origin-forwarding');
  const externalIp=Object.values(networkInterfaces()).flat().find(n=>n?.family==='IPv4'&&!n.internal&&!n.address.startsWith('172.30.'))?.address;assert.ok(externalIp,'External host interface required');await assert.rejects(httpProbe(undefined,{},externalIp));await assert.rejects(httpProbe(undefined,{},'::1'));checks.add('actual-loopback-ipv4-ipv6');
  checkpoint('actual peer and cross-bridge isolation');
  const peerCode=`const assert=(await import('node:assert/strict')).default;const {get}=await import('node:http');for(const host of ['172.30.77.2:3001','172.30.77.3:8080']){const status=await new Promise((ok,reject)=>{const r=get('http://'+host+'/api/v1/health',{headers:{Host:'localhost:17777',Origin:'http://localhost:17777'},timeout:4000},s=>{s.resume();s.on('end',()=>ok(s.statusCode));});r.on('error',reject);r.on('timeout',()=>r.destroy(new Error('timeout')));});assert.equal(status,403);}const {connect}=await import('node:net');for(const [host,port] of [['172.30.78.4',3306],['172.30.78.5',6379]])await new Promise((ok,reject)=>{const s=connect({host,port});s.on('connect',()=>{s.destroy();reject(new Error('private service reached'));});s.on('error',()=>ok());s.setTimeout(2000,()=>{s.destroy();ok();});});`;
  raw(isolatedNodeArgs(EDGE,'172.30.77.7',apiImage,null,peerCode));
  const crossCode=`const {connect}=await import('node:net');for(const [host,port] of [['172.30.77.2',3001],['172.30.77.3',8080]])await new Promise((ok,reject)=>{const s=connect({host,port});s.on('connect',()=>{s.destroy();reject(new Error('cross bridge API reached'));});s.on('error',()=>ok());s.setTimeout(2000,()=>{s.destroy();ok();});});`;
  raw(isolatedNodeArgs(originalNetwork,'172.30.79.7',apiImage,null,crossCode));raw([...compose,'exec','-T','web','sh','-c','nc -z -w 2 127.0.0.1 8080 || exit 1; if nc -z -w 2 172.30.78.4 3306; then exit 1; fi; if nc -z -w 2 172.30.78.5 6379; then exit 1; fi']);checks.add('edge-peer-private-isolation');
  raw([...compose,'exec','-T','api','node','--input-type=module','-e',`const {PrismaClient}=await import('@prisma/client');const db=new PrismaClient();try{await db.$queryRawUnsafe('SELECT id FROM user LIMIT 1');for(const sql of ['CREATE TABLE forbidden (id INT)','SELECT * FROM fakejournal.entry','UPDATE fakejournal.entry SET body=\'tampered\'','SELECT LOAD_FILE(\'/etc/passwd\')']){let denied=false;try{const r=await db.$queryRawUnsafe(sql);if(sql.includes('LOAD_FILE')&&Object.values(r[0])[0]===null)denied=true;}catch{denied=true;}if(!denied)throw new Error('Excess privileges');}}finally{await db.$disconnect();}`]);checks.add('cross-schema-denied');checks.add('exact-role-identities-grants');
  checkpoint('actual shared-stack browser sessions');
  const browserFixture=join(dir,'browser.json');privateJson(browserFixture,{accounts,redisContainer:byService.redis.Name.slice(1),redisPassword:settings.REDIS_PASSWORD});
  localCommand(process.execPath,[join(root,'node_modules/@playwright/test/cli.js'),'test','-c','tests/ssh-shared-fixtures/playwright.config.ts'],{cwd:root,env:{...process.env,CI:'true',SHARED_BROWSER_FIXTURE:browserFixture},timeout:600000});checks.add('shared-stack-browser-sessions');
  await action('stop');verifyExternal();
  checkpoint('encrypted backup and candidate recovery');
  await verifyBackupAndRestore({root,dir,input,inputPath,settings,envPath,manifest,run,raw,compose,sql,verifyExternal,checks,deploy,apiImage,accountEnv,accounts,externalId,rootPassword});
  verifyExternal();checks.add('external-lifecycle-records-unchanged');
  assert.ok(REQUIRED_CHECKS.every(check=>checks.has(check)),'Missing executed shared acceptance check');
  const git=arg=>localCommand('git',['rev-parse',arg],{cwd:root});privateJson(proofPath,{format:1,profile:'ssh-shared',status:'passed',commit:git('HEAD'),sourceTree:git('HEAD^{tree}'),images:manifest.images,engineVersion,composeVersion,checks:[...checks]});
  console.log('Shared synthetic MySQL lifecycle, grants, isolation, real browser sessions and encrypted candidate restore passed.');
 }finally{
  // Cleanup targets exclusively this freshly created synthetic fixture, after checks.
  // Production launcher calls remain audited separately and never own external MySQL.
  try{const ids=raw([...docker,'ps','-aq','--filter',`label=com.docker.compose.project=${PROJECT}`]).split(/\s+/).filter(Boolean);if(ids.length)raw([...docker,'rm','-f',...ids]);}catch{}
  for(const id of [journalId,externalId])if(id)try{raw([...docker,'rm','-f',id]);}catch{}
  for(const network of [EDGE,BACKEND,...(createdNetwork?[originalNetwork]:[])])try{raw([...docker,'network','rm',network]);}catch{}
  try{const candidateVolumes=raw([...docker,'volume','ls','-q','--filter','label=io.star-oracle.candidate=true','--filter',`label=com.docker.compose.project=${PROJECT}`]).split(/\s+/).filter(Boolean);for(const volume of candidateVolumes)raw([...docker,'volume','rm',volume]);}catch{}
  for(const volume of [mysqlVolume,PROJECT+'-redis-data'])try{raw([...docker,'volume','rm',volume]);}catch{}
  rmSync(dir,{recursive:true,force:true});
 }
}

async function verifyBackupAndRestore({root,dir,input,settings,manifest,run,raw,compose,sql,verifyExternal,checks,deploy,apiImage,accountEnv,accounts,externalId,rootPassword}){
 const {createEncryptedBackup}=await import('./ssh-shared-backup.mjs');
 const {prepareAuthenticatedRestore,restoreSharedCandidate}=await import('./ssh-shared-restore.mjs');
 const {mysqlClientArguments,withRoleEnvironment}=await import('./ssh-shared-db.mjs');
 const identityFile=join(dir,'identity.txt');localCommand('age-keygen',['-o',identityFile]);chmodSync(identityFile,0o600);
 const recipient=localCommand('age-keygen',['-y',identityFile]);const archive=join(dir,'current.sql.gz.age');
 const readingId=randomUUID(),owner=accounts[0].id;
 await deploy.withSharedMaintenance({root,input,settings,manifest,run,operation:async context=>{
  const ids=raw([...compose,'ps','-aq']).split(/\s+/).filter(Boolean);const containers=JSON.parse(raw([...docker,'inspect',...ids]));
  assert.ok(containers.filter(c=>['api','web','migrate'].includes(c.Config.Labels['com.docker.compose.service'])).every(c=>!c.State.Running));
  // A second real process must fail to acquire the same flock while maintenance owns it.
  const contention=spawnSync(process.execPath,['--input-type=module','-e',`import {withSharedLock} from ${JSON.stringify(new URL('./ssh-shared-deploy.mjs',import.meta.url).href)};await withSharedLock(()=>{process.stdout.write('UNSAFE_CONCURRENT_WORK');});`],{cwd:root,encoding:'utf8',timeout:5000});
  assert.notEqual(contention.status,0,'Competing maintenance acquired the common lock');assert.equal(contention.signal,null,'Lock contention must reject promptly');assert.ok(!contention.stdout.includes('UNSAFE_CONCURRENT_WORK'));checks.add('exclusive-offline-maintenance');
  await withRoleEnvironment(context,settings.MYSQL_BACKUP_PASSWORD,async envFile=>{
   const imageId=manifest.images.find(image=>image.tag==='star-oracle-mysql-client:local').id;
   const args=mysqlClientArguments({role:'backup',envFile,imageId,sqlMode:'probe'}).filter(arg=>arg!=='--interactive');
   args.splice(args.indexOf('run')+1,0,'--detach');args[args.indexOf('--execute')+1]='SELECT SLEEP(5)';
   const clientId=run(args);assert.match(clientId,/^[a-f0-9]{64}$/);
   const [client]=JSON.parse(raw([...docker,'inspect',clientId]));
   assert.equal(client.State.Running,true);assert.equal(client.HostConfig.LogConfig.Type,'none','Maintenance SQL must not enter daemon logs');
   assert.equal(raw([...docker,'wait',clientId]),'0');
   let removed=false;for(let attempt=0;attempt<100;attempt++){if(!raw([...docker,'ps','-aq','--no-trunc','--filter',`id=${clientId}`])){removed=true;break;}await delay(50);}assert.ok(removed,'Synthetic maintenance log probe did not clean up');
  });
  const seedCode=`const {db,redis,seal}=await import('./apps/api/dist/infrastructure.js');try{const id=${JSON.stringify(readingId)},userId=${JSON.stringify(owner)};await db.reading.create({data:{id,userId,kind:'tarot',requestId:id,question:seal('SYNTHETIC_ENCRYPTED_RESTORE_SENTINEL','question:'+userId+':'+id),payload:{fixture:true},tagsCipher:seal('[]','reading-tags:'+userId+':'+id),annotation:seal('SYNTHETIC_PRIVATE_NOTE','reading-note:'+userId+':'+id)}});}finally{await db.$disconnect();redis.disconnect();}`;
  const seedArgs=isolatedNodeArgs('star-oracle-shared-backend','172.30.78.7',apiImage,accountEnv,seedCode);seedArgs[seedArgs.indexOf('--memory')+1]='512m';run(seedArgs);
  await createEncryptedBackup({context,outputFile:archive,recipient});
 }});
 assert.ok(readFileSync(archive).subarray(0,24).toString().startsWith('age-encryption.org/v1'));verifyExternal();
 const sourceDump=()=>createHash('sha256').update(localCommand('docker',[...docker,'exec','-e','MYSQL_PWD',externalId,'mysqldump','--no-defaults','--user=root','--single-transaction','--skip-comments','--skip-dump-date','--skip-lock-tables','--no-tablespaces','--set-gtid-purged=OFF','--hex-blob','staroracle'],{env:{...dockerEnvironment(),MYSQL_PWD:rootPassword}})).digest('hex');
 assert.equal(sql('SELECT COUNT(*) FROM staroracle.session'),'3','Each browser must leave a real recoverable session');
 const originalDump=sourceDump();const redisId=raw([...compose,'ps','-q','redis']);
 const redis=(...args)=>localCommand('docker',[...docker,'exec','-e','REDISCLI_AUTH',redisId,'redis-cli','--raw',...args],{env:{...dockerEnvironment(),REDISCLI_AUTH:settings.REDIS_PASSWORD}});
 const cacheSentinel=token();assert.equal(redis('SET','synthetic:original-restore-sentinel',cacheSentinel),'OK');
 const noDatabaseContact=async archive=>{
  const before=Number(sql("SELECT VARIABLE_VALUE FROM performance_schema.global_status WHERE VARIABLE_NAME='Connections'"));
  await assert.rejects(()=>prepareAuthenticatedRestore({archive,identityFile,temporaryRoot:dir}),error=>error.message==='SHARED_RESTORE_ARCHIVE');
  const after=Number(sql("SELECT VARIABLE_VALUE FROM performance_schema.global_status WHERE VARIABLE_NAME='Connections'"));
  assert.equal(after,before+1,'Corrupted encrypted input caused a database connection');
 };
 checkpoint('authenticated archive rejection before database contact');
 const damaged=Buffer.from(readFileSync(archive));damaged[damaged.length-20]^=1;const damagedPath=join(dir,'damaged.age');writeFileSync(damagedPath,damaged,{mode:0o600});await noDatabaseContact(damagedPath);
 const malformedPath=join(dir,'malformed-gzip.age');localCommand('age',['-r',recipient,'-o',malformedPath],{input:Buffer.from('authenticated but not gzip')});await noDatabaseContact(malformedPath);checks.add('corrupt-backup-no-db-contact');
 const candidateSettings=()=>Object.fromEntries(['IMPORTER_PASSWORD','MIGRATOR_PASSWORD','APP_PASSWORD','REDIS_PASSWORD'].map(k=>[k,token()]));
 const createCandidate=suffix=>{
  const candidate={format:1,database:'staroraclerestore'+suffix,provisioningAudit:{...input.provisioningAudit,schema:'staroraclerestore'+suffix,reviewedAt:new Date().toISOString()}};const secrets=candidateSettings();
  sql(`CREATE DATABASE ${candidate.database} CHARACTER SET utf8mb4; CREATE USER 'sor_i_${suffix}'@'172.30.78.7' IDENTIFIED BY '${secrets.IMPORTER_PASSWORD}'; GRANT SELECT,INSERT,UPDATE,DELETE,CREATE,ALTER,INDEX,REFERENCES,DROP ON ${candidate.database}.* TO 'sor_i_${suffix}'@'172.30.78.7'; CREATE USER 'sor_m_${suffix}'@'172.30.78.7' IDENTIFIED BY '${secrets.MIGRATOR_PASSWORD}'; GRANT SELECT,INSERT,UPDATE,DELETE,CREATE,ALTER,INDEX,REFERENCES ON ${candidate.database}.* TO 'sor_m_${suffix}'@'172.30.78.7'; CREATE USER 'sor_a_${suffix}'@'172.30.78.7' IDENTIFIED BY '${secrets.APP_PASSWORD}'; GRANT SELECT,INSERT,UPDATE,DELETE ON ${candidate.database}.* TO 'sor_a_${suffix}'@'172.30.78.7';`);
  return {candidate,candidateSettings:secrets};
 };
 const restore=async (archive,fixture)=>{
  const prepared=await prepareAuthenticatedRestore({archive,identityFile,temporaryRoot:dir});
  try{return await deploy.withSharedMaintenance({root,input,settings,manifest,run,operation:context=>restoreSharedCandidate({context,prepared,...fixture})});}finally{prepared.cleanup();}
 };
 // A SELECT-only dump credential cannot read other schemas. The importer is
 // separately scoped; cross-schema SQL remains harmless even inside a valid age file.
 checkpoint('candidate privilege attack fixtures');
 const hostileSQL=["USE fakejournal; UPDATE entry SET body='MUST_NOT_CHANGE';","SELECT 'MUST_NOT_WRITE' INTO OUTFILE '/tmp/shared-must-not-exist';","CREATE PROCEDURE forbidden() SELECT 1;","CREATE TRIGGER forbidden BEFORE INSERT ON fakejournal.entry FOR EACH ROW SET NEW.body='MUST_NOT_CHANGE';","\\! touch /tmp/shared-must-not-exist\n","DROP DATABASE staroracle;"];
 for(let i=0;i<hostileSQL.length;i++){
  const hostile=join(dir,'hostile'+i+'.sql.gz.age');localCommand('age',['-r',recipient,'-o',hostile],{input:gzipSync(hostileSQL[i])});
  await assert.rejects(()=>restore(hostile,createCandidate('hostile'+i)),error=>error.message==='SHARED_RESTORE_IMPORT');
  assert.equal(sourceDump(),originalDump);verifyExternal();assert.equal(redis('GET','synthetic:original-restore-sentinel'),cacheSentinel);
 }
 // A candidate that already contains a table is rejected before import.
 const occupied=createCandidate('occupied');sql(`CREATE TABLE ${occupied.candidate.database}.mustremain(id INT PRIMARY KEY); INSERT INTO ${occupied.candidate.database}.mustremain VALUES (7);`);await assert.rejects(()=>restore(archive,occupied),error=>error.message==='SHARED_RESTORE_NOT_EMPTY');assert.equal(sql(`SELECT id FROM ${occupied.candidate.database}.mustremain`),'7');
 checkpoint('current encrypted database recovery');
 const recovered=createCandidate('current');const verified=await restore(archive,recovered);assert.equal(verified.automatedOfflineVerified,true);assert.equal(verified.manualCutoverRequired,true);assert.ok(verified.ciphertextsChecked>=9);assert.ok(verified.ownershipChecks>=20);
 assert.equal(sql(`SELECT COUNT(*) FROM ${recovered.candidate.database}.reading WHERE id='${readingId}' AND userId='${owner}'`),'1');
 assert.equal(sql(`SELECT COUNT(*) FROM ${recovered.candidate.database}.session`),'0');assert.equal(sql(`SELECT COUNT(*) FROM ${recovered.candidate.database}.verification`),'0');
 assert.equal(sql(`SELECT COUNT(*) FROM ${recovered.candidate.database}.twoFactor`),'3');
 assert.equal(sql(`SELECT CONCAT(id,':',question,':',annotation) FROM ${recovered.candidate.database}.reading WHERE id='${readingId}'`),sql(`SELECT CONCAT(id,':',question,':',annotation) FROM staroracle.reading WHERE id='${readingId}'`));
 // Restore an initial-version schema into a fresh candidate. Committed migrations
 // must add current tables themselves, rather than relying on leftover new tables.
 checkpoint('historical migration recovery');
 const initialMigration=readFileSync(join(root,'apps/api/prisma/migrations/202610020001_initial/migration.sql'),'utf8');
 const checksum=createHash('sha256').update(initialMigration).digest('hex');
 const historicalSQL=initialMigration+`\nCREATE TABLE _prisma_migrations (id VARCHAR(36) PRIMARY KEY,checksum VARCHAR(64) NOT NULL,finished_at DATETIME(3),migration_name VARCHAR(255) NOT NULL,logs TEXT,rolled_back_at DATETIME(3),started_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),applied_steps_count INTEGER UNSIGNED NOT NULL DEFAULT 0); INSERT INTO _prisma_migrations (id,checksum,finished_at,migration_name,applied_steps_count) VALUES ('${randomUUID()}','${checksum}',CURRENT_TIMESTAMP(3),'202610020001_initial',1);`;
 const historicalPath=join(dir,'historical.sql.gz.age');localCommand('age',['-r',recipient,'-o',historicalPath],{input:gzipSync(historicalSQL)});const historical=createCandidate('historical');await restore(historicalPath,historical);
 assert.equal(sql(`SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${historical.candidate.database}' AND table_name='reading_conversation'`),'1');assert.equal(sql(`SELECT COUNT(*) FROM ${historical.candidate.database}._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`),sql('SELECT COUNT(*) FROM staroracle._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL'));
 assert.equal(sourceDump(),originalDump,'Original database changed during candidate recovery');assert.equal(redis('GET','synthetic:original-restore-sentinel'),cacheSentinel,'Original Redis was altered');verifyExternal();checks.add('encrypted-backup-candidate-restore');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const [option,path,...extra]=process.argv.slice(2);if(option!=='--proof'||!path?.startsWith('/')||extra.length)throw new Error('Usage: node scripts/ssh-shared-smoke.mjs --proof /absolute/proof.json');runSharedSmoke(path).catch(()=>{console.error('Shared synthetic verification failed during '+stage+'; private fixture output withheld.');process.exitCode=1;});}
