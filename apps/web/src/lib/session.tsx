import { createContext,useContext,type ReactNode } from 'react';
import { useQuery,useQueryClient } from '@tanstack/react-query';
import type { CurrentUser } from '@star-oracle/contracts';
import { api,ApiError,authClient } from './api';
const Context=createContext<{user:CurrentUser|null;pending:boolean;error:unknown;signOut:()=>Promise<void>;refresh:()=>Promise<unknown>}>({user:null,pending:true,error:null,signOut:async()=>{},refresh:async()=>{}});
export function SessionProvider({children}:{children:ReactNode}) {
 const cache=useQueryClient();
 const query=useQuery({queryKey:['me'],queryFn:async()=>{try{return await api<CurrentUser>('/me');}catch(e){if(e instanceof ApiError&&e.status===401)return null;throw e;}},retry:false,staleTime:30000});
 return <Context.Provider value={{user:query.data??null,pending:query.isPending||(query.data===undefined&&query.isFetching),error:query.error,
 refresh:()=>query.refetch(),signOut:async()=>{const result=await authClient.signOut();if(result.error)throw new Error(result.error.message);cache.clear();await query.refetch();}}}>{children}</Context.Provider>;
}
export const useSession=()=>useContext(Context);
