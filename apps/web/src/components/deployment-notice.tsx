import React from 'react';
import {ShieldCheck} from 'lucide-react';

export function DeploymentNotice({mode}:{mode?:'https'|'ssh-only'}){
 if(mode!=='ssh-only')return null;
 return <aside className="deployment-notice" role="note" aria-label="访问方式与安全边界">
  <div className="deployment-notice-inner">
   <ShieldCheck className="deployment-notice-icon" size={19} aria-hidden="true"/>
   <div className="deployment-notice-copy">
    <strong>仅 SSH 访问 · 正式账号与数据</strong>
    <p>电脑到服务器的传输由 SSH 隧道加密。</p>
    <details>
     <summary>了解本机访问边界</summary>
     <p>浏览器通过本机 HTTP 连接到 SSH 隧道。本机 HTTP 不保护你免受本机恶意进程影响，请只在可信的电脑上使用。</p>
     <p>localhost 的 Cookie 不按端口隔离。建议使用独立的浏览器配置文件，避免与不可信的 localhost 服务共用登录环境。</p>
    </details>
   </div>
  </div>
 </aside>;
}
