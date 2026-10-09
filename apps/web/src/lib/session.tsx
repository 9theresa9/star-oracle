import {createContext,useContext,useEffect,useSyncExternalStore,type ReactNode} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import type {CurrentUser} from '@star-oracle/contracts';
import {api,ApiError} from './api';
import {identityBoundary,IdentityChangedError} from './session-identity';
const CHANNEL='star-oracle-session';
const TAB_ID=crypto.randomUUID();
const Context=createContext<{user:CurrentUser|null;pending:boolean;error:unknown;generation:number;signOut:()=>Promise<void>;refresh:()=>Promise<unknown>;beginAuthChange:()=>void}>({user:null,pending:true,error:null,generation:0,signOut:async()=>{},refresh:async()=>{},beginAuthChange:()=>{}});
function broadcast(){
 // Only a nonce is shared, never IDs, tokens or private content. Storage is a fallback
 // for browsers without BroadcastChannel; focus validation covers disabled storage.
 const message={sender:TAB_ID,nonce:crypto.randomUUID()};
 try{localStorage.setItem(CHANNEL,JSON.stringify(message));}catch{/* private browser storage can be unavailable */}
 try{const channel=new BroadcastChannel(CHANNEL);channel.postMessage(message);channel.close();}catch{/* unsupported browser */}
}
export function SessionProvider({children}:{children:ReactNode}){
 const cache=useQueryClient();
 const snapshot=useSyncExternalStore(identityBoundary.subscribe,identityBoundary.snapshot);
 const query=useQuery({queryKey:['me'],queryFn:async({signal})=>{
  const generation=identityBoundary.snapshot().generation;
  let user:CurrentUser|null;
  try{user=await api<CurrentUser>('/me',{signal});}catch(error){
   if(error instanceof ApiError&&error.status===401)user=null;
   else{if(!signal.aborted&&identityBoundary.snapshot().generation===generation)identityBoundary.revoke();throw error;}
  }
  if(signal.aborted||identityBoundary.snapshot().generation!==generation)throw new IdentityChangedError();
  if(user&&(typeof user.id!=='string'||!user.id||typeof user.sessionBinding!=='string'||!user.sessionBinding)){identityBoundary.revoke();throw new Error('账户确认信息不完整，请刷新后重试。');}
  identityBoundary.verify(user?{id:user.id,sessionBinding:user.sessionBinding}:null);
  return user;
 },retry:false,staleTime:0,refetchOnWindowFocus:false});
 useEffect(()=>{
  let previous=identityBoundary.snapshot().generation;
  return identityBoundary.subscribe(()=>{
   const next=identityBoundary.snapshot().generation;if(next===previous)return;previous=next;
   void cache.cancelQueries({predicate:q=>q.queryKey[0]!=='me'});
   cache.removeQueries({predicate:q=>!['me','public-config','content'].includes(String(q.queryKey[0]))});
   cache.getMutationCache().clear();
  });
 },[cache]);
 const revalidate=async()=>{await cache.cancelQueries({queryKey:['me'],exact:true});return query.refetch();};
 const invalidate=()=>{identityBoundary.revoke();void revalidate();};
 useEffect(()=>{
  let lastNonce='';
  const changed=(value:unknown)=>{if(!value||typeof value!=='object'||!('nonce' in value)||!('sender' in value)||typeof value.nonce!=='string'||value.sender===TAB_ID||value.nonce===lastNonce)return;lastNonce=value.nonce;invalidate();};
  const onStorage=(event:StorageEvent)=>{if(event.key===CHANNEL&&event.newValue){try{changed(JSON.parse(event.newValue));}catch{/* ignore unrelated/malformed storage */}}};
  const onFocus=()=>{if(document.visibilityState==='visible')void revalidate();};
  let channel:BroadcastChannel|undefined;
  try{channel=new BroadcastChannel(CHANNEL);channel.onmessage=event=>changed(event.data);}catch{/* storage/focus fallback remains */}
  window.addEventListener('storage',onStorage);window.addEventListener('focus',onFocus);
  document.addEventListener('visibilitychange',onFocus);window.addEventListener('oracle:session-invalid',invalidate);
  return()=>{channel?.close();window.removeEventListener('storage',onStorage);window.removeEventListener('focus',onFocus);document.removeEventListener('visibilitychange',onFocus);window.removeEventListener('oracle:session-invalid',invalidate);};
 },[cache]);
 const beginAuthChange=()=>{identityBoundary.revoke();broadcast();};
 const refresh=async()=>{beginAuthChange();const result=await revalidate();broadcast();return result;};
 const user=snapshot.verified&&snapshot.identity?.id===query.data?.id&&snapshot.identity?.sessionBinding===query.data?.sessionBinding?query.data??null:null;
 return <Context.Provider value={{user,pending:!snapshot.verified&&!query.error,error:query.error,generation:snapshot.generation,beginAuthChange,refresh,
 signOut:async()=>{beginAuthChange();try{const {authClient}=await import('./auth-client');const result=await authClient.signOut();if(result.error)throw new Error(result.error.message);}finally{await revalidate();broadcast();}}}}>{children}</Context.Provider>;
}
export const useSession=()=>useContext(Context);
