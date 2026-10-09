import {expect,type Page,type BrowserContext,type TestInfo} from '@playwright/test';

type Event={at:number;kind:string;path?:string;status?:number};
type Diagnostic={events:Event[];cookies:{phase:string;items:unknown[]}[];dispose:()=>void};
const active=new WeakMap<Page,Diagnostic>();
const enabled=()=>process.env.ORACLE_SSH_REFRESH_DIAGNOSTICS==='1';
const pathOf=(url:string)=>{try{return new URL(url).pathname;}catch{return '/invalid-url';}};

/** Only public cookie attributes are attached. Values, headers and bodies stay private. */
export function beginRefreshDiagnostics(page:Page){
 if(!enabled())return;
 const start=Date.now(),events:Event[]=[];
 const record=(kind:string,extra:Omit<Event,'at'|'kind'>={})=>events.push({at:Date.now()-start,kind,...extra});
 const failed=(request:import('@playwright/test').Request)=>record('request-failed',{path:pathOf(request.url())});
 const response=(value:import('@playwright/test').Response)=>{const path=pathOf(value.url());if(path==='/daily'||path.startsWith('/api/'))record('response',{path,status:value.status()});};
 const consoleError=(message:import('@playwright/test').ConsoleMessage)=>{if(message.type()==='error'&&message.text().includes('WebKit encountered an internal error'))record('webkit-internal-error');};
 const crash=()=>record('page-crash');
 page.on('requestfailed',failed);page.on('response',response);page.on('console',consoleError);page.on('crash',crash);
 active.set(page,{events,cookies:[],dispose:()=>{page.off('requestfailed',failed);page.off('response',response);page.off('console',consoleError);page.off('crash',crash);}});
}
async function snapshot(page:Page,context:BrowserContext,phase:string){
 const state=active.get(page);if(!state)return;
 const items=(await context.cookies('http://localhost:17777')).map(({name,domain,path,httpOnly,secure,sameSite,expires})=>({name,domain,path,httpOnly,secure,sameSite,expires}));
 state.cookies.push({phase,items});
}
export async function refreshAfterSecondFactor(page:Page){
 // The fast arm must preserve the original immediate reload: querying cookies
 // first adds a browser round trip and can suppress the race being measured.
 if(enabled()&&process.env.ORACLE_SSH_REFRESH_MODE==='ready'){
  await expect(page.locator('.daily-letter')).toBeVisible();
 }
 await page.reload();
}
export async function finishRefreshDiagnostics(page:Page,context:BrowserContext,info:TestInfo){
 const state=active.get(page);if(!state)return;
 try{await snapshot(page,context,'test-finished');}catch{state.events.push({at:0,kind:'cookie-metadata-unavailable'});}
 state.dispose();active.delete(page);
 await info.attach('ssh-refresh-diagnostics',{body:Buffer.from(JSON.stringify({mode:process.env.ORACLE_SSH_REFRESH_MODE??'fast',workerIndex:info.workerIndex,repeatEachIndex:info.repeatEachIndex,status:info.status,events:state.events,cookies:state.cookies},null,2)),contentType:'application/json'});
}
