#!/usr/bin/env node
/** Plaintext SQL exists only in the dump -> gzip -> age pipe. */
import {spawn} from 'node:child_process';
import {createWriteStream,existsSync,linkSync,rmSync,statSync} from 'node:fs';
import {dirname,isAbsolute,join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createGzip} from 'node:zlib';
import {pipeline} from 'node:stream/promises';
import {pathToFileURL} from 'node:url';
import {dockerEnvironment} from './ssh-deploy.mjs';
import {mysqlClientArguments,probeSharedClient,validateProvisioningAudit,withRoleEnvironment} from './ssh-shared-db.mjs';
import {databasePolicy} from '../apps/api/src/maintenance/shared-db-policy.ts';
function childExit(child){return new Promise((resolve,reject)=>{let failed=false;child.once('error',()=>{failed=true;});child.once('close',code=>code===0&&!failed?resolve():reject(new Error('SHARED_BACKUP_FAILED')));});}
export async function createEncryptedBackup({context,outputFile,recipient,spawnProcess=spawn}) {
 databasePolicy(isAbsolute(outputFile??'')&&!existsSync(outputFile)&&statSync(dirname(outputFile)).isDirectory(),'SHARED_BACKUP_DESTINATION');
 databasePolicy(/^age1[023456789acdefghjklmnpqrstuvwxyz]{58}$/.test(recipient??''),'SHARED_BACKUP_RECIPIENT');
 validateProvisioningAudit(context.input.provisioningAudit,'staroracle',context.input.externalMysql.serverUuid);
 await probeSharedClient(context,'backup');
 const partial=join(dirname(outputFile),'.star-oracle-'+randomUUID()+'.partial');
 const imageId=context.manifest.images.find(image=>image.tag==='star-oracle-mysql-client:local')?.id;
 try {
  await withRoleEnvironment(context,context.settings.MYSQL_BACKUP_PASSWORD,async envFile=>{
   let dump,age;const stages=[];
   try {
    const options={env:dockerEnvironment(),stdio:['pipe','pipe','ignore'],timeout:30*60*1000,signal:context.signal};
    dump=spawnProcess('docker',mysqlClientArguments({role:'backup',envFile,imageId,sqlMode:'dump'}),options);stages.push(childExit(dump));dump.stdin.end();
    age=spawnProcess('age',['-r',recipient],options);stages.push(childExit(age));
    stages.push(pipeline(dump.stdout,createGzip({level:6}),age.stdin),pipeline(age.stdout,createWriteStream(partial,{flags:'wx',mode:0o600})));
    await Promise.all(stages);
    databasePolicy(statSync(partial).size>0,'SHARED_BACKUP_EMPTY');
    // Same-filesystem hard-link is atomic and will never overwrite an artifact.
    linkSync(partial,outputFile);
   } catch {dump?.kill('SIGTERM');age?.kill('SIGTERM');await Promise.allSettled(stages);throw new Error('SHARED_BACKUP_FAILED');}
  });
  return outputFile;
 } finally {rmSync(partial,{force:true});}
}
export async function backupMain(args=process.argv.slice(2)) {
 const [inputPath,settingsPath,outputFile,recipient,...extra]=args;
 databasePolicy(args.length===4&&!extra.length&&[inputPath,settingsPath,outputFile].every(path=>isAbsolute(path??'')),'SHARED_BACKUP_USAGE');
 const {withSharedMaintenance}=await import('./ssh-shared-deploy.mjs');
 const {readSharedManifest}=await import('./ssh-shared-release.mjs');
 const {loadInput,loadSharedSettings}=await import('./ssh-shared-policy.mjs');
 const root=resolve(import.meta.dirname,'..'),input=loadInput(inputPath),settings=loadSharedSettings(settingsPath),manifest=readSharedManifest(root);
 await withSharedMaintenance({root,input,settings,manifest,operation:context=>createEncryptedBackup({context,outputFile,recipient})});
 console.log('Encrypted shared backup created. API/Web remain stopped.');
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url)backupMain().catch(()=>{console.error('Shared backup failed; no incomplete artifact was published. Raw diagnostics withheld.');process.exitCode=1;});
