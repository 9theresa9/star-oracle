import { Link } from 'react-router-dom';
import { BookOpen,CalendarDays,CheckCheck,ChartNoAxesCombined,Heart,MessageSquare,Settings,Star,History,Bell } from 'lucide-react';
import { useSession } from '../lib/session';
import { Reveal } from '../components/ui';
import './space.css';
const links=[
 {to:'/daily',title:'今日星笺',description:'领取今天的一张牌，留下一点安静。',Icon:Star},
 {to:'/history',title:'占卜档案',description:'搜索、收藏、标签，把线索慢慢连接。',Icon:History},
 {to:'/journal',title:'私人日记',description:'记录心情，回看你自己的日子。',Icon:Heart},
 {to:'/insights',title:'周月回顾',description:'看见变化，也看见已经走过的路。',Icon:ChartNoAxesCombined},
 {to:'/actions',title:'行动计划',description:'把一个想法，变成下一步的小行动。',Icon:CheckCheck},
 {to:'/membership',title:'会员与额度',description:'查看权益、兑换码和真实的额度明细。',Icon:Star},
 {to:'/library',title:'塔罗与易经图鉴',description:'查阅牌与卦，从含义走向自己的理解。',Icon:BookOpen},
 {to:'/tutorials',title:'探索入门',description:'循序了解牌阵、起卦和提问方法。',Icon:CalendarDays},
 {to:'/announcements',title:'星空公告',description:'阅读发布的新内容与网站动态。',Icon:Bell},
 {to:'/feedback',title:'建议与反馈',description:'把遇到的问题、想要的功能告诉我们。',Icon:MessageSquare},
 {to:'/account',title:'账户与安全',description:'登录、导出数据、管理两步验证。',Icon:Settings}
];
export function Space(){const {user}=useSession();return <Reveal className="page space-page"><span className="eyebrow">YOUR PERSONAL CONSTELLATION</span><h1>{user?user.name+'，欢迎回到星空。':'给自己，留一片星空。'}</h1><p className="page-intro">探索、记录、回顾，再走出下一步。你的私人内容始终由你决定如何使用。</p>{!user?<p className="space-signin"><Link to="/account">登录账户</Link>，跨设备保存占卜、日记和行动计划。</p>:null}<div className="space-grid">{links.map(({to,title,description,Icon})=><Link className="space-card" to={to} key={to}><Icon size={23} aria-hidden="true"/><h2>{title}</h2><p>{description}</p><span aria-hidden="true">探索 →</span></Link>)}</div></Reveal>;}
