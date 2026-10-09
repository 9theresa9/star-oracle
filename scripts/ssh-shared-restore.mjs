#!/usr/bin/env node
/** New candidate only. Never import unauthenticated bytes into any database. */
import {spawn} from 'node:child_process';
import {constants,writeFileSync,existsSync,openSync,closeSync,fstatSync,readFileSync,mkdtempSync,chmodSync,createWriteStream,createReadStream,rmSync,statSync} from 'node:fs';
import {isAbsolute,join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {privateText} from './ssh-shared-policy.mjs';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {WORKER_NAME,WORKER_LABELS,mysqlClientArguments,probeSharedClient,withRoleEnvironment,sharedEntrypointCommand} from './ssh-shared-db.mjs';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createGunzip} from 'node:zlib';
import {dockerEnvironment} from './ssh-deploy.mjs';
import {databasePolicy,roleIdentity,validateProvisioningAudit} from '../apps/api/src/maintenance/shared-db-policy.ts';
const authenticated = new WeakSet();
function openRegular(path,privateMode=false) {
 databasePolicy(isAbsolute(path??''),'SHARED_RESTORE_PATH');
 let fd;try{fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);const st=fstatSync(fd);databasePolicy(st.isFile()&&(!privateMode||(st.uid===process.getuid()&&(st.mode&0o777)===0o600)),'SHARED_RESTORE_FILE');return fd;}catch{if(fd!==undefined)closeSync(fd);throw new Error('SHARED_RESTORE_FILE');}
}
function bounded(maximum){let count=0;return new Transform({transform(chunk,_encoding,callback){count+=chunk.length;count<=maximum?callback(null,chunk):callback(new Error('SHARED_RESTORE_ARCHIVE'));}});}
function childExit(child){return new Promise((resolve,reject)=>{let failed=false;child.once('error',()=>{failed=true;});child.once('close',code=>code===0&&!failed?resolve():reject(new Error('SHARED_RESTORE_PROCESS')));});}
export async function prepareAuthenticatedRestore({archive,identityFile,temporaryRoot=tmpdir(),maxCompressedBytes=256*1024**2,maxPlaintextBytes=1024**3,spawnProcess=spawn,signal}) {
 databasePolicy(isAbsolute(temporaryRoot)&&[maxCompressedBytes,maxPlaintextBytes].every(n=>Number.isSafeInteger(n)&&n>0&&n<=1024**3),'SHARED_RESTORE_LIMIT');
 const abortController=new AbortController(),abort=()=>abortController.abort();
 process.once('SIGINT',abort);process.once('SIGTERM',abort);
 const workSignal=signal?AbortSignal.any([signal,abortController.signal]):abortController.signal;
 let identityFd,archiveFd,privateDir,age;const stages=[];
 try {
  identityFd=openRegular(identityFile,true);archiveFd=openRegular(archive);
  databasePolicy(fstatSync(identityFd).size<16384&&fstatSync(archiveFd).size<=maxCompressedBytes+1024**2,'SHARED_RESTORE_LIMIT');
  const keys=readFileSync(identityFd,'utf8').split(/\r?\n/).filter(line=>line&&!line.startsWith('#'));
  databasePolicy(keys.length===1&&/^AGE-SECRET-KEY-1[023456789ACDEFGHJKLMNPQRSTUVWXYZ]{58}$/.test(keys[0]),'SHARED_RESTORE_IDENTITY');
  privateDir=mkdtempSync(join(temporaryRoot,'star-oracle-restore-'));chmodSync(privateDir,0o700);
  const compressed=join(privateDir,'backup.sql.gz'),sqlPath=join(privateDir,'backup.sql');
  age=spawnProcess('age',['--decrypt','--identity','/proc/self/fd/3','/proc/self/fd/4'],{env:dockerEnvironment(),stdio:['ignore','pipe','ignore',identityFd,archiveFd],timeout:30*60*1000,signal:workSignal});
  stages.push(childExit(age),pipeline(age.stdout,bounded(maxCompressedBytes),createWriteStream(compressed,{flags:'wx',mode:0o600})));
  await Promise.all(stages);
  // createGunzip verifies the complete gzip checksum/footer. The private SQL
  // file is not usable by restoration until this whole pipeline has finished.
  await pipeline(createReadStream(compressed),createGunzip(),bounded(maxPlaintextBytes),createWriteStream(sqlPath,{flags:'wx',mode:0o600}),{signal:workSignal});
  databasePolicy(statSync(sqlPath).size>0,'SHARED_RESTORE_ARCHIVE');
  rmSync(compressed);chmodSync(sqlPath,0o400);
  const prepared=Object.freeze({privateDir,sqlPath,cleanup(){authenticated.delete(prepared);rmSync(privateDir,{recursive:true,force:true});}});
  authenticated.add(prepared);return prepared;
 } catch(error) {
  age?.kill('SIGTERM');await Promise.allSettled(stages);if(privateDir)rmSync(privateDir,{recursive:true,force:true});
  if(!age&&error instanceof Error&&/^SHARED_RESTORE_/.test(error.message))throw error;
  throw new Error('SHARED_RESTORE_ARCHIVE');
 } finally {process.off('SIGINT',abort);process.off('SIGTERM',abort);if(identityFd!==undefined)closeSync(identityFd);if(archiveFd!==undefined)closeSync(archiveFd);}
}
export function validateCandidateInput(candidate,serverUuid) {
 databasePolicy(candidate&&Object.keys(candidate).sort().join(',')==='database,format,provisioningAudit'&&candidate.format===1,'SHARED_RESTORE_CANDIDATE');
 roleIdentity('candidateImporter',candidate.database);
 validateProvisioningAudit(candidate.provisioningAudit,candidate.database,serverUuid);
 return candidate;
}

const docker=['--host','unix:///var/run/docker.sock'];
const candidateKeys=['IMPORTER_PASSWORD','MIGRATOR_PASSWORD','APP_PASSWORD','REDIS_PASSWORD'];
export function validateCandidateSettings(settings,original={}) {
 databasePolicy(settings&&Object.keys(settings).sort().join(',')===[...candidateKeys].sort().join(',')&&candidateKeys.every(key=>/^[a-fA-F0-9]{64}$/.test(settings[key]??''))&&new Set(Object.values(settings)).size===candidateKeys.length&&Object.values(settings).every(value=>!Object.values(original).includes(value)),'SHARED_RESTORE_SECRETS');
 return settings;
}
export function candidateApiArguments({envFile,imageId,role,action}) {
 databasePolicy(isAbsolute(envFile??'')&&/^sha256:[a-f0-9]{64}$/.test(imageId??'')&&['candidateMigrator','candidateApp'].includes(role),'SHARED_RESTORE_WORKER');
 return [...docker,'run','--log-driver=none','--pull=never','--rm',`--name=${WORKER_NAME}`,...WORKER_LABELS,'--network=star-oracle-shared-backend','--ip=172.30.78.7',
  '--read-only','--tmpfs=/tmp:rw,noexec,nosuid,size=67108864','--cap-drop=ALL','--security-opt=no-new-privileges:true',
  '--user=1000:1000','--memory=512m','--memory-swap=512m','--pids-limit=256','--cpus=1','--env-file',envFile,imageId,...sharedEntrypointCommand(role,action)];
}
async function candidateEnvironment(context,candidate,settings,role,operation) {
 const user=roleIdentity(role,candidate.database).user,password=settings[role==='candidateApp'?'APP_PASSWORD':'MIGRATOR_PASSWORD'];
 const values={NODE_ENV:'production',DATABASE_URL:`mysql://${user}:${password}@oracle-mysql:3306/${candidate.database}?connection_limit=5`,SHARED_CANDIDATE_DATABASE:candidate.database,SHARED_MYSQL_UUID:context.input.externalMysql.serverUuid,SHARED_MYSQL_VERSION:context.input.externalMysql.serverVersion};
 if(role==='candidateApp')Object.assign(values,{REDIS_URL:`redis://:${settings.REDIS_PASSWORD}@candidate-redis:6379`,DATA_ENCRYPTION_KEY:context.settings.DATA_ENCRYPTION_KEY,AUTH_SECRET_BASE64:Buffer.from(context.settings.AUTH_SECRET,'utf8').toString('base64')});
 const file=join(context.privateDir,'candidate-'+randomUUID()+'.env');
 writeFileSync(file,Object.entries(values).map(([key,value])=>key+'='+value+'\n').join(''),{flag:'wx',mode:0o600});
 try{return await operation(file);}finally{rmSync(file,{force:true});}
}
function redisArguments({name,volume,envFile,imageId}) {
 return [...docker,'run','--log-driver=none','--pull=never','--detach',`--name=${name}`,'--label=io.star-oracle.deployment=ssh-shared','--label=com.docker.compose.project=star-oracle-shared','--label=io.star-oracle.candidate=true',
  '--network=star-oracle-shared-backend','--ip=172.30.78.8','--network-alias=candidate-redis','--read-only','--tmpfs=/tmp:rw,noexec,nosuid,size=16777216',
  '--cap-drop=ALL','--security-opt=no-new-privileges:true','--user=999:999','--memory=64m','--memory-swap=64m','--pids-limit=128','--cpus=1',
  '--mount',`type=volume,source=${volume},target=/data`,'--env-file',envFile,imageId,'sh','-c','exec redis-server --bind 0.0.0.0 --protected-mode yes --appendonly yes --maxmemory 32mb --maxmemory-policy noeviction --requirepass "$REDIS_PASSWORD"'];
}
async function cleanupCandidateRedis(context,name,imageId) {
 const ids=(await context.run([...docker,'ps','-aq','--no-trunc','--filter',`name=^/${name}$`])).trim().split(/\s+/).filter(Boolean);
 if(!ids.length)return;
 databasePolicy(ids.length===1&&/^[a-f0-9]{64}$/.test(ids[0]),'SHARED_RESTORE_CLEANUP');
 const containers=JSON.parse(await context.run([...docker,'inspect',ids[0]])),c=containers[0],labels=c?.Config?.Labels;
 databasePolicy(containers.length===1&&c.Id===ids[0]&&c.Name==='/'+name&&c.Image===imageId&&labels?.['io.star-oracle.deployment']==='ssh-shared'&&labels?.['io.star-oracle.candidate']==='true'&&labels?.['com.docker.compose.project']==='star-oracle-shared','SHARED_RESTORE_CLEANUP');
 if(c.State?.Running)await context.run([...docker,'stop','--time','10',c.Id]);
 await context.run([...docker,'rm',c.Id]);
}
export async function restoreSharedCandidate({context,prepared,candidate,candidateSettings,spawnProcess=spawn}) {
 databasePolicy(!context.signal?.aborted,'SHARED_RESTORE_CANCELLED');
 databasePolicy(authenticated.has(prepared)&&existsSync(prepared.sqlPath),'SHARED_RESTORE_PREPARED');
 validateCandidateInput(candidate,context.input.externalMysql.serverUuid);validateCandidateSettings(candidateSettings,context.settings);
 const suffix=candidate.database.slice('staroraclerestore'.length),name='star-oracle-shared-candidate-'+suffix,volume=name+'-redis';
 const image=tag=>context.manifest.images.find(value=>value.tag===tag)?.id;
 const apiImage=image('star-oracle-api:local'),clientImage=image('star-oracle-mysql-client:local'),redisImage=image('redis:7.4');
 databasePolicy([apiImage,clientImage,redisImage].every(id=>/^sha256:[a-f0-9]{64}$/.test(id??'')),'SHARED_RESTORE_IMAGES');
 const volumes=(await context.run([...docker,'volume','ls','--format','{{.Name}}'])).trim().split(/\s+/);
 databasePolicy(!volumes.includes(volume),'SHARED_RESTORE_EXISTING_VOLUME');
 // Validate every independently scoped candidate role before the first write.
 await probeSharedClient(context,'candidateImporter',{database:candidate.database,password:candidateSettings.IMPORTER_PASSWORD});
 const runApi=(role,action)=>{databasePolicy(!context.signal?.aborted,'SHARED_RESTORE_CANCELLED');return candidateEnvironment(context,candidate,candidateSettings,role,envFile=>context.run(candidateApiArguments({envFile,imageId:apiImage,role,action})));};
 await runApi('candidateMigrator','check');await runApi('candidateApp','check');
 await withRoleEnvironment(context,candidateSettings.IMPORTER_PASSWORD,async envFile=>{
  const base={role:'candidateImporter',envFile,imageId:clientImage,database:candidate.database};
  databasePolicy((await context.run(mysqlClientArguments({...base,sqlMode:'empty'}))).trim()==='0','SHARED_RESTORE_NOT_EMPTY');
  const child=spawnProcess('docker',mysqlClientArguments({...base,sqlMode:'import'}),{env:dockerEnvironment(),stdio:['pipe','ignore','ignore'],timeout:30*60*1000,signal:context.signal});
  const stages=[childExit(child),pipeline(createReadStream(prepared.sqlPath),child.stdin)];
  try{await Promise.all(stages);}catch{child.kill('SIGTERM');await Promise.allSettled(stages);throw new Error('SHARED_RESTORE_IMPORT');}
 });
 for(const action of ['migrate','status','diff'])await runApi('candidateMigrator',action);
 const labels=['--label=io.star-oracle.deployment=ssh-shared','--label=com.docker.compose.project=star-oracle-shared','--label=io.star-oracle.candidate=true'];
 await context.run([...docker,'volume','create',...labels,volume]);
 const redisEnv=join(context.privateDir,'redis-'+randomUUID()+'.env');writeFileSync(redisEnv,'REDIS_PASSWORD='+candidateSettings.REDIS_PASSWORD+'\n',{flag:'wx',mode:0o600});
 try {
  await context.run(redisArguments({name,volume,envFile:redisEnv,imageId:redisImage}));
  const deadline=Date.now()+30000;
  while(true){if(context.signal?.aborted)throw new Error('SHARED_RESTORE_CANCELLED');let ready=false;try{ready=(await context.run([...docker,'exec',name,'sh','-c','REDISCLI_AUTH="$REDIS_PASSWORD" exec redis-cli --no-auth-warning ping'])).trim()==='PONG';}catch{}if(ready)break;databasePolicy(Date.now()<deadline,'SHARED_RESTORE_REDIS_TIMEOUT');await new Promise(resolve=>setTimeout(resolve,100));}
  let verified;try{verified=JSON.parse(await runApi('candidateApp','verify'));}catch{throw new Error('SHARED_RESTORE_VERIFICATION');}
  databasePolicy(verified&&Object.keys(verified).sort().join(',')==='automatedOfflineVerified,ciphertextsChecked,ownershipChecks,rowsChecked,sessionsRemaining,verificationsRemaining'&&verified.ownershipChecks>=20&&verified.automatedOfflineVerified===true&&verified.sessionsRemaining===0&&verified.verificationsRemaining===0&&['rowsChecked','ciphertextsChecked','ownershipChecks'].every(key=>Number.isSafeInteger(verified[key])&&verified[key]>=0),'SHARED_RESTORE_VERIFICATION');
  return {...verified,database:candidate.database,candidateRedisVolume:volume,manualCutoverRequired:true};
 } finally {rmSync(redisEnv,{force:true});await cleanupCandidateRedis(context,name,redisImage);}
}
export function loadCandidateSettings(path) {
 const values={};
 try{for(const line of privateText(path).split(/\r?\n/)){if(!line.trim()||line.startsWith('#'))continue;const match=/^([A-Z_]+)=([a-fA-F0-9]{64})$/.exec(line);databasePolicy(match&&candidateKeys.includes(match[1])&&!Object.hasOwn(values,match[1]),'SHARED_RESTORE_SECRETS');values[match[1]]=match[2];}return validateCandidateSettings(values);}catch{throw new Error('SHARED_RESTORE_SECRETS');}
}
export async function restoreMain(args=process.argv.slice(2),options={}) {
 databasePolicy(args.length===6&&args.every(path=>isAbsolute(path??'')),'SHARED_RESTORE_USAGE');
 const [inputPath,settingsPath,archive,identityFile,candidatePath,candidateSettingsPath]=args;
 const controller=new AbortController(),abort=()=>controller.abort();let prepared;
 process.once('SIGINT',abort);process.once('SIGTERM',abort);
 try {
  // Verification completes BEFORE the launcher, whose checks contact MySQL.
  prepared=await (options.prepareArchive??prepareAuthenticatedRestore)({archive,identityFile,signal:controller.signal});
  const configuration=await (options.loadConfiguration??(async()=>{
   const {loadInput,loadSharedSettings}=await import('./ssh-shared-policy.mjs');
   const {readSharedManifest}=await import('./ssh-shared-release.mjs');
   const root=resolve(import.meta.dirname,'..'),input=loadInput(inputPath),settings=loadSharedSettings(settingsPath),manifest=readSharedManifest(root);
   let candidate;try{candidate=JSON.parse(privateText(candidatePath));}catch{throw new Error('SHARED_RESTORE_CANDIDATE');}
   validateCandidateInput(candidate,input.externalMysql.serverUuid);const candidateSettings=loadCandidateSettings(candidateSettingsPath);
   return {root,input,settings,manifest,candidate,candidateSettings};
  }))();
  databasePolicy(!controller.signal.aborted,'SHARED_RESTORE_CANCELLED');
  const maintenance=options.maintenance??(await import('./ssh-shared-deploy.mjs')).withSharedMaintenance;
  databasePolicy(!controller.signal.aborted,'SHARED_RESTORE_CANCELLED');
  const {candidate,candidateSettings,...deployment}=configuration;
  const result=await maintenance({...deployment,operation:context=>restoreSharedCandidate({context,prepared,candidate,candidateSettings})});
  console.log(JSON.stringify(result));
  console.log('Candidate offline checks passed. API/Web remain stopped. Manual business validation and approval are required before cutover.');
 }finally{prepared?.cleanup();process.off('SIGINT',abort);process.off('SIGTERM',abort);}
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url)restoreMain().catch(()=>{console.error('Shared candidate restore failed. Keep API/Web stopped; inspect only the candidate and retry with a fresh candidate. Raw diagnostics withheld.');process.exitCode=1;});
