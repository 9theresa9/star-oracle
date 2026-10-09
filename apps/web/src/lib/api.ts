import {identityBoundary,IdentityChangedError} from './session-identity';
const configured=import.meta.env.VITE_API_ORIGIN as string|undefined;
export const apiOrigin=configured?new URL(configured).origin:window.location.origin;
export class ApiError extends Error {constructor(message:string,public status:number,public code?:string){super(message);}}
export async function api<T>(path:string,options:RequestInit={}):Promise<T> {
 const publicRequest=/^\/(me|config|health)(?:\?|$)/.test(path)||/^\/content(?:\/|\?|$)/.test(path);
 const identity=publicRequest?null:identityBoundary.capture();
 const controller=new AbortController();
 const untrack=identity?identityBoundary.track(identity,controller):()=>{};
 const signal=options.signal?AbortSignal.any([options.signal,controller.signal]):controller.signal;
 try{
  const headers=new Headers(options.headers);headers.set('Content-Type','application/json');
  if(identity){headers.set('X-Expected-Actor',identity.id);headers.set('X-Expected-Session',identity.sessionBinding);}
  const response=await fetch(apiOrigin+'/api/v1'+path,{...options,credentials:'include',headers,signal});
  let body:unknown;
  try{body=await response.json();}catch{if(response.ok)throw new ApiError('响应未完整收到，请重试以恢复这次结果。',0,'UNKNOWN_OUTCOME');body=null;}
  const payload=body as {error?:{message?:string;code?:string}}|null;
  if(identity){
   identityBoundary.assert(identity);
   if(response.status===401||payload?.error?.code==='SESSION_CHANGED'||(response.status===409&&(response.headers.get('X-Actor-Id')!==identity.id||response.headers.get('X-Session-Binding')!==identity.sessionBinding))){
    identityBoundary.revoke();window.dispatchEvent(new Event('oracle:session-invalid'));throw new IdentityChangedError();
   }
   if(response.ok&&(response.headers.get('X-Actor-Id')!==identity.id||response.headers.get('X-Session-Binding')!==identity.sessionBinding)){
    identityBoundary.revoke();window.dispatchEvent(new Event('oracle:session-invalid'));throw new IdentityChangedError();
   }
  }
  if(!response.ok)throw new ApiError(payload?.error?.message??'暂时无法完成，请稍后再试',response.status,payload?.error?.code);
  return body as T;
 }finally{untrack();}
}
export const json=(value:unknown)=>JSON.stringify(value);
