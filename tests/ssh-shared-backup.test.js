import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdtempSync,rmSync,readFileSync,readdirSync,writeFileSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {gunzipSync} from 'node:zlib';
const path='../scripts/ssh-shared-backup.mjs';
const backup=existsSync(new URL(path,import.meta.url))?await import(path):{};
const uuid='12345678-1234-4234-8234-123456789abc';
function fixture(){
 const privateDir=mkdtempSync(join(tmpdir(),'shared-backup-'));
 const context={privateDir,settings:{MYSQL_BACKUP_PASSWORD:'1'.repeat(64)},input:{externalMysql:{serverUuid:uuid,serverVersion:'8.4.9'},provisioningAudit:{schema:'staroracle',tablesOnly:true,serverUuid:uuid,reviewedAt:'2026-10-08T00:00:00Z',noAnonymousAccounts:true,noFallbackAccounts:true,noRolesOrExtraGrants:true}},manifest:{images:[{tag:'star-oracle-mysql-client:local',id:'sha256:'+'a'.repeat(64)}]},run(){return [JSON.stringify({currentUser:'staroracle_backup@172.30.78.7',serverUuid:uuid,serverVersion:'8.4.9',database:'staroracle',currentRole:'NONE',mandatoryRoles:''}),'GRANT USAGE ON *.* TO `staroracle_backup`@`172.30.78.7`','GRANT SELECT ON `staroracle`.* TO `staroracle_backup`@`172.30.78.7`'].join('\n')}};
 return {context,outputFile:join(privateDir,'backup.sql.gz.age'),recipient:'age1'+'a'.repeat(58),close:()=>rmSync(privateDir,{recursive:true,force:true})};
}
function processes(fail){return (binary,args,options)=>{
 if(binary==='docker'){assert.ok(args.includes('mysqldump'));const envFile=args[args.indexOf('--env-file')+1];assert.equal(readFileSync(envFile,'utf8'),'MYSQL_PWD='+'1'.repeat(64)+'\n');return spawn(process.execPath,['-e',"process.stdout.write('CREATE TABLE synthetic (id INT);\\n'); process.exitCode="+(fail==='dump'?1:0)],options);}
 assert.equal(binary,'age');assert.equal(args[0],'-r');
 return spawn(process.execPath,['-e',"process.stdin.pipe(process.stdout); process.stdin.on('end',()=>{process.exitCode="+(fail==='age'?1:0)+"});"],options);
};}
test('encrypted publication waits for every pipeline stage and creates only a private complete artifact',async()=>{
 assert.equal(typeof backup.createEncryptedBackup,'function');const f=fixture();
 try{const result=await backup.createEncryptedBackup({...f,spawnProcess:processes()});assert.equal(result,f.outputFile);assert.equal(gunzipSync(readFileSync(result)).toString(),'CREATE TABLE synthetic (id INT);\n');assert.equal(statSync(result).mode&0o777,0o600);assert.deepEqual(readdirSync(f.context.privateDir),['backup.sql.gz.age']);}finally{f.close();}
});
test('failed dump or encryption never publishes even when downstream produces complete-looking output',async()=>{
 assert.equal(typeof backup.createEncryptedBackup,'function');
 for(const fail of ['dump','age']){const f=fixture();try{await assert.rejects(backup.createEncryptedBackup({...f,spawnProcess:processes(fail)}),error=>error.message==='SHARED_BACKUP_FAILED');assert.equal(existsSync(f.outputFile),false);assert.deepEqual(readdirSync(f.context.privateDir),[]);}finally{f.close();}}
});
test('backup rejects missing trusted audit invalid recipient and existing destination before DB contact',async()=>{
 assert.equal(typeof backup.createEncryptedBackup,'function');
 for(const mode of ['audit','recipient','existing']){const f=fixture();let contact=false;f.context.run=()=>{contact=true;throw new Error('contact')};if(mode==='audit')delete f.context.input.provisioningAudit;if(mode==='recipient')f.recipient='ssh-ed25519 unreviewed';if(mode==='existing')writeFileSync(f.outputFile,'original',{mode:0o600});try{await assert.rejects(backup.createEncryptedBackup({...f,spawnProcess:processes()}),/SHARED_/);assert.equal(contact,false);if(mode==='existing')assert.equal(readFileSync(f.outputFile,'utf8'),'original');}finally{f.close();}}
});
test('backup abort closes both stages and removes unpublished ciphertext before rejecting',async()=>{
 const f=fixture(),controller=new AbortController();f.context.signal=controller.signal;
 const spawnProcess=(binary,args,options)=>{const child=binary==='docker'?spawn(process.execPath,['-e',"process.stdout.write('some SQL');setTimeout(()=>process.exit(0),200)"],options):spawn(process.execPath,['-e',"process.stdin.pipe(process.stdout)"],options);return child;};
 try{const work=backup.createEncryptedBackup({...f,spawnProcess});setTimeout(()=>controller.abort(),20);await assert.rejects(work,/SHARED_BACKUP_FAILED/);assert.equal(existsSync(f.outputFile),false);assert.deepEqual(readdirSync(f.context.privateDir),[]);}finally{f.close();}
});
