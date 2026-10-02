import { useState } from 'react';
import { useQuery,useMutation,useQueryClient } from '@tanstack/react-query';
import type { ReadingRecord } from '@star-oracle/contracts';
import { api,json } from '../lib/api';
import { useSession } from '../lib/session';
import { Button,Notice,Reveal } from '../components/ui';
import { ReadingView } from '../components/reading';
type ManagedUser={id:string;name:string;email:string;role:string;disabled:boolean;createdAt:string};
type Audit={id:string;action:string;actorId:string|null;targetId:string|null;createdAt:string};
type Overview={users:number;readings:number;dailyEntries:number;aiRequestsToday:number;aiDailyLimit:number;aiConfigured:boolean;database:string;redis:string};
export function Admin(){
 const {user,pending}=useSession(),[tab,setTab]=useState<'overview'|'users'|'shared'|'audit'>('overview'),cache=useQueryClient();
 const enabled=user?.role==='admin';
 const overview=useQuery({queryKey:['admin-overview',user?.id],queryFn:()=>api<Overview>('/admin/overview'),enabled:enabled&&tab==='overview'});
 const users=useQuery({queryKey:['admin-users',user?.id],queryFn:()=>api<{items:ManagedUser[]}>('/admin/users'),enabled:enabled&&tab==='users'});
 const shared=useQuery({queryKey:['admin-shared',user?.id],queryFn:()=>api<{items:ReadingRecord[]}>('/admin/shared-readings'),enabled:enabled&&tab==='shared'});
 const audit=useQuery({queryKey:['admin-audit',user?.id],queryFn:()=>api<{items:Audit[]}>('/admin/audit'),enabled:enabled&&tab==='audit'});
 const status=useMutation({mutationFn:(item:ManagedUser)=>api('/admin/users/'+item.id+'/status',{method:'PATCH',body:json({disabled:!item.disabled})}),onSuccess:()=>cache.invalidateQueries({queryKey:['admin-users',user?.id]})});
 if(!enabled&&!pending)return <div className="page"><h1>需要管理员权限</h1><p>只有被授权的管理员可以访问管理后台。</p></div>;
 return <Reveal className="page admin-page"><span className="eyebrow">STAR ORACLE / CONSOLE</span><h1>照看系统，也照看信任。</h1><div className="segmented admin-tabs">{([{id:'overview',label:'概览'},{id:'users',label:'用户'},{id:'shared',label:'共享记录'},{id:'audit',label:'操作日志'}] as const).map(t=><button key={t.id} className={tab===t.id?'selected':''} onClick={()=>setTab(t.id)}>{t.label}</button>)}</div><Notice error={overview.error??users.error??shared.error??audit.error??status.error}/>{overview.data&&tab==='overview'?<><div className="stat-grid">{[['用户数',overview.data.users],['占卜记录',overview.data.readings],['星笺',overview.data.dailyEntries],['今日 AI 请求',overview.data.aiRequestsToday+'/'+overview.data.aiDailyLimit]].map(([label,value])=><div className="stat-card" key={label}><span>{label}</span><strong>{value}</strong></div>)}</div><div className="form-panel"><h3>服务状态</h3><p>MySQL：{overview.data.database} · Redis：{overview.data.redis}</p><p>AI：{overview.data.aiConfigured?'已配置':'未配置，基础解读可用'}</p><p className="muted">私人日记和未共享的占卜内容不在管理后台开放。</p></div></>:null}{users.data&&tab==='users'?<div className="table-scroll"><table><thead><tr><th>用户</th><th>邮箱</th><th>角色</th><th>状态</th><th>操作</th></tr></thead><tbody>{users.data.items.map(item=><tr key={item.id}><td>{item.name}</td><td>{item.email}</td><td>{item.role}</td><td>{item.disabled?'停用':'正常'}</td><td>{item.role!=='admin'?<Button className="secondary" busy={status.isPending} onClick={()=>{if(window.confirm(item.disabled?'重新启用该用户？':'停用该用户并立即撤销其会话？'))status.mutate(item);}}>{item.disabled?'启用':'停用'}</Button>:<span className="muted">服务器管理</span>}</td></tr>)}</tbody></table><p className="muted small">最近 100 个用户</p></div>:null}{shared.data&&tab==='shared'?<><p className="muted">最近 50 条用户主动共享的记录</p>{shared.data.items.map(item=><article className="history-item" key={item.id}><ReadingView {...item}/></article>)}</>:null}{audit.data&&tab==='audit'?<div className="table-scroll"><table><thead><tr><th>时间</th><th>操作</th><th>操作者</th><th>目标</th></tr></thead><tbody>{audit.data.items.map(item=><tr key={item.id}><td>{new Date(item.createdAt).toLocaleString('zh-CN')}</td><td>{item.action}</td><td>{item.actorId??'服务器维护'}</td><td>{item.targetId??'—'}</td></tr>)}</tbody></table><p className="muted small">最近 100 条操作，日志不保存问题与日记正文。</p></div>:null}</Reveal>;
}
