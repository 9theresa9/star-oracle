import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bell,BookOpen } from 'lucide-react';
import { api } from '../lib/api';
import { Button,Notice,Reveal,Empty } from '../components/ui';
import './management.css';
type Content={id:string;slug:string;kind:'announcement'|'guide';title:string;body:string;published:boolean;version:number;createdAt:string;updatedAt:string};
export function Announcements(){
 const [kind,setKind]=useState<'announcement'|'guide'>('announcement'),[cursor,setCursor]=useState<string|null>(null);
 const query=useQuery({queryKey:['content',kind,cursor],queryFn:()=>api<{items:Content[];nextCursor:string|null}>('/content?kind='+kind+'&limit=20'+(cursor?'&cursor='+encodeURIComponent(cursor):''))});
 return <Reveal className="page management-page"><span className="eyebrow">LETTERS FROM STAR ORACLE</span><h1>星空里的，新消息。</h1><p className="page-intro">产品更新、使用指引，以及值得慢慢读完的一封信。</p><div className="segmented" aria-label="内容类型"><button className={kind==='announcement'?'selected':''} onClick={()=>{setKind('announcement');setCursor(null);}}><Bell size={15}/>公告</button><button className={kind==='guide'?'selected':''} onClick={()=>{setKind('guide');setCursor(null);}}><BookOpen size={15}/>使用指引</button></div><Notice error={query.error}/>{query.isPending?<p role="status">正在读取消息…</p>:null}{query.data?.items.length===0?<Empty title="新的星光，正在准备">发布后的公告与指引会出现在这里。</Empty>:null}{query.data?.items.map(item=><article className="content-letter" key={item.id}><time className="eyebrow" dateTime={item.updatedAt}>{new Date(item.updatedAt).toLocaleDateString('zh-CN')}</time><h2>{item.title}</h2><p className="plain-copy">{item.body}</p></article>)}<div className="record-actions">{cursor?<Button className="secondary" onClick={()=>setCursor(null)}>返回第一页</Button>:null}{query.data?.nextCursor?<Button className="secondary" onClick={()=>setCursor(query.data!.nextCursor)}>下一页</Button>:null}</div></Reveal>;
}
