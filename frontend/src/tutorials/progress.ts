import {computed,shallowRef,watch,type Ref} from 'vue';
import {TUTORIALS} from '../../../packages/domain/index.js';

export interface ProgressStorage {getItem(key:string):string|null;setItem(key:string,value:string):void}
export function readProgress(storage:ProgressStorage|null,key:string):Set<string>{
 try{const value=JSON.parse(storage?.getItem(key)??'[]');return new Set<string>(Array.isArray(value)?value.filter((item:unknown)=>typeof item==='string'):[]);}catch{return new Set<string>();}
}
export function browserProgressStorage():ProgressStorage|null {try{return typeof window==='undefined'?null:window.localStorage;}catch{return null;}}
export function tutorialsFor(category:string){return TUTORIALS.filter(item=>category==='all'||item.category===category);}
export function useTutorialProgress(actor:Readonly<Ref<string|null>>,storage:ProgressStorage|null){
 const key=()=> 'star-oracle-tutorials-'+(actor.value??'guest');
 const completed=shallowRef<ReadonlySet<string>>(readProgress(storage,key()));
 watch(actor,()=>{completed.value=readProgress(storage,key());},{flush:'sync'});
 const total=TUTORIALS.reduce((sum,tutorial)=>sum+tutorial.steps.length,0);
 const done=computed(()=>TUTORIALS.reduce((sum,tutorial)=>sum+tutorial.steps.filter((_,index)=>completed.value.has(tutorial.id+':'+index)).length,0));
 function toggle(id:string){
  const next=new Set(completed.value);next.has(id)?next.delete(id):next.add(id);
  try{storage?.setItem(key(),JSON.stringify([...next]));}catch{}
  completed.value=next;
 }
 return {completed,done,total,toggle};
}
