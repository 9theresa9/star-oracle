import { useState,type FormEvent } from 'react';
import { useQuery,useMutation,useQueryClient } from '@tanstack/react-query';
import { MessageCircle,Send } from 'lucide-react';
import { api,json } from '../lib/api';
import { useSession } from '../lib/session';
import { Button,Notice,Reveal,LoginPrompt,Empty } from '../components/ui';
import './management.css';
type Category='bug'|'idea'|'account'|'other';
type FeedbackItem={id:string;category:Category;body:string;status:'open'|'in_progress'|'resolved';adminReply:string|null;version:number;createdAt:string;updatedAt:string};
type Page={items:FeedbackItem[];nextCursor:string|null};
const categories:Record<Category,string>={bug:'功能问题',idea:'新功能建议',account:'账户与权益',other:'其他'};
const statuses={open:'待处理',in_progress:'处理中',resolved:'已处理'};
export function Feedback(){
 const {user,pending}=useSession(),cache=useQueryClient(),[category,setCategory]=useState<Category>('idea'),[body,setBody]=useState(''),[cursor,setCursor]=useState<string|null>(null),[sent,setSent]=useState(false);
 const query=useQuery({queryKey:['feedback',user?.id,cursor],queryFn:()=>api<Page>('/feedback?limit=20'+(cursor?'&cursor='+encodeURIComponent(cursor):'')),enabled:!!user});
 const submit=useMutation({mutationFn:()=>api<FeedbackItem>('/feedback',{method:'POST',body:json({category,body:body.trim()})}),onSuccess:()=>{setBody('');setSent(true);setCursor(null);void cache.invalidateQueries({queryKey:['feedback',user?.id]});}});
 function send(event:FormEvent){event.preventDefault();setSent(false);submit.mutate();}
 if(pending)return <div className="page" role="status">正在读取账户…</div>;
 if(!user)return <div className="page"><LoginPrompt/></div>;
 return <Reveal className="page management-page"><span className="eyebrow">WE ARE LISTENING</span><h1>让照见，变得更好。</h1><p className="page-intro">告诉我们遇到的问题，或你希望加入的新体验。你可以在这里查看处理状态和回复。</p><form className="form-panel" onSubmit={send}><MessageCircle size={23}/><label htmlFor="feedback-category">反馈类型</label><select id="feedback-category" value={category} onChange={e=>setCategory(e.target.value as Category)}>{Object.entries(categories).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select><label htmlFor="feedback-body">想告诉我们什么</label><textarea id="feedback-body" rows={6} maxLength={2000} value={body} onChange={e=>{setBody(e.target.value);setSent(false);}} required placeholder="描述发生了什么、你期待的体验，以及方便复现的步骤。"/><div className="journal-bottom"><span className="muted small">{body.length}/2000 · 请勿填写密码、验证码或支付信息</span><Button type="submit" busy={submit.isPending} disabled={!body.trim()}><Send size={15}/>提交反馈</Button></div><p className="muted small">反馈正文与处理回复会向管理员开放，请只提交与问题有关的信息。</p>{sent?<p className="success" role="status">反馈已收到，处理进展会显示在下方。</p>:null}</form><Notice error={submit.error??query.error}/><h2 className="section-title">我的反馈</h2>{query.isPending?<p role="status">正在读取反馈…</p>:null}{query.data?.items.length===0?<Empty title="每个想法，都有价值">提交后，你可以在这里查看回复。</Empty>:null}{query.data?.items.map(item=><article className="feedback-item" key={item.id}><header><span className="pill">{categories[item.category]}</span><span className={'feedback-status '+item.status}>{statuses[item.status]}</span><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleDateString('zh-CN')}</time></header><p className="plain-copy">{item.body}</p>{item.adminReply?<div className="feedback-reply"><span className="eyebrow">照见的回复</span><p className="plain-copy">{item.adminReply}</p></div>:<p className="muted small">暂时还没有回复。</p>}</article>)}<div className="record-actions">{cursor?<Button className="secondary" onClick={()=>setCursor(null)}>返回第一页</Button>:null}{query.data?.nextCursor?<Button className="secondary" onClick={()=>setCursor(query.data!.nextCursor)}>下一页</Button>:null}</div></Reveal>;
}
