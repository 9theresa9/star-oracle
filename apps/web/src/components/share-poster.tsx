import { useEffect,useState,useRef } from 'react';
import { Download,Image } from 'lucide-react';
import { TAROT_DECK,SPREADS,analyseLines,type Reading } from '@star-oracle/domain';
import { Button,Notice } from './ui';
function wrap(ctx:CanvasRenderingContext2D,text:string,x:number,y:number,width:number,lineHeight:number,maxLines=5){
 let line='',n=0;for(const char of Array.from(text)){if(ctx.measureText(line+char).width>width&&line){ctx.fillText(line,x,y+n*lineHeight);line='';n++;if(n>=maxLines){ctx.fillText('…',x,y+n*lineHeight);return y+(n+1)*lineHeight;}}line+=char;}
 if(line){ctx.fillText(line,x,y+n*lineHeight);n++;}return y+n*lineHeight;
}
function star(ctx:CanvasRenderingContext2D,x:number,y:number,r:number){
 ctx.beginPath();for(let i=0;i<8;i++){const a=-Math.PI/2+i*Math.PI/4,l=i%2?r*.24:r;const px=x+Math.cos(a)*l,py=y+Math.sin(a)*l;i?ctx.lineTo(px,py):ctx.moveTo(px,py);}ctx.closePath();ctx.stroke();
}
async function makePoster(reading:Reading,includeQuestion:boolean):Promise<Blob>{
 const canvas=document.createElement('canvas'),cards=reading.kind==='tarot'?reading.cards:[],cols=Math.min(4,Math.max(1,cards.length)),rows=Math.ceil(cards.length/cols);
 canvas.width=1080;canvas.height=reading.kind==='tarot'?Math.max(1500,700+rows*310):1500;
 const ctx=canvas.getContext('2d');if(!ctx)throw new Error('当前浏览器暂不支持海报生成');
 const g=ctx.createLinearGradient(0,0,1080,canvas.height);g.addColorStop(0,'#30203f');g.addColorStop(1,'#100c1b');ctx.fillStyle=g;ctx.fillRect(0,0,1080,canvas.height);ctx.strokeStyle='#d5b779';ctx.lineWidth=2;ctx.globalAlpha=.35;ctx.strokeRect(42,42,996,canvas.height-84);ctx.globalAlpha=1;
 for(let i=0;i<65;i++){const x=60+(i*167)%960,y=100+(i*293)%(canvas.height-200);ctx.globalAlpha=.15+(i%4)*.1;star(ctx,x,y,2+i%3);}ctx.globalAlpha=1;
 ctx.textAlign='center';ctx.fillStyle='#d5b779';ctx.font='24px sans-serif';ctx.fillText('STAR ORACLE · 照见',540,125);star(ctx,540,230,48);
 ctx.fillStyle='#f6f1e7';ctx.font='44px sans-serif';ctx.fillText(reading.kind==='tarot'?SPREADS[reading.spread]?.name??'一次塔罗探索':'一次易经探索',540,340);
 if(reading.kind==='tarot'){
  const gap=32,w=Math.min(210,(920-(cols-1)*gap)/cols),left=(1080-cols*w-(cols-1)*gap)/2;
  cards.forEach((card,i)=>{const x=left+(i%cols)*(w+gap),y=395+Math.floor(i/cols)*310,item=TAROT_DECK.find(c=>c.id===card.id);ctx.fillStyle='#21162e';ctx.fillRect(x,y,w,225);ctx.strokeStyle='#d5b779';ctx.globalAlpha=.75;ctx.strokeRect(x+6,y+6,w-12,213);ctx.globalAlpha=1;ctx.beginPath();ctx.ellipse(x+w/2,y+108,w*.32,72,0,0,Math.PI*2);ctx.stroke();star(ctx,x+w/2,y+108,34);ctx.fillStyle='#f6f1e7';ctx.font='23px sans-serif';ctx.fillText(item?.name??'牌面',x+w/2,y+258);ctx.fillStyle='#d5b779';ctx.font='18px sans-serif';ctx.fillText(card.reversed?'逆位':'正位',x+w/2,y+286);});
 }else{
  const result=analyseLines(reading.lines);ctx.fillStyle='#d5b779';[...reading.lines].reverse().forEach((line,i)=>{const y=425+i*48;if(line%2)ctx.fillRect(375,y,330,14);else{ctx.fillRect(375,y,145,14);ctx.fillRect(560,y,145,14);}if(line===6||line===9){ctx.beginPath();ctx.arc(733,y+7,5,0,Math.PI*2);ctx.stroke();}});
  ctx.fillStyle='#f6f1e7';ctx.font='34px sans-serif';ctx.fillText(result.original.number+' · '+result.original.name,540,795);ctx.fillStyle='#d5b779';ctx.font='24px sans-serif';ctx.fillText(result.moving.length?'变卦：'+result.resulting.name:'静卦 · 慢慢体会',540,845);
 }
 const bottom=canvas.height-390;ctx.fillStyle='#aaa2b7';ctx.font='23px sans-serif';ctx.fillText('留一点安静，听见自己。',540,bottom);
 if(includeQuestion){ctx.fillStyle='#f6f1e7';ctx.font='26px sans-serif';wrap(ctx,reading.question,540,bottom+60,850,39,3);}
 ctx.fillStyle='#aaa2b7';ctx.font='18px sans-serif';ctx.fillText('自我反思与娱乐 · 选择始终在你手中',540,canvas.height-100);
 return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('生成失败，请稍后再试')),'image/png'));
}
export function SharePoster({reading}:{reading:Reading}){
 const active=useRef(true);
 useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
 const [includeQuestion,setIncludeQuestion]=useState(false),[url,setUrl]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState<unknown>(null);
 useEffect(()=>()=>{if(url)URL.revokeObjectURL(url);},[url]);
 useEffect(()=>{setUrl('');setIncludeQuestion(false);},[reading.id]);
 async function generate(){setBusy(true);setError(null);try{const blob=await makePoster(reading,includeQuestion);if(active.current)setUrl(URL.createObjectURL(blob));}catch(e){if(active.current)setError(e);}finally{if(active.current)setBusy(false);}}
 return <details className="oracle-details poster-panel"><summary><Image size={16}/>制作分享海报</summary><p className="muted small">图片仅在你的浏览器生成，默认包含牌面或卦象，不含问题、AI 对话和日记。保存后请自行选择分享对象。</p><label className="checkbox"><input type="checkbox" disabled={busy} checked={includeQuestion} onChange={e=>{setIncludeQuestion(e.target.checked);setUrl('');}}/>我主动选择在海报中显示本次问题</label><div className="record-actions"><Button className="secondary" onClick={generate} busy={busy}>生成 PNG 海报</Button>{url?<a className="button" href={url} download={'star-oracle-'+reading.id.slice(0,8)+'.png'}><Download size={16}/>保存图片</a>:null}</div><Notice error={error}/>{url?<><img className="poster-preview" src={url} alt={includeQuestion?'包含本次问题的占卜分享海报预览':'不含问题的占卜分享海报预览'}/><p className="muted small">手机也可以长按预览图片保存。</p></>:null}</details>;
}
