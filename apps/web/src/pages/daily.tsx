import { useState,useEffect } from 'react';
import { useBlocker } from 'react-router-dom';
import { useMutation,useQuery,useQueryClient } from '@tanstack/react-query';
import { DAILY_MOODS } from '@star-oracle/domain';
import type { DailyRecord,JournalData } from '@star-oracle/contracts';
import { api,json } from '../lib/api';
import { useSession } from '../lib/session';
import { Button,Notice,LoginPrompt,Reveal,CopyButton } from '../components/ui';
import { Card } from '../components/reading';
export function JournalEditor({entry,onDirty}:{entry:DailyRecord;onDirty?:(dirty:boolean)=>void}){
 const cache=useQueryClient(),{user}=useSession(),[note,setNote]=useState(entry.journal.note),[mood,setMood]=useState<JournalData['mood']>(entry.journal.mood),[saved,setSaved]=useState(false),[baseline,setBaseline]=useState(entry.journal);
 const dirty=note!==baseline.note||mood!==baseline.mood;
 const blocker=useBlocker(({currentLocation,nextLocation})=>dirty&&currentLocation.pathname!==nextLocation.pathname);
 useEffect(()=>{onDirty?.(dirty);return()=>onDirty?.(false);},[dirty,onDirty]);
 useEffect(()=>{if(!dirty&&entry.journal.version!==baseline.version){setBaseline(entry.journal);setNote(entry.journal.note);setMood(entry.journal.mood);}},[entry.id,entry.journal.version,dirty,baseline.version]);
 useEffect(()=>{if(!dirty)return;const block=(e:BeforeUnloadEvent)=>{e.preventDefault();};window.addEventListener('beforeunload',block);return()=>window.removeEventListener('beforeunload',block);},[dirty]);
 const save=useMutation({mutationFn:(clear:boolean)=>api<DailyRecord>('/daily/'+entry.id+'/journal',{method:'PATCH',body:json({note:clear?'':note,mood:clear?null:mood,version:baseline.version})}),
 onSuccess:value=>{setBaseline(value.journal);setNote(value.journal.note);setMood(value.journal.mood);cache.setQueryData<DailyRecord>(['daily',user?.id],current=>current?.id===value.id?value:current);cache.invalidateQueries({queryKey:['journal',user?.id]});setSaved(true);setTimeout(()=>setSaved(false),2500);}});
 return <div className="journal-editor">{blocker.state==='blocked'?<div className="notice" role="alertdialog" aria-label="日记尚未保存"><p>这页日记还有未保存的内容。</p><div className="record-actions"><Button onClick={()=>blocker.reset()}>留在这里</Button><Button className="secondary" onClick={()=>blocker.proceed()}>离开并放弃草稿</Button></div></div>:null}<span className="eyebrow">A NOTE TO YOURSELF</span><h3>今天，你的心情是什么颜色？</h3><div className="mood-row">{DAILY_MOODS.map(item=><button key={item.id} className={mood===item.id?'selected':''} aria-pressed={mood===item.id} aria-label={item.label} onClick={()=>setMood(item.id as JournalData['mood'])}><span>{item.symbol}</span>{item.label}</button>)}</div><label htmlFor={'note-'+entry.id} className="sr-only">私人日记</label><textarea id={'note-'+entry.id} placeholder="一件小事，一个感受，或只写一句话……" maxLength={600} value={note} onChange={e=>setNote(e.target.value)}/><div className="journal-bottom"><span className="muted small">{note.length}/600 · 仅本人可见</span><div><Button className="secondary" busy={save.isPending} onClick={()=>save.mutate(true)}>清空日记</Button><Button busy={save.isPending} onClick={()=>save.mutate(false)}>保存</Button></div></div>{saved?<p className="success" role="status">已保存到你的私人记录。</p>:null}{dirty&&entry.journal.version!==baseline.version?<p className="notice" role="alert">云端日记已更新。当前草稿已保留；保存会提示冲突，你可以复制草稿后加载云端内容。</p>:null}<Notice error={save.error}/>{save.error?<Button className="secondary" onClick={()=>{if(dirty&&!window.confirm('加载云端内容会替换当前未保存草稿，确认继续？'))return;setBaseline(entry.journal);setNote(entry.journal.note);setMood(entry.journal.mood);save.reset();cache.invalidateQueries({queryKey:['daily',user?.id]});cache.invalidateQueries({queryKey:['journal',user?.id]});}}>加载云端内容</Button>:null}</div>;
}
export function Daily(){
 const {user,pending}=useSession(),[draftDirty,setDraftDirty]=useState(false),[displayed,setDisplayed]=useState<DailyRecord|null>(null);
 const query=useQuery({queryKey:['daily',user?.id],queryFn:()=>api<DailyRecord>('/daily/today',{method:'POST',body:'{}'}),enabled:!!user,staleTime:0,refetchOnWindowFocus:true});
 // The server date changes at Shanghai midnight. Poll only while this page is visible.
 useEffect(()=>{if(!user)return;const id=setInterval(()=>{if(document.visibilityState==='visible')void query.refetch();},60000);return()=>clearInterval(id);},[user?.id]);
 useEffect(()=>{if(query.data&&(!draftDirty||displayed?.id===query.data.id))setDisplayed(query.data);},[query.data,draftDirty,displayed?.id]);
 const entry=displayed;
 return <Reveal className="page narrow"><span className="eyebrow">DAILY LETTER / {entry?.date??'TODAY'} · 上海时间</span><h1>今天的光，<br/>写给今天的你。</h1><p className="page-intro">每天一张牌，一封小小来信。无需问题，也不必赶路。</p>{!user&&!pending?<LoginPrompt/>:null}{query.isPending&&user?<p role="status">正在打开今日星笺……</p>:null}<Notice error={query.error}/>{draftDirty&&query.data&&entry?.id!==query.data.id?<div className="notice" role="status">新的一天已经开始。上一页草稿还在，保存或清空后即可打开今日星笺。</div>:null}{entry&&entry.reading.kind==='tarot'?<><div className="daily-letter"><Card {...entry.reading.cards[0]!}/><div><span className="eyebrow">DEAR YOU</span><h2>{entry.message.title}</h2><p>{entry.message.text}</p><div className="action-box"><span className="eyebrow">今天的一小步</span><p>{entry.message.action}</p></div><p className="reflection">{entry.message.reflection}</p><CopyButton text={['照见 · '+entry.date,entry.message.title,entry.message.text,entry.message.action,entry.message.reflection].join('\n\n')}/></div></div><JournalEditor key={entry.id} entry={entry} onDirty={setDraftDirty}/><p className="disclaimer">星笺是象征性的编辑提示。清空日记不会重新抽牌。</p></>:null}</Reveal>;
}
export function Journal(){
 const {user,pending}=useSession();
 const query=useQuery({queryKey:['journal',user?.id],queryFn:()=>api<{items:DailyRecord[]}>('/daily'),enabled:!!user});
 const [active,setActive]=useState<string|null>(null),[draftDirty,setDraftDirty]=useState(false);
 return <Reveal className="page narrow"><span className="eyebrow">YOUR PRIVATE JOURNAL</span><h1>把走过的日子，<br/>轻轻收好。</h1><p className="page-intro">最近九十天的星笺与心情。日记内容仅你本人可见。</p>{!user&&!pending?<LoginPrompt/>:null}<Notice error={query.error}/>{query.data?.items.length===0?<p>还没有星笺，从今天开始写一页吧。</p>:null}<div className="journal-list">{query.data?.items.map(entry=><article className="journal-item" key={entry.id}><button className="journal-toggle" aria-expanded={active===entry.id} onClick={()=>{if(draftDirty&&!window.confirm('切换星笺会放弃未保存草稿，确认继续？'))return;setDraftDirty(false);setActive(active===entry.id?null:entry.id);}}><span>{entry.date}</span><strong>{entry.message.title}</strong><span>{DAILY_MOODS.find(m=>m.id===entry.journal.mood)?.label??'未写心情'} {active===entry.id?'−':'+'}</span></button>{active===entry.id?<><p>{entry.message.text}</p><JournalEditor entry={entry} onDirty={setDraftDirty}/></>:null}</article>)}</div></Reveal>;
}
