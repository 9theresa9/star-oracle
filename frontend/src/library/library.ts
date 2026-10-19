import {TAROT_LIBRARY,HEXAGRAM_LIBRARY} from '../../../packages/domain/index.js';
export type LibraryTab='tarot'|'iching';
export const suits=Array.from(new Set(TAROT_LIBRARY.map(card=>card.suit??'major')));
const suitNames:Record<string,string>={wands:'权杖',cups:'圣杯',swords:'宝剑',pentacles:'星币',major:'大阿卡纳'};
export const suitLabel=(suit:string)=>suitNames[suit]??suit;
export const maskLines=(mask:number)=>Array.from({length:6},(_,index)=>(mask>>index)&1?7:8);
export const libraryTab=(query:string):LibraryTab=>new URLSearchParams(query).get('tab')==='iching'?'iching':'tarot';
export function tabQuery(query:string,tab:LibraryTab){const params=new URLSearchParams(query);params.set('tab',tab);return params.toString();}
export function filterCards(search:string,suit:string){
 const q=search.trim().toLocaleLowerCase();
 return TAROT_LIBRARY.filter(card=>(suit==='all'||(card.suit??'major')===suit)&&(!q||[card.name,card.en,card.description,...card.upright,...card.reversed].join(' ').toLocaleLowerCase().includes(q)));
}
export function filterHexagrams(search:string){
 const q=search.trim().toLocaleLowerCase();
 return HEXAGRAM_LIBRARY.filter(item=>!q||[item.name,String(item.number),item.theme,item.description,...item.keywords,item.lower.name,item.upper.name].join(' ').toLocaleLowerCase().includes(q));
}
