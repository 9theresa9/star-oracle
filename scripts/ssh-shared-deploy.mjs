#!/usr/bin/env node
/** Checked lifecycle for the opt-in shared profile; external MySQL is read-only. */
import {openSync, closeSync, fstatSync, constants, mkdtempSync, writeFileSync, rmSync, realpathSync, readFileSync, readdirSync, existsSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {spawnSync, spawn} from 'node:child_process';
import {AsyncLocalStorage} from 'node:async_hooks';
import {setTimeout as delay} from 'node:timers/promises';
import {commandRunner, dockerEnvironment, inspectLocalDaemon, validateEngine} from './ssh-deploy.mjs';
import {PROJECT, EDGE, BACKEND, IMAGES, SERVICES, NETWORKS, roleUsers, exactKeys, validateInput, loadInput, loadSharedSettings, sharedDockerArgs, parseSharedComposeConfig, validateSharedConfig, validateSharedContainers, validateSharedNetworks, validateExternalMysql, validateExternalRoute} from './ssh-shared-policy.mjs';
import {readSharedManifest} from './ssh-shared-release.mjs';
import {WORKER_NAME, WORKER_LABELS, probeSharedClient, sharedEntrypointCommand, mysqlClientArguments} from './ssh-shared-db.mjs';
import {roleIdentity} from '../apps/api/src/maintenance/shared-db-policy.ts';
export {readSharedManifest};

const docker=['--host','unix:///var/run/docker.sock'];
const lockContext=new AsyncLocalStorage();
const fixedLock='/run/lock/star-oracle-shared.lock';
const services=['redis','migrate','api','web'];
const ingress=['web','api','migrate'];
const ensure=(ok,code)=>{if(!ok)throw new Error(code);};
// Only exact, source-defined assertion text is translated. Never interpolate
// actual Docker fields, parser output, environment values, or provider errors.
const policyDiagnostics=new Map([
 'invalid deployment input fields','invalid external database fields','external database identity is incomplete',
 'explicit original network inventory required','invalid original network identity','duplicate original network',
 'invalid original network address','original network overlaps the fixed SSH topology','invalid original aliases',
 'explicit original default route required','trusted provisioning audit is incomplete',
 'external container or image changed','external database must already be running','external database must not expose host ports',
 'external database must never carry owned labels','external network inventory changed','approved backend attachment required',
 'original external network endpoint changed','external backend endpoint differs','ambiguous external default routes',
 'invalid route observation','external default route changed','only fixed loopback/NAT options allowed',
 'invalid or duplicate actual environment','unexpected shared service/network/volume inventory','dedicated Redis volume required',
 'fixed owned IPv4 topology required','service runtime/security settings differ','service resources changed','bounded private logs required',
 'service peer address changed','service command changed','migration healthcheck override','service healthcheck changed',
 'web must publish only the fixed loopback port','web environment overrides forbidden','only web may publish a port',
 'Redis storage/secret differs','application bind mounts forbidden','database target must be the dedicated schema and role',
 'shared SQL identity differs','migration environment override','application security environment changed',
 'application secret/cache configuration differs','application environment override','exactly four owned containers required',
 'unknown or duplicate owned service','actual container name differs','runtime image differs from release',
 'actual user/command/entrypoint changed','actual migration healthcheck changed','actual healthcheck changed',
 'actual environment differs','actual host isolation differs','actual security settings changed','actual volume binding differs','actual resources differ',
 'actual log rotation differs','unreviewed actual mount','actual web publication changed','unpublished service has a port',
 'actual runtime publication changed','actual service network inventory changed','actual service peer changed',
 'actual service DNS aliases changed','exact owned network inventory required','actual network differs',
 'external endpoint on wrong network','unrelated endpoint on owned network'
].map(message=>['Shared SSH policy: '+message,'SHARED_POLICY_'+message.toUpperCase().replace(/[^A-Z]+/g,'_')]));
const diagnosticStages=new Set(['SHARED_DAEMON_INSPECTION','SHARED_ENGINE_INSPECTION','SHARED_RELEASE_INSPECTION',
 'SHARED_IMAGE_INSPECTION','SHARED_CONFIG_INSPECTION','SHARED_CONTAINER_INVENTORY','SHARED_EXTERNAL_INSPECTION',
 'SHARED_NETWORK_INVENTORY','SHARED_HOST_ROUTE_INSPECTION','SHARED_EXTERNAL_ROUTE_INSPECTION',
 'SHARED_VOLUME_INSPECTION','SHARED_CONTAINER_INSPECTION','SHARED_NETWORK_INSPECTION','SHARED_PREPARE_CREATE']);
function safeError(error){
 const message=policyDiagnostics.get(error?.message)??(/^SHARED_[A-Z_]{1,96}$/.test(error?.message??'')?error.message:'SHARED_VALIDATION_FAILED');
 const safe=new Error(message);if(diagnosticStages.has(error?.sharedStage))safe.sharedStage=error.sharedStage;return safe;
}
export function formatSharedFailure(error){const safe=safeError(error);return safe.message+(safe.sharedStage?' ['+safe.sharedStage+']':'');}
const label=c=>c.Config?.Labels??{};
const service=c=>label(c)['com.docker.compose.service'];
const stopped=c=>c.State?.Running===false&&!c.State.Paused&&!c.State.Restarting&&['created','exited','dead'].includes(c.State.Status);

export function validateSharedDaemonBackend(config,argv){
 ensure(!Object.hasOwn(config,'firewall-backend')||config['firewall-backend']==='iptables','SHARED_DAEMON_BACKEND');
 let seen=false;for(let i=0;i<argv.length;i++){
  if(argv[i]==='--firewall-backend'){ensure(!seen&&argv[++i]==='iptables','SHARED_DAEMON_BACKEND');seen=true;}
  else if(argv[i].startsWith('--firewall-backend=')){ensure(!seen&&argv[i]==='--firewall-backend=iptables','SHARED_DAEMON_BACKEND');seen=true;}
 }
}
function inspectSharedDaemon(){
 inspectLocalDaemon();const daemons=[];
 for(const pid of readdirSync('/proc').filter(value=>/^\d+$/.test(value)))try{const argv=readFileSync(`/proc/${pid}/cmdline`,'utf8').split('\0').filter(Boolean);if(/(?:^|\/)dockerd$/.test(argv[0]??''))daemons.push(argv);}catch{}
 ensure(daemons.length===1,'SHARED_DAEMON_IDENTITY');const argv=daemons[0],at=argv.indexOf('--config-file'),inline=argv.find(value=>value.startsWith('--config-file='));
 const path=at>=0?argv[at+1]:inline?.slice(14)??'/etc/docker/daemon.json';
 validateSharedDaemonBackend(existsSync(path)?JSON.parse(readFileSync(path,'utf8')):{},argv);
}
export function validateSharedHostRoutes(text,networks){
 const value=ip=>ip.split('.').reduce((sum,part)=>sum*256+Number(part),0),little=hex=>Buffer.from(hex,'hex').reverse().readUInt32BE(0);
 const rows=text.trim().split(/\r?\n/);ensure(rows.shift()?.startsWith('Iface'),'SHARED_HOST_ROUTES');
 for(const row of rows){const r=row.trim().split(/\s+/);ensure(r.length>=8&&[r[1],r[7]].every(v=>/^[a-fA-F0-9]{8}$/.test(v)),'SHARED_HOST_ROUTES');if(!(parseInt(r[3],16)&1)||r[7]==='00000000')continue;
  const mask=little(r[7]),size=2**32-mask,start=little(r[1]);ensure(Number.isInteger(Math.log2(size))&&start%size===0,'SHARED_HOST_ROUTES');
  for(const n of Object.values(NETWORKS)){const fixed=value(n.prefix+'.0');if(fixed+255<start||fixed>=start+size)continue;
   const own=networks.find(network=>network.Name===n.name);ensure(own&&r[0]==='br-'+own.Id.slice(0,12)&&start===fixed&&size===256&&r[2]==='00000000','SHARED_HOST_ROUTE_CONFLICT');
  }
 }
}

/** flock attaches to this open file description and remains held by our fd. */
export async function withSharedLock(operation,{path=fixedLock}={}){
 const inherited=lockContext.getStore();
 if(inherited){ensure(inherited.alive,'SHARED_LOCK_EXPIRED');ensure(path===fixedLock||path===inherited.path,'SHARED_LOCK_NESTING');return operation();}
 ensure(typeof operation==='function'&&typeof path==='string'&&path.startsWith('/'),'SHARED_LOCK_INPUT');
 let fd;
 try{
  try{fd=openSync(path,constants.O_CREAT|constants.O_RDWR|constants.O_NOFOLLOW,0o600);}catch{throw new Error('SHARED_LOCK_UNAVAILABLE');}
  const s=fstatSync(fd);ensure(s.isFile()&&s.uid===process.getuid()&&(s.mode&0o777)===0o600&&s.nlink===1,'SHARED_LOCK_UNSAFE');
  const acquired=spawnSync('flock',['-n','3'],{stdio:['ignore','ignore','ignore',fd],env:dockerEnvironment()});
  ensure(acquired.status===0,acquired.status===1?'SHARED_LOCK_BUSY':'SHARED_LOCK_UNAVAILABLE');
  const controller=new AbortController(),interrupt=()=>controller.abort(new Error('SHARED_INTERRUPTED')),scope={path,signal:controller.signal,active:false,alive:true};
  process.on('SIGINT',interrupt);process.on('SIGTERM',interrupt);
  try{return await lockContext.run(scope,operation);}
  finally{scope.alive=false;process.off('SIGINT',interrupt);process.off('SIGTERM',interrupt);}
 }finally{if(fd!==undefined)closeSync(fd);}
}

async function inspectIds(run,ids){
 if(!ids.length)return [];
 ensure(ids.every(id=>/^[a-f0-9]{64}$/.test(id)),'SHARED_CONTAINER_ID');
 const result=JSON.parse(await run([...docker,'inspect',...ids]));
 ensure(Array.isArray(result)&&result.length===ids.length&&new Set(result.map(c=>c.Id)).size===ids.length&&result.every(c=>ids.includes(c.Id)),'SHARED_CONTAINER_INVENTORY');return result;
}
const splitIds=value=>value.trim().split(/\s+/).filter(Boolean);
async function inventory(context){
 const {run,input}=context,ids=new Set();
 for(const filter of [`label=com.docker.compose.project=${PROJECT}`,`name=^/${WORKER_NAME}$`,'name=^/star-oracle-shared-candidate-'])for(const id of splitIds(await run([...docker,'ps','-aq','--no-trunc','--filter',filter])))ids.add(id);
 const containers=await inspectIds(run,[...ids]),owned=[],transient=[];
 for(const c of containers){
  if(c.Id===input.externalMysql.containerId)continue;
  if(c.Name===`/${WORKER_NAME}`||c.Name?.startsWith('/star-oracle-shared-candidate-')||label(c)['io.star-oracle.worker']==='true'||label(c)['io.star-oracle.candidate']==='true')transient.push(c);else owned.push(c);
 }
 return {owned,transient};
}
function ownsService(c,input){return c.Id!==input.externalMysql.containerId&&/^[a-f0-9]{64}$/.test(c.Id)&&Object.hasOwn(SERVICES,service(c))&&c.Name===`/${PROJECT}-${service(c)}-1`&&label(c)['com.docker.compose.project']===PROJECT&&label(c)['io.star-oracle.deployment']==='ssh-shared';}
async function stopServices(context,names=ingress){
 const current=await inventory(context),selected=current.owned.filter(c=>ownsService(c,context.input)&&names.includes(service(c)));
 const ids=selected.filter(c=>!stopped(c)).map(c=>c.Id);
 if(ids.length)await context.run([...docker,'stop','--time','20',...ids]);
 const observed=await inspectIds(context.run,selected.map(c=>c.Id));
 ensure(observed.every(c=>ownsService(c,context.input)&&stopped(c)),'SHARED_STOP_FAILED');
}

function validateTransient(c,context){
 const {manifest,input,images}=context,l=label(c),h=c.HostConfig,n=c.NetworkSettings;
 ensure(c.Id!==input.externalMysql.containerId&&/^[a-f0-9]{64}$/.test(c.Id)&&l['com.docker.compose.project']===PROJECT&&l['io.star-oracle.deployment']==='ssh-shared','SHARED_TRANSIENT_OWNERSHIP');
 const candidate=/^\/star-oracle-shared-candidate-([a-z0-9]{1,12})$/.exec(c.Name??'');
 const worker=c.Name===`/${WORKER_NAME}`&&l['io.star-oracle.worker']==='true';
 ensure(candidate&&l['io.star-oracle.candidate']==='true'||worker,'SHARED_TRANSIENT_OWNERSHIP');
 const image=manifest.images.find(i=>i.id===c.Image),actualImage=images.find(i=>i.Id===c.Image);
 ensure(image&&actualImage&&JSON.stringify(c.Config.Entrypoint??[])===JSON.stringify(actualImage.Config.Entrypoint??[]),'SHARED_TRANSIENT_IMAGE');
 const api=image.tag===IMAGES[0],client=image.tag===IMAGES[3],redis=image.tag===IMAGES[2];
 ensure(candidate?redis:api||client,'SHARED_TRANSIENT_IMAGE');
 const memory=(candidate?64:api?512:128)*1024**2;
 ensure(h?.NetworkMode===BACKEND&&!h.Privileged&&!h.PublishAllPorts&&!h.CapAdd?.length&&!h.Devices?.length&&!h.DeviceRequests?.length&&!h.PidMode&&(!h.IpcMode||h.IpcMode==='private')&&!h.UsernsMode&&!h.Binds?.length&&!h.ExtraHosts?.length&&!h.Dns?.length&&!h.DnsSearch?.length&&!h.DnsOptions?.length&&!Object.keys(h.Sysctls??{}).length&&h.ReadonlyRootfs===true&&JSON.stringify(h.CapDrop)===JSON.stringify(['ALL'])&&h.SecurityOpt?.length===1&&['no-new-privileges:true','no-new-privileges'].includes(h.SecurityOpt[0])&&h.RestartPolicy?.Name==='no','SHARED_TRANSIENT_SECURITY');
 ensure(h.Memory===memory&&h.MemorySwap===memory&&h.NanoCpus===1e9&&h.PidsLimit===(api?256:128)&&c.Config.User===(candidate?'999:999':api?'1000:1000':'10001:10001'),'SHARED_TRANSIENT_RESOURCES');
 ensure(h.LogConfig?.Type==='none'&&exactKeys(h.LogConfig.Config??{},[]),'SHARED_TRANSIENT_LOGGING');
 ensure(exactKeys(h.PortBindings??{},[])&&!Object.values(n?.Ports??{}).some(v=>v?.length)&&exactKeys(n.Networks,[BACKEND]),'SHARED_TRANSIENT_NETWORK');
 const endpoint=n.Networks[BACKEND],ip=candidate?'172.30.78.8':'172.30.78.7';
 ensure(endpoint.IPAMConfig?.IPv4Address===ip&&(!c.State?.Running||endpoint.IPAddress===ip)&&!endpoint.GlobalIPv6Address,'SHARED_TRANSIENT_NETWORK');
 ensure(exactKeys(h.Tmpfs??{},['/tmp'])&&h.Tmpfs['/tmp']===`rw,noexec,nosuid,size=${api?67108864:16777216}`,'SHARED_TRANSIENT_SECURITY');
 const mounts=(c.Mounts??[]).filter(m=>m.Type!=='tmpfs');
 ensure(candidate?mounts.length===1&&mounts[0].Type==='volume'&&mounts[0].Name===`star-oracle-shared-candidate-${candidate[1]}-redis`&&mounts[0].Destination==='/data'&&mounts[0].RW===true:mounts.length===0,'SHARED_TRANSIENT_MOUNT');
 validateTransientConfiguration(c,context,{candidate,api,client,actualImage});
 return c;
}
function envObject(values){const env={};for(const value of values??[]){const index=value.indexOf('=');ensure(index>0&&!Object.hasOwn(env,value.slice(0,index)),'SHARED_TRANSIENT_ENV');env[value.slice(0,index)]=value.slice(index+1);}return env;}
function validateTransientConfiguration(c,context,{candidate,api,client,actualImage}){
 const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b),cmd=c.Config.Cmd,env=envObject(c.Config.Env),base=envObject(actualImage.Config.Env);let expected;
 ensure(same(c.Config.Healthcheck??null,actualImage.Config.Healthcheck??null),'SHARED_TRANSIENT_HEALTHCHECK');
 if(candidate){
  ensure(same(cmd,['sh','-c','exec redis-server --bind 0.0.0.0 --protected-mode yes --appendonly yes --maxmemory 32mb --maxmemory-policy noeviction --requirepass "$REDIS_PASSWORD"']),'SHARED_TRANSIENT_COMMAND');
  ensure(/^[a-fA-F0-9]{64}$/.test(env.REDIS_PASSWORD??''),'SHARED_TRANSIENT_ENV');expected={...base,REDIS_PASSWORD:env.REDIS_PASSWORD};
 }else if(client){
  ensure(Array.isArray(cmd)&&/^[a-fA-F0-9]{64}$/.test(env.MYSQL_PWD??''),'SHARED_TRANSIENT_ENV');
  const database=cmd.find(arg=>arg.startsWith('--database='))?.slice(11)??cmd.at(-1),candidateSchema=/^staroraclerestore[a-z0-9]{1,12}$/.test(database??'');
  const modes=candidateSchema?[['candidateImporter','probe'],['candidateImporter','empty'],['candidateImporter','import']]:[['backup','probe'],['backup','dump'],['maintenance','probe']];
  ensure(modes.some(([role,sqlMode])=>{const args=mysqlClientArguments({role,sqlMode,database:candidateSchema?database:'staroracle',envFile:'/private.env',imageId:c.Image});return same(cmd,args.slice(args.indexOf(c.Image)+1));}),'SHARED_TRANSIENT_COMMAND');expected={...base,MYSQL_PWD:env.MYSQL_PWD};
 }else if(api){
  ensure(Array.isArray(cmd)&&cmd.length>=4&&cmd[0]==='node'&&cmd[1]==='apps/api/dist/maintenance/shared-entrypoint.js','SHARED_TRANSIENT_COMMAND');
  const role=cmd[2],action=cmd[3];ensure(['maintenance','candidateApp','candidateMigrator'].includes(role)&&same(cmd,sharedEntrypointCommand(role,action,cmd.slice(4))),'SHARED_TRANSIENT_COMMAND');
  if(role==='maintenance')expected={...base,...context.config.services.api.environment,DATABASE_URL:`mysql://${roleUsers.maintenance}:${context.settings.MYSQL_MAINTENANCE_PASSWORD}@oracle-mysql:3306/staroracle?connection_limit=5`};
  else{
   const database=env.SHARED_CANDIDATE_DATABASE,user=roleIdentity(role,database).user;
   ensure(new RegExp(`^mysql://${user}:[a-fA-F0-9]{64}@oracle-mysql:3306/${database}\\?connection_limit=5$`).test(env.DATABASE_URL??''),'SHARED_TRANSIENT_ENV');
   expected={...base,NODE_ENV:'production',DATABASE_URL:env.DATABASE_URL,SHARED_CANDIDATE_DATABASE:database,SHARED_MYSQL_UUID:context.input.externalMysql.serverUuid,SHARED_MYSQL_VERSION:context.input.externalMysql.serverVersion};
   if(role==='candidateApp'){
    ensure(/^redis:\/\/:[a-fA-F0-9]{64}@candidate-redis:6379$/.test(env.REDIS_URL??''),'SHARED_TRANSIENT_ENV');
    Object.assign(expected,{REDIS_URL:env.REDIS_URL,DATA_ENCRYPTION_KEY:context.settings.DATA_ENCRYPTION_KEY,AUTH_SECRET_BASE64:Buffer.from(context.settings.AUTH_SECRET,'utf8').toString('base64')});
   }
  }
 }
 ensure(expected&&exactKeys(env,Object.keys(expected))&&Object.entries(expected).every(([key,value])=>env[key]===value),'SHARED_TRANSIENT_ENV');
}
async function cleanupTransient(context){
 for(const c of (await inventory(context)).transient){
  validateTransient(c,context);
  if(!stopped(c))await context.run([...docker,'stop','--time','20',c.Id]);
  // --rm workers may disappear as soon as stop completes. Re-list under the
  // same lock and prove absence instead of treating auto-removal as a failure.
  const after=(await inventory(context)).transient.find(current=>current.Id===c.Id);if(!after)continue;
  validateTransient(after,context);ensure(stopped(after),'SHARED_TRANSIENT_STOP');
  await context.run([...docker,'rm',after.Id]);
 }
 ensure((await inventory(context)).transient.length===0,'SHARED_TRANSIENT_CLEANUP');
}

function noSubnetOverlap(networks){
 const value=ip=>ip.split('.').reduce((n,part)=>n*256+Number(part),0);
 for(const n of networks){if([EDGE,BACKEND].includes(n.Name))continue;
  for(const config of n.IPAM?.Config??[]){const match=/^(\d+\.\d+\.\d+\.\d+)\/(\d+)$/.exec(config.Subnet??'');if(!match)continue;
   const bits=Number(match[2]);ensure(bits>=0&&bits<=32,'SHARED_SUBNET_INVALID');const size=2**(32-bits),start=Math.floor(value(match[1])/size)*size;
   for(const fixed of Object.values(NETWORKS)){const address=value(fixed.prefix+'.0');ensure(address+255<start||address>=start+size,'SHARED_SUBNET_CONFLICT');}
  }
 }
}
async function inspectRedisVolume(context,{allowMissing=false}={}){
 const name=PROJECT+'-redis-data',names=(await context.run([...docker,'volume','ls','--format','{{.Name}}'])).trim().split(/\s+/).filter(Boolean);
 if(!names.includes(name)){ensure(allowMissing,'SHARED_REDIS_VOLUME_MISSING');return;}
 const volumes=JSON.parse(await context.run([...docker,'volume','inspect',name]));
 ensure(Array.isArray(volumes)&&volumes.length===1,'SHARED_REDIS_VOLUME');const v=volumes[0];
 ensure(v.Name===name&&v.Driver==='local'&&v.Scope==='local'&&exactKeys(v.Options??{},[])&&v.Labels?.['com.docker.compose.project']===PROJECT&&v.Labels?.['com.docker.compose.volume']==='redis-data','SHARED_REDIS_VOLUME');
}
async function inspectState(context,{phase='attached',allowPartial=false}={}){
 const {run,input,config,manifest,images}=context;
 context.stage='SHARED_CONTAINER_INVENTORY';
 const {owned,transient}=await inventory(context);ensure(transient.length===0,'SHARED_STALE_WORKER');
 context.stage='SHARED_EXTERNAL_INSPECTION';
 const [external]=await inspectIds(run,[input.externalMysql.containerId]);
 context.stage='SHARED_NETWORK_INVENTORY';
 const networkIds=splitIds(await run([...docker,'network','ls','-q','--no-trunc']));
 const allNetworks=networkIds.length?JSON.parse(await run([...docker,'network','inspect',...networkIds])):[];
 ensure(Array.isArray(allNetworks)&&allNetworks.length===networkIds.length,'SHARED_NETWORK_INVENTORY');noSubnetOverlap(allNetworks);
 const networks=allNetworks.filter(n=>[EDGE,BACKEND].includes(n.Name));
 context.stage='SHARED_HOST_ROUTE_INSPECTION';
 validateSharedHostRoutes(await context.readHostRoutes(),networks);
 context.stage='SHARED_EXTERNAL_INSPECTION';
 validateExternalMysql(external,input,{phase,backendId:networks.find(n=>n.Name===BACKEND)?.Id});
 context.stage='SHARED_EXTERNAL_ROUTE_INSPECTION';
 validateExternalRoute(await run([...docker,'exec',input.externalMysql.containerId,'cat','/proc/net/route']),input);
 context.stage='SHARED_VOLUME_INSPECTION';
 await inspectRedisVolume(context,{allowMissing:allowPartial});
 context.stage='SHARED_CONTAINER_INSPECTION';validateSharedContainers(owned,config,manifest,images,{allowPartial});
 context.stage='SHARED_NETWORK_INSPECTION';validateSharedNetworks(networks,owned,external,input,{allowPartial});
 context.stage=undefined;return {containers:owned,networks,external};
}
function makeContext({root,input,settings,manifest,run,inspectDaemon=inspectSharedDaemon,readHostRoutes=()=>readFileSync('/proc/net/route','utf8')}){
 validateInput(input);ensure(typeof root==='string'&&root.startsWith('/'),'SHARED_ROOT');
 run??=commandRunner({...settings,SHARED_MYSQL_UUID:input.externalMysql.serverUuid,SHARED_MYSQL_VERSION:input.externalMysql.serverVersion});
 const execute=async args=>{try{return await run(args);}catch{throw new Error('SHARED_DOCKER_FAILED');}};
 return {root,input,settings,manifest,run:execute,inspectDaemon,readHostRoutes,signal:lockContext.getStore().signal};
}
async function initialize(context){
 const {root,input,run:execute,inspectDaemon}=context;let {manifest}=context;
 context.stage='SHARED_DAEMON_INSPECTION';
 await inspectDaemon();
 context.stage='SHARED_ENGINE_INSPECTION';
 validateEngine(await execute([...docker,'version','--format','{{.Server.Version}}']));
 context.stage='SHARED_RELEASE_INSPECTION';
 manifest??=readSharedManifest(root);
 ensure(Array.isArray(manifest.images)&&manifest.images.length===4&&new Set(manifest.images.map(i=>i.tag)).size===4&&manifest.images.every(i=>IMAGES.includes(i.tag)&&/^sha256:[a-f0-9]{64}$/.test(i.id)&&/^linux\/(amd64|arm64)$/.test(i.platform)),'SHARED_IMAGE_MANIFEST');
 context.stage='SHARED_IMAGE_INSPECTION';const platform=(await execute([...docker,'info','--format','{{.OSType}}/{{.Architecture}}'])).trim().replace('/x86_64','/amd64').replace('/aarch64','/arm64');
 context.manifest=manifest;
 const images=JSON.parse(await execute([...docker,'image','inspect',...IMAGES]));context.images=images;
 ensure(Array.isArray(images)&&images.length===4&&manifest.images.every(m=>m.platform===platform&&images.some(i=>i.Id===m.id&&i.RepoTags?.includes(m.tag)&&`${i.Os}/${i.Architecture}`===m.platform)),'SHARED_IMAGE_MISMATCH');
 context.stage='SHARED_CONFIG_INSPECTION';const config=validateSharedConfig(parseSharedComposeConfig(await execute([...sharedDockerArgs(root),'config','--format','json'])),root,input);
 context.config=config;context.stage=undefined;
}
async function ready(context,name){
 const deadline=Date.now()+240000;
 while(true){
  ensure(!context.signal.aborted,'SHARED_INTERRUPTED');
  const state=await inspectState(context),c=state.containers.find(c=>service(c)===name),s=c?.State;
  ensure(s&&!s.OOMKilled&&!s.Paused&&!s.Restarting&&!['dead','removing','exited'].includes(s.Status)&&s.Health?.Status!=='unhealthy','SHARED_SERVICE_UNHEALTHY');
  if(s.Running&&s.Health?.Status==='healthy')return state;
  ensure(Date.now()<deadline,'SHARED_HEALTH_TIMEOUT');await delay(500,undefined,{signal:context.signal});
 }
}
async function startService(context,name){
 const state=await inspectState(context),c=state.containers.find(c=>service(c)===name);
 ensure(c&&ownsService(c,context.input)&&name!=='migrate','SHARED_SERVICE_START');
 if(!c.State.Running)await context.run([...docker,'start',c.Id]);
 return ready(context,name);
}
async function privateContext(context,operation){
 const privateDir=mkdtempSync(join(tmpdir(),'star-oracle-shared-')),envFile=join(privateDir,'maintenance.env');
 try{
  const env={...context.config.services.api.environment,DATABASE_URL:`mysql://${roleUsers.maintenance}:${context.settings.MYSQL_MAINTENANCE_PASSWORD}@oracle-mysql:3306/staroracle?connection_limit=5`};delete env.AUTH_SECRET;
  ensure(Object.values(env).every(value=>typeof value==='string'&&!/[\0\r\n]/.test(value)),'SHARED_ENV_FILE');
  writeFileSync(envFile,Object.entries(env).map(([key,value])=>`${key}=${value}`).join('\n')+'\n',{flag:'wx',mode:0o600});
  return await operation({...context,privateDir,envFile});
 }finally{rmSync(privateDir,{recursive:true,force:true});}
}
async function checkSql(context){
 await probeSharedClient(context,'backup');await probeSharedClient(context,'maintenance');
}
async function maintenance(context,operation){
 await inspectState(context);await stopServices(context);await startService(context,'redis');
 return privateContext(context,async prepared=>{
  await checkSql(prepared);const state=await inspectState(prepared);ensure(state.containers.filter(c=>ingress.includes(service(c))).every(stopped),'SHARED_MAINTENANCE_INGRESS');
  ensure(!context.signal.aborted,'SHARED_INTERRUPTED');const result=await operation(prepared);
  ensure(!context.signal.aborted,'SHARED_INTERRUPTED');await stopServices(prepared);await cleanupTransient(prepared);await ready(prepared,'redis');return result;
 });
}
async function actionScope(options,operation){
 return withSharedLock(async()=>{
  const lock=lockContext.getStore();ensure(!lock.active,'SHARED_OPERATION_ACTIVE');lock.active=true;let context;
  try{context=makeContext(options);await initialize(context);ensure(!lock.signal.aborted,'SHARED_INTERRUPTED');return await operation(context);}
  catch(error){
   const diagnostic=safeError(error);if(diagnosticStages.has(context?.stage))diagnostic.sharedStage=context.stage;
   if(context){try{await stopServices(context);await cleanupTransient(context);}catch{throw new Error('SHARED_CLEANUP_FAILED_INGRESS_MUST_REMAIN_STOPPED');}}
   throw diagnostic;
  }finally{lock.active=false;}
 });
}
export async function withSharedMaintenance(options){ensure(typeof options.operation==='function','SHARED_MAINTENANCE_CALLBACK');return actionScope(options,context=>maintenance(context,options.operation));}
export async function runSharedDeployment(options){
 ensure(['check','prepare','start','stop','migrate'].includes(options.action),'SHARED_ACTION');
 return actionScope(options,async context=>{
  const {action}=options;
  if(action==='prepare'){
   // Phase one admits only the exact external original inventory, or an already
   // approved attachment to the actual inspected backend. No external mutation.
   await inspectState(context,{phase:'prepare',allowPartial:true});
   context.stage='SHARED_PREPARE_CREATE';
   await context.run([...sharedDockerArgs(context.root),'create','--no-recreate','--no-build','--pull','never',...services]);
   const state=await inspectState(context,{phase:'prepare'});ensure(state.containers.filter(c=>ingress.includes(service(c))).every(stopped),'SHARED_PREPARE_INGRESS');return state;
  }
  if(action==='migrate')return maintenance(context,async prepared=>{
   const state=await inspectState(prepared),migration=state.containers.find(c=>service(c)==='migrate');ensure(ownsService(migration,context.input)&&stopped(migration),'SHARED_MIGRATION_STATE');
   await context.run([...docker,'start','--attach',migration.Id]);
   const after=await inspectState(context),completed=after.containers.find(c=>c.Id===migration.Id);ensure(stopped(completed)&&completed.State.Status==='exited'&&completed.State.ExitCode===0,'SHARED_MIGRATION_FAILED');return after;
  });
  const initial=await inspectState(context);
  if(action==='stop'){await stopServices(context,services);return inspectState(context);}
  ensure(initial.containers.filter(c=>service(c)==='migrate').every(stopped),'SHARED_MIGRATION_ACTIVE');
  return privateContext(context,async prepared=>{
   await checkSql(prepared);
   if(action==='check'){
    ensure(initial.containers.filter(c=>c.State.Running).every(c=>!c.State.OOMKilled&&!c.State.Paused&&!c.State.Restarting&&c.State.Status==='running'&&c.State.Health?.Status==='healthy'),'SHARED_SERVICE_UNHEALTHY');
    const api=initial.containers.find(c=>service(c)==='api');if(api.State.Running)await context.run([...docker,'exec',api.Id,...sharedEntrypointCommand('app','check')]);
    return inspectState(context);
   }
   await startService(context,'redis');await startService(context,'api');const state=await startService(context,'web');
   ensure(state.containers.filter(c=>service(c)!=='migrate').every(c=>c.State.Running&&c.State.Health?.Status==='healthy'),'SHARED_START_FAILED');return state;
  });
 });
}

export function sharedAccountArguments(context,operation){
 const image=context.manifest.images.find(i=>i.tag===IMAGES[0]).id;
 return [...docker,'run','--rm','--pull','never','--log-driver=none','--interactive','--tty',`--name=${WORKER_NAME}`,...WORKER_LABELS,'--network='+BACKEND,'--ip=172.30.78.7','--read-only','--tmpfs=/tmp:rw,noexec,nosuid,size=67108864','--cap-drop=ALL','--security-opt=no-new-privileges:true','--user=1000:1000','--memory=512m','--memory-swap=512m','--pids-limit=256','--cpus=1','--env-file',context.envFile,'--env','AUTH_SECRET',image,...sharedEntrypointCommand('maintenance','account',[operation])];
}
async function account(context,operation){
 const args=sharedAccountArguments(context,operation);
 await new Promise((resolve,reject)=>{
  const child=spawn('docker',args,{env:{...dockerEnvironment(),AUTH_SECRET:context.settings.AUTH_SECRET},stdio:'inherit'}),interrupt=()=>child.kill('SIGTERM');context.signal.addEventListener('abort',interrupt,{once:true});
  child.once('error',()=>{context.signal.removeEventListener('abort',interrupt);reject(new Error('SHARED_ACCOUNT_FAILED'));});
  child.once('close',code=>{context.signal.removeEventListener('abort',interrupt);code===0?resolve():reject(new Error('SHARED_ACCOUNT_FAILED'));});
 });
}
async function main(){
 const [action,inputFile,settingsFile,accountOperation,...extra]=process.argv.slice(2);
 ensure(['check','prepare','start','stop','migrate','account'].includes(action)&&inputFile?.startsWith('/')&&settingsFile?.startsWith('/')&&!extra.length&&(action==='account'?['create','assign-username','reset-password','revoke-all-sessions'].includes(accountOperation):accountOperation===undefined),'SHARED_USAGE');
 if(action==='account')ensure(process.stdin.isTTY&&process.stdout.isTTY,'SHARED_TERMINAL_REQUIRED');
 const options={root:realpathSync(resolve(import.meta.dirname,'..')),input:loadInput(inputFile),settings:loadSharedSettings(settingsFile)};
 if(action==='account')await withSharedMaintenance({...options,operation:context=>account(context,accountOperation)});else await runSharedDeployment({...options,action});
 console.log(action==='start'?'Shared SSH application is healthy at http://localhost:17777.':action==='prepare'?'Owned resources prepared. External attachment and account provisioning remain operator actions.':action==='check'?'Shared SSH state and available database identities verified.':'Shared operation completed. API/Web remain stopped.');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{console.error(formatSharedFailure(error));process.exitCode=1;});
