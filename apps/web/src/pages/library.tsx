import { useMemo,useState } from 'react';
import { useSearchParams,Link } from 'react-router-dom';
import { Search,ArrowUpRight,BookOpen } from 'lucide-react';
import { TAROT_LIBRARY,HEXAGRAM_LIBRARY } from '@star-oracle/domain';
import { CardArt,Hexagram } from '../components/reading';
import { OracleModal } from '../components/oracle-modal';
import { Reveal } from '../components/ui';
import './divination.css';
type TarotEntry=(typeof TAROT_LIBRARY)[number];
type HexEntry=(typeof HEXAGRAM_LIBRARY)[number];
const suitNames:Record<string,string>={wands:'权杖',cups:'圣杯',swords:'宝剑',pentacles:'星币',major:'大阿卡纳'};
const suitLabel=(suit:string)=>suitNames[suit]??suit;
function lines(mask:number){return Array.from({length:6},(_,i)=>(mask>>i)&1?7:8);}
export function Library(){
 const [params,setParams]=useSearchParams(),tab=params.get('tab')==='iching'?'iching':'tarot';
 const [search,setSearch]=useState(''),[suit,setSuit]=useState('all'),[tarot,setTarot]=useState<TarotEntry|null>(null),[hex,setHex]=useState<HexEntry|null>(null);
 const suits=Array.from(new Set(TAROT_LIBRARY.map(card=>card.suit??'major')));
 const cards=useMemo(()=>{const q=search.trim().toLocaleLowerCase();return TAROT_LIBRARY.filter(card=>(suit==='all'||(card.suit??'major')===suit)&&(!q||[card.name,card.en,card.description,...card.upright,...card.reversed].join(' ').toLocaleLowerCase().includes(q)));},[search,suit]);
 const hexagrams=useMemo(()=>{const q=search.trim().toLocaleLowerCase();return HEXAGRAM_LIBRARY.filter(item=>!q||[item.name,String(item.number),item.theme,item.description,...item.keywords,item.lower.name,item.upper.name].join(' ').toLocaleLowerCase().includes(q));},[search]);
 function switchTab(next:string){const value=new URLSearchParams(params);value.set('tab',next);setParams(value);setSearch('');}
 return <Reveal className="page library-page"><span className="eyebrow">A FIELD GUIDE / SYMBOLS & CHANGE</span><h1>认识象征，也认识自己。</h1><p className="page-intro">78 张塔罗牌，64 卦。把抽象的符号，读成可以思考和实践的问题。</p><div className="library-topline"><div className="segmented library-tabs" aria-label="图鉴类型"><button type="button" aria-pressed={tab==='tarot'} className={tab==='tarot'?'selected':''} onClick={()=>switchTab('tarot')}>塔罗 · 78 张</button><button type="button" aria-pressed={tab==='iching'} className={tab==='iching'?'selected':''} onClick={()=>switchTab('iching')}>易经 · 64 卦</button></div><Link className="text-link" to="/tutorials"><BookOpen size={15}/>从入门开始</Link></div>
 <div className="library-search"><Search size={18} aria-hidden="true"/><label className="sr-only" htmlFor="library-search">搜索图鉴</label><input id="library-search" type="search" value={search} onChange={e=>setSearch(e.target.value)} maxLength={100} placeholder={tab==='tarot'?'搜索牌名、英文名或关键词':'搜索卦名、卦序、关键词或八卦'}/></div>
 {tab==='tarot'?<div className="spread-filters" aria-label="塔罗牌分类"><button type="button" aria-pressed={suit==='all'} className={suit==='all'?'active':''} onClick={()=>setSuit('all')}>全部</button>{suits.map(value=><button type="button" key={value} aria-pressed={suit===value} className={suit===value?'active':''} onClick={()=>setSuit(value)}>{suitLabel(value)}</button>)}</div>:null}
 <p className="library-result-count" role="status">找到 {tab==='tarot'?cards.length:hexagrams.length} 项 · 选择一项查看完整说明</p>
 {tab==='tarot'?<div className="library-grid tarot-library-grid">{cards.map(card=><button type="button" className="library-tarot" key={card.id} onClick={()=>setTarot(card)} aria-label={'查看 '+card.name+' 的含义'}><div className="library-card-art"><CardArt id={card.id}/></div><span className="eyebrow">{suitLabel(card.suit??'major')}</span><h2>{card.name}</h2><p>{card.upright.slice(0,3).join(' · ')}</p><ArrowUpRight size={16} className="library-arrow"/></button>)}</div>:<div className="library-grid hex-library-grid">{hexagrams.map(item=><button type="button" className="library-hex" key={item.number} onClick={()=>setHex(item)} aria-label={'查看第 '+item.number+' 卦 '+item.name}><Hexagram lines={lines(item.mask)} compact label={item.name+' 六爻'}/><span className="eyebrow">第 {String(item.number).padStart(2,'0')} 卦</span><h2>{item.name}</h2><p>{item.theme}</p><ArrowUpRight size={16} className="library-arrow"/></button>)}</div>}
 {(tab==='tarot'&&!cards.length)||(tab==='iching'&&!hexagrams.length)?<div className="empty"><h2>换一个词，再找找。</h2><p>试试牌名、卦名，或“沟通”“变化”这样的关键词。</p></div>:null}
 <p className="disclaimer">图鉴采用现代反思式说明，不将牌意或卦意视为确定事实。牌面图案为本站原创几何线稿。</p>
 {tarot?<OracleModal title={tarot.name+' · 塔罗图鉴'} onClose={()=>setTarot(null)}><div className="library-detail-hero"><div className="library-card-art"><CardArt id={tarot.id}/></div><div><span className="eyebrow">{tarot.en} · {tarot.element}</span><h2>{tarot.name}</h2><p>{tarot.description}</p></div></div><div className="meaning-columns"><section><h3>正位 · 可以看见的力量</h3><p className="keyword-line">{tarot.upright.join(' · ')}</p><p>{tarot.uprightMeaning}</p></section><section><h3>逆位 · 值得重新照顾的部分</h3><p className="keyword-line">{tarot.reversed.join(' · ')}</p><p>{tarot.reversedMeaning}</p></section></div><section className="library-detail-section"><h3>象征线索</h3><p>{tarot.symbolism}</p></section><div className="action-box"><h3>一个小练习</h3><p>{tarot.practice}</p><p className="reflection">{tarot.reflection}</p></div><Link className="button" to="/tarot" onClick={()=>setTarot(null)}>带着一个问题去探索 <ArrowUpRight size={16}/></Link></OracleModal>:null}
 {hex?<OracleModal title={hex.name+' · 易经图鉴'} onClose={()=>setHex(null)}><div className="library-detail-hero hex-detail-hero"><Hexagram lines={lines(hex.mask)} compact label={hex.name+' 六爻'}/><div><span className="eyebrow">第 {hex.number} 卦 · 下{hex.lower.name}上{hex.upper.name}</span><h2>{hex.name}</h2><p>{hex.description}</p></div></div><p className="keyword-line">{hex.keywords.join(' · ')}</p><section className="library-detail-section"><h3>当下可以怎样理解</h3><p>{hex.guidance}</p></section><div className="action-box"><h3>给自己的一个问题</h3><p>{hex.prompt}</p></div><p className="muted small">这里是现代语言的学习提示，不是古籍原文。上、下卦与卦序依六爻结构列出。</p><Link className="button" to="/iching" onClick={()=>setHex(null)}>观察一次变化 <ArrowUpRight size={16}/></Link></OracleModal>:null}
 </Reveal>;
}
