export type VerifiedIdentity={id:string;sessionBinding:string};
export type IdentityToken=VerifiedIdentity&{generation:number};
export type IdentitySnapshot={identity:VerifiedIdentity|null;generation:number;verified:boolean};
export class IdentityChangedError extends Error {
 constructor(){super('账户状态已变化，请重新确认后再操作。');this.name='IdentityChangedError';}
}
/** One boundary owns every private network request, including non-query mutations. */
export function createIdentityBoundary(){
 let state:IdentitySnapshot={identity:null,generation:0,verified:false};
 const listeners=new Set<()=>void>(),requests=new Set<AbortController>();
 const notify=()=>{for(const fn of listeners)fn();};
 const clear=()=>{
  state={identity:null,generation:state.generation+1,verified:false};
  for(const request of requests)request.abort();requests.clear();
 };
 const revoke=()=>{clear();notify();};
 const verify=(identity:VerifiedIdentity|null)=>{
  if((state.identity?.id!==identity?.id||state.identity?.sessionBinding!==identity?.sessionBinding)&&(state.verified||state.generation>0)){clear();}
  state={identity,generation:state.generation,verified:true};notify();
 };
 const assert=(token:IdentityToken)=>{
  if(!state.verified||!state.identity||token.generation!==state.generation||token.id!==state.identity.id||token.sessionBinding!==state.identity.sessionBinding)throw new IdentityChangedError();
 };
 return {snapshot:()=>state,subscribe:(fn:()=>void)=>{listeners.add(fn);return()=>{listeners.delete(fn);};},revoke,verify,assert,
  capture:():IdentityToken=>{if(!state.verified||!state.identity)throw new IdentityChangedError();return {...state.identity,generation:state.generation};},
  track:(token:IdentityToken,controller:AbortController)=>{assert(token);requests.add(controller);return()=>requests.delete(controller);},
 };
}
export const identityBoundary=createIdentityBoundary();
