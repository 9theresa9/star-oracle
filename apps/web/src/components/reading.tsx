import { TAROT_DECK,SPREADS,evidenceFor,basicInterpretation,readingText,analyseLines,type Reading,type Interpretation } from '@star-oracle/domain';
import { CopyButton } from './ui';
import { Link } from 'react-router-dom';
import { useSession } from '../lib/session';
import { SharePoster } from './share-poster';
import '../pages/divination.css';

/** Original, deterministic line art. No third-party card images or fonts. */
export function CardArt({id,reversed=false,back=false}:{id:string;reversed?:boolean;back?:boolean}){
 const seed=Array.from(id).reduce((n,c)=>n+c.charCodeAt(0),0),petals=back?8:5+seed%5,card=TAROT_DECK.find(c=>c.id===id),english=card?.en.toLowerCase()??'';
 const suit=english.includes('wands')?'wands':english.includes('cups')?'cups':english.includes('swords')?'swords':english.includes('pentacles')?'pentacles':'major';
 return <svg className={'oracle-card-art '+(reversed?'art-reversed':'')} viewBox="0 0 160 220" aria-hidden="true" focusable="false">
  <g fill="none" stroke="currentColor" strokeWidth="1"><rect x="8" y="8" width="144" height="204" rx="8" opacity=".35"/><path d="M22 32h16M30 24v16M122 188h16M130 180v16" opacity=".6"/><ellipse cx="80" cy="108" rx="48" ry="69" opacity=".3"/><circle cx="80" cy="108" r="39" opacity=".65"/>{Array.from({length:petals},(_,i)=><path key={i} d="M80 64Q112 92 80 108Q48 92 80 64" transform={'rotate('+(i*360/petals)+' 80 108)'} opacity={back?'.42':'.7'}/>)}
   {back?<><circle cx="80" cy="108" r="20"/><path d="M80 88l5 15 15 5-15 5-5 15-5-15-15-5 15-5Z"/></>:<><path d={'M80 77L'+(102+seed%6)+' 119H'+(58-seed%6)+'Z'} fill="currentColor" fillOpacity=".08"/><circle cx="80" cy="106" r="8" fill="currentColor" fillOpacity=".22"/>{suit==='wands'?<path d="M77 137l6-58M83 89q17-9 18-21M79 108q-17-8-19-20" strokeWidth="2"/>:suit==='cups'?<path d="M61 91h38v17q0 22-19 22t-19-22ZM80 130v15M65 145h30M99 95h8v11q0 12-8 12" strokeWidth="2"/>:suit==='swords'?<path d="M80 73l-7 14v40h14V87ZM62 127h36M80 127v24M73 151h14" strokeWidth="2"/>:suit==='pentacles'?<path d="M80 78l9 23h25l-20 15 8 24-22-15-22 15 8-24-20-15h25Z" strokeWidth="1.6"/>:null}<path d="M54 164h52M64 172h32" opacity=".5"/></>}
   <circle cx="80" cy="34" r="3"/><circle cx="80" cy="185" r="2"/>
  </g>
 </svg>;
}
export function Card({id,reversed=false,index=0,position,revealed=true,onReveal}:{id:string;reversed?:boolean;index?:number;position?:string;revealed?:boolean;onReveal?:()=>void}){
 const card=TAROT_DECK.find(c=>c.id===id);
 if(!card)return <div className="card-wrap"><p>牌面暂不可用</p></div>;
 const art=<><CardArt id={id} reversed={revealed&&reversed} back={!revealed}/><span className="card-number">{revealed?card.en:'STAR ORACLE'}</span></>;
 return <div className={'card-wrap '+(revealed?'is-revealed':'is-covered')} style={{animationDelay:Math.min(index,8)*70+'ms'}}>
  {position?<p className="card-position"><span>{String(index+1).padStart(2,'0')}</span>{position}</p>:null}
  {onReveal?<button type="button" className={'tarot-card card-flip '+(revealed&&reversed?'reversed':'')} disabled={revealed} aria-label={revealed?card.name+' · '+(reversed?'逆位':'正位'):'翻开第 '+(index+1)+' 张牌'+(position?'：'+position:'')} onClick={onReveal}>{art}</button>:<div className={'tarot-card '+(reversed?'reversed':'')}>{art}</div>}
  <h3>{revealed?card.name:'轻触翻开'}</h3><p>{revealed?(reversed?'逆位':'正位'):'给自己一个停顿'}</p>
 </div>;
}
export function Hexagram({lines,revealed=6,compact=false,label='从下到上的六爻'}:{lines:readonly number[];revealed?:number;compact?:boolean;label?:string}){
 return <div className={'hexagram '+(compact?'hex-compact':'')} aria-label={label} role="img"><span className="hex-label">上</span>{[...lines].reverse().map((value,i)=><div key={i} className={(compact?'aux-hex-line ':'hex-line ')+(5-i<revealed?'shown':'hidden')}><span className={'yao '+(value%2?'yang':'yin')}><i/><i/></span><b>{value===6||value===9?'◦':''}</b></div>)}<span className="hex-label">初</span></div>;
}
function maskLines(mask:number){return Array.from({length:6},(_,i)=>(mask>>i)&1?7:8);}
export function ReadingView({reading,interpretation,ai=false,revealedCards,onReveal}:{reading:Reading;interpretation?:Interpretation;ai?:boolean;revealedCards?:boolean[];onReveal?:(index:number)=>void}){
 const {user}=useSession();
 const result=interpretation??basicInterpretation(reading),evidence=evidenceFor(reading),hex=reading.kind==='iching'?analyseLines(reading.lines):null;
 const spread=reading.kind==='tarot'?SPREADS[reading.spread]:null;
 return <div className="reading-view"><div className="reading-top"><span className="eyebrow">{ai?'AI · 有据解读':'SYMBOLS · 基础解读'}</span><CopyButton text={readingText(reading,result)}/></div><h2 className="question">{reading.question}</h2>
 {reading.kind==='tarot'?<><p className="reading-method">{spread?.name??'塔罗牌阵'} · {reading.cards.length} 张牌</p><div className={'card-row extended-card-row '+(reading.cards.length>3?'many-cards':'')}>{reading.cards.map((card,i)=><Card key={i+'-'+card.id} {...card} index={i} position={spread?.positions[i]??'第 '+(i+1)+' 张'} revealed={revealedCards?.[i]??true} onReveal={onReveal?()=>onReveal(i):undefined}/>)}</div></>:hex?<><Hexagram lines={reading.lines}/><p className="hex-title">{evidence.map(e=>e.position+' · '+e.name).join(' → ')}</p><p className="muted">{hex.moving.length?'动爻（由下而上）：'+hex.moving.join('、'):'本次没有动爻'}</p>
  <p className="reading-method">{reading.method==='numbers'?'数字起卦 · 现代数字规则':reading.method==='time'?'时间起卦 · 上海公历简化规则':'三枚硬币法 · 六次由下而上'}</p>
  <div className="trigram-pair"><span>下卦 · {hex.original.lower.name}</span><span>上卦 · {hex.original.upper.name}</span></div>
  <details className="oracle-details"><summary>展开互卦、错卦与综卦</summary><p className="muted small">这些辅助卦提供观察角度，不代表额外确定的预测。</p><div className="aux-hex-grid">{[['互卦',hex.mutual],['错卦',hex.opposite],['综卦',hex.reversed]].map(([label,item])=>{const value=item as typeof hex.original;return <div className="aux-hex" key={String(label)}><span className="eyebrow">{String(label)}</span><Hexagram lines={maskLines(value.mask)} compact label={String(label)+' '+value.name}/><h3>{value.number} · {value.name}</h3><p>{value.theme}</p></div>;})}</div></details>
 </>:null}
 <div className="interpretation"><p className="summary">{result.summary}</p>{result.insights.map((item,i)=><p key={item.reference+'-'+i}>{item.text}</p>)}<div className="action-box"><span className="eyebrow">ONE SMALL STEP</span><h3>把一点光，带回生活</h3>{result.actions.map((action,i)=><p key={i}>✧ {action}</p>)}</div><p className="reflection">{result.reflection}</p></div>
 <SharePoster reading={reading}/>{user?<Link className="text-link" to={'/actions?readingId='+encodeURIComponent(reading.id)}>把建议整理成行动计划 →</Link>:null}<p className="disclaimer">供自我反思与娱乐，选择始终在你手中。医疗、法律和财务决定请咨询合适的专业人士。</p></div>;
}
