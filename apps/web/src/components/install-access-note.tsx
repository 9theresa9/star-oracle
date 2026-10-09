import React from 'react';

export function InstallAccessNote({mode}:{mode?:'https'|'ssh-only'}){
 return <p className="small muted">{mode==='ssh-only'?'是否支持安装，取决于浏览器对 localhost 的支持。每台设备都需要自己的 SSH 隧道，电脑的 localhost 地址不能直接用于手机访问。你也可以保存书签。':mode==='https'?'需要 HTTPS 网站和支持的浏览器。':'安装支持取决于当前访问方式与浏览器，也可以保存书签。'}安装是可选的，离线时无法读取私人内容。</p>;
}
