import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,chmodSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {sharedInput,sharedExternal,sharedSettings} from './fixtures/ssh-shared.mjs';
const implementation=()=>import('../scripts/ssh-shared-policy.mjs');

test('shared profile requires explicit exact external identity and trusted provisioning audit',async()=>{
 const {validateInput}=await implementation();
 assert.deepEqual(validateInput(sharedInput()),sharedInput());
 for(const change of [x=>delete x.externalMysql,x=>x.externalMysql.containerId='mysql',x=>x.externalMysql.imageId='mysql:8.4',x=>x.externalMysql.serverVersion='8.0.36',x=>x.externalMysql.serverUuid='',x=>x.externalMysql.originalNetworks=[],x=>x.externalMysql.originalNetworks[0].ipv4Address='localhost',x=>x.externalMysql.originalNetworks[0].ipv4Address='172.28.91.004',x=>x.externalMysql.originalNetworks[0].gateway='https://evil.invalid',x=>{x.externalMysql.originalNetworks[0].ipv4Address='172.30.1.4';x.externalMysql.originalNetworks[0].prefixLength=16;},x=>x.externalMysql.originalNetworks.push(x.externalMysql.originalNetworks[0]),x=>x.externalMysql.rootPassword='secret',x=>x.provisioningAudit.tablesOnly=false,x=>x.provisioningAudit.noFallbackAccounts=false,x=>x.provisioningAudit.serverUuid='00000000-0000-0000-0000-000000000000',x=>x.provisioningAudit.schema='journal',x=>x.provisioningAudit.reviewedAt='later']){const input=sharedInput();change(input);assert.throws(()=>validateInput(input));}
});

test('external MySQL bootstrap and attached phases pin originals without acquiring lifecycle ownership',async()=>{
 const {validateExternalMysql}=await implementation(),input=sharedInput();
 assert.doesNotThrow(()=>validateExternalMysql(sharedExternal(input,false),input,{phase:'prepare'}));
 assert.throws(()=>validateExternalMysql(sharedExternal(input,false),input,{phase:'attached',backendId:'b'.repeat(64)}));
 assert.doesNotThrow(()=>validateExternalMysql(sharedExternal(input),input,{phase:'attached',backendId:'b'.repeat(64)}));
 for(const change of [x=>x.Id='c'.repeat(64),x=>x.Image=`sha256:${'a'.repeat(64)}`,x=>x.State.Running=false,x=>x.HostConfig.Privileged=true,x=>x.HostConfig.NetworkMode='host',x=>x.HostConfig.PortBindings={'3306/tcp':[{HostIp:'0.0.0.0',HostPort:'3306'}]},x=>x.NetworkSettings.Networks['star-oracle-shared-backend'].IPAddress='172.30.78.9',x=>x.NetworkSettings.Networks['star-oracle-shared-backend'].Aliases=[],x=>x.NetworkSettings.Networks['synthetic-existing-mysql'].NetworkID='0'.repeat(64),x=>x.NetworkSettings.Networks['synthetic-existing-mysql'].Gateway='172.28.91.9',x=>x.NetworkSettings.Networks.public={IPAddress:'10.0.0.1'},x=>x.Config.Labels['com.docker.compose.project']='star-oracle-shared']){const external=sharedExternal(input);change(external);assert.throws(()=>validateExternalMysql(external,input,{phase:'attached',backendId:'b'.repeat(64)}));}
});

test('shared private input and secret parser reject public files, symlinks and overrides; preserve original auth bytes',async t=>{
 const {loadInput,loadSharedSettings}=await implementation();
 const dir=mkdtempSync(join(tmpdir(),'shared-input-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const input=join(dir,'input.json'),env=join(dir,'env'),link=join(dir,'linked');
 writeFileSync(input,JSON.stringify(sharedInput()),{mode:0o600});assert.deepEqual(loadInput(input),sharedInput());
 symlinkSync(input,link);assert.throws(()=>loadInput(link));chmodSync(input,0o644);assert.throws(()=>loadInput(input));
 const values=sharedSettings(),render=v=>Object.entries(v).map(([k,v])=>`${k}=${v}`).join('\n');
 const auth='Original auth secret, spaces and UTF-8 字节 must survive 12345';
 delete values.AUTH_SECRET;values.AUTH_SECRET_BASE64=Buffer.from(auth).toString('base64');
 writeFileSync(env,render(values),{mode:0o600});assert.equal(loadSharedSettings(env).AUTH_SECRET,auth);
 for(const extra of ['\nMYSQL_ROOT_PASSWORD='+ '9'.repeat(64),'\nCOMPOSE_FILE=public.yml','\nDATABASE_URL=mysql://root@host/journal','\nAUTH_SECRET='+ 'a'.repeat(64),'\nAI_API_KEY=$(cat /secret)']){writeFileSync(env,render(values)+extra);assert.throws(()=>loadSharedSettings(env));}
 writeFileSync(env,render(values));chmodSync(env,0o644);assert.throws(()=>loadSharedSettings(env));
});

test('shared topology has bounded standing memory and migration never auto-starts with API',async()=>{
 const {SERVICES,sharedDockerArgs}=await implementation();
 assert.equal(['api','redis','web'].reduce((sum,s)=>sum+SERVICES[s].memory,0),832*1024**2);
 assert.equal(SERVICES.migrate.memory,512*1024**2);
 const args=sharedDockerArgs('/synthetic/release');
 assert.ok(args.includes('/synthetic/release/compose.ssh-shared.yml'));assert.ok(!args.includes('compose.yml'));
 assert.equal(args[1],'unix:///var/run/docker.sock');
});

test('shared Compose refuses changed ports, privileges, implicit migrations and hidden command/config overrides',async()=>{
 const {readFileSync}=await import('node:fs');
 const {validateSharedConfig}=await implementation();
 const fixture=()=>JSON.parse(readFileSync(new URL('./fixtures/ssh-shared-compose.json',import.meta.url)));
 assert.doesNotThrow(()=>validateSharedConfig(fixture(),'/fixture',sharedInput()));
 for(const mutate of [c=>c.services.mysql={},c=>c.services.web.ports[0].host_ip='0.0.0.0',c=>c.services.api.ports=[{target:3001,published:3001}],c=>c.services.web.user='0',c=>c.services.redis.user='root',c=>c.volumes['redis-data'].driver='unexpected-volume-plugin',c=>c.services.api.memswap_limit=-1,c=>c.services.api.mem_limit=0,c=>c.services.migrate.depends_on={mysql:{condition:'service_started'}},c=>c.services.api.depends_on={migrate:{condition:'service_completed_successfully'}},c=>c.services.web.entrypoint=['sh'],c=>c.services.api.command=['node','apps/api/dist/main.js'],c=>c.services.web.healthcheck.test=['CMD','sh','-c','echo leak'],c=>c.services.api.environment.SHARED_MYSQL_UUID='00000000-0000-0000-0000-000000000000',c=>c.services.api.environment.DATABASE_URL=c.services.api.environment.DATABASE_URL.replace('staroracle?','journal?'),c=>c.services.api.environment.TRUST_PROXY='true',c=>c.services.web.networks.backend={ipv4_address:'172.30.78.3'},c=>c.services.api.volumes=[{type:'bind',source:'/var/run/docker.sock',target:'/var/run/docker.sock'}],c=>c.services.api.restart='always',c=>c.services.redis.logging.options['max-size']='0',c=>c.networks.backend.external=true,c=>c.networks.backend.internal=false,c=>c.networks.ssh.driver_opts['com.docker.network.bridge.gateway_mode_ipv4']='nat-unprotected',c=>c.volumes['redis-data'].external=true]){const c=fixture();mutate(c);assert.throws(()=>validateSharedConfig(c,'/fixture',sharedInput()));}
});

test('external route comparison distinguishes explicit no-default-route and rejects attachment changes',async()=>{
 const {validateExternalRoute,parseDefaultRoute}=await implementation();
 const header='Iface Destination Gateway Flags RefCnt Use Metric Mask MTU Window IRTT\n';
 assert.deepEqual(parseDefaultRoute(header+'eth0 00000000 015B1CAC 0003 0 0 0 00000000 0 0 0\n'),{gateway:'172.28.91.1',interface:'eth0'});
 const input=sharedInput();assert.doesNotThrow(()=>validateExternalRoute(header+'eth0 00000000 015B1CAC 0003 0 0 0 00000000 0 0 0\n',input));
 assert.throws(()=>validateExternalRoute(header,input));input.externalMysql.defaultRoute=null;assert.doesNotThrow(()=>validateExternalRoute(header,input));
 assert.throws(()=>validateExternalRoute(header+'eth1 00000000 014E1EAC 0003 0 0 0 00000000 0 0 0\n',input));
});

test('rendered Compose dollars decode once while preserving the original authentication secret',async()=>{
 const {parseSharedComposeConfig,validateSharedConfig}=await implementation();
 assert.equal(typeof parseSharedComposeConfig,'function');
 const {readFileSync}=await import('node:fs'),config=JSON.parse(readFileSync(new URL('./fixtures/ssh-shared-compose.json',import.meta.url)));
 const original='An original AUTH secret with $single and $$double literal dollar signs';config.services.api.environment.AUTH_SECRET=original;
 const rendered=JSON.stringify(config).replaceAll('$','$$$$');
 const decoded=parseSharedComposeConfig(rendered);
 assert.equal(decoded.services.api.environment.AUTH_SECRET,original);
 assert.deepEqual(decoded,config);assert.doesNotThrow(()=>validateSharedConfig(decoded,'/fixture',sharedInput()));
});

test('actual migration healthcheck injection is rejected even for a partial prepare inventory',async()=>{
 const {readFileSync}=await import('node:fs'),config=JSON.parse(readFileSync(new URL('./fixtures/ssh-shared-compose.json',import.meta.url))),s=config.services.migrate;
 const {validateSharedContainers}=await implementation();
 const id='sha256:'+'a'.repeat(64),images=[{Id:id,Config:{Env:['PATH=/usr/bin'],Entrypoint:[]}}],manifest={images:[{tag:s.image,id,platform:'linux/amd64'}]};
 const container={Id:'f'.repeat(64),Name:'/star-oracle-shared-migrate-1',Image:id,Config:{Image:s.image,User:s.user,Cmd:s.command,Entrypoint:[],Env:['PATH=/usr/bin',...Object.entries(s.environment).map(([k,v])=>`${k}=${v}`)],Labels:{'com.docker.compose.project':'star-oracle-shared','com.docker.compose.service':'migrate','io.star-oracle.deployment':'ssh-shared'}},State:{Running:false},HostConfig:{NetworkMode:'star-oracle-shared-backend',ReadonlyRootfs:true,CapDrop:['ALL'],Tmpfs:{'/tmp':''},SecurityOpt:['no-new-privileges:true'],RestartPolicy:{Name:'no'},Memory:s.mem_limit,MemorySwap:s.memswap_limit,NanoCpus:1e9,PidsLimit:256,LogConfig:{Type:'json-file',Config:{'max-size':'10m','max-file':'3'}},PortBindings:{}},NetworkSettings:{Ports:{},Networks:{'star-oracle-shared-backend':{IPAMConfig:{IPv4Address:'172.30.78.6'},Aliases:['migrate']}}}};
 assert.doesNotThrow(()=>validateSharedContainers([container],config,manifest,images,{allowPartial:true}));
 for(const mutate of [c=>c.Config.Healthcheck={Test:['CMD-SHELL','echo secret-leak']},c=>c.Config.Cmd=['node','apps/api/dist/main.js'],c=>c.Config.User='0',c=>c.Config.Entrypoint=['sh'],c=>c.Config.Env.push('NODE_OPTIONS=--inspect=0.0.0.0'),c=>c.HostConfig.ExtraHosts=['oracle-mysql:1.2.3.4'],c=>c.NetworkSettings.Networks['star-oracle-shared-backend'].Aliases.push('oracle-mysql'),c=>c.HostConfig.Tmpfs['/run']='',c=>c.HostConfig.Memory=0]){const c=structuredClone(container);mutate(c);assert.throws(()=>validateSharedContainers([c],config,manifest,images,{allowPartial:true}));}
});
