#!/usr/bin/env node
/** Fail-closed launcher for the one supported SSH-only Docker topology. */
import {readFileSync, statSync, realpathSync, openSync, readSync, closeSync, readdirSync, existsSync, mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {resolve, join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';

export const PROJECT = 'star-oracle-ssh';
export const NETWORK = 'star-oracle-ssh-private';
export const BACKEND = 'star-oracle-ssh-backend';
const networks={ssh:{name:NETWORK,prefix:'172.30.77',internal:false},backend:{name:BACKEND,prefix:'172.30.78',internal:true}};
const serviceNetworks=name=>name==='api'?['ssh','backend']:name==='web'?['ssh']:['backend'];
export const IMAGES = ['star-oracle-api:local','star-oracle-web:local','mysql:8.4','redis:7.4'];
const policy = (ok, detail) => {if (!ok) throw new Error(`SSH policy: ${detail}`);};
const equalKeys = (actual,expected) => JSON.stringify(Object.keys(actual??{}).sort())===JSON.stringify([...expected].sort());
const services = {api:{ip:2,image:IMAGES[0],memory:512*1024**2},web:{ip:3,image:IMAGES[1],memory:128*1024**2},mysql:{ip:4,image:IMAGES[2],memory:768*1024**2},redis:{ip:5,image:IMAGES[3],memory:192*1024**2},migrate:{ip:6,image:IMAGES[0],memory:512*1024**2}};
const fixedEnvironment = {NODE_ENV:'production',DEPLOYMENT_MODE:'ssh-only',SSH_ONLY_CONTAINER:'true',WEB_ORIGIN:'http://localhost:17777',API_PUBLIC_URL:'http://localhost:17777',TRUST_PROXY:'false',ADMIN_REQUIRE_2FA:'true',PORT:'3001'};
const networkOptions = {'com.docker.network.bridge.host_binding_ipv4':'127.0.0.1','com.docker.network.bridge.gateway_mode_ipv4':'nat'};
const secretNames = ['MYSQL_ROOT_PASSWORD','MYSQL_PASSWORD','MYSQL_MIGRATION_PASSWORD','REDIS_PASSWORD','AUTH_SECRET','DATA_ENCRYPTION_KEY'];
const optionalNames = ['AI_API_KEY','AI_BASE_URL','AI_PROVIDER_NAME','AI_MODEL','AI_DAILY_LIMIT'];
export function dockerEnvironment(ambient=process.env) {
  // Deliberately omit COMPOSE_*, DOCKER_*, application config, NODE_OPTIONS and
  // inherited env-file interpolation. The caller adds only parsed settings.
  return Object.fromEntries(['PATH','HOME'].filter(k=>ambient[k]!==undefined).map(k=>[k,ambient[k]]));
}
export function dockerArguments(root) {
  return ['--host','unix:///var/run/docker.sock','compose','--project-name',PROJECT,'--project-directory',root,'--env-file','/dev/null','-f',join(root,'compose.ssh.yml')];
}
export function validateEngine(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version.trim()) || Number(version.split('.')[0])<28) throw new Error('Docker Engine 28.0.0 or newer stable is required for loopback-publishing isolation.');
}
function daemonConfigLocation(argv) {
  const paths=[];
  for(let index=0;index<argv.length;index++){
    const argument=argv[index];
    if(argument==='--config-file'){const path=argv[++index];policy(typeof path==='string'&&path.startsWith('/'),'Docker config-file must have one explicit absolute path');paths.push(path);}
    else if(argument.startsWith('--config-file=')){const path=argument.slice('--config-file='.length);policy(path.startsWith('/'),'Docker config-file must have one explicit absolute path');paths.push(path);}
  }
  policy(paths.length<=1,'repeated Docker config-file flags are ambiguous');
  return {path:paths[0]??'/etc/docker/daemon.json',explicit:paths.length===1};
}
export function validateDaemonConfig(config,argv) {
  daemonConfigLocation(argv);
  policy((!Object.hasOwn(config,'allow-direct-routing')||config['allow-direct-routing']===false)&&['iptables','ip6tables'].every(key=>!Object.hasOwn(config,key)||config[key]===true),'Docker daemon direct routing or disabled firewall is unsupported');
  // Go accepts aliases such as 1/0, True/False and t/f. Permit only the safe
  // canonical explicit values instead of trying to enumerate unsafe aliases.
  const safeFlags={'--allow-direct-routing':'false','--iptables':'true','--ip6tables':'true'};
  for(const argument of argv)for(const [name,value] of Object.entries(safeFlags))if(argument===name||argument.startsWith(name+'='))policy(argument===name+'='+value,'unsafe or noncanonical Docker daemon routing/firewall flag');
}
export function inspectLocalDaemon() {
  policy(process.platform==='linux','the SSH bundle requires the local Linux Docker Engine');
  const daemons=[];
  for(const pid of readdirSync('/proc').filter(name=>/^\d+$/.test(name))){
    try {const argv=readFileSync(`/proc/${pid}/cmdline`,'utf8').split('\0').filter(Boolean);if(/(?:^|\/)dockerd$/.test(argv[0]??''))daemons.push(argv);}catch{}
  }
  policy(daemons.length===1,'cannot verify one local dockerd process; remote/rootless/Desktop engines are unsupported');
  const argv=daemons[0],location=daemonConfigLocation(argv);
  policy(!location.explicit||existsSync(location.path),'explicit Docker daemon config is unavailable');
  const config=existsSync(location.path)?JSON.parse(readFileSync(location.path,'utf8')):{};
  validateDaemonConfig(config,argv);
}
export function loadSettings(path) {
  const file=statSync(path);
  if (!file.isFile() || (file.mode & 0o077)!==0 || file.uid!==process.getuid()) throw new Error('SSH settings must be a private regular file owned by the current user (chmod 600).');
  const settings={};
  for (const [index,line] of readFileSync(path,'utf8').split(/\r?\n/).entries()) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const match=line.match(/^([A-Z][A-Z_0-9]*)=([^\r\n]*)$/);
    if (!match || ![...secretNames,...optionalNames,'AUTH_SECRET_BASE64'].includes(match[1]) || Object.hasOwn(settings,match[1]) || /[$`\\"'\x00-\x1f]/.test(match[2])) throw new Error(`SSH settings: invalid or duplicate setting on line ${index+1}; shell expressions and overrides are forbidden.`);
    settings[match[1]]=match[2];
  }
  if(Object.hasOwn(settings,'AUTH_SECRET_BASE64')){
    if(Object.hasOwn(settings,'AUTH_SECRET'))throw new Error('SSH settings: choose AUTH_SECRET or AUTH_SECRET_BASE64, never both.');
    const encoded=settings.AUTH_SECRET_BASE64,bytes=Buffer.from(encoded,'base64'),decoded=bytes.toString('utf8');
    if(bytes.toString('base64')!==encoded||!Buffer.from(decoded,'utf8').equals(bytes)||decoded.includes('\0'))throw new Error('SSH settings: AUTH_SECRET_BASE64 must be canonical base64 of the original UTF-8 secret.');
    settings.AUTH_SECRET=decoded;delete settings.AUTH_SECRET_BASE64;
  }
  for (const name of secretNames.filter(k=>k!=='AUTH_SECRET')) if (!/^[a-fA-F0-9]{64}$/.test(settings[name]??'')) throw new Error(`SSH settings: ${name} needs 64 random hexadecimal characters.`);
  if((settings.AUTH_SECRET??'').length<32)throw new Error('SSH settings: preserve a strong AUTH_SECRET of at least 32 characters.');
  if (new Set(secretNames.map(k=>settings[k])).size!==secretNames.length) throw new Error('SSH settings: use independent secrets for database, cache, authentication and encryption.');
  if (settings.AI_API_KEY && !/^[A-Za-z0-9_./+=:@-]{1,512}$/.test(settings.AI_API_KEY)) throw new Error('SSH settings: unsupported AI_API_KEY characters.');
  if (settings.AI_BASE_URL) {
    let url;try {url=new URL(settings.AI_BASE_URL);} catch {throw new Error('SSH settings: AI_BASE_URL must be HTTPS.');}
    if(url.protocol!=='https:' || url.username || url.password || url.hash || url.search) throw new Error('SSH settings: AI_BASE_URL must be HTTPS without embedded credentials, query or fragment.');
  }
  for(const name of ['AI_MODEL','AI_PROVIDER_NAME'])if(settings[name]&&!/^[\p{L}\p{N} _./:-]{1,100}$/u.test(settings[name]))throw new Error(`SSH settings: invalid ${name}.`);
  if(settings.AI_DAILY_LIMIT&&(!/^[1-9][0-9]{0,4}$/.test(settings.AI_DAILY_LIMIT)||Number(settings.AI_DAILY_LIMIT)>10000))throw new Error('SSH settings: invalid AI_DAILY_LIMIT.');
  return settings;
}
function validateOptions(options) {
  policy(equalKeys(options,Object.keys(networkOptions)) && Object.entries(networkOptions).every(([k,v])=>options[k]===v),'bridge must use only approved loopback/NAT options; routed, direct-routing and trusted interfaces are forbidden');
}
function validateApiEnvironment(env) {
  for(const [key,value] of Object.entries(fixedEnvironment))policy(String(env?.[key])===value,`API ${key} must be fixed`);
  policy(/^mysql:\/\/oracle:[a-fA-F0-9]{64}@mysql:3306\/star_oracle$/.test(env.DATABASE_URL),'application database must be the dedicated least-privilege database');
  policy(/^redis:\/\/:[a-fA-F0-9]{64}@redis:6379$/.test(env.REDIS_URL),'cache must be the dedicated authenticated Redis');
  policy(Object.keys(env).every(k=>[...Object.keys(fixedEnvironment),'DATABASE_URL','REDIS_URL','AUTH_SECRET','DATA_ENCRYPTION_KEY',...optionalNames].includes(k)),'unexpected API environment override');
}
export function validateConfig(config,root) {
  policy(config.name===PROJECT,'wrong project');
  policy(equalKeys(config.services,Object.keys(services)),'unexpected or missing service');
  policy(equalKeys(config.networks,Object.keys(networks)),'only the dedicated edge and backend networks are permitted');
  for(const [key,expected] of Object.entries(networks)){
    const net=config.networks[key];
    policy(net.name===expected.name&&net.driver==='bridge'&&!net.external&&!net.enable_ipv6&&Boolean(net.internal)===expected.internal,'dedicated IPv4 networks required');
    policy(net.ipam?.config?.length===1&&net.ipam.config[0].subnet===`${expected.prefix}.0/24`&&net.ipam.config[0].gateway===`${expected.prefix}.1`,'fixed subnet and gateway required');
    policy(!net.ipam.driver||net.ipam.driver==='default','unexpected IPAM driver');
    validateOptions(net.driver_opts);
  }
  policy(equalKeys(config.volumes,['mysql-data','redis-data']),'unexpected persistent volume');
  for(const name of ['mysql','redis'])policy(config.volumes[`${name}-data`].name===`${PROJECT}-${name}-data`&&!config.volumes[`${name}-data`].external&&!config.volumes[`${name}-data`].driver_opts,'dedicated Docker volumes required');
  for(const [name,expected] of Object.entries(services)) {
    const s=config.services[name];
    policy(s.image===expected.image,`${name} image is not the verified release image`);
    for(const forbidden of ['build','network_mode','container_name','entrypoint','privileged','devices','device_cgroup_rules','cap_add','pid','ipc','userns_mode','uts','volumes_from','external_links','links','extra_hosts','dns','dns_search','profiles','develop','post_start','pre_stop','use_api_socket'])policy(!s[forbidden] || Array.isArray(s[forbidden])&&s[forbidden].length===0,`${name} has unsafe ${forbidden}`);
    policy(equalKeys(s.networks,serviceNetworks(name))&&serviceNetworks(name).every(key=>s.networks[key].ipv4_address===`${networks[key].prefix}.${expected.ip}`),`${name} must use exactly its fixed peer addresses and network isolation`);
    policy(Number(s.mem_limit)===expected.memory&&Number(s.cpus)===1&&Number(s.pids_limit)===256,`${name} resource limits changed`);
    policy(s.restart==='no',`${name} must be started through the checked launcher after reboot`);
    policy(s.security_opt?.length===1&&s.security_opt[0]==='no-new-privileges:true',`${name} security options changed`);
    policy(s.labels?.['io.star-oracle.deployment']==='ssh-only',`${name} ownership label missing`);
    policy(s.logging?.driver==='json-file'&&s.logging.options?.['max-size']==='10m'&&s.logging.options?.['max-file']==='3',`${name} logging must be bounded`);
    if(['api','web','migrate'].includes(name))policy(s.read_only===true&&s.cap_drop?.length===1&&s.cap_drop[0]==='ALL'&&s.tmpfs?.length===1&&s.tmpfs[0]==='/tmp'&&!(s.volumes?.length),`${name} must have a read-only root, no capabilities and only temporary scratch space`);
    if(name==='web'){
      const p=s.ports;policy(p?.length===1&&p[0].host_ip==='127.0.0.1'&&String(p[0].published)==='17777'&&Number(p[0].target)===8080&&(p[0].protocol??'tcp')==='tcp', 'web must publish only 127.0.0.1:17777:8080');
      policy(JSON.stringify(s.command)===JSON.stringify(['nginx','-c','/etc/nginx/ssh.conf','-g','daemon off;']),'web must use the SSH-only nginx configuration');
      policy(!s.environment||Object.keys(s.environment).length===0,'web cannot receive entrypoint/config overrides');
    }else policy(!s.ports||s.ports.length===0,`${name} must not publish a host port`);
    if(name==='api'){validateApiEnvironment(s.environment);policy(!s.command,'API must use its verified image command');}
    if(name==='migrate'){
      policy(equalKeys(s.environment,['DATABASE_URL'])&&/^mysql:\/\/oracle_migrator:[a-fA-F0-9]{64}@mysql:3306\/star_oracle$/.test(s.environment.DATABASE_URL),'migration credentials must target only the dedicated database');
      policy(JSON.stringify(s.command)===JSON.stringify(['npm','run','db:migrate','-w','@star-oracle/api']),'unexpected migration command');
    }
    if(name==='mysql'){
      policy(s.environment.MYSQL_DATABASE==='star_oracle'&&s.environment.MYSQL_USER==='oracle','dedicated database/user required');
      policy(s.volumes?.length===2&&s.volumes[0].type==='volume'&&s.volumes[0].source==='mysql-data'&&s.volumes[0].target==='/var/lib/mysql'&&s.volumes[1].type==='bind'&&s.volumes[1].source===join(root,'infra/mysql-init.sh')&&s.volumes[1].target==='/docker-entrypoint-initdb.d/10-privileges.sh'&&s.volumes[1].read_only===true,'only the reviewed database initialization script may be mounted');
    }
    if(name==='redis')policy(s.volumes?.length===1&&s.volumes[0].type==='volume'&&s.volumes[0].source==='redis-data'&&s.volumes[0].target==='/data','dedicated Redis data volume required');
  }
  return config;
}
export function validateNetwork(n,containers=[]) {
  const expected=Object.values(networks).find(net=>net.name===n.Name);
  policy(expected&&n.Driver==='bridge'&&Boolean(n.Internal)===expected.internal&&!n.EnableIPv6&&!n.Ingress,'unexpected actual Docker network');
  policy(n.Labels?.['com.docker.compose.project']===PROJECT,'network is not owned by the SSH project');
  policy(n.IPAM?.Config?.length===1&&n.IPAM.Config[0].Subnet===`${expected.prefix}.0/24`&&n.IPAM.Config[0].Gateway===`${expected.prefix}.1`,'actual subnet/gateway differs');
  validateOptions(n.Options);
  for(const [id,endpoint] of Object.entries(n.Containers??{})){
    const container=containers.find(c=>c.Id===id),service=container?.Config?.Labels?.['com.docker.compose.service'];
    policy(container&&serviceNetworks(service).some(key=>networks[key].name===n.Name), 'unrelated endpoint attached to the dedicated network');
    policy(endpoint.IPv4Address===`${expected.prefix}.${services[service].ip}/24`&&!endpoint.IPv6Address,'unexpected network endpoint address');
  }
}

function envObject(list) {
  const env={};for(const entry of list??[]){const at=entry.indexOf('=');const k=entry.slice(0,at);policy(at>0&&!Object.hasOwn(env,k),'duplicate or invalid container environment');env[k]=entry.slice(at+1);}return env;
}
export function validateContainers(containers,config,manifest=null,requireStarted=false) {
  policy(containers.length===5,'expected exactly five project containers');
  const seen=new Set();
  for(const c of containers){
    const labels=c.Config?.Labels??{},name=labels['com.docker.compose.service'],expected=services[name],s=config.services[name],h=c.HostConfig,n=c.NetworkSettings;
    policy(expected&&!seen.has(name)&&labels['com.docker.compose.project']===PROJECT&&labels['io.star-oracle.deployment']==='ssh-only','unexpected/duplicate container ownership');seen.add(name);
    policy(c.Config.Image===expected.image,`${name} actual image tag differs`);
    if(manifest)policy(c.Image===manifest.images.find(i=>i.tag===expected.image)?.id,`${name} actual image ID differs from verified release`);
    policy(serviceNetworks(name).some(key=>h.NetworkMode===networks[key].name)&&!h.Privileged&&!h.PublishAllPorts&&!(h.CapAdd?.length)&&!(h.Devices?.length)&&!(h.DeviceRequests?.length)&&!h.PidMode&&(!h.IpcMode||h.IpcMode==='private')&&!h.UsernsMode,`${name} actual host/security settings are unsafe`);
    policy(h.SecurityOpt?.length===1&&['no-new-privileges:true','no-new-privileges'].includes(h.SecurityOpt[0]),`${name} actual security options differ`);
    policy(h.Memory===expected.memory&&h.NanoCpus===1e9&&h.PidsLimit===256,`${name} actual resources are unbounded`);
    policy(h.RestartPolicy?.Name==='no',`${name} can bypass checked restart`);
    if(['api','web','migrate'].includes(name))policy(h.ReadonlyRootfs===true&&h.CapDrop?.length===1&&h.CapDrop[0]==='ALL'&&!(h.Binds?.length),`${name} actual root/capabilities/mounts differ`);
    const mounts=c.Mounts??[];
    if(['api','web','migrate'].includes(name))policy(mounts.every(m=>m.Type==='tmpfs'&&m.Destination==='/tmp'),`${name} has an unreviewed actual mount`);
    if(name==='mysql'||name==='redis'){
      const wanted=s.volumes;
      policy(mounts.length===wanted.length&&wanted.every(v=>mounts.some(m=>m.Destination===v.target&&(v.type==='volume'?m.Type==='volume'&&m.Name===`${PROJECT}-${v.source}`:m.Type==='bind'&&m.Source===v.source&&m.RW===false))),`${name} actual persistent mounts differ`);
    }
    const bindings=h.PortBindings??{};
    if(name==='web')policy(equalKeys(bindings,['8080/tcp'])&&bindings['8080/tcp'].length===1&&bindings['8080/tcp'][0].HostIp==='127.0.0.1'&&bindings['8080/tcp'][0].HostPort==='17777','actual web port is not loopback-only');
    else policy(Object.keys(bindings).length===0,`${name} has an actual host port binding`);
    for(const [port,list] of Object.entries(n.Ports??{}))if(list?.length)policy(name==='web'&&port==='8080/tcp'&&list.length===1&&list[0].HostIp==='127.0.0.1'&&list[0].HostPort==='17777','actual runtime port is not loopback-only');
    policy(equalKeys(n.Networks,serviceNetworks(name).map(key=>networks[key].name)),`${name} is attached to an unexpected network`);
    for(const key of serviceNetworks(name)){
      const peer=n.Networks[networks[key].name],ip=`${networks[key].prefix}.${expected.ip}`;
      policy(peer.IPAMConfig?.IPv4Address===ip&&((requireStarted&&name!=='migrate'||c.State?.Running)?peer.IPAddress===ip:!peer.IPAddress||peer.IPAddress===ip)&&!peer.GlobalIPv6Address,`${name} actual peer address differs`);
    }
    if(requireStarted)policy(name==='migrate'?c.State?.Status==='exited'&&c.State.ExitCode===0:c.State?.Running===true&&c.State.Health?.Status==='healthy',`${name} did not reach its expected healthy/completed state`);
    const actualEnv=envObject(c.Config.Env);
    for(const [key,value] of Object.entries(s.environment??{}))policy(actualEnv[key]===String(value),`${name} actual environment differs`);
    if(name==='api')validateApiEnvironment(Object.fromEntries(Object.keys(s.environment).map(k=>[k,actualEnv[k]])));
  }
}
export function commandRunner(settings={}) {
  return (args)=>{
    const result=spawnSync('docker',args,{env:{...dockerEnvironment(),...settings},encoding:'utf8',maxBuffer:32*1024**2,timeout:360000});
    // Compose and Docker errors can contain interpolated secrets. Never echo
    // their raw output; operators can inspect sanitized application diagnostics.
    if(result.status!==0){
      const verb=args.find(arg=>['config','create','start','stop','inspect','version','ps','exec','run','logs','save','load','info','ls'].includes(arg))??'operation';
      throw new Error(`Docker ${args.includes('compose')?'Compose ':''}${verb} failed (${result.error?.code??result.status??'unknown'}); raw output withheld to protect credentials.`);
    }
    return result.stdout.trim();
  };
}
const baseDocker=['--host','unix:///var/run/docker.sock'];
function ownedContainers(run){const ids=run([...baseDocker,'ps','-aq','--filter',`label=com.docker.compose.project=${PROJECT}`]).split(/\s+/).filter(Boolean);return ids.length?JSON.parse(run([...baseDocker,'inspect',...ids])):[];}
function stopOwned(run,containers){const ids=containers.filter(c=>c.Config?.Labels?.['com.docker.compose.project']===PROJECT&&c.Config?.Labels?.['io.star-oracle.deployment']==='ssh-only').map(c=>c.Id);if(ids.length)run([...baseDocker,'stop','--time','20',...ids]);}
function safeContainerState(container){
  const service=container.Config.Labels['com.docker.compose.service'];
  const status=['created','running','paused','restarting','removing','exited','dead'].includes(container.State?.Status)?container.State.Status:'unknown';
  const health=['starting','healthy','unhealthy'].includes(container.State?.Health?.Status)?container.State.Health.Status:'none';
  const code=Number.isInteger(container.State?.ExitCode)?container.State.ExitCode:'unknown';
  return `${service}: status=${status}, health=${health}, exit=${code}`;
}
export function waitForReady({run,config,manifest=null,serviceNames=Object.keys(services),timeoutMs=240000,now=Date.now,pause=ms=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms)}){
  const deadline=now()+timeoutMs;
  while(true){
    const current=ownedContainers(run);
    validateContainers(current,config,manifest);
    for(const network of [NETWORK,BACKEND])validateNetwork(JSON.parse(run([...baseDocker,'network','inspect',network]))[0],current);
    const selected=current.filter(c=>serviceNames.includes(c.Config.Labels['com.docker.compose.service']));
    for(const container of selected){
      const name=container.Config.Labels['com.docker.compose.service'],state=container.State;
      policy(!state?.OOMKilled&&state?.Health?.Status!=='unhealthy'&&!['dead','removing','restarting'].includes(state?.Status)&&!(state?.Status==='exited'&&(name!=='migrate'||state.ExitCode!==0)),`unhealthy startup (${safeContainerState(container)})`);
    }
    const ready=selected.every(c=>c.Config.Labels['com.docker.compose.service']==='migrate'?c.State?.Status==='exited'&&c.State.ExitCode===0:c.State?.Running===true&&c.State.Health?.Status==='healthy');
    if(ready)return current;
    policy(now()<deadline,`startup timed out (${selected.map(safeContainerState).join('; ')})`);
    pause(Math.min(1000,Math.max(1,deadline-now())));
  }
}
export function runDeployment({action,root,settings,run=commandRunner(settings),manifest=null}) {
  policy(['check','start','stop','maintenance'].includes(action),'unsupported launcher action');
  if(action==='stop'){stopOwned(run,ownedContainers(run));return;}
  validateEngine(run([...baseDocker,'version','--format','{{.Server.Version}}']));
  const compose=dockerArguments(root);
  const config=validateConfig(JSON.parse(run([...compose,'config','--format','json'])),root);
  let current=ownedContainers(run);
  try {
    if(current.length){validateContainers(current,config,manifest);for(const network of [NETWORK,BACKEND])validateNetwork(JSON.parse(run([...baseDocker,'network','inspect',network]))[0],current);}
    if(action==='start'||action==='maintenance'){
      if(action==='maintenance')stopIngress(run,current);
      if(action==='start'&&current.length&&current.filter(c=>c.State?.Running).length===4){validateContainers(current,config,manifest,true);return;}
      if(action==='start'&&current.some(c=>c.State?.Running&&['api','web','migrate'].includes(c.Config.Labels['com.docker.compose.service'])))stopIngress(run,current);
      run([...compose,'create','--no-build','--pull','never']);
      current=ownedContainers(run);
      validateContainers(current,config,manifest);
      for(const network of [NETWORK,BACKEND])validateNetwork(JSON.parse(run([...baseDocker,'network','inspect',network]))[0],current);
      if(action==='maintenance'){
        run([...compose,'start','mysql','redis']);
        current=waitForReady({run,config,manifest,serviceNames:['mysql','redis']});
        const migration=current.find(c=>c.Config.Labels['com.docker.compose.service']==='migrate');
        run([...baseDocker,'start','--attach',migration.Id]);
        current=ownedContainers(run);validateContainers(current,config,manifest);
        const completed=current.find(c=>c.Config.Labels['com.docker.compose.service']==='migrate');
        policy(completed.State?.Status==='exited'&&completed.State.ExitCode===0,'offline migration did not complete');
        for(const network of [NETWORK,BACKEND])validateNetwork(JSON.parse(run([...baseDocker,'network','inspect',network]))[0],current);
        for(const c of current){const service=c.Config.Labels['com.docker.compose.service'];policy(['mysql','redis'].includes(service)?c.State?.Running&&c.State.Health?.Status==='healthy':!c.State?.Running,'maintenance requires healthy private dependencies and every API/web/migration stopped');}
        return {config,containers:current};
      }
      // Compose 2.38 has no `start --wait` CLI flags. Start only the already
      // inspected containers, then perform our own bounded health inspection.
      run([...compose,'start']);
      current=waitForReady({run,config,manifest});
      validateContainers(current,config,manifest,true);
      for(const network of [NETWORK,BACKEND])validateNetwork(JSON.parse(run([...baseDocker,'network','inspect',network]))[0],current);
    }
  }catch(error){
    // Only labeled containers in this one fixed project may be stopped. Never
    // run down, delete volumes, prune resources, or acquire another project.
    try{stopOwned(run,ownedContainers(run));}catch{throw new Error(`${error.message} Automatic stop failed; stop the star-oracle-ssh containers before proceeding.`);}
    throw error;
  }
}
const maintenanceOperations=['create','assign-username','reset-password','revoke-all-sessions'];
function stopIngress(run,containers){const ids=containers.filter(c=>['api','web','migrate'].includes(c.Config?.Labels?.['com.docker.compose.service'])).map(c=>c.Id);if(ids.length)run([...baseDocker,'stop','--time','20',...ids]);}
export function maintenanceArguments(operation,envFile,image) {
  policy(maintenanceOperations.includes(operation),'unsupported account maintenance operation');
  return [...baseDocker,'run','--rm','--pull','never','--interactive','--tty','--network',BACKEND,'--ip','172.30.78.7','--read-only','--tmpfs','/tmp','--cap-drop','ALL','--security-opt','no-new-privileges:true','--memory','512m','--cpus','1','--pids-limit','256','--env-file',envFile,'--env','AUTH_SECRET',image,'node','apps/api/dist/maintenance/account-cli.js',operation];
}
function interactiveRunner(args,authSecret) {
  const result=spawnSync('docker',args,{env:{...dockerEnvironment(),AUTH_SECRET:authSecret},stdio:'inherit'});
  if(result.status!==0)throw new Error('Account maintenance did not complete. API/web remain stopped; resolve the problem and retry the same operation.');
}
function executeMaintenance(prepared,manifest,operation) {
  const directory=mkdtempSync(join(tmpdir(),'star-oracle-ssh-maintenance-')),envFile=join(directory,'env');
  try{
    writeFileSync(envFile,Object.entries(prepared.config.services.api.environment).filter(([k])=>k!=='AUTH_SECRET').map(([k,v])=>`${k}=${v}`).join('\n')+'\n',{mode:0o600});
    interactiveRunner(maintenanceArguments(operation,envFile,manifest.images.find(i=>i.tag===IMAGES[0]).id),prepared.config.services.api.environment.AUTH_SECRET);
  }finally{rmSync(directory,{recursive:true,force:true});}
}
export function fileSha256(path) {
  const fd=openSync(path,'r'),hash=createHash('sha256'),buffer=Buffer.allocUnsafe(1024*1024);
  try{let length;while((length=readSync(fd,buffer,0,buffer.length,null))>0)hash.update(buffer.subarray(0,length));return hash.digest('hex');}finally{closeSync(fd);}
}
export function readManifest(root) {
  const manifest=JSON.parse(readFileSync(join(root,'ssh-manifest.json'),'utf8'));
  policy(manifest.format===1&&/^[a-f0-9]{40}$/.test(manifest.commit)&&/^linux\/(amd64|arm64)$/.test(manifest.platform),'invalid release manifest');
  policy(manifest.images?.length===IMAGES.length&&new Set(manifest.images.map(i=>i.tag)).size===IMAGES.length&&manifest.images.every(i=>IMAGES.includes(i.tag)&&/^sha256:[a-f0-9]{64}$/.test(i.id)&&i.platform===manifest.platform),'invalid release image manifest');
  const proof=manifest.verification;
  policy(/^[a-f0-9]{40}$/.test(manifest.sourceTree??'')&&proof?.format===1&&proof.status==='passed'&&proof.commit===manifest.commit&&proof.sourceTree===manifest.sourceTree,'missing or mismatched successful source verification');
  policy(proof.images?.length===manifest.images.length&&new Set(proof.images.map(i=>i.tag)).size===manifest.images.length&&proof.images.every(i=>manifest.images.some(j=>i.tag===j.tag&&i.id===j.id&&i.platform===j.platform)),'verification does not cover the exact release images');

  for(const [file,digest] of Object.entries(manifest.files??{})){
    policy(!file.startsWith('/')&&!file.split('/').includes('..')&&/^[a-f0-9]{64}$/.test(digest),'invalid manifest file');
    policy(fileSha256(join(root,file))===digest,`release file checksum differs: ${file}`);
  }
  for(const file of ['compose.ssh.yml','infra/mysql-init.sh','scripts/ssh-deploy.mjs','scripts/ssh-release.mjs','scripts/backup.sh','scripts/ssh-dump.mjs','images.tar.gz'])policy(Object.hasOwn(manifest.files??{},file),`manifest must cover ${file}`);
  return manifest;
}
function main(){
  const [action,...args]=process.argv.slice(2);
  if(!['check','start','stop','maintenance'].includes(action)||args[0]!=='--env-file'||(action==='maintenance'?(args.length!==4||args[2]!=='--operation'||!maintenanceOperations.includes(args[3])):args.length!==2))throw new Error('Usage: node scripts/ssh-deploy.mjs check|start|stop --env-file /absolute/path/.env.ssh; or maintenance --env-file /absolute/path/.env.ssh --operation create|assign-username|reset-password|revoke-all-sessions');
  if(action==='maintenance'&&(!process.stdin.isTTY||!process.stdout.isTTY))throw new Error('Account maintenance requires a real interactive terminal.');
  if(!args[1].startsWith('/'))throw new Error('Use an absolute private env-file path.');
  const root=realpathSync(resolve(import.meta.dirname,'..'));
  if(action==='stop'){runDeployment({action,root,settings:{}});console.log('SSH-only project stopped; persistent data retained.');return;}
  const settings=loadSettings(realpathSync(args[1])),run=commandRunner(settings);
  inspectLocalDaemon();
  const manifest=readManifest(root);
  const loaded=JSON.parse(run([...baseDocker,'image','inspect',...IMAGES]));
  for(const image of manifest.images)policy(loaded.some(i=>i.Id===image.id&&`${i.Os}/${i.Architecture}`===image.platform),'load the verified release images before running the launcher');
  const prepared=runDeployment({action,root,settings,run,manifest});
  if(action==='maintenance'){executeMaintenance(prepared,manifest,args[3]);console.log('Account maintenance completed. API/web remain stopped; use the checked start command when ready.');return;}
  console.log(action==='start'?'SSH-only containers healthy at http://localhost:17777. Connect through the documented SSH tunnel.':action==='stop'?'SSH-only project stopped; persistent data retained.':'SSH-only configuration and any existing containers passed inspection.');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){try{main();}catch(error){console.error(error.message);process.exitCode=1;}}
