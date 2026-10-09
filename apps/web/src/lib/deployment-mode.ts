import {useQuery} from '@tanstack/react-query';
import {api} from './api';

export function useDeploymentMode(){
 const config=useQuery({queryKey:['public-config'],queryFn:()=>api<{deploymentMode:'https'|'ssh-only'}>('/config'),staleTime:60000});
 return config.data?.deploymentMode;
}
