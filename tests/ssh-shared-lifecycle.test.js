import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync, symlinkSync, statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {sharedInput, sharedExternal, sharedSettings, sha} from './fixtures/ssh-shared.mjs';
import {PROJECT, EDGE, BACKEND, IMAGES, NETWORKS, NETWORK_OPTIONS, SERVICES, HEALTH_TESTS} from '../scripts/ssh-shared-policy.mjs';
import {mysqlClientArguments} from '../scripts/ssh-shared-db.mjs';

const root=resolve(import.meta.dirname,'..');
const launcher=()=>import('../scripts/ssh-shared-deploy.mjs');
const clone=value=>structuredClone(value);
const route='Iface\tDestination\tGateway\tFlags\tRefCnt\tUse\tMetric\tMask\tMTU\tWindow\tIRTT\neth0\t00000000\t015B1CAC\t0003\t0\t0\t0\t00000000\t0\t0\t0';
const temporary=()=>mkdtempSync(join(tmpdir(),'shared-launcher-test-'));
async function locked(operation){const directory=temporary();try{const {withSharedLock}=await launcher();return await withSharedLock(operation,{path:join(directory,'host.lock')});}finally{rmSync(directory,{recursive:true,force:true});}}

function fixture({prepared=true,attached=true,running=false}={}){
 const input=sharedInput(),settings=sharedSettings(),config=JSON.parse(readFileSync(join(root,'tests/fixtures/ssh-shared-compose.json'),'utf8'));
 const images=IMAGES.map((tag,index)=>({Id:'sha256:'+sha(String(index+1)),RepoTags:[tag],Os:'linux',Architecture:'amd64',Config:{Env:['PATH=/usr/local/bin:/usr/bin:/bin'],Entrypoint:[]}}));
 const manifest={images:images.map(image=>({tag:image.RepoTags[0],id:image.Id,platform:'linux/amd64'})),platform:'linux/amd64'};
 const external=sharedExternal(input,attached);
 const allOwned=Object.entries(config.services).map(([name,s],index)=>({
  Id:sha(String(index+5)),Name:`/${PROJECT}-${name}-1`,Image:images.find(image=>image.RepoTags.includes(s.image)).Id,
  Config:{Image:s.image,User:s.user,Cmd:s.command,Entrypoint:[],Labels:{...s.labels,'com.docker.compose.project':PROJECT,'com.docker.compose.service':name},Env:['PATH=/usr/local/bin:/usr/bin:/bin',...Object.entries(s.environment??{}).map(([k,v])=>`${k}=${v}`)],...(s.healthcheck?{Healthcheck:{Test:s.healthcheck.test,Interval:5e9,Timeout:5e9,Retries:s.healthcheck.retries}}:{})},
  HostConfig:{NetworkMode:NETWORKS[Object.keys(s.networks)[0]].name,Privileged:false,PublishAllPorts:false,ReadonlyRootfs:true,Tmpfs:{'/tmp':''},CapDrop:['ALL'],SecurityOpt:['no-new-privileges:true'],RestartPolicy:{Name:'no'},Memory:s.mem_limit,MemorySwap:s.mem_limit,NanoCpus:1e9,PidsLimit:256,LogConfig:{Type:'json-file',Config:{'max-size':'10m','max-file':'3'}},PortBindings:name==='web'?{'8080/tcp':[{HostIp:'127.0.0.1',HostPort:'17777'}]}:{}},
  Mounts:name==='redis'?[{Type:'volume',Name:PROJECT+'-redis-data',Destination:'/data',RW:true}]:[],
  NetworkSettings:{Ports:{},Networks:Object.fromEntries(Object.entries(s.networks).map(([key,n])=>[NETWORKS[key].name,{NetworkID:sha(key==='backend'?'b':'a'),IPAMConfig:{IPv4Address:n.ipv4_address},IPAddress:n.ipv4_address,GlobalIPv6Address:'',Aliases:[name]}]))},
  State:{Running:running&&name!=='migrate',Status:running&&name!=='migrate'?'running':'created',ExitCode:0,Health:{Status:running?'healthy':'starting'}}
 }));
 const networkInventory=Object.entries(NETWORKS).map(([key,n])=>({Id:sha(key==='backend'?'b':'a'),Name:n.name,Driver:'bridge',Internal:n.internal,EnableIPv6:false,Labels:{'com.docker.compose.project':PROJECT},IPAM:{Config:[{Subnet:n.prefix+'.0/24',Gateway:n.prefix+'.1'}]},Options:NETWORK_OPTIONS,Containers:{}}));
 const volume={Name:PROJECT+'-redis-data',Driver:'local',Scope:'local',Options:{},Labels:{'com.docker.compose.project':PROJECT,'com.docker.compose.volume':'redis-data'}};
 const state={owned:prepared?allOwned:[],networks:prepared?networkInventory:[],volume:prepared?volume:null,external,extra:[],commands:[],fail:undefined,afterCreate:undefined,afterStart:undefined,renderDollars:false};
 const inspectNetworks=()=>state.networks.map(n=>({...n,Containers:{...(n.Name===BACKEND&&state.external.NetworkSettings.Networks[BACKEND]?{[external.Id]:{IPv4Address:'172.30.78.4/24'}}:{}),...Object.fromEntries(state.owned.filter(c=>c.State.Running&&c.NetworkSettings.Networks[n.Name]).map(c=>[c.Id,{IPv4Address:c.NetworkSettings.Networks[n.Name].IPAddress+'/24'}]))}}));
 const run=async args=>{
  state.commands.push(args);if(state.fail?.(args))throw new Error('PRIVATE_RAW_COMMAND_SECRET');
  const a=args.slice(2),verb=a[0];
  if(verb==='version')return '28.5.0';
  if(verb==='info')return 'linux/amd64';
  if(verb==='image'&&a[1]==='inspect')return JSON.stringify(images);
  if(verb==='compose'){
   const command=a[a.indexOf('-f')+2];
   if(command==='config')return JSON.stringify(config,(_key,value)=>state.renderDollars&&typeof value==='string'?value.split('$').join('$$'):value);
   if(command==='create'){state.owned=allOwned;state.networks=networkInventory;state.volume??=volume;state.afterCreate?.();return '';}
   throw new Error('Unexpected compose mutation');
  }
  if(verb==='network'&&a[1]==='ls')return state.networks.map(n=>n.Id).join('\n');
  if(verb==='network'&&a[1]==='inspect')return JSON.stringify(inspectNetworks().filter(n=>a.includes(n.Id)||a.includes(n.Name)));
  if(verb==='volume'&&a[1]==='ls')return state.volume?.Name??'';
  if(verb==='volume'&&a[1]==='inspect')return JSON.stringify([state.volume]);
  if(verb==='ps'){
   const filter=a[a.indexOf('--filter')+1]??'';
   if(filter.startsWith('name='))return state.extra.filter(c=>filter.includes('candidate')?c.Name.includes('candidate'):c.Name==='/star-oracle-shared-worker').map(c=>c.Id).join('\n');
   return [...state.owned,...state.extra,...(external.Config.Labels['com.docker.compose.project']===PROJECT?[external]:[])].map(c=>c.Id).join('\n');
  }
  if(verb==='inspect')return JSON.stringify([...state.owned,...state.extra,external].filter(c=>a.slice(1).includes(c.Id)));
  if(verb==='exec'&&a.includes('/proc/net/route'))return route;
  if(verb==='exec')return '';
  if(verb==='start'){
   const id=a.at(-1),c=state.owned.find(c=>c.Id===id);assert.ok(c,'start must target an inspected owned ID');
   if(c.Config.Labels['com.docker.compose.service']==='migrate'){c.State={Running:false,Status:'exited',ExitCode:0};}
   else c.State={Running:true,Status:'running',ExitCode:0,Health:{Status:'healthy'}};
   state.afterStart?.(c);return '';
  }
  if(verb==='stop'){for(const id of a.slice(3)){assert.notEqual(id,external.Id);const c=[...state.owned,...state.extra].find(c=>c.Id===id);assert.ok(c,'stop must target owned ID');c.State={Running:false,Status:'exited',ExitCode:0};}return '';}
  if(verb==='rm'){for(const id of a.slice(1)){assert.notEqual(id,external.Id);state.extra=state.extra.filter(c=>c.Id!==id);}return '';}
  if(verb==='run'){
   if(a.includes('mysql')){const role=a.find(arg=>arg.startsWith('--user=staroracle_')).slice(7);const privileges=role==='staroracle_backup'?'SELECT':'SELECT, INSERT, UPDATE, DELETE';const grantee='`'+role+'`@`172.30.78.7`';return JSON.stringify({currentUser:role+'@172.30.78.7',serverUuid:input.externalMysql.serverUuid,serverVersion:input.externalMysql.serverVersion,database:'staroracle',currentRole:'NONE',mandatoryRoles:''})+'\nGRANT USAGE ON *.* TO '+grantee+'\nGRANT '+privileges+' ON `staroracle`.* TO '+grantee;}
   return '';
  }
  throw new Error('Unexpected fake Docker command: '+JSON.stringify(args));
 };
 return {root,input,settings,manifest,config,images,state,run,inspectDaemon:()=>{},readHostRoutes:()=>route,service:name=>state.owned.find(c=>c.Config.Labels['com.docker.compose.service']===name)};
}
const mutators=commands=>commands.filter(a=>a.some(v=>['start','stop','rm','create','connect','disconnect'].includes(v)));

test('launcher module is present',()=>assert.ok(existsSync(join(root,'scripts/ssh-shared-deploy.mjs'))));
test('shared daemon policy accepts only tested iptables backend',async()=>{
 const {validateSharedDaemonBackend}=await launcher();assert.equal(typeof validateSharedDaemonBackend,'function');validateSharedDaemonBackend({},['dockerd']);validateSharedDaemonBackend({'firewall-backend':'iptables'},['dockerd']);validateSharedDaemonBackend({},['dockerd','--firewall-backend=iptables']);
 for(const [config,args] of [[{'firewall-backend':'nftables'},['dockerd']],[{},['dockerd','--firewall-backend=nftables']],[{},['dockerd','--firewall-backend','nftables']],[{},['dockerd','--firewall-backend=iptables','--firewall-backend=iptables']]])assert.throws(()=>validateSharedDaemonBackend(config,args));
});
test('host route checks reject overlapping host/VPN routes but permit exact owned bridge routes',async()=>{
 const {validateSharedHostRoutes}=await launcher();assert.equal(typeof validateSharedHostRoutes,'function');const header=route.split('\n')[0];validateSharedHostRoutes(route,[]);
 const row=(name,destination,mask)=>`${name}\t${destination}\t00000000\t0001\t0\t0\t0\t${mask}\t0\t0\t0`;
 assert.throws(()=>validateSharedHostRoutes(header+'\n'+row('eth1','004D1EAC','00FFFFFF'),[]));assert.throws(()=>validateSharedHostRoutes(header+'\n'+row('vpn0','00001EAC','0000FFFF'),[]));
 validateSharedHostRoutes(header+'\n'+row('br-'+sha('a').slice(0,12),'004D1EAC','00FFFFFF'),[{Id:sha('a'),Name:EDGE}]);
 assert.throws(()=>validateSharedHostRoutes(header+'\n'+row('br-'+sha('a').slice(0,12),'00001EAC','0000FFFF'),[{Id:sha('a'),Name:EDGE}]));
});
test('prepare rejects a fixed-subnet host route before creating own resources',()=>locked(async()=>{
 const f=fixture({prepared:false,attached:false}),{runSharedDeployment}=await launcher();f.readHostRoutes=()=>route+'\neth1\t004D1EAC\t00000000\t0001\t0\t0\t0\t00FFFFFF\t0\t0\t0';await assert.rejects(runSharedDeployment({...f,action:'prepare'}));assert.equal(mutators(f.state.commands).length,0);
}));
test('kernel lock rejects another process for entire callback and releases after failure',async()=>{
 const {withSharedLock}=await launcher(),directory=temporary(),path=join(directory,'host.lock');
 const contender=()=>spawnSync('flock',['-n',path,'true'],{encoding:'utf8'}).status;
 try{await assert.rejects(withSharedLock(async()=>{assert.equal(contender(),1);await new Promise(resolve=>setTimeout(resolve,25));assert.equal(contender(),1);throw new Error('operation failed');},{path}),/operation failed/);assert.equal(contender(),0);assert.equal(statSync(path).mode&0o777,0o600);}finally{rmSync(directory,{recursive:true,force:true});}
});
test('kernel lock rejects symlinks and unsafe permissions without running operation',async()=>{
 const {withSharedLock}=await launcher(),directory=temporary(),target=join(directory,'target'),link=join(directory,'link');let called=false;
 try{writeFileSync(target,'',{mode:0o644});symlinkSync(target,link);await assert.rejects(withSharedLock(()=>{called=true;},{path:link}));await assert.rejects(withSharedLock(()=>{called=true;},{path:target}));assert.equal(called,false);}finally{rmSync(directory,{recursive:true,force:true});}
});
test('prepare validates original external state before create and never starts ingress',()=>locked(async()=>{
 const f=fixture({prepared:false,attached:false}),{runSharedDeployment}=await launcher();await runSharedDeployment({...f,action:'prepare'});
 const create=mutators(f.state.commands);assert.equal(create.length,1);assert.ok(create[0].includes('--no-recreate'));assert.ok(create[0].includes('--no-build'));assert.deepEqual(create[0].slice(-4),['redis','migrate','api','web']);assert.ok(create[0].includes('never'));assert.equal(f.state.owned.length,4);assert.ok(f.state.owned.every(c=>!c.State.Running));
 assert.ok(f.state.commands.findIndex(a=>a.includes('/proc/net/route'))<f.state.commands.indexOf(create[0]));
}));
test('launcher decodes rendered Compose dollars once without changing original auth bytes',()=>locked(async()=>{
 const f=fixture(),{runSharedDeployment}=await launcher();f.state.renderDollars=true;f.settings.AUTH_SECRET=f.config.services.api.environment.AUTH_SECRET='original$literal$$secret-'.repeat(3);f.service('api').Config.Env=f.service('api').Config.Env.filter(v=>!v.startsWith('AUTH_SECRET=')).concat('AUTH_SECRET='+f.settings.AUTH_SECRET);await runSharedDeployment({...f,action:'start'});assert.equal(f.service('api').State.Running,true);
}));
test('prepare rejects a pre-existing bind-backed or unowned Redis volume before creating resources',()=>locked(async()=>{
 const {runSharedDeployment}=await launcher();for(const mutation of [v=>v.Options={type:'none',o:'bind',device:'/private'},v=>v.Labels={}]){
  const f=fixture({prepared:false,attached:false});f.state.volume={Name:PROJECT+'-redis-data',Driver:'local',Scope:'local',Options:{},Labels:{'com.docker.compose.project':PROJECT,'com.docker.compose.volume':'redis-data'}};mutation(f.state.volume);await assert.rejects(runSharedDeployment({...f,action:'prepare'}));assert.equal(mutators(f.state.commands).length,0);
 }
}));
test('new Redis volume is verified again immediately after create',()=>locked(async()=>{
 const f=fixture({prepared:false,attached:false}),{runSharedDeployment}=await launcher();f.state.afterCreate=()=>{f.state.volume.Driver='foreign-driver';};await assert.rejects(runSharedDeployment({...f,action:'prepare'}));assert.ok(!f.state.commands.some(a=>a[2]==='start'));
}));
test('wrong original external metadata rejects prepare before own resources are created',()=>locked(async()=>{
 const f=fixture({prepared:false,attached:false}),{runSharedDeployment}=await launcher();f.state.external.Image='sha256:'+sha('0');await assert.rejects(runSharedDeployment({...f,action:'prepare'}));assert.equal(mutators(f.state.commands).length,0);
}));
test('prepare rejects an attached external backend without the actual matching network',()=>locked(async()=>{
 const f=fixture({prepared:false,attached:true}),{runSharedDeployment}=await launcher();await assert.rejects(runSharedDeployment({...f,action:'prepare'}));assert.equal(mutators(f.state.commands).length,0);
}));
test('start starts Redis then API then Web and never starts migration',()=>locked(async()=>{
 const f=fixture(),{runSharedDeployment}=await launcher();await runSharedDeployment({...f,action:'start'});
 assert.deepEqual(f.state.commands.filter(a=>a[2]==='start').map(a=>a.at(-1)),['redis','api','web'].map(s=>f.service(s).Id));assert.equal(f.service('migrate').State.Running,false);assert.ok(!f.state.commands.some(a=>a.includes('create')));
 for(const args of mutators(f.state.commands))assert.ok(!args.includes(f.input.externalMysql.containerId));
}));
test('start revalidates actual command after each transition and stops owned ingress on drift',()=>locked(async()=>{
 const f=fixture(),{runSharedDeployment}=await launcher();f.state.afterStart=c=>{if(c.Config.Labels['com.docker.compose.service']==='api')c.Config.Cmd=['unsafe'];};await assert.rejects(runSharedDeployment({...f,action:'start'}));assert.equal(f.service('api').State.Running,false);assert.equal(f.service('web').State.Running,false);assert.ok(!f.state.commands.some(a=>a[2]==='start'&&a.at(-1)===f.service('web').Id));
}));
test('external container is excluded from every stop even when falsely carrying owned labels',()=>locked(async()=>{
 const f=fixture({running:true}),{runSharedDeployment}=await launcher();f.state.external.Config.Labels={'com.docker.compose.project':PROJECT,'io.star-oracle.deployment':'ssh-shared','com.docker.compose.service':'api'};await assert.rejects(runSharedDeployment({...f,action:'stop'}));for(const args of mutators(f.state.commands))assert.ok(!args.includes(f.input.externalMysql.containerId));
}));
test('migration stops API/Web and keeps Redis healthy before attached one-shot migration',()=>locked(async()=>{
 const f=fixture({running:true}),{runSharedDeployment}=await launcher();f.state.afterStart=c=>{if(c.Config.Labels['com.docker.compose.service']==='migrate'){assert.equal(f.service('api').State.Running,false);assert.equal(f.service('web').State.Running,false);assert.equal(f.service('redis').State.Health.Status,'healthy');}};await runSharedDeployment({...f,action:'migrate'});const starts=f.state.commands.filter(a=>a[2]==='start');assert.ok(starts.some(a=>a.includes('--attach')&&a.at(-1)===f.service('migrate').Id));assert.equal(f.service('api').State.Running,false);assert.equal(f.service('web').State.Running,false);
}));
test('stop failure blocks migration and callback, while raw Docker output is withheld',()=>locked(async()=>{
 const f=fixture({running:true}),{withSharedMaintenance}=await launcher();let called=false;f.state.fail=a=>a[2]==='stop';await assert.rejects(withSharedMaintenance({...f,operation:()=>{called=true;}}),error=>!error.message.includes('PRIVATE_RAW_COMMAND_SECRET'));assert.equal(called,false);assert.ok(!f.state.commands.some(a=>a[2]==='run'||a[2]==='start'));
}));
test('maintenance lock spans callback, sensitive private file cleanup, and keeps ingress stopped',()=>locked(async()=>{
 const f=fixture({running:true}),{withSharedMaintenance}=await launcher();f.config.services.api.environment.AUTH_SECRET=f.settings.AUTH_SECRET='strong\nsecret-with-special-$-characters-'.repeat(2);f.service('api').Config.Env=f.service('api').Config.Env.filter(v=>!v.startsWith('AUTH_SECRET=')).concat('AUTH_SECRET='+f.settings.AUTH_SECRET);let privateDir;
 await withSharedMaintenance({...f,operation:async context=>{privateDir=context.privateDir;assert.equal(statSync(privateDir).mode&0o777,0o700);assert.ok(!readFileSync(context.envFile,'utf8').includes('AUTH_SECRET='));assert.ok(context.signal instanceof AbortSignal);assert.equal(f.service('api').State.Running,false);assert.equal(f.service('web').State.Running,false);return 42;}});assert.ok(!existsSync(privateDir));assert.equal(f.service('api').State.Running,false);assert.equal(f.service('web').State.Running,false);
}));

function transient(f,{candidate=false,autoRemove=false}={}){
 const c=clone(f.service('redis')),suffix='example';c.Id=sha('c');c.Name=candidate?'/star-oracle-shared-candidate-'+suffix:'/star-oracle-shared-worker';
 c.Image=f.images[candidate?2:3].Id;c.Config.Image=c.Image;c.Config.Labels={'com.docker.compose.project':PROJECT,'io.star-oracle.deployment':'ssh-shared',[candidate?'io.star-oracle.candidate':'io.star-oracle.worker']:'true'};
 const args=mysqlClientArguments({role:'backup',envFile:'/private.env',imageId:c.Image,sqlMode:'probe'});
 c.Config.User=candidate?'999:999':'10001:10001';c.Config.Cmd=candidate?['sh','-c','exec redis-server --bind 0.0.0.0 --protected-mode yes --appendonly yes --maxmemory 32mb --maxmemory-policy noeviction --requirepass "$REDIS_PASSWORD"']:args.slice(args.indexOf(c.Image)+1);
 delete c.Config.Healthcheck;c.Config.Env=['PATH=/usr/local/bin:/usr/bin:/bin',(candidate?'REDIS_PASSWORD=':'MYSQL_PWD=')+f.settings.MYSQL_BACKUP_PASSWORD];
 c.HostConfig.Memory=(candidate?64:128)*1024**2;c.HostConfig.MemorySwap=c.HostConfig.Memory;c.HostConfig.PidsLimit=128;c.HostConfig.Tmpfs={'/tmp':'rw,noexec,nosuid,size=16777216'};c.HostConfig.AutoRemove=autoRemove;
 c.HostConfig.LogConfig={Type:'none',Config:{}};
 c.NetworkSettings.Networks[BACKEND].IPAMConfig.IPv4Address=c.NetworkSettings.Networks[BACKEND].IPAddress=candidate?'172.30.78.8':'172.30.78.7';c.NetworkSettings.Networks[BACKEND].Aliases=candidate?['candidate-redis']:[];
 c.Mounts=candidate?[{Type:'volume',Name:'star-oracle-shared-candidate-'+suffix+'-redis',Destination:'/data',RW:true}]:[];c.State={Running:true,Status:'running',Health:{Status:'healthy'}};return c;
}
test('stale valid worker is cleaned while action refuses and ingress remains stopped',()=>locked(async()=>{
 const f=fixture({running:true}),{runSharedDeployment}=await launcher();f.state.extra.push(transient(f));await assert.rejects(runSharedDeployment({...f,action:'start'}),/SHARED_STALE_WORKER/);assert.equal(f.state.extra.length,0);assert.equal(f.service('api').State.Running,false);assert.equal(f.service('web').State.Running,false);assert.ok(!f.state.commands.some(a=>a[2]==='start'));
}));
test('spoofed stale worker is never mutated and fails closed',()=>locked(async()=>{
 const f=fixture({running:true}),{runSharedDeployment}=await launcher();const c=transient(f);c.HostConfig.Memory=0;f.state.extra.push(c);await assert.rejects(runSharedDeployment({...f,action:'start'}),/SHARED_CLEANUP_FAILED/);assert.ok(!mutators(f.state.commands).some(a=>a.includes(c.Id)));assert.equal(f.service('api').State.Running,false);
}));
test('transient command or environment drift prevents any mutation of that container',()=>locked(async()=>{
 const {runSharedDeployment}=await launcher();for(const drift of [c=>c.Config.Cmd.push('--execute','DROP DATABASE staroracle'),c=>c.Config.Env.push('NODE_OPTIONS=--inspect=0.0.0.0')]){
  const f=fixture({running:true}),c=transient(f);drift(c);f.state.extra.push(c);await assert.rejects(runSharedDeployment({...f,action:'start'}),/SHARED_CLEANUP_FAILED/);assert.ok(!mutators(f.state.commands).some(a=>a.includes(c.Id)));assert.equal(f.service('api').State.Running,false);
 }
}));
test('transient daemon log capture is rejected before mutating that container',()=>locked(async()=>{
 const {runSharedDeployment}=await launcher(),f=fixture({running:true}),c=transient(f);c.HostConfig.LogConfig={Type:'json-file',Config:{}};f.state.extra.push(c);await assert.rejects(runSharedDeployment({...f,action:'start'}),/SHARED_CLEANUP_FAILED/);assert.ok(!mutators(f.state.commands).some(a=>a.includes(c.Id)));
}));
test('account worker uses exact offline role and passes auth by name with daemon logging disabled',async()=>{
 const {sharedAccountArguments}=await launcher();assert.equal(typeof sharedAccountArguments,'function');const f=fixture(),args=sharedAccountArguments({...f,envFile:'/private/maintenance.env'},'reset-password');
 assert.ok(args.includes('--log-driver=none'));assert.ok(args.includes('--ip=172.30.78.7'));assert.ok(args.includes('--memory=512m'));assert.ok(args.includes('--memory-swap=512m'));assert.deepEqual(args.slice(-5),['node','apps/api/dist/maintenance/shared-entrypoint.js','maintenance','account','reset-password']);assert.ok(args.includes('--env')&&args.includes('AUTH_SECRET'));assert.ok(!args.filter(value=>!value.startsWith('sha256:')).some(value=>Object.values(f.settings).some(secret=>value.includes(secret))));assert.throws(()=>sharedAccountArguments({...f,envFile:'/private/maintenance.env'},'serve'));
});
test('callback failure cleans owned candidate Redis without touching its volume or external MySQL',()=>locked(async()=>{
 const f=fixture({running:true}),{withSharedMaintenance}=await launcher();await assert.rejects(withSharedMaintenance({...f,operation:()=>{f.state.extra.push(transient(f,{candidate:true}));throw new Error('PRIVATE_CALLBACK_SECRET');}}),error=>error.message==='SHARED_VALIDATION_FAILED');assert.equal(f.state.extra.length,0);assert.ok(f.state.commands.some(a=>a[2]==='rm'&&a.includes(sha('c'))));assert.ok(!f.state.commands.some(a=>a[2]==='volume'&&!['inspect','ls'].includes(a[3])||a.includes(f.input.externalMysql.containerId)&&['stop','rm'].includes(a[2])));
}));
test('auto-removed worker disappearance after stop is verified as successful cleanup',()=>locked(async()=>{
 const f=fixture({running:true}),{withSharedMaintenance}=await launcher();const original=f.run;f.run=async args=>{const value=await original(args);if(args[2]==='stop')f.state.extra=f.state.extra.filter(c=>!c.HostConfig.AutoRemove);return value;};
 await assert.rejects(withSharedMaintenance({...f,operation:()=>{f.state.extra.push(transient(f,{autoRemove:true}));throw new Error('operation failed');}}),error=>error.message==='SHARED_VALIDATION_FAILED');assert.equal(f.state.extra.length,0);
}));
test('configuration rejection stops proven own ingress before returning failure',()=>locked(async()=>{
 const f=fixture({running:true}),{runSharedDeployment}=await launcher();f.config.services.api.command=['unsafe'];await assert.rejects(runSharedDeployment({...f,action:'start'}));assert.equal(f.service('api').State.Running,false);assert.equal(f.service('web').State.Running,false);
}));
test('shared diagnostics name the fixed policy assertion and inspection stage without actual values',()=>locked(async()=>{
 const {runSharedDeployment,formatSharedFailure}=await launcher();assert.equal(typeof formatSharedFailure,'function');
 const f=fixture({prepared:false,attached:false});f.state.afterCreate=()=>{f.service('api').Config.Cmd=['PRIVATE_COMMAND_SENTINEL'];};
 await assert.rejects(runSharedDeployment({...f,action:'prepare'}),error=>{
  assert.equal(error.message,'SHARED_POLICY_ACTUAL_USER_COMMAND_ENTRYPOINT_CHANGED');
  assert.equal(formatSharedFailure(error),'SHARED_POLICY_ACTUAL_USER_COMMAND_ENTRYPOINT_CHANGED [SHARED_CONTAINER_INSPECTION]');
  assert.ok(!formatSharedFailure(error).includes('PRIVATE_COMMAND_SENTINEL'));return true;
 });
}));
test('shared diagnostics reject policy-like raw output and unknown stage values',async()=>{
 const {formatSharedFailure}=await launcher();assert.equal(typeof formatSharedFailure,'function');
 for(const message of ['Shared SSH policy: PRIVATE_ENV_SENTINEL','Shared SSH policy: actual resources differ PRIVATE_ENV_SENTINEL','{"AUTH_SECRET":"PRIVATE_ENV_SENTINEL"}']){
  const error=new Error(message);error.sharedStage='PRIVATE_STAGE_SENTINEL';assert.equal(formatSharedFailure(error),'SHARED_VALIDATION_FAILED');
 }
});
test('check rejects unhealthy running dependencies and leaves ingress stopped',()=>locked(async()=>{
 const f=fixture({running:true}),{runSharedDeployment}=await launcher();f.service('redis').State.Health.Status='unhealthy';await assert.rejects(runSharedDeployment({...f,action:'check'}),/SHARED_SERVICE_UNHEALTHY/);assert.equal(f.service('api').State.Running,false);assert.equal(f.service('web').State.Running,false);
}));
test('maintenance completion requires Redis to remain healthy without automatic restart',()=>locked(async()=>{
 const f=fixture({running:true}),{withSharedMaintenance}=await launcher();await assert.rejects(withSharedMaintenance({...f,operation:()=>{f.service('redis').State={Running:false,Status:'exited',ExitCode:0};}}),/SHARED_SERVICE_UNHEALTHY/);assert.equal(f.service('redis').State.Running,false);assert.ok(!f.state.commands.some(a=>a[2]==='start'));
}));
test('independent asynchronous lock users contend within the same process',async()=>{
 const {withSharedLock}=await launcher(),directory=temporary(),path=join(directory,'lock');let release;
 const gate=new Promise(resolve=>{release=resolve;});try{const holder=withSharedLock(()=>gate,{path});await assert.rejects(withSharedLock(()=>42,{path}),/SHARED_LOCK_BUSY/);release();await holder;}finally{release();rmSync(directory,{recursive:true,force:true});}
});
test('detached async work cannot reuse an already released lock context',async()=>{
 const {withSharedLock}=await launcher(),directory=temporary(),path=join(directory,'lock');let resume,detached;
 try{
  await withSharedLock(()=>{const gate=new Promise(resolve=>{resume=resolve;});detached=gate.then(()=>withSharedLock(()=>42,{path}));},{path});
  resume();await assert.rejects(detached,/SHARED_LOCK_EXPIRED/);
 }finally{rmSync(directory,{recursive:true,force:true});}
});
test('SIGTERM aborts callback but retains lock through awaited pipeline shutdown and cleanup',async()=>{
 const {withSharedLock,withSharedMaintenance}=await launcher(),directory=temporary(),path=join(directory,'lock'),f=fixture({running:true});let privateDir;
 try{await assert.rejects(withSharedLock(()=>withSharedMaintenance({...f,operation:async context=>{
  privateDir=context.privateDir;process.emit('SIGTERM');assert.equal(context.signal.aborted,true);await new Promise(resolve=>setTimeout(resolve,20));assert.equal(spawnSync('flock',['-n',path,'true']).status,1);f.state.extra.push(transient(f));
 }}),{path}),/SHARED_INTERRUPTED/);assert.equal(f.state.extra.length,0);assert.equal(spawnSync('flock',['-n',path,'true']).status,0);assert.equal(existsSync(privateDir),false);}finally{rmSync(directory,{recursive:true,force:true});}
});
