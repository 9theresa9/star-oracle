import {identityBoundary} from './session-identity.ts';
import type { InfiniteData,QueryClient } from '@tanstack/react-query';
export type PrivatePage<T>={items:T[];nextCursor:string|null};
export type OwnerToken={id:string;query:unknown;generation:number;sessionBinding:string|undefined};
export function captureOwner(cache:QueryClient,id:string|undefined):OwnerToken|null{
 const query=cache.getQueryCache().find({queryKey:['me'],exact:true});
 return id&&query&&cache.getQueryData<{id:string}|null>(['me'])?.id===id?{id,query,generation:identityBoundary.snapshot().generation,sessionBinding:cache.getQueryData<{sessionBinding?:string}|null>(['me'])?.sessionBinding}:null;
}
export function sameOwner(cache:QueryClient,owner:OwnerToken|null|undefined):owner is OwnerToken{
 return !!owner&&identityBoundary.snapshot().generation===owner.generation&&cache.getQueryData<{sessionBinding?:string}|null>(['me'])?.sessionBinding===owner.sessionBinding&&cache.getQueryCache().find({queryKey:['me'],exact:true})===owner.query&&cache.getQueryData<{id:string}|null>(['me'])?.id===owner.id;
}
export function patchLoadedPages<T extends {id:string}>(data:InfiniteData<PrivatePage<T>>|undefined,id:string,patch:(item:T)=>T){
 if(!data)return data;
 let changed=false;
 const pages=data.pages.map(page=>{
  const index=page.items.findIndex(item=>item.id===id);
  if(index<0)return page;
  const item=patch(page.items[index]!);
  if(item===page.items[index])return page;
  const items=page.items.slice();items[index]=item;changed=true;
  return {...page,items};
 });
 return changed?{...data,pages}:data;
}
export async function patchPrivatePages<T extends {id:string}>(cache:QueryClient,owner:OwnerToken|null|undefined,prefix:string,id:string,patch:(item:T)=>T,refreshFilter?:(key:readonly unknown[])=>boolean){
 if(!sameOwner(cache,owner))return false;
 const queryKey=[prefix,owner.id];
 await cache.cancelQueries({queryKey});
 if(!sameOwner(cache,owner))return false;
 cache.setQueriesData<InfiniteData<PrivatePage<T>>>({queryKey,predicate:query=>!refreshFilter?.(query.queryKey)},data=>patchLoadedPages(data,id,patch));
 if(refreshFilter)void cache.invalidateQueries({queryKey,predicate:query=>refreshFilter(query.queryKey)});
 return true;
}
