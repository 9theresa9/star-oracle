import React,{useState} from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter,RouterProvider,Routes,Route,Link,NavLink,useLocation } from 'react-router-dom';
import { QueryClient,QueryClientProvider } from '@tanstack/react-query';
import { Menu,X,ArrowUpRight } from 'lucide-react';
import { SessionProvider,useSession } from './lib/session';
import { Home } from './pages/home';
import { Explore } from './pages/explore';
import { Daily,Journal } from './pages/daily';
import { History } from './pages/history';
import { Account } from './pages/account';
import { Admin } from './pages/admin';
import { Privacy } from './pages/privacy';
import './styles.css';
const queryClient=new QueryClient({defaultOptions:{queries:{retry:1,refetchOnWindowFocus:false},mutations:{retry:false}}});
class ErrorBoundary extends React.Component<{children:React.ReactNode},{failed:boolean}>{
 state={failed:false};static getDerivedStateFromError(){return {failed:true};}
 render(){return this.state.failed?<div className="page"><h1>星光稍作停顿。</h1><p>页面暂时未能打开，请刷新后重试。</p><button className="button" onClick={()=>window.location.reload()}>刷新页面</button></div>:this.props.children;}
}
function Shell(){
 const {user}=useSession(),[menu,setMenu]=useState(false),location=useLocation();
 React.useEffect(()=>{setMenu(false);window.scrollTo({top:0,behavior:'instant'});},[location.pathname]);
 return <><a className="skip-link" href="#main">跳到主要内容</a><div className="star-field" aria-hidden="true"/><header className="site-header"><Link className="brand" to="/"><span className="brand-icon">✧</span><strong>照见</strong><span className="brand-en">STAR ORACLE</span></Link><button className="menu-toggle" aria-expanded={menu} aria-controls="nav" aria-label={menu?'关闭导航':'打开导航'} onClick={()=>setMenu(!menu)}>{menu?<X size={22}/>:<Menu size={22}/>}</button><nav id="nav" className={menu?'open':''} aria-label="主导航">{[['/tarot','塔罗'],['/iching','易经'],['/daily','每日'],['/journal','日记'],['/history','记录']].map(([to,label])=><NavLink key={to} to={to!}>{label}</NavLink>)}{user?.role==='admin'?<NavLink to="/admin">管理</NavLink>:null}<NavLink className="nav-account" to="/account">{user?'我的账户':'登录'} <ArrowUpRight size={13}/></NavLink></nav></header><main id="main"><Routes><Route path="/" element={<Home/>}/><Route path="/tarot" element={<Explore key="tarot" kind="tarot"/>}/><Route path="/iching" element={<Explore key="iching" kind="iching"/>}/><Route path="/daily" element={<Daily/>}/><Route path="/journal" element={<Journal/>}/><Route path="/history" element={<History/>}/><Route path="/account" element={<Account/>}/><Route path="/admin" element={<Admin/>}/><Route path="/privacy" element={<Privacy/>}/><Route path="*" element={<div className="page"><h1>这一页，尚未抵达。</h1><Link className="button" to="/">回到星空</Link></div>}/></Routes></main><footer className="site-footer"><Link className="brand" to="/"><span className="brand-icon">✧</span><strong>照见</strong></Link><span>留一点安静，听见自己。</span><Link to="/privacy">隐私与使用说明</Link><small>© {new Date().getFullYear()} Star Oracle</small></footer></>;
}
const router=createBrowserRouter([{path:'*',element:<Shell/>}]);
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><ErrorBoundary><QueryClientProvider client={queryClient}><SessionProvider><RouterProvider router={router}/></SessionProvider></QueryClientProvider></ErrorBoundary></React.StrictMode>);
