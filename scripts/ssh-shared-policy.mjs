/** Private-input and Docker-state policy for the separately opted-in shared profile. */
import {openSync,closeSync,fstatSync,readFileSync,constants} from 'node:fs';
import {join} from 'node:path';
import {isIPv4} from 'node:net';
export const PROJECT='star-oracle-shared',EDGE='star-oracle-shared-edge',BACKEND='star-oracle-shared-backend';
export const DB_HOST='oracle-mysql',DB_NAME='staroracle';
export const IMAGES=['star-oracle-api:local','star-oracle-web:local','redis:7.4','star-oracle-mysql-client:local'];
export const roleUsers={app:'staroracle_app',migrator:'staroracle_migrator',backup:'staroracle_backup',maintenance:'staroracle_maintenance'};
export const SERVICES={api:{ip:2,image:IMAGES[0],memory:512*1024**2},web:{ip:3,image:IMAGES[1],memory:128*1024**2},redis:{ip:5,image:IMAGES[2],memory:192*1024**2},migrate:{ip:6,image:IMAGES[0],memory:512*1024**2}};
export const NETWORK_OPTIONS={'com.docker.network.bridge.host_binding_ipv4':'127.0.0.1','com.docker.network.bridge.gateway_mode_ipv4':'nat'};
export const NETWORKS={ssh:{name:EDGE,prefix:'172.30.77',internal:false},backend:{name:BACKEND,prefix:'172.30.78',internal:true}};
export const FIXED_ENV={NODE_ENV:'production',DEPLOYMENT_MODE:'ssh-only',SSH_ONLY_CONTAINER:'true',PORT:'3001',WEB_ORIGIN:'http://localhost:17777',API_PUBLIC_URL:'http://localhost:17777',TRUST_PROXY:'false',ADMIN_REQUIRE_2FA:'true'};
export const SECRET_NAMES=['MYSQL_PASSWORD','MYSQL_MIGRATION_PASSWORD','MYSQL_BACKUP_PASSWORD','MYSQL_MAINTENANCE_PASSWORD','REDIS_PASSWORD','AUTH_SECRET','DATA_ENCRYPTION_KEY'];
export const OPTIONAL_NAMES=['AI_API_KEY','AI_BASE_URL','AI_PROVIDER_NAME','AI_MODEL','AI_DAILY_LIMIT'];
export const assertPolicy=(ok,message)=>{if(!ok)throw new Error(`Shared SSH policy: ${message}`);};
export const exactKeys=(value,keys)=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&JSON.stringify(Object.keys(value).sort())===JSON.stringify([...keys].sort());
const hex64=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const name=v=>typeof v==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(v);
const ipv4Number=v=>v.split('.').reduce((n,x)=>n*256+Number(x),0);
const cidrRange=(v,p)=>{const size=2**(32-p),start=Math.floor(ipv4Number(v)/size)*size;return [start,start+size-1];};
const privateIp=v=>typeof v==='string'&&isIPv4(v)&&(v.startsWith('10.')||v.startsWith('192.168.')||(/^172\.(\d+)\./.test(v)&&Number(v.split('.')[1])>=16&&Number(v.split('.')[1])<=31));
export function privateText(path){
 assertPolicy(typeof path==='string'&&path.startsWith('/'),'private file path must be absolute');
 let fd;try{fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);const s=fstatSync(fd);assertPolicy(s.isFile()&&s.uid===process.getuid()&&(s.mode&0o077)===0&&s.nlink===1&&s.size<=64*1024,'input must be a private owned regular file without links');return readFileSync(fd,'utf8');}catch(error){if(error.message.startsWith('Shared SSH policy:'))throw error;throw new Error('Shared SSH policy: cannot read private input safely');}finally{if(fd!==undefined)closeSync(fd);}
}
export function validateInput(input){
 assertPolicy(exactKeys(input,['format','externalMysql','provisioningAudit'])&&input.format===1,'invalid deployment input fields');
 const x=input.externalMysql;
 assertPolicy(exactKeys(x,['containerId','imageId','serverUuid','serverVersion','originalNetworks','defaultRoute']),'invalid external database fields');
 assertPolicy(hex64(x.containerId)&&typeof x.imageId==='string'&&/^sha256:[a-f0-9]{64}$/.test(x.imageId)&&uuid(x.serverUuid)&&/^8\.4\.\d+$/.test(x.serverVersion),'external database identity is incomplete');
 assertPolicy(Array.isArray(x.originalNetworks)&&x.originalNetworks.length>0&&x.originalNetworks.length<=8,'explicit original network inventory required');
 const names=new Set(),ids=new Set();
 for(const n of x.originalNetworks){
  assertPolicy(exactKeys(n,['name','id','ipv4Address','prefixLength','gateway','aliases'])&&name(n.name)&&![EDGE,BACKEND,'host','none','bridge'].includes(n.name)&&hex64(n.id),'invalid original network identity');
  assertPolicy(!names.has(n.name)&&!ids.has(n.id),'duplicate original network');names.add(n.name);ids.add(n.id);
  assertPolicy(privateIp(n.ipv4Address)&&Number.isInteger(n.prefixLength)&&n.prefixLength>=8&&n.prefixLength<=30&&(n.gateway===''||privateIp(n.gateway)),'invalid original network address');
  const [first,last]=cidrRange(n.ipv4Address,n.prefixLength);
  assertPolicy(!['172.30.77.0','172.30.78.0'].some(ip=>{const start=ipv4Number(ip);return first<=start+255&&last>=start;}),'original network overlaps the fixed SSH topology');
  assertPolicy(!n.gateway||ipv4Number(n.gateway)>=first&&ipv4Number(n.gateway)<=last,'original gateway outside its network');
  assertPolicy(Array.isArray(n.aliases)&&n.aliases.length<=16&&n.aliases.every(name)&&new Set(n.aliases).size===n.aliases.length,'invalid original aliases');
 }
 const route=x.defaultRoute;
 assertPolicy(route===null||exactKeys(route,['gateway','interface'])&&privateIp(route.gateway)&&/^[a-zA-Z0-9_.-]{1,15}$/.test(route.interface)&&x.originalNetworks.some(n=>n.gateway===route.gateway),'explicit original default route required');
 const a=input.provisioningAudit;
 assertPolicy(exactKeys(a,['schema','tablesOnly','serverUuid','reviewedAt','noAnonymousAccounts','noFallbackAccounts','noRolesOrExtraGrants'])&&a.schema===DB_NAME&&a.serverUuid===x.serverUuid&&a.tablesOnly===true&&a.noAnonymousAccounts===true&&a.noFallbackAccounts===true&&a.noRolesOrExtraGrants===true&&typeof a.reviewedAt==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(a.reviewedAt)&&Number.isFinite(Date.parse(a.reviewedAt))&&new Date(a.reviewedAt).toISOString()===a.reviewedAt,'trusted provisioning audit is incomplete');
 return input;
}
export function loadInput(path){let value;try{value=JSON.parse(privateText(path));}catch{throw new Error('Shared SSH policy: private deployment input is not valid JSON');}return validateInput(value);}
export function loadSharedSettings(path){
 const settings={};
 for(const [i,line] of privateText(path).split(/\r?\n/).entries()){
  if(!line.trim()||line.trimStart().startsWith('#'))continue;
  const m=line.match(/^([A-Z][A-Z_0-9]*)=([^\r\n]*)$/);
  assertPolicy(m&&[...SECRET_NAMES,...OPTIONAL_NAMES,'AUTH_SECRET_BASE64'].includes(m[1])&&!Object.hasOwn(settings,m[1])&&!/[$`\\"'\x00-\x1f]/.test(m[2]),`invalid setting on line ${i+1}`);settings[m[1]]=m[2];
 }
 if(Object.hasOwn(settings,'AUTH_SECRET_BASE64')){
  assertPolicy(!Object.hasOwn(settings,'AUTH_SECRET'),'choose exactly one auth secret encoding');
  const encoded=settings.AUTH_SECRET_BASE64,bytes=Buffer.from(encoded,'base64'),decoded=bytes.toString('utf8');
  assertPolicy(bytes.toString('base64')===encoded&&Buffer.from(decoded).equals(bytes)&&!decoded.includes('\0'),'invalid original auth secret encoding');settings.AUTH_SECRET=decoded;delete settings.AUTH_SECRET_BASE64;
 }
 for(const key of SECRET_NAMES.filter(k=>k!=='AUTH_SECRET'))assertPolicy(/^[a-fA-F0-9]{64}$/.test(settings[key]??''),`${key} requires 64 hexadecimal characters`);
 assertPolicy((settings.AUTH_SECRET??'').length>=32,'original strong authentication secret required');
 assertPolicy(new Set(SECRET_NAMES.map(k=>settings[k])).size===SECRET_NAMES.length,'secrets must be independent');
 assertPolicy(!settings.AI_API_KEY||/^[A-Za-z0-9_./+=:@-]{1,512}$/.test(settings.AI_API_KEY),'unsupported model key format');
 if(settings.AI_BASE_URL){let u;try{u=new URL(settings.AI_BASE_URL);}catch{}assertPolicy(u?.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash,'model origin must be HTTPS without credentials or query');}
 for(const k of ['AI_MODEL','AI_PROVIDER_NAME'])assertPolicy(!settings[k]||/^[\p{L}\p{N} _./:-]{1,100}$/u.test(settings[k]),'invalid model label');
 assertPolicy(!settings.AI_DAILY_LIMIT||/^[1-9][0-9]{0,4}$/.test(settings.AI_DAILY_LIMIT)&&Number(settings.AI_DAILY_LIMIT)<=10000,'invalid model limit');return settings;
}
export function validateExternalMysql(c,input,{phase='attached',backendId}={}){
 validateInput(input);const x=input.externalMysql;
 assertPolicy(c?.Id===x.containerId&&c.Image===x.imageId,'external container or image changed');
 assertPolicy(c.State?.Running===true&&!c.State.Paused&&!c.State.Restarting&&c.State.Status==='running','external database must already be running');
 assertPolicy(!c.HostConfig?.Privileged&&!['host','none'].includes(c.HostConfig?.NetworkMode)&&Object.keys(c.HostConfig?.PortBindings??{}).length===0&&!Object.values(c.NetworkSettings?.Ports??{}).some(v=>v?.length),'external database must not expose host ports');
 assertPolicy(c.Config?.Labels?.['com.docker.compose.project']!==PROJECT&&c.Config?.Labels?.['io.star-oracle.deployment']!=='ssh-shared','external database must never carry owned labels');
 const actual=c.NetworkSettings?.Networks??{},hasBackend=Object.hasOwn(actual,BACKEND);
 assertPolicy(['prepare','attached'].includes(phase)&&exactKeys(actual,[...x.originalNetworks.map(n=>n.name),...(hasBackend?[BACKEND]:[])]),'external network inventory changed');
 if(phase==='attached')assertPolicy(hasBackend&&hex64(backendId),'approved backend attachment required');
 for(const n of x.originalNetworks){const p=actual[n.name];assertPolicy(p.NetworkID===n.id&&p.IPAddress===n.ipv4Address&&p.IPPrefixLen===n.prefixLength&&p.Gateway===n.gateway&&!p.GlobalIPv6Address&&JSON.stringify([...(p.Aliases??[])].sort())===JSON.stringify([...n.aliases].sort()),'original external network endpoint changed');}
 if(hasBackend){const p=actual[BACKEND];assertPolicy(hex64(backendId)&&p.NetworkID===backendId&&p.IPAddress==='172.30.78.4'&&p.IPPrefixLen===24&&!p.GlobalIPv6Address&&(p.Aliases??[]).includes(DB_HOST)&&(p.Aliases??[]).every(a=>[DB_HOST,c.Name?.slice(1),c.Id,c.Id.slice(0,12)].includes(a)),'external backend endpoint differs');}
 return c;
}
export function parseDefaultRoute(text){
 const rows=text.trim().split('\n').slice(1).map(r=>r.trim().split(/\s+/)).filter(r=>r[1]==='00000000'&&r[7]==='00000000'&&(parseInt(r[3],16)&1));
 assertPolicy(rows.length<=1,'ambiguous external default routes');if(!rows.length)return null;
 const r=rows[0];assertPolicy(/^[A-Fa-f0-9]{8}$/.test(r[2]),'invalid route observation');return {gateway:Buffer.from(r[2],'hex').reverse().join('.'),interface:r[0]};
}
export function validateExternalRoute(text,input){assertPolicy(JSON.stringify(parseDefaultRoute(text))===JSON.stringify(input.externalMysql.defaultRoute),'external default route changed');}
export function sharedDockerArgs(root){return ['--host','unix:///var/run/docker.sock','compose','--project-name',PROJECT,'--project-directory',root,'--env-file','/dev/null','-f',join(root,'compose.ssh-shared.yml')];}
export const serviceNetworks=name=>name==='api'?['ssh','backend']:name==='web'?['ssh']:['backend'];
export const SERVICE_USERS={api:'1000:1000',migrate:'1000:1000',web:'101:101',redis:'999:999'};
const commands={api:['node','apps/api/dist/maintenance/shared-entrypoint.js','app','serve'],migrate:['node','apps/api/dist/maintenance/shared-entrypoint.js','migrator','migrate'],web:['nginx','-c','/etc/nginx/ssh.conf','-g','daemon off;'],redis:['sh','-c','exec redis-server --appendonly yes --maxmemory 128mb --maxmemory-policy noeviction --requirepass "$REDIS_PASSWORD"']};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const networkOptions=o=>assertPolicy(exactKeys(o,Object.keys(NETWORK_OPTIONS))&&Object.entries(NETWORK_OPTIONS).every(([k,v])=>o[k]===v),'only fixed loopback/NAT options allowed');
function environment(list){const out={};for(const item of list??[]){const at=item.indexOf('=');assertPolicy(at>0&&!Object.hasOwn(out,item.slice(0,at)),'invalid or duplicate actual environment');out[item.slice(0,at)]=item.slice(at+1);}return out;}
// Compose renders literal dollars escaped even in JSON output. Decode that layer once.
export function parseSharedComposeConfig(text){
 return JSON.parse(text,(_key,value)=>typeof value==='string'?value.replaceAll('$$','$'):value);
}
export function validateSharedConfig(c,root,input){
 assertPolicy(c.name===PROJECT&&exactKeys(c.services,Object.keys(SERVICES))&&exactKeys(c.networks,['ssh','backend'])&&exactKeys(c.volumes,['redis-data']),'unexpected shared service/network/volume inventory');
 assertPolicy(c.volumes['redis-data'].name===`${PROJECT}-redis-data`&&!c.volumes['redis-data'].external&&!c.volumes['redis-data'].driver_opts&&(!c.volumes['redis-data'].driver||c.volumes['redis-data'].driver==='local'),'dedicated Redis volume required');
 for(const [key,w] of Object.entries(NETWORKS)){const n=c.networks[key];assertPolicy(n.name===w.name&&n.driver==='bridge'&&!n.external&&!n.enable_ipv6&&Boolean(n.internal)===w.internal&&(!n.ipam?.driver||n.ipam.driver==='default')&&n.ipam?.config?.length===1&&n.ipam.config[0].subnet===`${w.prefix}.0/24`&&n.ipam.config[0].gateway===`${w.prefix}.1`,'fixed owned IPv4 topology required');networkOptions(n.driver_opts);}
 for(const [name,w] of Object.entries(SERVICES)){
  const s=c.services[name];
  assertPolicy(s.image===w.image&&s.user===SERVICE_USERS[name]&&s.read_only===true&&same(s.cap_drop,['ALL'])&&same(s.tmpfs,['/tmp'])&&s.restart==='no'&&same(s.security_opt,['no-new-privileges:true'])&&s.labels?.['io.star-oracle.deployment']==='ssh-shared','service runtime/security settings differ');
  assertPolicy(Number(s.mem_limit)===w.memory&&Number(s.memswap_limit)===w.memory&&Number(s.cpus)===1&&Number(s.pids_limit)===256,'service resources changed');
  assertPolicy(s.logging?.driver==='json-file'&&s.logging.options?.['max-size']==='10m'&&s.logging.options?.['max-file']==='3','bounded private logs required');
  for(const key of ['build','entrypoint','network_mode','container_name','privileged','devices','device_cgroup_rules','cap_add','pid','ipc','userns_mode','uts','volumes_from','external_links','links','extra_hosts','dns','dns_search','profiles','develop','post_start','pre_stop','use_api_socket','depends_on'])assertPolicy(!s[key]||Array.isArray(s[key])&&s[key].length===0,`unsupported service field ${key}`);
  assertPolicy(exactKeys(s.networks,serviceNetworks(name))&&serviceNetworks(name).every(k=>s.networks[k].ipv4_address===`${NETWORKS[k].prefix}.${w.ip}`&&exactKeys(s.networks[k],['ipv4_address'])),'service peer address changed');
  assertPolicy(same(s.command,commands[name]),'service command changed');
  if(name==='migrate')assertPolicy(!s.healthcheck,'migration healthcheck override');else assertPolicy(s.healthcheck&&same(s.healthcheck.test,HEALTH_TESTS[name])&&s.healthcheck.interval==='5s'&&s.healthcheck.timeout==='5s'&&s.healthcheck.retries===(name==='api'?30:20)&&!s.healthcheck.disable,'service healthcheck changed');
  if(name==='web'){assertPolicy(s.ports?.length===1&&s.ports[0].host_ip==='127.0.0.1'&&String(s.ports[0].published)==='17777'&&Number(s.ports[0].target)===8080&&(s.ports[0].protocol??'tcp')==='tcp','web must publish only the fixed loopback port');assertPolicy(!s.environment||Object.keys(s.environment).length===0,'web environment overrides forbidden');}
  else assertPolicy(!s.ports||s.ports.length===0,'only web may publish a port');
  if(name==='redis'){assertPolicy(s.volumes?.length===1&&s.volumes[0].type==='volume'&&s.volumes[0].source==='redis-data'&&s.volumes[0].target==='/data'&&exactKeys(s.environment,['REDIS_PASSWORD'])&&/^[a-fA-F0-9]{64}$/.test(s.environment.REDIS_PASSWORD),'Redis storage/secret differs');}
  else assertPolicy(!s.volumes?.length,'application bind mounts forbidden');
  if(['api','migrate'].includes(name)){
   const env=s.environment??{},user=name==='api'?roleUsers.app:roleUsers.migrator;
   assertPolicy(new RegExp(`^mysql://${user}:[a-fA-F0-9]{64}@oracle-mysql:3306/staroracle\\?connection_limit=5$`).test(env.DATABASE_URL),'database target must be the dedicated schema and role');
   assertPolicy(uuid(env.SHARED_MYSQL_UUID)&&/^8\.4\.\d+$/.test(env.SHARED_MYSQL_VERSION)&&(!input||env.SHARED_MYSQL_UUID===input.externalMysql.serverUuid&&env.SHARED_MYSQL_VERSION===input.externalMysql.serverVersion),'shared SQL identity differs');
   if(name==='migrate')assertPolicy(exactKeys(env,['DATABASE_URL','SHARED_MYSQL_UUID','SHARED_MYSQL_VERSION']),'migration environment override');
   else{assertPolicy(Object.entries(FIXED_ENV).every(([k,v])=>env[k]===v),'application security environment changed');assertPolicy(/^redis:\/\/:[a-fA-F0-9]{64}@redis:6379$/.test(env.REDIS_URL)&&typeof env.AUTH_SECRET==='string'&&env.AUTH_SECRET.length>=32&&/^[a-fA-F0-9]{64}$/.test(env.DATA_ENCRYPTION_KEY),'application secret/cache configuration differs');assertPolicy(Object.keys(env).every(k=>[...Object.keys(FIXED_ENV),'DATABASE_URL','REDIS_URL','AUTH_SECRET','DATA_ENCRYPTION_KEY','SHARED_MYSQL_UUID','SHARED_MYSQL_VERSION',...OPTIONAL_NAMES].includes(k)),'application environment override');}
  }
 }
 return c;
}
export function validateSharedContainers(containers,config,manifest,images,{allowPartial=false}={}){
 assertPolicy(Array.isArray(containers)&&(allowPartial?containers.length<=4:containers.length===4),'exactly four owned containers required');const seen=new Set();
 for(const c of containers){
  const labels=c.Config?.Labels??{},name=labels['com.docker.compose.service'],w=SERVICES[name],s=config.services[name],image=images?.find(i=>i.Id===c.Image);
  assertPolicy(w&&!seen.has(name)&&labels['com.docker.compose.project']===PROJECT&&labels['io.star-oracle.deployment']==='ssh-shared','unknown or duplicate owned service');seen.add(name);
  assertPolicy(c.Name===`/${PROJECT}-${name}-1`,'actual container name differs');
  assertPolicy(c.Config.Image===w.image&&c.Image===manifest.images.find(i=>i.tag===w.image)?.id&&image,'runtime image differs from release');
  assertPolicy(c.Config.User===SERVICE_USERS[name]&&same(c.Config.Cmd,s.command)&&same(c.Config.Entrypoint??[],image.Config.Entrypoint??[]),'actual user/command/entrypoint changed');
  if(name==='migrate')assertPolicy(same(c.Config.Healthcheck??null,image.Config.Healthcheck??null),'actual migration healthcheck changed');
  else assertPolicy(same(c.Config.Healthcheck?.Test,HEALTH_TESTS[name])&&c.Config.Healthcheck.Interval===5e9&&c.Config.Healthcheck.Timeout===5e9&&c.Config.Healthcheck.Retries===(name==='api'?30:20),'actual healthcheck changed');
  const expectedEnv={...environment(image.Config.Env),...(s.environment??{})},actualEnv=environment(c.Config.Env);
  assertPolicy(exactKeys(actualEnv,Object.keys(expectedEnv))&&Object.entries(expectedEnv).every(([k,v])=>actualEnv[k]===String(v)),'actual environment differs');
  const h=c.HostConfig,n=c.NetworkSettings;
  assertPolicy(serviceNetworks(name).some(k=>h.NetworkMode===NETWORKS[k].name)&&!h.Privileged&&!h.PublishAllPorts&&!h.CapAdd?.length&&!h.Devices?.length&&!h.DeviceRequests?.length&&!h.PidMode&&(!h.IpcMode||h.IpcMode==='private')&&!h.UsernsMode&&!h.ExtraHosts?.length&&!h.Dns?.length&&!h.DnsSearch?.length&&!h.DnsOptions?.length&&!Object.keys(h.Sysctls??{}).length,'actual host isolation differs');
  assertPolicy(h.ReadonlyRootfs===true&&exactKeys(h.Tmpfs,['/tmp'])&&h.Tmpfs['/tmp']===''&&same(h.CapDrop,['ALL'])&&h.SecurityOpt?.length===1&&['no-new-privileges:true','no-new-privileges'].includes(h.SecurityOpt[0])&&h.RestartPolicy?.Name==='no','actual security settings changed');
  // Compose uses the legacy Binds API for ordinary named volumes too:
  // https://github.com/docker/compose/blob/v5.6.0/pkg/compose/create.go#L931-L1002
  // Accept only that exact Redis serialization; resolved Mounts and the
  // launcher's owned local-volume inspection remain independent requirements.
  assertPolicy(same(h.Binds??[],[])||name==='redis'&&same(h.Binds,[`${PROJECT}-redis-data:/data:rw`]),'actual volume binding differs');
  assertPolicy(h.Memory===w.memory&&h.MemorySwap===w.memory&&h.NanoCpus===1e9&&h.PidsLimit===256,'actual resources differ');
  assertPolicy(h.LogConfig?.Type==='json-file'&&h.LogConfig.Config?.['max-size']==='10m'&&h.LogConfig.Config?.['max-file']==='3','actual log rotation differs');
  const mounts=c.Mounts??[];
  assertPolicy(mounts.every(m=>m.Type==='tmpfs'&&m.Destination==='/tmp'||name==='redis'&&m.Type==='volume'&&m.Name===`${PROJECT}-redis-data`&&m.Destination==='/data'&&m.RW===true)&&mounts.filter(m=>m.Type!=='tmpfs').length===(name==='redis'?1:0),'unreviewed actual mount');
  const bindings=h.PortBindings??{};
  if(name==='web')assertPolicy(exactKeys(bindings,['8080/tcp'])&&bindings['8080/tcp'].length===1&&bindings['8080/tcp'][0].HostIp==='127.0.0.1'&&bindings['8080/tcp'][0].HostPort==='17777','actual web publication changed');
  else assertPolicy(Object.keys(bindings).length===0,'unpublished service has a port');
  for(const [port,list] of Object.entries(n.Ports??{}))if(list?.length)assertPolicy(name==='web'&&port==='8080/tcp'&&list.length===1&&list[0].HostIp==='127.0.0.1'&&list[0].HostPort==='17777','actual runtime publication changed');
  assertPolicy(exactKeys(n.Networks,serviceNetworks(name).map(k=>NETWORKS[k].name)),'actual service network inventory changed');
  for(const k of serviceNetworks(name)){const p=n.Networks[NETWORKS[k].name],ip=`${NETWORKS[k].prefix}.${w.ip}`;assertPolicy(p.IPAMConfig?.IPv4Address===ip&&!p.GlobalIPv6Address&&(c.State?.Running?p.IPAddress===ip:!p.IPAddress||p.IPAddress===ip),'actual service peer changed');assertPolicy((p.Aliases??[]).every(a=>[name,c.Name.slice(1),c.Id,c.Id.slice(0,12)].includes(a))&&(!c.State?.Running||(p.Aliases??[]).includes(name)),'actual service DNS aliases changed');}
 }
 return containers;
}
export function validateSharedNetworks(actual,owned,external,input,{allowPartial=false}={}){
 assertPolicy(Array.isArray(actual)&&(allowPartial?actual.length<=2:actual.length===2)&&new Set(actual.map(n=>n.Name)).size===actual.length&&actual.every(n=>Object.values(NETWORKS).some(w=>w.name===n.Name)),'exact owned network inventory required');
 for(const [key,w] of Object.entries(NETWORKS)){
  const n=actual.find(n=>n.Name===w.name);if(!n&&allowPartial)continue;assertPolicy(n?.Driver==='bridge'&&Boolean(n.Internal)===w.internal&&!n.EnableIPv6&&!n.Ingress&&n.Labels?.['com.docker.compose.project']===PROJECT&&n.IPAM?.Config?.length===1&&n.IPAM.Config[0].Subnet===`${w.prefix}.0/24`&&n.IPAM.Config[0].Gateway===`${w.prefix}.1`,'actual network differs');networkOptions(n.Options);
  for(const [id,e] of Object.entries(n.Containers??{})){
   if(id===input.externalMysql.containerId){assertPolicy(key==='backend'&&external?.Id===id&&e.IPv4Address==='172.30.78.4/24'&&!e.IPv6Address,'external endpoint on wrong network');continue;}
   const c=owned.find(c=>c.Id===id),service=c?.Config?.Labels?.['com.docker.compose.service'];
   assertPolicy(c&&serviceNetworks(service).includes(key)&&e.IPv4Address===`${w.prefix}.${SERVICES[service].ip}/24`&&!e.IPv6Address,'unrelated endpoint on owned network');
  }
 }
 return actual;
}

export const HEALTH_TESTS={"redis":["CMD-SHELL","REDISCLI_AUTH=$REDIS_PASSWORD redis-cli ping"],"api":["CMD","node","-e","const r=require('node:http').get('http://127.0.0.1:3001/api/v1/health',{headers:{Host:'localhost:17777'},agent:false,timeout:4000},s=>{s.on('error',()=>{process.exitCode=1});s.resume();if(s.statusCode!==200)process.exitCode=1});r.on('timeout',()=>{process.exitCode=1;r.destroy()});r.on('error',()=>{process.exitCode=1})"],"web":["CMD","wget","-q","-O","/dev/null","--header=Host: localhost:17777","http://127.0.0.1:8080/"]};
