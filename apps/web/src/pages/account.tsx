import {useEffect,useLayoutEffect,useRef,useState,type FormEvent} from 'react';
import {useNavigate,Link} from 'react-router-dom';
import {QRCodeSVG} from 'qrcode.react';
import {ArrowLeft,ArrowUpRight,Eye,EyeOff,LockKeyhole,ShieldCheck,Download,LogOut,Mail} from 'lucide-react';
import {api} from '../lib/api';
import {identityBoundary,IdentityChangedError} from '../lib/session-identity';
import {authClient} from '../lib/auth-client';
import {useSession} from '../lib/session';
import {Button,Notice} from '../components/ui';
import {Observatory} from '../components/observatory';
import './management.css';
import './account.css';
type Mode='login'|'signup'|'forgot'|'reset'|'verify';
function PasswordField({id,label,value,onChange,newPassword=false}:{id:string;label:string;value:string;onChange:(value:string)=>void;newPassword?:boolean}){
 const [visible,setVisible]=useState(false);
 useEffect(()=>{if(!value)setVisible(false);},[value]);
 return <div className="password-field"><label htmlFor={id}>{label}</label><div><input id={id} type={visible?'text':'password'} autoComplete={newPassword?'new-password':'current-password'} value={value} onChange={e=>onChange(e.target.value)} minLength={12} maxLength={128} required/><button type="button" className="password-toggle" aria-label={visible?'隐藏'+label:'显示'+label} aria-pressed={visible} onClick={()=>setVisible(!visible)}>{visible?<EyeOff size={18}/>:<Eye size={18}/>}</button></div></div>;
}
async function accountAction<T>(action:(options:{headers:Record<string,string>;signal:AbortSignal})=>Promise<T>):Promise<T>{
 const owner=identityBoundary.capture(),controller=new AbortController(),untrack=identityBoundary.track(owner,controller);
 try{const result=await action({headers:{'X-Expected-Actor':owner.id,'X-Expected-Session':owner.sessionBinding},signal:controller.signal});identityBoundary.assert(owner);if(result&&typeof result==='object'&&'error' in result){const error=result.error as {status?:number;code?:string}|null;if(error?.status===401||error?.code==='SESSION_CHANGED'){identityBoundary.revoke();window.dispatchEvent(new Event('oracle:session-invalid'));throw new IdentityChangedError();}}return result;}finally{untrack();}
}
export function Account(){
 const {user,pending,error:sessionError,generation,refresh,signOut,beginAuthChange}=useSession(),navigate=useNavigate();
 const [token,setToken]=useState(()=>new URLSearchParams(window.location.search).get('token')??'');
 const hadVerifiedIdentity=useRef(false),lastGeneration=useRef(generation);
 const [mode,setMode]=useState<Mode>(()=>token?'reset':new URLSearchParams(window.location.search).get('mode')==='verify'?'verify':'login');
 const [name,setName]=useState(''),[email,setEmail]=useState(''),[password,setPassword]=useState(''),[code,setCode]=useState('');
 const [totp,setTotp]=useState(false),[recovery,setRecovery]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState<unknown>(null);
 const [message,setMessage]=useState(()=>new URLSearchParams(window.location.search).get('verified')==='true'?'邮箱验证已完成，可以登录了。':'');
 const [totpURI,setTotpURI]=useState(''),[backup,setBackup]=useState<string[]>([]),[showBackup,setShowBackup]=useState(false),[showEmail,setShowEmail]=useState(false),[backupSaved,setBackupSaved]=useState(false),[backupViewed,setBackupViewed]=useState(false);
 useEffect(()=>{const url=new URL(window.location.href);if(url.searchParams.has('token')){url.searchParams.delete('token');window.history.replaceState(window.history.state,'',url.pathname+url.search+url.hash);}},[]);
 useLayoutEffect(()=>{
  if(lastGeneration.current!==generation){
   setPassword('');setCode('');setTotpURI('');setBackup([]);setShowBackup(false);setShowEmail(false);setBackupSaved(false);setBackupViewed(false);
   if(hadVerifiedIdentity.current&&token){setToken('');setMode('login');}
  }
  lastGeneration.current=generation;if(!pending)hadVerifiedIdentity.current=true;
 },[generation,pending,token]);
 const changeMode=(next:Mode)=>{if(mode==='reset')setToken('');setMode(next);setPassword('');setCode('');setError(null);setMessage('');setRecovery(false);};
 const run=async(fn:()=>Promise<void>)=>{if(busy)return;setBusy(true);setError(null);try{await fn();}catch(e){setError(e);}finally{setBusy(false);}};
 const callbackURL=window.location.origin+'/account?verified=true';
 async function submit(e:FormEvent){e.preventDefault();await run(async()=>{
  if(totp){const r=recovery?await authClient.twoFactor.verifyBackupCode({code,trustDevice:false}):await authClient.twoFactor.verifyTotp({code,trustDevice:false});if(r.error)throw new Error(r.error.message);setTotp(false);setCode('');await refresh();navigate('/daily');return;}
  if(mode==='signup'){
   const r=await authClient.signUp.email({name,email,password,callbackURL});if(r.error)throw new Error(r.error.message);
   // Keep a consistent explicit sign-in flow if verification is disabled in a local test environment.
   if(r.data?.token){const logout=await authClient.signOut();if(logout.error)throw new Error(logout.error.message);}
   await refresh();setPassword('');setMode('login');setMessage('账户创建请求已提交。如果邮箱可用，请查看验证邮件，再回到这里登录。');return;
  }
  if(mode==='forgot'){const r=await authClient.requestPasswordReset({email,redirectTo:window.location.origin+'/account'});if(r.error)throw new Error(r.error.message);setMessage('如果该邮箱已注册，你会收到重设密码的邮件。也请检查垃圾邮件。');return;}
  if(mode==='verify'){const r=await authClient.sendVerificationEmail({email,callbackURL});if(r.error)throw new Error('暂时无法发送验证邮件，请稍后重试。');setMessage('如果该邮箱仍需验证，你会收到新的验证邮件。');return;}
  if(mode==='reset'){if(!token)throw new Error('重设链接无效，请重新申请邮件。');const savedPassword=password;const r=await authClient.resetPassword({token,newPassword:savedPassword});if(r.error)throw new Error(r.error.message);setToken('');setPassword('');setMode('login');await refresh();setMessage('密码已更新，请使用新密码登录。');return;}
  const savedEmail=email,savedPassword=password;beginAuthChange();
  const r=await authClient.signIn.email({email:savedEmail,password:savedPassword});
  if(r.error){await refresh();throw new Error('登录失败，请检查邮箱、密码和邮件验证状态。');}
  if(r.data&&'twoFactorRedirect' in r.data&&r.data.twoFactorRedirect){setTotp(true);setPassword('');setCode('');return;}
  await refresh();navigate('/daily');
 });}
 const exportData=()=>run(async()=>{const data=await api<Record<string,unknown>>('/me/export');const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='star-oracle-records.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
 const headings={login:['欢迎回到照见','留一点安静，继续与你自己相遇。'],signup:['留一片自己的星空','把探索、心情与微小的行动，慢慢收好。'],forgot:['找回星空的入口','输入注册邮箱，我们会发送重设密码的链接。'],reset:['重新设置密码','换一个只有你知道的密码，安心继续。'],verify:['确认你的邮箱','验证后，你就可以保存属于自己的记录。']} as const;
 const title=totp?'再确认，是你。':headings[mode][0],description=totp?(recovery?'输入一条未使用过的恢复码。每条只能使用一次。':'输入身份验证器中的六位验证码，完成安全登录。'):headings[mode][1];
 const privateAccount=!!user&&mode!=='reset';
 return <div className={'account-layout '+(privateAccount?'signed-in':'')}>
  <aside className="account-story"><div className="account-story-copy"><span className="account-series">照见 · 一处安静的心灵天文台</span><h1>向星光提问，<br/>向自己靠近。</h1><p>一张牌，一次变化，一页心绪。<br/>不急于知道答案，先好好听见自己。</p></div><Observatory/><div className="account-story-foot"><span>让每一次探索，都有回响。</span><span>Star Oracle</span></div></aside>
  <section className="account-content" aria-label={privateAccount?'账户与安全':'账户登录'}>
   {!privateAccount?<div className="account-form-wrap"><Link to="/" className="account-back"><ArrowLeft size={15}/>回到照见</Link><div className="account-form-heading"><span className="account-symbol"><ShieldCheck size={22}/></span><h2>{title}</h2><p>{description}</p></div>
    {pending&&!totp&&mode==='login'?<p role="status" className="account-pending">正在确认账户状态…</p>:<form onSubmit={submit} aria-busy={busy}>
     <fieldset disabled={busy}>
      {totp?<><label htmlFor="code">{recovery?'一次性恢复码':'身份验证器中的六位验证码'}</label><input id="code" type="password" className="otp-input" inputMode={recovery?'text':'numeric'} autoComplete="one-time-code" value={code} onChange={e=>setCode(e.target.value)} pattern={recovery?undefined:'[0-9]{6}'} maxLength={recovery?128:6} required autoFocus/></>:<>
       {mode==='signup'?<><label htmlFor="name">怎么称呼你</label><input id="name" autoComplete="nickname" value={name} onChange={e=>setName(e.target.value)} maxLength={100} required/></>:null}
       {mode!=='reset'?<><label htmlFor="email">邮箱</label><input id="email" type="email" autoComplete="email" placeholder="you@example.com" maxLength={191} value={email} onChange={e=>setEmail(e.target.value)} required/></>:null}
       {mode!=='forgot'&&mode!=='verify'?<><PasswordField key={mode} id="password" label={mode==='reset'?'新密码':'密码'} value={password} onChange={setPassword} newPassword={mode!=='login'}/>{mode!=='login'?<p className="field-hint">至少 12 个字符，建议使用密码管理器。</p>:<div className="forgot-link"><button type="button" disabled={busy} onClick={()=>changeMode('forgot')}>忘记密码</button></div>}</>:null}
       {mode==='signup'?<p className="account-terms">创建账户即表示你已阅读<Link to="/privacy">隐私说明</Link>。占卜用于自我反思与娱乐。</p>:null}
      </>}
      <Button type="submit" busy={busy} className="auth-submit">{totp?'确认验证码':mode==='signup'?'创建账户':mode==='forgot'?'发送重设邮件':mode==='reset'?'保存新密码':mode==='verify'?'发送验证邮件':'登录'}<ArrowUpRight size={16}/></Button>
     </fieldset>
     <Notice error={error||sessionError}/>{message?<p className="success" role="status"><Mail size={17}/>{message}</p>:null}
     <div className="auth-links">{totp?<><button type="button" disabled={busy} onClick={()=>{setTotp(false);setCode('');setRecovery(false);void refresh();}}>返回登录</button><button type="button" disabled={busy} onClick={()=>{setRecovery(!recovery);setCode('');setError(null);}}>{recovery?'使用身份验证器':'使用恢复码'}</button></>:mode==='login'?<><span>初次来到这里？ <button type="button" disabled={busy} onClick={()=>changeMode('signup')}>创建新账户</button></span><button type="button" disabled={busy} onClick={()=>changeMode('verify')}>重新发送验证邮件</button></>:<button type="button" disabled={busy} onClick={()=>changeMode('login')}>{mode==='signup'?'已有账户，登录':'返回登录'}</button>}</div>
    </form>}
    <p className="account-security-note"><LockKeyhole size={14}/>私人记录默认仅你可见</p><Link className="account-guest" to="/tarot">先体验一次探索</Link>
   </div>:<div className="account-settings"><div className="account-form-heading"><span className="account-symbol"><ShieldCheck size={22}/></span><h2>{user.name}，你好。</h2><p>照看你的账户，也照看自己的记录。</p><div className="account-email"><span>{showEmail?user.email:user.email.replace(/^(.).+(@.*)$/,'$1••••$2')}</span><button type="button" aria-label={showEmail?'隐藏账户邮箱':'显示账户邮箱'} onClick={()=>setShowEmail(!showEmail)}>{showEmail?<EyeOff size={16}/>:<Eye size={16}/>}</button></div></div>
    <div className="account-destinations"><Link to="/membership">会员与 AI 额度 <ArrowUpRight size={15}/></Link><Link to="/actions">我的行动 <ArrowUpRight size={15}/></Link><Link to="/insights">每周与每月回顾 <ArrowUpRight size={15}/></Link><Link to="/feedback">反馈与回复 <ArrowUpRight size={15}/></Link><Link to="/announcements">公告与使用指引 <ArrowUpRight size={15}/></Link></div>
    <div className="settings-section"><h3>带走你的记录</h3><p className="muted">导出包括私人日记、追问、行动与回顾，请保存到你信任的位置。</p><div className="record-actions"><Button busy={busy} onClick={exportData}><Download size={16}/>导出我的记录</Button><Button className="secondary" busy={busy} onClick={()=>run(async()=>{await signOut();navigate('/');})}><LogOut size={16}/>退出登录</Button></div></div>
    <div className="settings-section"><h3>两步验证</h3><p className="muted">用身份验证器增加一道保护。管理员必须启用两步验证。</p><PasswordField id="current-password" label="当前密码" value={password} onChange={setPassword}/>
     {!user.twoFactorEnabled&&!totpURI?<Button busy={busy} disabled={!password} onClick={()=>run(async()=>{const r=await accountAction(options=>authClient.twoFactor.enable({password,method:'totp'},options));if(r.error)throw new Error(r.error.message);if(r.data.method!=='totp')throw new Error('未能创建身份验证器配置');setTotpURI(r.data.totpURI);setBackup(r.data.backupCodes);setShowBackup(false);setBackupSaved(false);setBackupViewed(false);})}>启用两步验证</Button>:null}
     {totpURI?<div className="totp-setup"><QRCodeSVG value={totpURI} size={180} marginSize={3}/><p>用身份验证器扫描，再输入验证码完成启用。二维码含账户密钥，请勿分享。</p><label htmlFor="setup-code">确认两步验证验证码</label><input id="setup-code" type="password" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={e=>setCode(e.target.value)} maxLength={6}/><Button busy={busy} disabled={!/^[0-9]{6}$/.test(code)||!backupSaved} onClick={()=>run(async()=>{const r=await accountAction(options=>authClient.twoFactor.verifyTotp({code},options));if(r.error)throw new Error(r.error.message);setTotpURI('');setPassword('');setCode('');await refresh();setMessage('两步验证已启用。请妥善保管已保存的恢复码。');})}>确认启用</Button>{!backupSaved?<p className="field-hint">请先显示并离线保存下方恢复码，再确认启用。</p>:null}</div>:null}
     {backup.length?<div className="backup-codes"><p>恢复码仅在这里展示。每条只能使用一次，请离线妥善保存。</p>{showBackup?<code>{backup.join('\n')}</code>:<p aria-label="恢复码已隐藏">•••••••• &nbsp; ••••••••</p>}<Button className="secondary" onClick={()=>{if(!showBackup)setBackupViewed(true);setShowBackup(!showBackup);}}>{showBackup?'隐藏恢复码':'显示恢复码'}</Button><Button className="secondary" disabled={!backupViewed} onClick={()=>{setBackup([]);setShowBackup(false);setBackupSaved(true);}}>我已妥善保存</Button></div>:null}
     {user.twoFactorEnabled?<><p className="success">两步验证已启用。</p><Button className="secondary" busy={busy} disabled={!password} onClick={()=>run(async()=>{const r=await accountAction(options=>authClient.twoFactor.disable({password},options));if(r.error)throw new Error(r.error.message);setPassword('');await refresh();})}>关闭两步验证</Button></>:null}
    </div>
    <div className="settings-section account-danger"><h3>删除账户</h3><p>永久删除账户、占卜记录、日记、追问、行动与回顾，无法撤销。请先在上方输入当前密码。</p><Button className="danger" busy={busy} disabled={!password} onClick={()=>{if(window.confirm('永久删除账户及全部私人记录？此操作无法撤销。'))void run(async()=>{const savedPassword=password;const r=await accountAction(options=>authClient.deleteUser({password:savedPassword},options));await refresh();if(r.error)throw new Error(r.error.message);navigate('/');});}}>删除账户与全部记录</Button></div>
    <Notice error={error||sessionError}/>{message?<p className="success" role="status">{message}</p>:null}
   </div>}
  </section>
 </div>;
}
