import { TAROT_DECK,evidenceFor,basicInterpretation,readingText,analyseLines,type Reading,type Interpretation } from '@star-oracle/domain';
import { CopyButton } from './ui';
export function Card({id,reversed=false,index=0}:{id:string;reversed?:boolean;index?:number}){
 const card=TAROT_DECK.find(c=>c.id===id)!;
 return <div className="card-wrap" style={{animationDelay:index*140+'ms'}}><div className={'tarot-card '+(reversed?'reversed':'')}><span className="card-corner">✦</span><span className="card-orbit"/><span className="card-symbol">{card.mark}</span><span className="card-number">{card.en}</span><span className="card-corner bottom">✦</span></div><h3>{card.name}</h3><p>{reversed?'逆位':'正位'}</p></div>;
}
export function Hexagram({lines,revealed=6}:{lines:number[];revealed?:number}){
 return <div className="hexagram" aria-label="从下到上的六爻"><span className="hex-label">上</span>{[...lines].reverse().map((value,i)=><div key={i} className={'hex-line '+(5-i<revealed?'shown':'hidden')}><span className={'yao '+(value%2?'yang':'yin')}><i/><i/></span><b>{value===6||value===9?'◦':''}</b></div>)}<span className="hex-label">初</span></div>;
}
export function ReadingView({reading,interpretation,ai=false}:{reading:Reading;interpretation?:Interpretation;ai?:boolean}){
 const result=interpretation??basicInterpretation(reading),evidence=evidenceFor(reading);
 return <div className="reading-view"><div className="reading-top"><span className="eyebrow">{ai?'AI · 有据解读':'SYMBOLS · 基础解读'}</span><CopyButton text={readingText(reading,result)}/></div><h2 className="question">{reading.question}</h2>{reading.kind==='tarot'?<div className="card-row">{reading.cards.map((card,i)=><Card key={card.id} {...card} index={i}/>)}</div>:<><Hexagram lines={reading.lines}/><p className="hex-title">{evidence.map(e=>e.position+' · '+e.name).join(' → ')}</p><p className="muted">{analyseLines(reading.lines).moving.length?'动爻：'+analyseLines(reading.lines).moving.join('、'):'本次没有动爻'}</p></>}<div className="interpretation"><p className="summary">{result.summary}</p>{result.insights.map(item=><p key={item.reference}>{item.text}</p>)}<div className="action-box"><span className="eyebrow">ONE SMALL STEP</span><h3>把一点光，带回生活</h3>{result.actions.map(action=><p key={action}>✧ {action}</p>)}</div><p className="reflection">{result.reflection}</p></div><p className="disclaimer">供自我反思与娱乐，选择始终在你手中。</p></div>;
}
