import {useEffect,useLayoutEffect,useRef,useState,type FormEvent} from 'react';
import {useNavigate,Link} from 'react-router-dom';
import {QRCodeSVG} from 'qrcode.react';
import {ArrowLeft,ArrowUpRight,Eye,EyeOff,LockKeyhole,ShieldCheck,Download,LogOut} from 'lucide-react';
import {api} from '../lib/api';
import {identityBoundary,IdentityChangedError} from '../lib/session-identity';
import {authClient} from '../lib/auth-client';
import {useSession} from '../lib/session';
import {Button,Notice} from '../components/ui';
import {Observatory} from '../components/observatory';
import './management.css';
import './account.css';
function PasswordField({id,label,value,onChange}:{id:string;label:string;value:string;onChange:(value:string)=>void}){
 const [visible,setVisible]=useState(false);
 useEffect(()=>{if(!value)setVisible(false);},[value]);
 return <div className="password-field"><label htmlFor={id}>{label}</label><div><input id={id} type={visible?'text':'password'} autoComplete="current-password" value={value} onChange={e=>onChange(e.target.value)} minLength={12} maxLength={128} required/><button type="button" className="password-toggle" aria-label={visible?'隐藏'+label:'显示'+label} aria-pressed={visible} onClick={()=>setVisible(!visible)}>{visible?<EyeOff size={18}/>:<Eye size={18}/>}</button></div></div>;
}
async function accountAction<T>(action:(options:{headers:Record<string,string>;signal:AbortSignal})=>Promise<T>):Promise<T>{
 const owner=identityBoundary.capture(),controller=new AbortController(),untrack=identityBoundary.track(owner,controller);
 try{const result=await action({headers:{'X-Expected-Actor':owner.id,'X-Expected-Session':owner.sessionBinding},signal:controller.signal});identityBoundary.assert(owner);if(result&&typeof result==='object'&&'error' in result){const error=result.error as {status?:number;code?:string}|null;if(error?.status===401||error?.code==='SESSION_CHANGED'){identityBoundary.revoke();window.dispatchEvent(new Event('oracle:session-invalid'));throw new IdentityChangedError();}}return result;}finally{untrack();}
}
export function Account(){
 const {user,pending,error:sessionError,generation,refresh,signOut,beginAuthChange}=useSession(),navigate=useNavigate();
 const lastGeneration=useRef(generation);
 const [username,setUsername]=useState(''),[password,setPassword]=useState(''),[code,setCode]=useState('');
 const [totp,setTotp]=useState(false),[recovery,setRecovery]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState<unknown>(null);
 const [message,setMessage]=useState(()=>{const params=new URLSearchParams(window.location.search);return params.has('token')||params.has('verified')||['verify','forgot','reset'].includes(params.get('mode')??'')?'邮箱验证与邮件重设密码已停用，请使用管理员提供的用户名和密码登录。':'';});
 const [totpURI,setTotpURI]=useState(''),[backup,setBackup]=useState<string[]>([]),[showBackup,setShowBackup]=useState(false),[backupSaved,setBackupSaved]=useState(false),[backupViewed,setBackupViewed]=useState(false);
 useEffect(()=>{const url=new URL(window.location.href);if(url.searchParams.has('token')){url.searchParams.delete('token');window.history.replaceState(window.history.state,'',url.pathname+url.search+url.hash);}},[]);
 useLayoutEffect(()=>{
  if(lastGeneration.current!==generation){
   setPassword('');setCode('');setTotpURI('');setBackup([]);setShowBackup(false);setBackupSaved(false);setBackupViewed(false);
  }
  lastGeneration.current=generation;
 },[generation]);
 const run=async(fn:()=>Promise<void>)=>{if(busy)return;setBusy(true);setError(null);try{await fn();}catch(e){setError(e);}finally{setBusy(false);}};
 async function submit(e:FormEvent){e.preventDefault();await run(async()=>{
  if(totp){const r=recovery?await authClient.twoFactor.verifyBackupCode({code,trustDevice:false}):await authClient.twoFactor.verifyTotp({code,trustDevice:false});if(r.error)throw new Error(r.error.message);setTotp(false);setCode('');await refresh();navigate('/daily');return;}
  const trimmedUsername=username.trim(),savedPassword=password;
  if(!/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,31}$/.test(trimmedUsername))throw new Error('用户名需为 3–32 位小写英文字母、数字、点、下划线或短横线，并以字母或数字开头。');
  const savedUsername=trimmedUsername.toLowerCase();setUsername(savedUsername);beginAuthChange();
  const r=await authClient.signIn.username({username:savedUsername,password:savedPassword});
  if(r.error){await refresh();throw new Error('登录失败，请检查用户名和密码。');}
  if(r.data&&'twoFactorRedirect' in r.data&&r.data.twoFactorRedirect){setTotp(true);setPassword('');setCode('');return;}
  await refresh();navigate('/daily');
 });}
 const exportData=()=>run(async()=>{const data=await api<Record<string,unknown>>('/me/export');const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='star-oracle-records.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
 const title=totp?'再确认，是你。':'欢迎回到照见',description=totp?(recovery?'输入一条未使用过的恢复码。每条只能使用一次。':'输入身份验证器中的六位验证码，完成安全登录。'):'留一点安静，继续与你自己相遇。';
 const privateAccount=!!user;
 return <div className={'account-layout '+(privateAccount?'signed-in':'')}>
  <aside className="account-story"><div className="account-story-copy"><span className="account-series">照见 · 一处安静的心灵天文台</span><h1>向星光提问，<br/>向自己靠近。</h1><p>一张牌，一次变化，一页心绪。<br/>不急于知道答案，先好好听见自己。</p></div><Observatory/><div className="account-story-foot"><span>让每一次探索，都有回响。</span><span>Star Oracle</span></div></aside>
  <section className="account-content" aria-label={privateAccount?'账户与安全':'账户登录'}>
   {!privateAccount?<div className="account-form-wrap"><Link to="/" className="account-back"><ArrowLeft size={15}/>回到照见</Link><div className="account-form-heading"><span className="account-symbol"><ShieldCheck size={22}/></span><h2>{title}</h2><p>{description}</p></div>
    {pending&&!totp&&!busy?<p role="status" className="account-pending">正在确认账户状态…</p>:<form onSubmit={submit} aria-busy={busy}>
     <fieldset disabled={busy}>
      {totp?<><label htmlFor="code">{recovery?'一次性恢复码':'身份验证器中的六位验证码'}</label><input id="code" type="password" className="otp-input" inputMode={recovery?'text':'numeric'} autoComplete="one-time-code" value={code} onChange={e=>setCode(e.target.value)} pattern={recovery?undefined:'[0-9]{6}'} maxLength={recovery?128:6} required autoFocus/></>:<>
       <label htmlFor="username">用户名</label><input id="username" type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={128} value={username} onChange={e=>setUsername(e.target.value)} required/>
       <PasswordField id="password" label="密码" value={password} onChange={setPassword}/>
      </>}
      <Button type="submit" busy={busy} className="auth-submit">{totp?'确认验证码':'登录'}<ArrowUpRight size={16}/></Button>
     </fieldset>
     <Notice error={error||sessionError}/>{message?<p className="success" role="status">{message}</p>:null}
     {totp?<div className="auth-links"><button type="button" disabled={busy} onClick={()=>{setTotp(false);setCode('');setRecovery(false);void refresh();}}>返回登录</button><button type="button" disabled={busy} onClick={()=>{setRecovery(!recovery);setCode('');setError(null);}}>{recovery?'使用身份验证器':'使用恢复码'}</button></div>:null}
    </form>}
    <p className="account-help">账户由管理员预先创建。忘记密码请联系管理员。</p>
    <p className="account-security-note"><LockKeyhole size={14}/>私人记录默认仅你可见</p><Link className="account-guest" to="/tarot">先体验一次探索</Link>
   </div>:<div className="account-settings"><div className="account-form-heading"><span className="account-symbol"><ShieldCheck size={22}/></span><h2>{user.name}，你好。</h2><p>照看你的账户，也照看自己的记录。</p>{user.username?<div className="account-username">用户名：{user.username}</div>:null}</div>
    <div className="account-destinations"><Link to="/membership">会员与 AI 额度 <ArrowUpRight size={15}/></Link><Link to="/actions">我的行动 <ArrowUpRight size={15}/></Link><Link to="/insights">每周与每月回顾 <ArrowUpRight size={15}/></Link><Link to="/feedback">反馈与回复 <ArrowUpRight size={15}/></Link><Link to="/announcements">公告与使用指引 <ArrowUpRight size={15}/></Link></div>
    <div className="settings-section"><h3>带走你的记录</h3><p className="muted">导出包括私人日记、追问、行动与回顾，请保存到你信任的位置。</p><div className="record-actions"><Button busy={busy} onClick={exportData}><Download size={16}/>导出我的记录</Button><Button className="secondary" busy={busy} onClick={()=>run(async()=>{await signOut();navigate('/');})}><LogOut size={16}/>退出登录</Button></div></div>
    <div className="settings-section"><h3>两步验证</h3><p className="muted">用身份验证器增加一道保护。管理员必须启用两步验证。</p><PasswordField id="current-password" label="当前密码" value={password} onChange={setPassword}/>
     {!user.twoFactorEnabled&&!totpURI?<Button busy={busy} disabled={!password} onClick={()=>run(async()=>{const r=await accountAction(options=>authClient.twoFactor.enable({password,method:'totp'},options));if(r.error)throw new Error(r.error.message);if(r.data.method!=='totp')throw new Error('未能创建身份验证器配置');const displayURI=new URL(r.data.totpURI);displayURI.pathname='/'+encodeURIComponent('照见 Star Oracle:'+(user.username??user.name));setTotpURI(displayURI.href);setBackup(r.data.backupCodes);setShowBackup(false);setBackupSaved(false);setBackupViewed(false);})}>启用两步验证</Button>:null}
     {totpURI?<div className="totp-setup"><QRCodeSVG value={totpURI} title={'身份验证器二维码：'+(user.username??user.name)} size={180} marginSize={3}/><p>用身份验证器扫描，再输入验证码完成启用。二维码含账户密钥，请勿分享。</p><label htmlFor="setup-code">确认两步验证验证码</label><input id="setup-code" type="password" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={e=>setCode(e.target.value)} maxLength={6}/><Button busy={busy} disabled={!/^[0-9]{6}$/.test(code)||!backupSaved} onClick={()=>run(async()=>{const r=await accountAction(options=>authClient.twoFactor.verifyTotp({code},options));if(r.error)throw new Error(r.error.message);setTotpURI('');setPassword('');setCode('');await refresh();setMessage('两步验证已启用。请妥善保管已保存的恢复码。');})}>确认启用</Button>{!backupSaved?<p className="field-hint">请先显示并离线保存下方恢复码，再确认启用。</p>:null}</div>:null}
     {backup.length?<div className="backup-codes"><p>恢复码仅在这里展示。每条只能使用一次，请离线妥善保存。</p>{showBackup?<code>{backup.join('\n')}</code>:<p aria-label="恢复码已隐藏">•••••••• &nbsp; ••••••••</p>}<Button className="secondary" onClick={()=>{if(!showBackup)setBackupViewed(true);setShowBackup(!showBackup);}}>{showBackup?'隐藏恢复码':'显示恢复码'}</Button><Button className="secondary" disabled={!backupViewed} onClick={()=>{setBackup([]);setShowBackup(false);setBackupSaved(true);}}>我已妥善保存</Button></div>:null}
     {user.twoFactorEnabled?<><p className="success">两步验证已启用。</p><Button className="secondary" busy={busy} disabled={!password} onClick={()=>run(async()=>{const r=await accountAction(options=>authClient.twoFactor.disable({password},options));if(r.error)throw new Error(r.error.message);setPassword('');await refresh();})}>关闭两步验证</Button></>:null}
    </div>
    <div className="settings-section account-danger"><h3>删除账户</h3><p>永久删除账户、占卜记录、日记、追问、行动与回顾，无法撤销。请先在上方输入当前密码。</p><Button className="danger" busy={busy} disabled={!password} onClick={()=>{if(window.confirm('永久删除账户及全部私人记录？此操作无法撤销。'))void run(async()=>{const savedPassword=password;const r=await accountAction(options=>authClient.deleteUser({password:savedPassword},options));await refresh();if(r.error)throw new Error(r.error.message);navigate('/');});}}>删除账户与全部记录</Button></div>
    <Notice error={error||sessionError}/>{message?<p className="success" role="status">{message}</p>:null}
   </div>}
  </section>
 </div>;
}
