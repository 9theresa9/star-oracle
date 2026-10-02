import { useState,type FormEvent } from 'react';
import { useMutation,useQuery } from '@tanstack/react-query';
import { Sparkles,RotateCcw } from 'lucide-react';
import { drawTarot,castCoinLine,basicInterpretation,type Reading } from '@star-oracle/domain';
import type { ReadingRecord } from '@star-oracle/contracts';
import { useSession } from '../lib/session';
import { api,json } from '../lib/api';
import { Button,Notice,Reveal } from '../components/ui';
import { ReadingView,Hexagram } from '../components/reading';
import { Link } from 'react-router-dom';
export function Explore({kind}:{kind:'tarot'|'iching'}){
 const {user}=useSession(),[question,setQuestion]=useState(''),[spread,setSpread]=useState<'single'|'three'>('three'),[reversed,setReversed]=useState(true),[result,setResult]=useState<ReadingRecord|null>(null),[revealed,setRevealed]=useState(0),[consent,setConsent]=useState(false),[attemptId,setAttemptId]=useState(()=>crypto.randomUUID());
 const settings=useQuery({queryKey:['public-config'],queryFn:()=>api<{aiEnabled:boolean;aiProvider:string}>('/config'),staleTime:60000});
 const draw=useMutation({mutationFn:async()=>{
  if(user)return api<ReadingRecord>('/readings',{method:'POST',body:json({kind,question,spread,allowReversed:reversed,requestId:attemptId})});
  const reading:Reading={version:1,id:crypto.randomUUID(),createdAt:new Date().toISOString(),question,
   ...(kind==='tarot'?{kind,spread,cards:drawTarot(spread,reversed)}:{kind,lines:Array.from({length:6},()=>castCoinLine().value)})};
  return {id:reading.id,reading,interpretation:basicInterpretation(reading),shared:false,ai:false,createdAt:reading.createdAt};
 },onSuccess:value=>{setResult(value);setRevealed(kind==='tarot'?6:0);}});
 const ai=useMutation({mutationFn:()=>api<ReadingRecord>('/readings/'+result!.id+'/interpret',{method:'POST',body:json({consent:true})}),onSuccess:setResult});
 function submit(e:FormEvent){e.preventDefault();draw.mutate();}
 return <Reveal className="page narrow"><span className="eyebrow">{kind==='tarot'?'TAROT / A NEW PERSPECTIVE':'I CHING / THE ART OF CHANGE'}</span><h1>{kind==='tarot'?'给问题，另一种光。':'听见变化的节奏。'}</h1><p className="page-intro">{kind==='tarot'?'带着一个具体的问题，安静地抽一组牌。':'带着问题，六次起爻。看看哪些值得守住，哪些可以改变。'}</p>{!result?<form className="form-panel" onSubmit={submit}><label htmlFor="question">此刻，你想探索什么？</label><textarea id="question" value={question} onChange={e=>{setQuestion(e.target.value);setAttemptId(crypto.randomUUID());}} minLength={2} maxLength={500} placeholder="例如：面对新的机会，我需要留意什么？" required/><span className="field-hint">不必填写姓名、联系方式或其他敏感信息。{question.length}/500</span>{kind==='tarot'?<><div className="segmented" aria-label="选择牌阵"><button type="button" className={spread==='single'?'selected':''} onClick={()=>{setSpread('single');setAttemptId(crypto.randomUUID());}}>一张 · 聚焦</button><button type="button" className={spread==='three'?'selected':''} onClick={()=>{setSpread('three');setAttemptId(crypto.randomUUID());}}>三张 · 情境与行动</button></div><label className="checkbox"><input type="checkbox" checked={reversed} onChange={e=>{setReversed(e.target.checked);setAttemptId(crypto.randomUUID());}}/>包含逆位</label></>:null}<Button busy={draw.isPending} type="submit">{kind==='tarot'?'开始抽牌':'开始起卦'} <Sparkles size={17}/></Button><Notice error={draw.error}/>{!user?<p className="muted small">你正在访客体验。<Link to="/account">登录</Link>可保存记录与使用 AI 解读。</p>:<p className="muted small">记录默认仅你可见。共享需要你主动开启。</p>}</form>:<>{kind==='iching'&&revealed<6&&result.reading.kind==='iching'?<div className="ritual"><Hexagram lines={result.reading.lines} revealed={revealed}/><p>由下而上 · 第 {revealed+1} 爻</p><Button onClick={()=>setRevealed(v=>v+1)}>掷三枚铜钱</Button><p className="muted small">慢一点，给此刻一个停顿。</p></div>:<><ReadingView {...result}/>{user&&!result.ai?<div className="ai-panel"><h3>让解读靠近你的问题</h3><p>AI 将结合这次牌面或卦象整理建议。问题和结果会发送到 {settings.data?.aiProvider??'网站配置的模型服务'}；私人日记不会发送。</p><label className="checkbox"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/>我同意发送本次问题与结果进行 AI 解读</label><Button busy={ai.isPending} disabled={!consent||!settings.data?.aiEnabled} onClick={()=>ai.mutate()}>{settings.data?.aiEnabled?'生成 AI 解读':'AI 暂未启用'} <Sparkles size={16}/></Button><Notice error={ai.error}/></div>:null}<Button className="secondary" onClick={()=>{setResult(null);setAttemptId(crypto.randomUUID());setConsent(false);draw.reset();ai.reset();}}>再探索一个问题 <RotateCcw size={16}/></Button></>}</>}</Reveal>;
}
