import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync, mkdtempSync, writeFileSync, chmodSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';

const root = resolve(import.meta.dirname, '..');
const launcher = join(root, 'scripts/ssh-deploy.mjs');
async function implementation() {
  assert.ok(existsSync(launcher), 'the fail-closed SSH launcher must exist');
  return import(launcher);
}
// Synthetic Docker output. Unit tests exercise the policy and launch sequencing;
// real packet routing and image checks run separately in ssh-container-smoke.mjs.
function configuration() {
  const services = {};
  for (const [name, ip, image, memory] of [['api',2,'star-oracle-api:local',536870912],['web',3,'star-oracle-web:local',134217728],['mysql',4,'mysql:8.4',805306368],['redis',5,'redis:7.4',201326592],['migrate',6,'star-oracle-api:local',536870912]]) {
    services[name] = {image, networks:name==='api'?{ssh:{ipv4_address:'172.30.77.2'},backend:{ipv4_address:'172.30.78.2'}}:name==='web'?{ssh:{ipv4_address:'172.30.77.3'}}:{backend:{ipv4_address:`172.30.78.${ip}`}}, security_opt:['no-new-privileges:true'], cpus:1, mem_limit:memory, pids_limit:256, logging:{driver:'json-file',options:{'max-size':'10m','max-file':'3'}}, labels:{'io.star-oracle.deployment':'ssh-only'}, restart:'no'};
    if (['api','web','migrate'].includes(name)) Object.assign(services[name], {read_only:true,cap_drop:['ALL'],tmpfs:['/tmp']});
  }
  services.web.ports = [{host_ip:'127.0.0.1',published:'17777',target:8080,protocol:'tcp',mode:'ingress'}];
  services.web.command = ['nginx','-c','/etc/nginx/ssh.conf','-g','daemon off;'];
  services.api.environment = {NODE_ENV:'production',DEPLOYMENT_MODE:'ssh-only',SSH_ONLY_CONTAINER:'true',WEB_ORIGIN:'http://localhost:17777',API_PUBLIC_URL:'http://localhost:17777',TRUST_PROXY:'false',ADMIN_REQUIRE_2FA:'true',PORT:'3001',DATABASE_URL:`mysql://oracle:${'a'.repeat(64)}@mysql:3306/star_oracle`,REDIS_URL:`redis://:${'b'.repeat(64)}@redis:6379`};
  services.migrate.environment = {DATABASE_URL:`mysql://oracle_migrator:${'c'.repeat(64)}@mysql:3306/star_oracle`};
  services.migrate.command = ['npm','run','db:migrate','-w','@star-oracle/api'];
  services.mysql.environment = {MYSQL_DATABASE:'star_oracle',MYSQL_USER:'oracle'};
  services.mysql.volumes = [{type:'volume',source:'mysql-data',target:'/var/lib/mysql'}, {type:'bind',source:join(root,'infra/mysql-init.sh'),target:'/docker-entrypoint-initdb.d/10-privileges.sh',read_only:true}];
  services.redis.volumes = [{type:'volume',source:'redis-data',target:'/data'}];
  return {name:'star-oracle-ssh',services,networks:{ssh:{name:'star-oracle-ssh-private',driver:'bridge',enable_ipv6:false,ipam:{config:[{subnet:'172.30.77.0/24',gateway:'172.30.77.1'}]},driver_opts:{'com.docker.network.bridge.host_binding_ipv4':'127.0.0.1','com.docker.network.bridge.gateway_mode_ipv4':'nat'}},backend:{name:'star-oracle-ssh-backend',driver:'bridge',internal:true,enable_ipv6:false,ipam:{config:[{subnet:'172.30.78.0/24',gateway:'172.30.78.1'}]},driver_opts:{'com.docker.network.bridge.host_binding_ipv4':'127.0.0.1','com.docker.network.bridge.gateway_mode_ipv4':'nat'}}},volumes:{'mysql-data':{name:'star-oracle-ssh-mysql-data'},'redis-data':{name:'star-oracle-ssh-redis-data'}}};
}
function network(name='ssh') {
  if(name==='backend'){const n=network();n.Name='star-oracle-ssh-backend';n.Internal=true;n.IPAM.Config=[{Subnet:'172.30.78.0/24',Gateway:'172.30.78.1'}];return n;}
  return {Name:'star-oracle-ssh-private',Driver:'bridge',Internal:false,EnableIPv6:false,Ingress:false,IPAM:{Config:[{Subnet:'172.30.77.0/24',Gateway:'172.30.77.1'}]},Options:{'com.docker.network.bridge.host_binding_ipv4':'127.0.0.1','com.docker.network.bridge.gateway_mode_ipv4':'nat'},Labels:{'com.docker.compose.project':'star-oracle-ssh'}};
}
function containers(config=configuration()) {
  return Object.entries(config.services).map(([name,s]) => ({Id:`id-${name}`,Image:`sha256:${name}`,Config:{Image:s.image,Labels:{'com.docker.compose.project':'star-oracle-ssh','com.docker.compose.service':name,'io.star-oracle.deployment':'ssh-only'},Env:Object.entries(s.environment??{}).map(([k,v])=>`${k}=${v}`)},State:{Running:false,Status:'created'},Mounts:(s.volumes??[]).map(v=>({Type:v.type,Name:v.type==='volume'?`star-oracle-ssh-${v.source}`:undefined,Source:v.source,Destination:v.target,RW:!v.read_only})),HostConfig:{NetworkMode:['api','web'].includes(name)?'star-oracle-ssh-private':'star-oracle-ssh-backend',Privileged:false,ReadonlyRootfs:s.read_only??false,CapDrop:s.cap_drop??[],CapAdd:[],SecurityOpt:['no-new-privileges:true'],PortBindings:name==='web'?{'8080/tcp':[{HostIp:'127.0.0.1',HostPort:'17777'}]}:{},PublishAllPorts:false,Memory:s.mem_limit,NanoCpus:1e9,PidsLimit:256,Binds:name==='mysql'?[`${root}/infra/mysql-init.sh:/docker-entrypoint-initdb.d/10-privileges.sh:ro`]:[],RestartPolicy:{Name:'no'}},NetworkSettings:{Ports:{},Networks:Object.fromEntries(Object.entries(s.networks).map(([net,p])=>[net==='ssh'?'star-oracle-ssh-private':'star-oracle-ssh-backend',{IPAMConfig:{IPv4Address:p.ipv4_address},IPAddress:p.ipv4_address}]))}}));
}

test('SSH config accepts only its isolated, bounded five-service topology', async()=>{
  const {validateConfig}=await implementation();
  assert.doesNotThrow(()=>validateConfig(configuration(),root));
  for(const change of [c=>c.services.web.ports[0].host_ip='0.0.0.0',c=>c.services.api.ports=[{published:'3001',target:3001}],c=>c.services.web.network_mode='host',c=>c.services.api.environment.TRUST_PROXY='true',c=>c.services.api.environment.SSH_ONLY_CONTAINER='false',c=>c.services.api.environment.WEB_ORIGIN='http://127.0.0.1:17777',c=>c.services.api.networks.ssh.ipv4_address='172.30.77.3',c=>c.services.api.privileged=true,c=>c.services.api.cap_add=['SYS_ADMIN'],c=>c.services.api.mem_limit=0,c=>c.services.api.volumes=[{type:'bind',source:'/var/run/docker.sock',target:'/var/run/docker.sock'}],c=>c.services.web.build={context:'.'},c=>c.services.mysql.volumes[1].source='/etc/passwd',c=>c.services.redis.networks.ssh={ipv4_address:'172.30.77.5'},c=>c.services.unknown={},c=>c.services.web.restart='unless-stopped',c=>c.networks.ssh.enable_ipv6=true,c=>c.networks.ssh.driver_opts['com.docker.network.bridge.gateway_mode_ipv4']='nat-unprotected',c=>c.networks.ssh.driver_opts['com.docker.network.bridge.trusted_host_interfaces']='eth0']) {
    const candidate=configuration(); change(candidate); assert.throws(()=>validateConfig(candidate,root),/SSH policy/);
  }
});

test('SSH validates actual Docker network and container boundaries, not just YAML', async()=>{
  const {validateNetwork,validateContainers}=await implementation();
  assert.doesNotThrow(()=>validateNetwork(network()));
  assert.doesNotThrow(()=>validateContainers(containers(),configuration()));
  for(const change of [n=>n.EnableIPv6=true,n=>n.Options['com.docker.network.bridge.gateway_mode_ipv4']='routed',n=>n.Options['com.docker.network.bridge.trusted_host_interfaces']='eth0',n=>n.IPAM.Config[0].Gateway='172.30.77.9',n=>n.Driver='host']) { const n=network(); change(n); assert.throws(()=>validateNetwork(n),/SSH policy/); }
  for(const change of [c=>c[1].HostConfig.PortBindings['8080/tcp'][0].HostIp='',c=>c[0].HostConfig.PortBindings={'3001/tcp':[{HostIp:'127.0.0.1',HostPort:'3001'}]},c=>c[0].NetworkSettings.Networks.other={},c=>c[0].HostConfig.NetworkMode='host',c=>c[0].HostConfig.Privileged=true,c=>c[0].Config.Env.push('TRUST_PROXY=true'),c=>c[1].NetworkSettings.Networks['star-oracle-ssh-private'].IPAddress='172.30.77.4',c=>c[0].HostConfig.Memory=0,c=>c[0].HostConfig.RestartPolicy.Name='always']) {const candidate=containers();change(candidate);assert.throws(()=>validateContainers(candidate,configuration()),/SSH policy/);}
});

test('SSH rejects vulnerable Docker releases and nonlocal/ambient Compose controls',async()=>{
  const {validateEngine,dockerEnvironment,dockerArguments}=await implementation();
  for(const version of ['27.5.1','20.10.2','28.0.0-rc.1','garbage'])assert.throws(()=>validateEngine(version),/Docker/);
  for(const version of ['28.0.0','28.5.1','29.0.1'])assert.doesNotThrow(()=>validateEngine(version));
  const env=dockerEnvironment({PATH:'/trusted/bin',HOME:'/home/test',COMPOSE_FILE:'/hostile.yml',COMPOSE_PROFILES:'public',COMPOSE_PROJECT_NAME:'victim',DOCKER_HOST:'tcp://public:2375',WEB_ORIGIN:'https://attacker.invalid'});
  assert.deepEqual(Object.keys(env).sort(),['HOME','PATH']);
  const args=dockerArguments(root);
  assert.deepEqual(args,['--host','unix:///var/run/docker.sock','compose','--project-name','star-oracle-ssh','--project-directory',root,'--env-file','/dev/null','-f',join(root,'compose.ssh.yml')]);
});

test('SSH environment parser rejects unknown settings, insecure files and shell interpolation',async t=>{
  const {loadSettings}=await implementation();
  const dir=mkdtempSync(join(tmpdir(),'ssh-settings-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const path=join(dir,'env');
  const valid=['MYSQL_ROOT_PASSWORD','MYSQL_PASSWORD','MYSQL_MIGRATION_PASSWORD','REDIS_PASSWORD','AUTH_SECRET','DATA_ENCRYPTION_KEY'].map((name,i)=>`${name}=${String(i+1).repeat(64)}`).join('\n');
  writeFileSync(path,valid,{mode:0o600});assert.equal(loadSettings(path).MYSQL_PASSWORD,'2'.repeat(64));
  for(const extra of ['\nCOMPOSE_FILE=public.yml','\nWEB_ORIGIN=https://evil.invalid','\nAI_API_KEY=${HOME}','\nAI_API_KEY=$(cat /secret)','\nMYSQL_PASSWORD=other','\nAI_BASE_URL=http://api.example.com','\nAI_DAILY_LIMIT=10001']){writeFileSync(path,valid+extra);assert.throws(()=>loadSettings(path),/SSH settings/);}
  writeFileSync(path,valid);chmodSync(path,0o644);assert.throws(()=>loadSettings(path),/private/);
});

test('SSH launcher inspects stopped containers before start and stops only its own containers on post-start drift',async()=>{
  const {runDeployment}=await implementation();
  for(const drift of [false,true]){
    const calls=[];let started=false;
    const run=(args)=>{calls.push(args);if(args.includes('version'))return '28.1.0';if(args.includes('config'))return JSON.stringify(configuration());if(args.includes('ps'))return containers().map(c=>c.Id).join('\n');if(args.includes('inspect')&&args.includes('network'))return JSON.stringify([network(args.at(-1)==='star-oracle-ssh-backend'?'backend':'ssh')]);if(args.includes('inspect')&&args.includes('image'))return JSON.stringify([{Id:'sha256:api'}]);if(args.includes('inspect')){const c=containers();if(started)for(const container of c)container.State=container.Config.Labels['com.docker.compose.service']==='migrate'?{Status:'exited',ExitCode:0,Running:false}:{Status:'running',Running:true,Health:{Status:'healthy'}};if(started&&drift)c[1].HostConfig.PortBindings['8080/tcp'][0].HostIp='0.0.0.0';return JSON.stringify(c);}if(args.includes('start'))started=true;return '';};
    const action=()=>runDeployment({action:'start',root,settings:{},run,manifest:null});
    if(drift)assert.throws(action,/SSH policy/);else assert.doesNotThrow(action);
    const create=calls.findIndex(a=>a.includes('create'));const start=calls.findIndex(a=>a.includes('start'));const inspected=calls.findIndex((a,i)=>i>create&&a.includes('inspect')&&!a.includes('network'));
    assert.ok(create>=0&&inspected>create&&start>inspected,'must inspect created containers before any start');
    assert.ok(calls[create].includes('--no-build')&&calls[create].includes('never'));
    const stop=calls.filter(a=>a.includes('stop'));
    if(drift){assert.equal(stop.length,1);assert.ok(stop[0].includes('id-web'));assert.ok(!stop[0].includes('down'));}else assert.equal(stop.length,0);
  }
});

test('SSH nginx preserves strict authority, source restrictions and private logs',()=>{
  const path=join(root,'infra/nginx-ssh.conf');assert.ok(existsSync(path),'SSH-specific nginx configuration must exist');
  const nginx=readFileSync(path,'utf8');
  assert.match(nginx,/\$http_host/);assert.match(nginx,/localhost:17777/);assert.match(nginx,/allow 172\.30\.77\.1;/);assert.match(nginx,/allow 127\.0\.0\.1;/);assert.match(nginx,/deny all;/);
  assert.match(nginx,/proxy_set_header Host localhost:17777;/);assert.doesNotMatch(nginx,/proxy_set_header (?:Forwarded|X-Forwarded-|X-Real-IP)/);assert.match(nginx,/~\^localhost:17777\$/);assert.match(nginx,/map \$request \$origin_form/);assert.match(nginx,/error_log \/dev\/null;/);
  assert.doesNotMatch(nginx,/upgrade-insecure-requests|Strict-Transport-Security/);
  const variables=[...nginx.match(/log_format privacy[\s\S]*?;/)[0].matchAll(/\$([a-z_]+)/g)].map(x=>x[1]);
  assert.ok(variables.every(v=>['time_iso','request_id','status','body_bytes_sent','request_time'].includes(v)));
});

test('SSH release manifest binds image IDs, architecture, commit and all launcher files',async t=>{
  const script=join(root,'scripts/ssh-release.mjs');assert.ok(existsSync(script),'release packer must exist');
  const {makeManifest}=await import(script);
  const {readManifest}=await implementation();
  const dir=mkdtempSync(join(tmpdir(),'ssh-release-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const {mkdirSync}=await import('node:fs');
  const files=['compose.ssh.yml','infra/mysql-init.sh','scripts/ssh-deploy.mjs','scripts/ssh-release.mjs','scripts/backup.sh','scripts/ssh-dump.mjs','images.tar.gz'];
  for(const file of files){mkdirSync(resolve(dir,file,'..'),{recursive:true});writeFileSync(join(dir,file),'synthetic '+file);}
  const images=['star-oracle-api:local','star-oracle-web:local','mysql:8.4','redis:7.4'].map((tag,i)=>({tag,id:`sha256:${String(i+1).repeat(64)}`,platform:'linux/amd64'}));
  const sourceTree='b'.repeat(40),verification={format:1,status:'passed',commit:'a'.repeat(40),sourceTree,images};
  const manifest=makeManifest({root:dir,files,images,commit:'a'.repeat(40),sourceTree,verification});
  writeFileSync(join(dir,'ssh-manifest.json'),JSON.stringify(manifest));
  assert.equal(readManifest(dir).platform,'linux/amd64');
  for(const change of [m=>delete m.sourceTree,m=>delete m.verification,m=>m.verification.commit='c'.repeat(40),m=>m.verification.images[0].id='sha256:'+ 'd'.repeat(64),m=>delete m.files['images.tar.gz']]){const altered=JSON.parse(JSON.stringify(manifest));change(altered);writeFileSync(join(dir,'ssh-manifest.json'),JSON.stringify(altered));assert.throws(()=>readManifest(dir),/SSH policy/);}
  writeFileSync(join(dir,'ssh-manifest.json'),JSON.stringify(manifest));
  assert.throws(()=>makeManifest({root:dir,files,images:[...images.slice(0,3),{...images[3],platform:'linux/arm64'}],commit:'a'.repeat(40)}),/platform/);
  writeFileSync(join(dir,'compose.ssh.yml'),'tampered publication');
  assert.throws(()=>readManifest(dir),/checksum/);
});

test('SSH refuses daemon direct routing or disabled firewall before Docker changes',async()=>{
  const {validateDaemonConfig}=await implementation();
  assert.equal(typeof validateDaemonConfig,'function','daemon routing validation must exist');
  assert.doesNotThrow(()=>validateDaemonConfig({},['dockerd']));
  for(const [config,args] of [[{'allow-direct-routing':true},['dockerd']],[{iptables:false},['dockerd']],[{},['dockerd','--allow-direct-routing']],[{},['dockerd','--allow-direct-routing=true']],[{},['dockerd','--iptables=false']],[{},['dockerd','--allow-direct-routing=1']],[{},['dockerd','--allow-direct-routing=True']],[{},['dockerd','--iptables=0']],[{},['dockerd','--ip6tables=False']],[{},['dockerd','--config-file=/safe.json','--config-file=/other.json']],[{},['dockerd','--config-file','/safe.json','--config-file=/other.json']]])assert.throws(()=>validateDaemonConfig(config,args),/SSH policy/);
});

test('SSH daemon checks reject every noncanonical unsafe boolean flag spelling',async()=>{
 const {validateDaemonConfig}=await implementation();
 for(const value of ['1','True','TRUE','t','T','true'])assert.throws(()=>validateDaemonConfig({},['dockerd','--allow-direct-routing='+value]),/SSH policy/);
 for(const name of ['iptables','ip6tables'])for(const value of ['0','False','FALSE','f','F','false'])assert.throws(()=>validateDaemonConfig({},['dockerd','--'+name+'='+value]),/SSH policy/);
 assert.doesNotThrow(()=>validateDaemonConfig({},['dockerd','--allow-direct-routing=false','--iptables=true','--ip6tables=true']));
 for(const config of [{'allow-direct-routing':'false'},{iptables:0},{ip6tables:null}])assert.throws(()=>validateDaemonConfig(config,[]),/SSH policy/);
});

test('SSH checks assigned addresses and health after start; empty pre-start addresses are not runtime proof',async()=>{
  const {validateContainers}=await implementation();
  const candidate=containers();
  for(const c of candidate)for(const peer of Object.values(c.NetworkSettings.Networks))peer.IPAddress='';
  assert.doesNotThrow(()=>validateContainers(candidate,configuration()));
  assert.throws(()=>validateContainers(candidate,configuration(),null,true),/SSH policy/);
});

test('SSH rejects unrelated endpoints and unreviewed actual mounts',async()=>{
  const {validateNetwork,validateContainers}=await implementation();
  const n=network();n.Containers={'foreign-id':{Name:'unrelated',IPv4Address:'172.30.77.8/24'}};
  assert.throws(()=>validateNetwork(n,containers()),/SSH policy/);
  const c=containers();c[0].Mounts=[{Type:'bind',Source:'/var/run/docker.sock',Destination:'/docker.sock',RW:true}];
  assert.throws(()=>validateContainers(c,configuration()),/SSH policy/);
});

test('SSH maintenance starts only private dependencies, uses a fixed CLI and leaves ingress stopped',async()=>{
  const {maintenanceArguments}=await implementation();
  assert.equal(typeof maintenanceArguments,'function','constrained maintenance container interface must exist');
  const args=maintenanceArguments('revoke-all-sessions','/tmp/private-env','sha256:verified');
  assert.ok(args.includes('--read-only')&&args.includes('--rm')&&args.includes('--pull'));
  assert.equal(args[args.indexOf('--network')+1],'star-oracle-ssh-backend');
  assert.equal(args[args.indexOf('--ip')+1],'172.30.78.7');
  assert.deepEqual(args.slice(-4),['sha256:verified','node','apps/api/dist/maintenance/account-cli.js','revoke-all-sessions']);
  assert.ok(!args.some(arg=>['-p','--publish','--publish-all','-P'].includes(arg)));
  assert.throws(()=>maintenanceArguments('node -e arbitrary','/tmp/private-env','sha256:verified'),/SSH policy/);
});

test('SSH maintenance orchestrates stopped ingress and an offline migration without starting an API',async()=>{
  const {runDeployment}=await implementation();
  const calls=[];let dependencies=false,migrated=false,full=false;
  const run=args=>{calls.push(args);if(args.includes('version'))return '28.1.0';if(args.includes('config'))return JSON.stringify(configuration());if(args.includes('ps'))return containers().map(c=>c.Id).join('\n');if(args.includes('network'))return JSON.stringify([network(args.at(-1)==='star-oracle-ssh-backend'?'backend':'ssh')]);if(args.includes('inspect')){const c=containers();if(dependencies)for(const container of c)if(['mysql','redis'].includes(container.Config.Labels['com.docker.compose.service'])||full&&container.Id!=='id-migrate')container.State={Running:true,Status:'running',Health:{Status:'healthy'}};if(migrated)c.find(c=>c.Id==='id-migrate').State={Running:false,Status:'exited',ExitCode:0};return JSON.stringify(c);}if(args.includes('start')){if(args.includes('--attach'))migrated=true;else if(args.includes('mysql'))dependencies=true;else full=true;}return '';};
  const prepared=runDeployment({action:'maintenance',root,settings:{},run});
  assert.equal(prepared.containers.filter(c=>c.State.Running).length,2);
  const starts=calls.filter(args=>args.includes('start'));
  assert.equal(starts.length,2);
  assert.deepEqual(starts[0].slice(-2),['mysql','redis']);
  assert.deepEqual(starts[1].slice(-3),['start','--attach','id-migrate']);
  assert.ok(calls.findIndex(args=>args.includes('stop'))<calls.findIndex(args=>args.includes('start')));
  assert.doesNotThrow(()=>runDeployment({action:'start',root,settings:{},run}),'checked start must resume the dependency-only maintenance state');
  assert.equal(full,true);
});

test('SSH preserves a legacy UTF-8 auth secret through canonical base64 without shell expansion',async t=>{
  const {loadSettings}=await implementation();
  const dir=mkdtempSync(join(tmpdir(),'ssh-legacy-secret-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const path=join(dir,'env');
  const legacy='existing $literal `quotes` \\ key with unicode 星'.repeat(2);
  const valid=['MYSQL_ROOT_PASSWORD','MYSQL_PASSWORD','MYSQL_MIGRATION_PASSWORD','REDIS_PASSWORD','DATA_ENCRYPTION_KEY'].map((k,i)=>`${k}=${String(i+1).repeat(64)}`).join('\n');
  writeFileSync(path,valid+'\nAUTH_SECRET_BASE64='+Buffer.from(legacy).toString('base64'),{mode:0o600});
  assert.equal(loadSettings(path).AUTH_SECRET,legacy);
  assert.equal(loadSettings(path).AUTH_SECRET_BASE64,undefined);
  writeFileSync(path,valid+'\nAUTH_SECRET_BASE64='+Buffer.from(legacy).toString('base64')+'\nAUTH_SECRET='+ '9'.repeat(64));
  assert.throws(()=>loadSettings(path),/SSH settings/);
});
