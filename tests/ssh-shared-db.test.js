import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
const path = '../apps/api/src/maintenance/shared-db-policy.ts';
const db = existsSync(new URL(path, import.meta.url)) ? await import(path) : {};
const uuid = '12345678-1234-4234-8234-123456789abc';
const privileges = { app: ['SELECT','INSERT','UPDATE','DELETE'], migrator: ['SELECT','INSERT','UPDATE','DELETE','CREATE','ALTER','INDEX','REFERENCES'], backup: ['SELECT'], maintenance: ['SELECT','INSERT','UPDATE','DELETE'] };
function fixture(role='app') {
 const sourceIp = `172.30.78.${role==='app'?2:role==='migrator'?6:7}`, user = `staroracle_${role}`;
 return {role, sourceIp, expectedUuid:uuid, expectedVersion:'8.4.9', database:'staroracle', identity:{currentUser:`${user}@${sourceIp}`,serverUuid:uuid,serverVersion:'8.4.9',database:'staroracle',currentRole:'NONE',mandatoryRoles:''}, grants:[`GRANT USAGE ON *.* TO \`${user}\`@\`${sourceIp}\``,`GRANT ${privileges[role].join(', ')} ON \`staroracle\`.* TO \`${user}\`@\`${sourceIp}\``]};
}
test('shared identity accepts only the complete explicit grants for each fixed-source role', () => {
 assert.equal(typeof db.validateDatabaseIdentity, 'function', 'identity validator must exist');
 for(const role of Object.keys(privileges)) assert.equal(db.validateDatabaseIdentity(fixture(role)), true);
});
test('shared identity rejects changed or absent UUID version schema authenticated host and role metadata', () => {
 assert.equal(typeof db.validateDatabaseIdentity, 'function');
 for(const [field,value] of [['currentUser','staroracle_app@%'],['serverUuid','aaaaaaaa-1234-4234-8234-123456789abc'],['serverVersion','8.4.9-commercial'],['database','fakejournal'],['currentRole','`admin`@`%`'],['mandatoryRoles','admin']]) {
  const f=fixture(); f.identity[field]=value; assert.throws(()=>db.validateDatabaseIdentity(f), /SHARED_DB_IDENTITY/,field);
 }
 for(const key of Object.keys(fixture().identity)) {const f=fixture();delete f.identity[key];assert.throws(()=>db.validateDatabaseIdentity(f), /SHARED_DB_IDENTITY/,key);}
 for(const [key,value] of [['sourceIp','172.30.78.7'],['role','root'],['database','star_oracle'],['expectedUuid',''],['expectedVersion','8.4']]) {const f=fixture();f[key]=value;assert.throws(()=>db.validateDatabaseIdentity(f), /SHARED_DB_/);}
});
test('shared grants reject global privileges wildcard schemas roles proxy table grants and incomplete access', () => {
 assert.equal(typeof db.validateDatabaseIdentity, 'function');
 const baseline=fixture();
 const bad=[baseline.grants[1]+' WITH GRANT OPTION',baseline.grants[1].replace('DELETE','DROP'),baseline.grants[1].replace('`staroracle`','`staroracle%`'),baseline.grants[1].replace('`staroracle`.*','*.*'),baseline.grants[1].replace('`staroracle`.*','`staroracle`.`user`'),baseline.grants[1].replace('172.30.78.2','%'),'GRANT `admin`@`%` TO `staroracle_app`@`172.30.78.2`','GRANT PROXY ON ``@`` TO `staroracle_app`@`172.30.78.2`',baseline.grants[1].replace('SELECT, ','')];
 for(const grant of bad){const f=fixture();f.grants[1]=grant;assert.throws(()=>db.validateDatabaseIdentity(f), /SHARED_DB_GRANTS/,grant);}
 for(const grants of [[],baseline.grants.slice(1),[...baseline.grants,baseline.grants[1]],[baseline.grants[0],baseline.grants[1], 'GRANT FILE ON *.* TO `staroracle_app`@`172.30.78.2`']]) assert.throws(()=>db.validateDatabaseIdentity({...fixture(),grants}), /SHARED_DB_GRANTS/);
});
test('candidate identities are bound to a new alphanumeric schema and exact candidate roles', () => {
 assert.equal(typeof db.validateDatabaseIdentity, 'function');
 for(const role of ['candidateImporter','candidateMigrator','candidateApp']) {
  const sourceIp='172.30.78.7';
  const user={candidateImporter:'sor_i_abc123',candidateMigrator:'sor_m_abc123',candidateApp:'sor_a_abc123'}[role];
  const ps=role==='candidateApp'?privileges.app:role==='candidateMigrator'?privileges.migrator:[...privileges.migrator,'DROP'];
  const f={...fixture(),role,sourceIp,database:'staroraclerestoreabc123',identity:{...fixture().identity,currentUser:`${user}@${sourceIp}`,database:'staroraclerestoreabc123'},grants:[`GRANT USAGE ON *.* TO \`${user}\`@\`${sourceIp}\``,`GRANT ${ps.join(', ')} ON \`staroraclerestoreabc123\`.* TO \`${user}\`@\`${sourceIp}\``]};
  assert.equal(db.validateDatabaseIdentity(f),true);
  for(const database of ['staroracle','staroraclerestore','staroraclerestore_1','fakejournal']) assert.throws(()=>db.validateDatabaseIdentity({...f,database}),/SHARED_DB_/);
 }
});
test('trusted provisioning audit is explicit and complete; restricted metadata is never an audit', () => {
 assert.equal(typeof db.validateProvisioningAudit, 'function');
 const audit={schema:'staroracle',tablesOnly:true,serverUuid:uuid,reviewedAt:'2026-10-08T00:00:00Z',noAnonymousAccounts:true,noFallbackAccounts:true,noRolesOrExtraGrants:true};
 assert.equal(db.validateProvisioningAudit(audit,'staroracle',uuid),true);
 for(const key of Object.keys(audit)){const a={...audit};delete a[key];assert.throws(()=>db.validateProvisioningAudit(a,'staroracle',uuid),/SHARED_DB_AUDIT/);}
 for(const a of [{...audit,tablesOnly:false},{...audit,noFallbackAccounts:false},{...audit,reviewedAt:'2100-01-01T00:00:00Z'},{...audit,schema:'fakejournal'},{...audit,serverUuid:'wrong'},{...audit,observedTriggers:0}]) assert.throws(()=>db.validateProvisioningAudit(a,'staroracle',uuid),/SHARED_DB_AUDIT/);
});
const hostPath='../scripts/ssh-shared-db.mjs';
const host=existsSync(new URL(hostPath,import.meta.url))?await import(hostPath):{};
test('mysqldump excludes the mysql-only connect-timeout option while query clients keep it',()=>{
 const base={role:'backup',envFile:'/private/role.env',imageId:'sha256:'+'a'.repeat(64)};
 assert.ok(!host.mysqlClientArguments({...base,sqlMode:'dump'}).includes('--connect-timeout=10'));
 for(const sqlMode of ['probe','empty','import'])assert.ok(host.mysqlClientArguments({...base,sqlMode,...(sqlMode==='probe'?{}:{role:'candidateImporter',database:'staroraclerestoretest'})}).includes('--connect-timeout=10'));
});
test('client arguments pin source and image, expose only password-file path and harden mysql import', () => {
 assert.equal(typeof host.mysqlClientArguments,'function');
 const imageId='sha256:'+'a'.repeat(64);
 const args=host.mysqlClientArguments({role:'backup',envFile:'/private/role.env',imageId,sqlMode:'probe'});
 assert.deepEqual(args.slice(0,3),['--host','unix:///var/run/docker.sock','run']);
 for(const text of ['--log-driver=none','--pull=never','--read-only','--cap-drop=ALL','--security-opt=no-new-privileges:true','--network=star-oracle-shared-backend','--ip=172.30.78.7','--memory=128m','--memory-swap=128m','--pids-limit=128','--cpus=1','--user=10001:10001','--no-defaults','--no-login-paths','--host=oracle-mysql','--port=3306','--local-infile=0','--binary-mode=1'])assert.ok(args.includes(text),text);
 assert.ok(args.includes(imageId));assert.ok(!args.some(a=>/password|root/.test(a)));assert.ok(args.at(-1).includes('SHOW GRANTS;'));assert.ok(!args.at(-1).includes('FOR CURRENT_USER'));
 const dump=host.mysqlClientArguments({role:'backup',envFile:'/private/role.env',imageId,sqlMode:'dump'});
 for(const flag of ['--single-transaction','--quick','--no-tablespaces','--set-gtid-purged=OFF','--skip-triggers','--skip-lock-tables','--skip-add-drop-table','--skip-add-locks','--skip-disable-keys','--column-statistics=0'])assert.ok(dump.includes(flag),flag);
 assert.ok(dump.includes('--log-driver=none'));assert.equal(dump.at(-1),'staroracle');assert.ok(!dump.some(a=>['--all-databases','--databases','--events','--routines'].includes(a)));
 for(const change of [{role:'app'},{role:'migrator'},{imageId:'mysql:8.4'},{envFile:'relative.env'},{sqlMode:'raw'}])assert.throws(()=>host.mysqlClientArguments({role:'backup',envFile:'/private/role.env',imageId,sqlMode:'probe',...change}),/SHARED_DB_/);
});
test('host probe supplies one password only, parses raw SHOW GRANTS and always removes private temp env', async () => {
 assert.equal(typeof host.probeSharedClient,'function');
 const {mkdtempSync,readdirSync,rmSync,statSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const privateDir=mkdtempSync(join(tmpdir(),'shared-db-test-'));
 const f=fixture('backup'),password='1'.repeat(64);
 const context={privateDir,settings:{MYSQL_BACKUP_PASSWORD:password,AUTH_SECRET:'do-not-leak'},input:{externalMysql:{serverUuid:uuid,serverVersion:'8.4.9'}},manifest:{images:[{tag:'star-oracle-mysql-client:local',id:'sha256:'+'a'.repeat(64)}]},run(args){const path=args[args.indexOf('--env-file')+1];assert.equal(readFileSync(path,'utf8'),'MYSQL_PWD='+password+'\n');assert.equal(statSync(path).mode&0o777,0o600);return [JSON.stringify(f.identity),...f.grants].join('\n');}};
 try{
  assert.deepEqual(await host.probeSharedClient(context),f.identity);assert.deepEqual(readdirSync(privateDir),[]);
  context.run=()=>{throw new Error('mysql://private:password@server')};
  await assert.rejects(host.probeSharedClient(context),error=>error.message==='SHARED_DB_PROBE');assert.deepEqual(readdirSync(privateDir),[]);
 }finally{rmSync(privateDir,{recursive:true,force:true});}
});
test('entrypoint command only accepts reviewed role/action pairs and existing hidden-account operations',()=>{
 assert.equal(typeof host.sharedEntrypointCommand,'function');
 assert.deepEqual(host.sharedEntrypointCommand('app','serve'),['node','apps/api/dist/maintenance/shared-entrypoint.js','app','serve']);
 assert.deepEqual(host.sharedEntrypointCommand('maintenance','account',['create']).slice(-3),['maintenance','account','create']);
 for(const args of [['app','migrate'],['migrator','serve'],['candidateApp','serve'],['maintenance','account',['create','password']],['backup','check']])assert.throws(()=>host.sharedEntrypointCommand(...args),/SHARED_DB_ENTRYPOINT/);
});
test('identity diagnostics identify one rejected field without revealing supplied values',()=>{
 const cases=[['currentUser','private-user@private-host','USER'],['serverUuid','private-server-id','UUID'],['serverVersion','private-version','VERSION'],['database','private-schema','DATABASE'],['currentRole','private-role','ACTIVE_ROLES'],['mandatoryRoles','private-role','MANDATORY_ROLES'],['mandatoryRoles',null,'MANDATORY_ROLES']];
 for(const [field,value,code] of cases){const f=fixture();f.identity[field]=value;assert.throws(()=>db.validateDatabaseIdentity(f),error=>error.message==='SHARED_DB_IDENTITY_'+code);}
 for(const identity of [null,undefined,[],42,'private-secret'])assert.throws(()=>db.validateDatabaseIdentity({...fixture(),identity}),error=>error.message==='SHARED_DB_IDENTITY_SHAPE');
 assert.throws(()=>db.validateDatabaseIdentity({...fixture(),sourceIp:'172.30.78.7'}),error=>error.message==='SHARED_DB_IDENTITY_SOURCE');
 for(const [field,code] of [['expectedUuid','EXPECTED_UUID'],['expectedVersion','EXPECTED_VERSION']])assert.throws(()=>db.validateDatabaseIdentity({...fixture(),[field]:'private-secret'}),error=>error.message==='SHARED_DB_IDENTITY_'+code);
});
test('probe JSON framing failures have a separate static code and never echo client output',async()=>{
 const {mkdtempSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const privateDir=mkdtempSync(join(tmpdir(),'shared-json-diagnostic-'));
 const context={privateDir,settings:{MYSQL_BACKUP_PASSWORD:'1'.repeat(64)},input:{externalMysql:{serverUuid:uuid,serverVersion:'8.4.9'}},manifest:{images:[{tag:'star-oracle-mysql-client:local',id:'sha256:'+'a'.repeat(64)}]},run:()=> 'private-client-banner-or-secret\n{}'};
 try{await assert.rejects(host.probeSharedClient(context),error=>error.message==='SHARED_DB_IDENTITY_JSON');context.run=()=> '0x7B7D';await assert.rejects(host.probeSharedClient(context),error=>error.message==='SHARED_DB_IDENTITY_JSON_HEX');}finally{rmSync(privateDir,{recursive:true,force:true});}
});
test('role identity queries force character text before MySQL JSON can encode the binary CURRENT_ROLE cache',()=>{
 // MySQL 8.4.11 CURRENT_ROLE uses a default binary String cache and set_ascii
 // preserves its charset. JSON_OBJECT wraps that value as an opaque scalar.
 const roleText='CAST(CURRENT_ROLE() AS CHAR CHARACTER SET utf8mb4)';
 assert.ok(db.identityQuery.includes(roleText+' AS currentRole'),'Prisma identity needs an explicit text result');
 assert.ok(db.identityJsonQuery.includes("'currentRole', "+roleText),'JSON identity must receive character text');
 for(const currentRole of ['base64:type15:Tk9ORQ==','base64:type253:Tk9ORQ==','',null,'none','`operator`@`%`'])assert.throws(()=>db.validateDatabaseIdentity({...fixture(),identity:{...fixture().identity,currentRole}}),error=>error.message==='SHARED_DB_IDENTITY_ACTIVE_ROLES');
 assert.equal(db.validateDatabaseIdentity(fixture()),true);
});
