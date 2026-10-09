import type {IncomingHttpHeaders} from 'node:http';

/** A container flag alone must never turn a native listener into a public one.
 * The launcher validates Docker itself; startup also checks this process's real
 * interfaces before it can bind the two private container addresses. */
export function assertSshContainerBoundary(containerMarker:boolean,interfaces:Record<string,Array<{address:string;family:string;internal:boolean}>|undefined>):void {
 const addresses=Object.values(interfaces).flatMap(values=>values??[]).filter(value=>!value.internal);
 if(!containerMarker||addresses.length!==2||addresses.some(value=>value.family!=='IPv4')||new Set(addresses.map(value=>value.address)).size!==2||!addresses.some(value=>value.address==='172.30.77.2')||!addresses.some(value=>value.address==='172.30.78.2'))throw new Error('SSH container network boundary does not match the verified deployment');
}

type RequestBoundary={headers:IncomingHttpHeaders;rawHeaders:string[];socket:{remoteAddress?:string};url?:string;method?:string};
/** Defense in depth; the deployment launcher separately verifies Docker isolation.
 * Literal Host is not proof of a loopback connection: inspect the actual socket. */
export function sshRequestAllowed(req:RequestBoundary,container:boolean):boolean {
 if(req.headers.host!=='localhost:17777')return false;
 let hosts=0;
 for(let index=0;index<req.rawHeaders.length;index+=2){
  const name=req.rawHeaders[index]!.toLowerCase();
  if(name==='host'){hosts++;if(req.rawHeaders[index+1]!=='localhost:17777')return false;}
  if(name==='forwarded'||name==='x-real-ip'||name.startsWith('x-forwarded-'))return false;
 }
 if(hosts!==1||!req.url?.startsWith('/')||req.url.startsWith('//'))return false;
 const peer=req.socket.remoteAddress;
 if(!container)return peer==='127.0.0.1';
 if(peer==='172.30.77.3')return true;
 return peer==='127.0.0.1'&&req.url==='/api/v1/health'&&['GET','HEAD'].includes(req.method??'');
}
