import { useEffect,useState,useRef,type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight,LoaderCircle,Check,Copy } from 'lucide-react';
export function Button({children,busy=false,...props}:React.ButtonHTMLAttributes<HTMLButtonElement>&{busy?:boolean}) {
 return <button {...props} disabled={busy||props.disabled} className={'button '+(props.className??'')}>{busy?<LoaderCircle size={17} className="spin"/>:null}{children}</button>;
}
export function Notice({error}:{error:unknown}) {return error?<p className="notice" role="alert">{error instanceof Error?error.message:String(error)}</p>:null;}
export function Empty({title,children}:{title:string;children:ReactNode}) {return <div className="empty"><span className="eyebrow">A LITTLE SPACE</span><h2>{title}</h2><p>{children}</p></div>;}
export function LoginPrompt(){return <Empty title="为你的故事，留一个位置">登录后即可同步占卜记录和私人日记。<br/><Link className="button" to="/account">使用预先创建的账户登录 <ArrowUpRight size={16}/></Link></Empty>;}
export function CopyButton({text}:{text:string}){
 const [done,setDone]=useState(false),[error,setError]=useState(false);
 const timer=useRef<ReturnType<typeof setTimeout>|null>(null),mounted=useRef(false);
 useEffect(()=>{mounted.current=true;return ()=>{mounted.current=false;if(timer.current!==null)clearTimeout(timer.current);};},[]);
 return <><button className="icon-button" aria-label="复制解读" onClick={async()=>{try{await navigator.clipboard.writeText(text);if(!mounted.current)return;if(timer.current!==null)clearTimeout(timer.current);setDone(true);setError(false);timer.current=setTimeout(()=>{timer.current=null;setDone(false);},1800);}catch{if(mounted.current)setError(true);}}}>{done?<Check size={18}/>:<Copy size={18}/>}</button>{error?<textarea aria-label="手动复制解读" readOnly value={text}/>:null}</>;
}
export function Reveal({children,className=''}:{children:ReactNode;className?:string}){
 return <div className={'reveal visible '+className}>{children}</div>;
}
