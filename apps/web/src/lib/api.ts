import { createAuthClient } from 'better-auth/react';
import { twoFactorClient } from 'better-auth/client/plugins';
const configured=import.meta.env.VITE_API_ORIGIN as string|undefined;
export const apiOrigin=configured?new URL(configured).origin:window.location.origin;
export const authClient=createAuthClient({baseURL:apiOrigin,plugins:[twoFactorClient()]});
export class ApiError extends Error {constructor(message:string,public status:number){super(message);}}
export async function api<T>(path:string,options:RequestInit={}):Promise<T> {
 const response=await fetch(apiOrigin+'/api/v1'+path,{...options,credentials:'include',headers:{'Content-Type':'application/json',...options.headers}});
 const body=await response.json().catch(()=>null);
 if(!response.ok) throw new ApiError(body?.error?.message??'暂时无法完成，请稍后再试',response.status);
 return body as T;
}
export const json=(value:unknown)=>JSON.stringify(value);
