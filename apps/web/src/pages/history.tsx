import { useState } from 'react';
import { useInfiniteQuery,useMutation,useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { ReadingRecord } from '@star-oracle/contracts';
import { api,json } from '../lib/api';
import { useSession } from '../lib/session';
import { Button,Notice,LoginPrompt,Reveal } from '../components/ui';
import { ReadingView } from '../components/reading';
export function History(){
 const {user,pending}=useSession(),cache=useQueryClient(),[active,setActive]=useState<string|null>(null);
 const query=useInfiniteQuery({queryKey:['history',user?.id],queryFn:({pageParam})=>api<{items:ReadingRecord[];nextCursor:string|null}>('/readings?limit=20'+(pageParam?'&cursor='+pageParam:'')),initialPageParam:null as string|null,getNextPageParam:page=>page.nextCursor,enabled:!!user});
 const remove=useMutation({mutationFn:(id:string)=>api('/readings/'+id,{method:'DELETE',body:'{}'}),onSuccess:()=>cache.invalidateQueries({queryKey:['history',user?.id]})});
 const share=useMutation({mutationFn:(item:ReadingRecord)=>api('/readings/'+item.id+'/sharing',{method:'PATCH',body:json({shared:!item.shared})}),onSuccess:()=>cache.invalidateQueries({queryKey:['history',user?.id]})});
 return <Reveal className="page narrow"><span className="eyebrow">YOUR EXPLORATIONS</span><h1>曾经问过的问题，<br/>也是走过的路。</h1><p className="page-intro">记录默认私人保存。主动共享后，管理员可在后台查看这份占卜问题和解读；日记始终保持私人。</p>{!user&&!pending?<LoginPrompt/>:null}<Notice error={query.error??remove.error??share.error}/>{query.data?.pages[0]?.items.length===0?<p>还没有探索记录。<Link to="/tarot">从一个问题开始</Link>。</p>:null}{query.data?.pages.flatMap(page=>page.items).map(item=><article key={item.id} className="history-item"><button className="history-toggle" onClick={()=>setActive(active===item.id?null:item.id)} aria-expanded={active===item.id}><span className="eyebrow">{item.reading.kind==='tarot'?'TAROT':'I CHING'} · {new Date(item.createdAt).toLocaleDateString('zh-CN')}</span><h3>{item.reading.question}</h3><span className="muted small">{item.ai?'AI 解读':'基础解读'} · {item.shared?'已主动共享':'仅本人可见'}</span></button>{active===item.id?<><ReadingView {...item}/><div className="record-actions"><Button className="secondary" busy={share.isPending} onClick={()=>{if(item.shared||window.confirm('共享后，管理员可以看到本次问题和解读。确认共享？'))share.mutate(item);}}>{item.shared?'停止共享':'共享给管理员'}</Button><Button className="danger" busy={remove.isPending} onClick={()=>{if(window.confirm('永久删除这条记录？'))remove.mutate(item.id);}}>删除记录</Button></div></>:null}</article>)}{query.hasNextPage?<Button className="secondary" busy={query.isFetchingNextPage} onClick={()=>query.fetchNextPage()}>加载更多</Button>:null}</Reveal>;
}
