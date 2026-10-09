#!/usr/bin/env node
// Real Docker/network regression, exclusively in a fresh disposable CI runner.
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {networkInterfaces,tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {request} from 'node:http';
import {connect} from 'node:net';
import {commandRunner,dockerArguments,runDeployment,inspectLocalDaemon,PROJECT,NETWORK,BACKEND} from './ssh-deploy.mjs';
import {inspectImages} from './ssh-release.mjs';
if(process.env.CI!=='true')throw new Error('SSH container smoke is restricted to a disposable CI runner.');
const root=resolve(import.meta.dirname,'..');
const [proofOption,proofPath,...extra]=process.argv.slice(2);
if(proofOption!=='--proof'||!proofPath?.startsWith('/')||extra.length)throw new Error('Usage: node scripts/ssh-container-smoke.mjs --proof /absolute/verification.json');
const git=arg=>{const result=spawnSync('git',['rev-parse',arg],{cwd:root,encoding:'utf8'});if(result.status!==0)throw new Error('Cannot record verified source');return result.stdout.trim();};
const secrets=['MYSQL_ROOT_PASSWORD','MYSQL_PASSWORD','MYSQL_MIGRATION_PASSWORD','REDIS_PASSWORD','AUTH_SECRET','DATA_ENCRYPTION_KEY'];
const settings=Object.fromEntries(secrets.map(k=>[k,randomBytes(32).toString('hex')]));
const run=commandRunner(settings),docker=['--host','unix:///var/run/docker.sock'],compose=dockerArguments(root);
inspectLocalDaemon();
// Never acquire an existing operator deployment, even when CI was set by hand.
assert.equal(run([...docker,'ps','-aq','--filter',`label=com.docker.compose.project=${PROJECT}`]),'','Existing SSH containers are forbidden in smoke');
const existingNetworks=run([...docker,'network','ls','--format','{{.Name}}']).split('\n');
assert.ok(!existingNetworks.some(n=>[NETWORK,BACKEND].includes(n)),'Existing SSH networks are forbidden in smoke');
const existingVolumes=run([...docker,'volume','ls','--format','{{.Name}}']).split('\n');
assert.ok(!existingVolumes.some(n=>[`${PROJECT}-mysql-data`,`${PROJECT}-redis-data`].includes(n)),'Existing SSH data is forbidden in smoke');
const manifest={images:inspectImages(run)};
const origin='http://localhost:17777';
function get(path='/',headers={},host='127.0.0.1') {
  return new Promise((ok,reject)=>{const req=request({hostname:host,port:17777,path,headers:{Host:'localhost:17777',...headers}},res=>{let body='';res.on('data',c=>body+=c);res.on('end',()=>ok({status:res.statusCode,headers:res.headers,body}));});req.setTimeout(5000,()=>req.destroy(new Error('HTTP probe timed out')));req.on('error',reject);req.end();});
}
function rawProbe(requestLine,headers) {
  return new Promise((ok,reject)=>{const socket=connect({host:'127.0.0.1',port:17777},()=>socket.end(`${requestLine}\r\n${headers}\r\nConnection: close\r\n\r\n`));let response='';socket.on('data',c=>response+=c);socket.on('end',()=>ok(Number(response.match(/^HTTP\/1\.[01] (\d+)/)?.[1])));socket.setTimeout(5000,()=>socket.destroy(new Error('Raw probe timeout')));socket.on('error',reject);});
}
let created=false;
try {
  created=true;
  runDeployment({action:'start',root,settings,run,manifest});
  const page=await get();assert.equal(page.status,200);
  assert.equal(page.headers['strict-transport-security'],undefined);
  assert.ok(!page.headers['content-security-policy']?.includes('upgrade-insecure-requests'));
  assert.equal((await get('/api/v1/health')).status,200);
  for(const host of ['127.0.0.1:17777','localhost','LOCALHOST:17777','localhost:17777.','attacker.invalid:17777','localhost:17778'])assert.equal((await get('/api/v1/health',{Host:host})).status,421,`Host ${host}`);
  for(const value of ['https://localhost:17777','http://127.0.0.1:17777','http://LOCALHOST:17777','null'])assert.equal((await get('/api/v1/health',{Origin:value})).status,403,`Origin ${value}`);
  for(const header of ['Forwarded','X-Forwarded-For','X-Forwarded-Host','X-Forwarded-Proto','X-Forwarded-Port','X-Real-IP','X-Forwarded-Unrecognized']){
    for(const value of ['for=127.0.0.1',''])assert.equal((await get('/api/v1/health',{[header]:value})).status,403,`${header} ${value?'populated':'empty'}`);
  }
  assert.equal(await rawProbe('GET http://attacker.invalid/api/v1/health HTTP/1.1','Host: localhost:17777'),400);
  assert.equal(await rawProbe('GET /api/v1/health HTTP/1.1','Host: localhost:17777\r\nHost: localhost:17777'),400);
  // A reachable non-loopback address is required; a skipped external-port test
  // would hide accidental 0.0.0.0 publication even with a forged valid Host.
  const external=Object.values(networkInterfaces()).flat().find(n=>n?.family==='IPv4'&&!n.internal&&!n.address.startsWith('172.30.'))?.address;
  assert.ok(external,'No external host interface for network regression');
  await assert.rejects(get('/api/v1/health',{},external),/ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|timed out/);
  // Same-network direct routing must fail at both ingress layers, even when
  // Host and Origin are completely valid. This uses a real third container.
  const networkProbe=`
    const assert=await import('node:assert/strict');
    const {get}=await import('node:http');
    for(const url of ['http://172.30.77.3:8080/api/v1/health','http://172.30.77.2:3001/api/v1/health']){
      const status=await new Promise((ok,reject)=>{const r=get(url,{headers:{Host:'localhost:17777',Origin:'http://localhost:17777'},agent:false,timeout:5000},s=>{s.resume();s.on('end',()=>ok(s.statusCode));s.on('error',reject);});r.on('timeout',()=>r.destroy(new Error('Peer probe timeout')));r.on('error',reject);});
      assert.equal(status,403,url);
    }
    const {connect}=await import('node:net');
    for(const [host,port] of [['172.30.78.4',3306],['172.30.78.5',6379]]){
      await new Promise((ok,reject)=>{const s=connect({host,port});s.on('connect',()=>{s.destroy();reject(new Error('Edge probe reached private data service'));});s.on('error',()=>ok());s.setTimeout(2000,()=>{s.destroy();ok();});});
    }
  `;
  run([...docker,'run','--rm','--pull','never','--network',NETWORK,'--ip','172.30.77.7','--read-only','--tmpfs','/tmp','--cap-drop','ALL','--security-opt','no-new-privileges:true','--memory','128m','--pids-limit','64','--entrypoint','node','star-oracle-api:local','--input-type=module','-e',networkProbe]);
  // The actual web container is only on the edge network, so its route to the
  // internal DB/cache must fail too. BusyBox nc opens no protocol connection.
  run([...compose,'exec','-T','web','sh','-c','nc -z -w 2 127.0.0.1 8080 || exit 1; if nc -z -w 2 172.30.78.4 3306; then exit 1; fi; if nc -z -w 2 172.30.78.5 6379; then exit 1; fi']);
  const username='ssh-smoke-'+randomUUID().slice(0,12),password=randomBytes(24).toString('hex');
  run([...compose,'exec','-T','api','node','--input-type=module','-e',`
    const {db,redis}=await import('./apps/api/dist/infrastructure.js');
    const {provisionAccount}=await import('./apps/api/dist/maintenance/account-service.js');
    try{await provisionAccount(db,{username:${JSON.stringify(username)},name:'Synthetic SSH smoke',password:${JSON.stringify(password)}});
      let denied=false;try{await db.$executeRawUnsafe('CREATE TABLE ssh_must_not_exist (id INT)');}catch{denied=true;}if(!denied)throw new Error('App user has DDL privileges');
    }finally{await db.$disconnect();redis.disconnect();}
  `]);
  const login=await fetch(origin+'/api/auth/sign-in/username',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({username,password}),signal:AbortSignal.timeout(10000)});
  assert.equal(login.status,200);
  const cookies=login.headers.getSetCookie();assert.ok(cookies.length);
  assert.ok(cookies.some(cookie=>cookie.includes('HttpOnly')));
  for(const cookie of cookies){assert.ok(!/(?:^|;\s*)(?:Secure|Domain=)/i.test(cookie));assert.match(cookie,/SameSite=Lax/i);assert.ok(!cookie.startsWith('__Secure-'));}
  const cookie=cookies.map(c=>c.split(';')[0]).join('; ');
  const me=await fetch(origin+'/api/v1/me',{headers:{Cookie:cookie}});assert.equal(me.status,200);
  const sentinel='SSH_SYNTHETIC_LOG_SENTINEL';
  assert.equal((await get(`/account?token=${sentinel}`,{Referer:origin+`/?token=${sentinel}`})).status,200);
  await get(`/api/does-not-exist?token=${sentinel}`);
  const logs=run([...compose,'logs','--no-color','web','api']);assert.ok(!logs.includes(sentinel),'Sensitive query/referrer reached logs');
  const backupTemp=mkdtempSync(join(tmpdir(),'ssh-smoke-backup-'));
  try{
    const path=join(backupTemp,'env');
    const privateSettings={...settings,AUTH_SECRET_BASE64:Buffer.from(settings.AUTH_SECRET).toString('base64')};delete privateSettings.AUTH_SECRET;
    writeFileSync(path,Object.entries(privateSettings).map(([k,v])=>`${k}=${v}`).join('\n')+'\n',{mode:0o600});
    const dumped=spawnSync(process.execPath,[join(root,'scripts/ssh-dump.mjs'),path],{encoding:'utf8',maxBuffer:16*1024**2,timeout:30000});
    assert.equal(dumped.status,0,'Synthetic SSH database stream failed');
    assert.ok(dumped.stdout.includes('CREATE TABLE'),'Synthetic backup stream contains no schema');
    // Never print SQL, fixture credentials or the captured dump.
  }finally{rmSync(backupTemp,{recursive:true,force:true});}
  runDeployment({action:'check',root,settings,run,manifest});
  writeFileSync(proofPath,JSON.stringify({format:1,status:'passed',commit:git('HEAD'),sourceTree:git('HEAD^{tree}'),images:manifest.images,checks:['actual-container-inspection','external-host-port','direct-routing-source','private-data-network','authority-origin-forwarding','http-cookie-session','sanitized-logs','private-backup-stream']},null,2)+'\n',{mode:0o600});
  console.log('SSH-only Docker health, actual isolation, hostile authority/proxy headers, private DB/cache, HTTP session cookie and sanitized logs passed.');
} finally {
  if(created)runDeployment({action:'stop',root,settings,run});
}
