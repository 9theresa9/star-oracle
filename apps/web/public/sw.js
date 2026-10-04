/* Public static shell only. API, authentication and private navigation are never persisted. */
const CACHE='star-oracle-public-v3';
const SHELL='/index.html';
const PUBLIC_NAV=new Set(['/','/tarot','/iching','/library','/tutorials','/announcements','/privacy']);
const OFFLINE='<html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>照见 · 暂时离线</title><body><main><h1>星光稍作停顿。</h1><p>请连接网络后重试。私人记录与 AI 服务需要联网。</p><a href="/">返回首页</a></main></body></html>';
self.addEventListener('install',event=>{
 event.waitUntil((async()=>{const response=await fetch(SHELL,{credentials:'omit',cache:'reload'});if(response.ok&&response.headers.get('content-type')?.includes('text/html'))await(await caches.open(CACHE)).put(SHELL,response);})());
});
self.addEventListener('activate',event=>event.waitUntil((async()=>{for(const key of await caches.keys())if(key.startsWith('star-oracle-public-')&&key!==CACHE)await caches.delete(key);await self.clients.claim();})()));
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=='GET'||url.origin!==self.location.origin)return;
 if(url.pathname.startsWith('/api/')||url.pathname.startsWith('/auth/')||url.pathname.includes('token')||url.search)return;
 if(request.mode==='navigate'){
  event.respondWith((async()=>{try{const response=await fetch(request);return response;}catch{if(PUBLIC_NAV.has(url.pathname)){const shell=await caches.match(SHELL);if(shell)return shell;}return new Response(OFFLINE,{status:503,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}});}})());return;
 }
 const staticAsset=/^\/assets\/[a-zA-Z0-9._-]+-[a-zA-Z0-9_-]{8,}\.(?:js|css|woff2|svg|png|jpe?g|webp)$/.test(url.pathname)||['/pwa-icon.svg','/pwa-192.png','/pwa-512.png'].includes(url.pathname);
 if(!staticAsset||request.credentials!=='omit'&&request.destination!=='script'&&request.destination!=='style'&&request.destination!=='image'&&request.destination!=='font')return;
 event.respondWith((async()=>{const cached=await caches.match(request);if(cached)return cached;const response=await fetch(request,{credentials:'omit'});if(response.ok&&response.type==='basic'&&!response.headers.get('cache-control')?.includes('no-store'))await(await caches.open(CACHE)).put(request,response.clone());return response;})());
});
