import { useEffect,useState,useRef } from 'react';
import { Download,Share,X,PlusSquare } from 'lucide-react';
import { Button,Notice } from './ui';
import '../pages/management.css';
type InstallPrompt=Event&{prompt:()=>Promise<void>;userChoice:Promise<{outcome:'accepted'|'dismissed';platform:string}>};
export function InstallApp(){
 const [prompt,setPrompt]=useState<InstallPrompt|null>(null),[open,setOpen]=useState(false),[installed,setInstalled]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState<unknown>(null);
 const dialog=useRef<HTMLDivElement>(null);
 const isiOS=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
 useEffect(()=>{
  const standalone=window.matchMedia('(display-mode: standalone)');setInstalled(standalone.matches||!!(navigator as Navigator&{standalone?:boolean}).standalone);
  const capture=(event:Event)=>{event.preventDefault();setPrompt(event as InstallPrompt);};
  const done=()=>{setInstalled(true);setPrompt(null);setOpen(false);};
  window.addEventListener('beforeinstallprompt',capture);window.addEventListener('appinstalled',done);
  if('serviceWorker' in navigator&&window.isSecureContext)void navigator.serviceWorker.register('/sw.js',{scope:'/',updateViaCache:'none'}).catch(()=>{/* Installation remains optional when browser storage is unavailable. */});
  return ()=>{window.removeEventListener('beforeinstallprompt',capture);window.removeEventListener('appinstalled',done);};
 },[]);
 useEffect(()=>{
  if(!open)return;const previous=document.activeElement as HTMLElement|null;dialog.current?.querySelector<HTMLButtonElement>('button')?.focus();
  const keys=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();setOpen(false);return;}if(event.key!=='Tab')return;const buttons=Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),[tabindex="0"]')??[]);const first=buttons[0],last=buttons[buttons.length-1];if(!first)return;if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}};
  document.addEventListener('keydown',keys);return ()=>{document.removeEventListener('keydown',keys);previous?.focus();};
 },[open]);
 async function install(){if(!prompt){setOpen(true);return;}setBusy(true);setError(null);try{await prompt.prompt();const result=await prompt.userChoice;if(result.outcome==='accepted')setOpen(false);setPrompt(null);}catch(e){setError(e);}finally{setBusy(false);}}
 if(installed)return null;
 return <div className="install-app"><button className="install-trigger" onClick={()=>setOpen(true)}><Download size={15}/>添加到手机桌面</button>{open?<div className="install-overlay" role="dialog" aria-modal="true" aria-labelledby="install-title"><div className="install-card form-panel" ref={dialog}><button className="icon-button install-close" aria-label="关闭安装说明" onClick={()=>setOpen(false)}><X size={18}/></button><span className="eyebrow">ONE TAP TO YOUR UNIVERSE</span><h2 id="install-title">把星空，留在桌面。</h2><p className="muted">使用桌面入口快速打开照见。占卜记录、登录与 AI 仍需联网。</p>{prompt?<Button busy={busy} onClick={()=>void install()}><Download size={16}/>添加照见</Button>:isiOS?<ol className="install-steps"><li>在 Safari 中打开此网站。</li><li>轻点浏览器的<Share size={15} aria-label="分享"/>分享按钮。</li><li>选择<PlusSquare size={15} aria-label="添加"/>“添加到主屏幕”，然后确认。</li></ol>:<p>在浏览器菜单中查找“安装应用”或“添加到主屏幕”。不同浏览器的名称可能不同；如果没有该选项，也可以保存书签。</p>}<p className="small muted">需要 HTTPS 网站和支持的浏览器。安装是可选的，离线时无法读取私人内容。</p><Notice error={error}/><Button className="secondary" onClick={()=>setOpen(false)}>知道了</Button></div></div>:null}</div>;
}
