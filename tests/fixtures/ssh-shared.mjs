export const sha = char => char.repeat(64);
export function sharedInput(){
 const serverUuid='11223344-1122-3344-5566-112233445566';
 return {format:1,externalMysql:{containerId:sha('d'),imageId:`sha256:${sha('e')}`,serverUuid,serverVersion:'8.4.11',defaultRoute:{gateway:'172.28.91.1',interface:'eth0'},originalNetworks:[{name:'synthetic-existing-mysql',id:sha('f'),ipv4Address:'172.28.91.4',prefixLength:24,gateway:'172.28.91.1',aliases:['synthetic-mysql']}]},provisioningAudit:{schema:'staroracle',tablesOnly:true,serverUuid,reviewedAt:'2026-10-09T00:00:00.000Z',noAnonymousAccounts:true,noFallbackAccounts:true,noRolesOrExtraGrants:true}};
}
export function sharedExternal(input=sharedInput(),attached=true){
 const x=input.externalMysql;
 const Networks=Object.fromEntries(x.originalNetworks.map(n=>[n.name,{NetworkID:n.id,IPAddress:n.ipv4Address,IPPrefixLen:n.prefixLength,Gateway:n.gateway,Aliases:n.aliases,GlobalIPv6Address:''}]));
 if(attached)Networks['star-oracle-shared-backend']={NetworkID:sha('b'),IPAddress:'172.30.78.4',IPPrefixLen:24,Gateway:'172.30.78.1',Aliases:['oracle-mysql'],GlobalIPv6Address:''};
 return {Id:x.containerId,Image:x.imageId,Config:{Labels:{}},State:{Running:true,Paused:false,Restarting:false,Status:'running'},HostConfig:{Privileged:false,NetworkMode:x.originalNetworks[0].name,PortBindings:{}},NetworkSettings:{Networks,Ports:{}}};
}
export function sharedSettings(){return Object.fromEntries(['MYSQL_PASSWORD','MYSQL_MIGRATION_PASSWORD','MYSQL_BACKUP_PASSWORD','MYSQL_MAINTENANCE_PASSWORD','REDIS_PASSWORD','AUTH_SECRET','DATA_ENCRYPTION_KEY'].map((k,i)=>[k,String(i+1).repeat(64)]));}
