#!/usr/bin/env node
/** Client-only commands. The launcher owns validation and the exclusive lock. */
import {writeFileSync, rmSync} from 'node:fs';
import {join, isAbsolute} from 'node:path';
import {randomUUID} from 'node:crypto';
import {databasePolicy, identityJsonQuery, roleIdentity, validateDatabaseIdentity, validateProvisioningAudit} from '../apps/api/src/maintenance/shared-db-policy.ts';
export {validateDatabaseIdentity,validateProvisioningAudit};
export const WORKER_NAME = 'star-oracle-shared-worker';
export const WORKER_LABELS = ['--label=io.star-oracle.deployment=ssh-shared','--label=io.star-oracle.worker=true','--label=com.docker.compose.project=star-oracle-shared'];
export function mysqlClientArguments({role,envFile,imageId,sqlMode,database='staroracle'}) {
 const expected=roleIdentity(role,database);
 databasePolicy(['backup','maintenance','candidateImporter'].includes(role)&&expected.sourceIp==='172.30.78.7','SHARED_DB_CLIENT_ROLE');
 databasePolicy(isAbsolute(envFile??'')&&!/[\r\n\0]/.test(envFile)&&/^sha256:[a-f0-9]{64}$/.test(imageId??''),'SHARED_DB_CLIENT_INPUT');
 databasePolicy(['probe','dump','empty','import'].includes(sqlMode)&&(sqlMode!=='dump'||role==='backup')&&(!['empty','import'].includes(sqlMode)||role==='candidateImporter'),'SHARED_DB_CLIENT_MODE');
 const args=['--host','unix:///var/run/docker.sock','run','--log-driver=none','--pull=never','--rm','--interactive',`--name=${WORKER_NAME}`,...WORKER_LABELS,
  '--network=star-oracle-shared-backend','--ip=172.30.78.7','--read-only','--tmpfs=/tmp:rw,noexec,nosuid,size=16777216',
  '--cap-drop=ALL','--security-opt=no-new-privileges:true','--user=10001:10001','--memory=128m','--memory-swap=128m','--pids-limit=128','--cpus=1',
  '--env-file',envFile,imageId,sqlMode==='dump'?'mysqldump':'mysql','--no-defaults','--no-login-paths','--protocol=TCP','--host=oracle-mysql','--port=3306',
  '--user='+expected.user,'--ssl-mode=REQUIRED','--default-character-set=utf8mb4'];
 if(sqlMode==='dump')return [...args,'--single-transaction','--quick','--no-tablespaces','--set-gtid-purged=OFF','--skip-triggers','--skip-lock-tables','--skip-add-drop-table','--skip-add-locks','--skip-disable-keys','--column-statistics=0','--hex-blob',database];
 // MySQL 8.4 mysqldump has no connect-timeout option; its host process has a
 // bounded overall timeout. Keep the mysql-only option on query/import clients.
 args.push('--connect-timeout=10','--binary-mode=1','--local-infile=0','--skip-reconnect','--batch','--raw','--skip-column-names','--database='+database);
 if(sqlMode==='probe')args.push('--execute',identityJsonQuery+'; SHOW GRANTS;');
 if(sqlMode==='empty')args.push('--execute','SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE();');
 return args;
}
export function withRoleEnvironment(context,password,operation) {
 databasePolicy(/^[a-fA-F0-9]{64}$/.test(password??'')&&isAbsolute(context.privateDir??''),'SHARED_DB_PRIVATE_ENV');
 const path=join(context.privateDir,'mysql-'+randomUUID()+'.env');
 writeFileSync(path,'MYSQL_PWD='+password+'\n',{flag:'wx',mode:0o600});
 const result=Promise.resolve().then(()=>operation(path));
 return result.finally(()=>rmSync(path,{force:true}));
}
export async function probeSharedClient(context,role='backup',{database='staroracle',password}={}) {
 password??=context.settings[role==='backup'?'MYSQL_BACKUP_PASSWORD':'MYSQL_MAINTENANCE_PASSWORD'];
 const imageId=context.manifest.images.find(image=>image.tag==='star-oracle-mysql-client:local')?.id;
 return withRoleEnvironment(context,password,async envFile=>{
  let lines;try{lines=(await context.run(mysqlClientArguments({role,envFile,imageId,sqlMode:'probe',database}))).trim().split(/\r?\n/);}catch{throw new Error('SHARED_DB_PROBE');}
  const first=lines.shift();let identity;try{identity=JSON.parse(first);}catch{throw new Error(/^0x[0-9a-f]+$/i.test(first??'')?'SHARED_DB_IDENTITY_JSON_HEX':'SHARED_DB_IDENTITY_JSON');}
  validateDatabaseIdentity({role,identity,grants:lines,expectedUuid:context.input.externalMysql.serverUuid,expectedVersion:context.input.externalMysql.serverVersion,database,sourceIp:'172.30.78.7'});
  return identity;
 });
}
export function sharedEntrypointCommand(role,action='check',args=[]) {
 const allowed={app:['check','serve'],migrator:['check','migrate'],maintenance:['check','account'],candidateMigrator:['check','migrate','status','diff'],candidateApp:['check','verify']};
 databasePolicy(allowed[role]?.includes(action)&&Array.isArray(args)&&((action==='account'&&args.length===1&&['create','assign-username','reset-password','revoke-all-sessions'].includes(args[0]))||(action!=='account'&&args.length===0)),'SHARED_DB_ENTRYPOINT');
 return ['node','apps/api/dist/maintenance/shared-entrypoint.js',role,action,...args];
}
