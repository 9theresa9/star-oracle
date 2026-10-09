import { test,expect,type Page } from './fixtures';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import {provisionBrowserAccount} from './fixtures/accounts';

async function signInFixture(page:Page,username:string,name:string){
 await provisionBrowserAccount(username,name,'management-fixture-password-123');
 await page.goto('/account');
 await page.getByLabel('用户名',{exact:true}).fill(username);
 await page.getByLabel('密码',{exact:true}).fill('management-fixture-password-123');
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await expect(page.locator('.daily-letter')).toBeVisible();
}

test('management publishing, feedback, redemption and membership use real isolated accounts',async({browser,baseURL},info)=>{
 test.skip(info.project.name==='small-chromium','Complete management flows run on desktop and iPhone.');
 test.setTimeout(120000);
 // Promotion is a disposable database fixture operation, never a production shortcut.
 if(process.env.NODE_ENV!=='test'||!process.env.DATABASE_URL||!['localhost','127.0.0.1','[::1]'].includes(new URL(process.env.DATABASE_URL).hostname))throw new Error('Management fixtures require the isolated local test database.');
 const origin=baseURL??'http://localhost:5173',token=randomUUID().replaceAll('-',''),usernames=['synthetic-member-'+token.slice(0,12),'synthetic-operator-'+token.slice(0,12)];
 const device={viewport:info.project.use.viewport,isMobile:info.project.use.isMobile,hasTouch:info.project.use.hasTouch,deviceScaleFactor:info.project.use.deviceScaleFactor,userAgent:info.project.use.userAgent};
 const memberContext=await browser.newContext({baseURL:origin,...device}),operatorContext=await browser.newContext({baseURL:origin,...device}),guestContext=await browser.newContext({baseURL:origin,...device});
 async function fitsViewport(page:Page){expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(await page.evaluate(()=>window.innerWidth));}
 const member=await memberContext.newPage(),operator=await operatorContext.newPage(),guest=await guestContext.newPage(),db=new PrismaClient(),codeIds:string[]=[],contentIds:string[]=[];
 try{
  await signInFixture(member,usernames[0]!, '管理流程用户');
  if(device.viewport)expect(await member.evaluate(()=>window.innerWidth)).toBe(device.viewport.width);
  await fitsViewport(member);
  await member.goto('/feedback');
  const feedbackBody='希望支持更多占卜牌阵 '+token;
  await member.getByLabel('反馈类型').selectOption('idea');
  await member.getByLabel('想告诉我们什么').fill(feedbackBody);
  const submitted=member.waitForResponse(r=>r.url().endsWith('/api/v1/feedback')&&r.request().method()==='POST');
  await member.getByRole('button',{name:'提交反馈',exact:true}).click();
  const submittedResponse=await submitted;expect(submittedResponse.status()).toBe(201);
  const feedback=await submittedResponse.json() as {id:string};
  await expect(member.locator('.feedback-item').filter({hasText:feedbackBody})).toBeVisible();
  await fitsViewport(member);
  expect((await memberContext.request.get('/api/v1/admin/overview')).status()).toBe(403);
  expect((await guestContext.request.get('/api/v1/feedback')).status()).toBe(401);

  await signInFixture(operator,usernames[1]!, '管理流程管理员');
  const fixture=await db.user.findUniqueOrThrow({where:{username:usernames[1]!},select:{id:true}});
  await db.user.update({where:{id:fixture.id},data:{role:'admin'}});
  await operator.goto('/admin');
  await expect(operator.getByRole('heading',{name:'照看系统，也照看信任。'})).toBeVisible();
  await expect(operator.getByRole('heading',{name:'每日使用趋势'})).toBeVisible();
  await operator.getByRole('button',{name:'最近 90 天',exact:true}).click();
  await expect(operator.getByText(/· 北京时间 · 仅汇总数量/)).toBeVisible();
  await fitsViewport(operator);
  await operator.screenshot({path:'test-results/admin-overview-'+info.project.name+'.png',fullPage:true,animations:'disabled'});

  await operator.getByRole('button',{name:'内容',exact:true}).click();
  const slug='management-'+token,title='纯文本公告 '+token,plainBody='<script>window.__oracleUnsafe=true</script>\n这段文字应当原样显示。';
  await operator.getByLabel('唯一标识').fill(slug);
  await operator.getByLabel('标题',{exact:true}).fill(title);
  await operator.getByLabel('正文',{exact:true}).fill(plainBody);
  const draftResponse=operator.waitForResponse(r=>r.url().endsWith('/api/v1/admin/content')&&r.request().method()==='POST');
  await operator.getByRole('button',{name:'保存草稿',exact:true}).click();
  const draft=await draftResponse;expect(draft.status()).toBe(201);
  const draftItem=await draft.json() as {id:string};contentIds.push(draftItem.id);
  expect((await guestContext.request.get('/api/v1/content/'+slug)).status()).toBe(404);
  const publicDrafts=await(await guestContext.request.get('/api/v1/content?kind=announcement&limit=50')).json() as {items:{id:string}[]};
  expect(publicDrafts.items.some(item=>item.id===draftItem.id)).toBe(false);
  await operator.getByLabel('公开发布').check();
  const published=operator.waitForResponse(r=>r.url().endsWith('/api/v1/admin/content/'+draftItem.id)&&r.request().method()==='PATCH');
  await operator.getByRole('button',{name:'保存并发布',exact:true}).click();
  expect((await published).status()).toBe(200);
  await guest.goto('/announcements');
  const letter=guest.locator('.content-letter').filter({hasText:title});
  await expect(letter).toBeVisible();
  await expect(letter.locator('.plain-copy')).toContainText('<script>window.__oracleUnsafe=true</script>');
  expect(await letter.locator('script').count()).toBe(0);
  expect(await guest.evaluate(()=>Reflect.get(window,'__oracleUnsafe'))).toBeUndefined();
  expect((await guestContext.request.get('/api/v1/content/'+slug)).status()).toBe(200);
  await fitsViewport(guest);
  await fitsViewport(operator);
  await operator.screenshot({path:'test-results/admin-content-'+info.project.name+'.png',fullPage:true,animations:'disabled'});

  await operator.getByRole('button',{name:'反馈',exact:true}).click();
  const item=operator.locator('.feedback-item').filter({hasText:feedbackBody});
  await item.getByRole('button',{name:'回复与处理',exact:true}).click();
  await item.getByLabel('回复内容').fill('建议已收到，我们会继续完善占卜体验。');
  await item.getByLabel('处理状态').selectOption('resolved');
  const replied=operator.waitForResponse(r=>r.url().endsWith('/api/v1/admin/feedback/'+feedback.id)&&r.request().method()==='PATCH');
  await item.getByRole('button',{name:'保存处理结果',exact:true}).click();
  expect((await replied).status()).toBe(200);
  await member.reload();
  const mine=member.locator('.feedback-item').filter({hasText:feedbackBody});
  await expect(mine.locator('.feedback-reply')).toContainText('建议已收到');
  await expect(mine.locator('.feedback-status')).toHaveText('已处理');
  await fitsViewport(member);
  await fitsViewport(operator);
  await operator.screenshot({path:'test-results/admin-feedback-'+info.project.name+'.png',fullPage:true,animations:'disabled'});

  await operator.getByRole('button',{name:'兑换码',exact:true}).click();
  async function createCode(kind:'credits'|'membership',value:number){
   await operator.getByLabel('权益类型').selectOption(kind);
   if(kind==='credits')await operator.getByLabel('每次兑换的额度').fill(String(value));
   else await operator.getByLabel('会员天数').fill(String(value));
   await operator.getByLabel('最多可兑换次数').fill('2');
   const response=operator.waitForResponse(r=>r.url().endsWith('/api/v1/admin/redeem-codes')&&r.request().method()==='POST');
   await operator.getByRole('button',{name:'创建兑换码',exact:true}).click();
   const result=await response;expect(result.status()).toBe(201);
   const code=await result.json() as {code:string;item:{id:string;codeHint:string}};
   codeIds.push(code.item.id);
   await expect(operator.locator('.one-time-code code')).toHaveText(code.code);
   const listed=await(await operatorContext.request.get('/api/v1/admin/redeem-codes?limit=50')).json() as {items:Record<string,unknown>[]};
   const metadata=listed.items.find(item=>item.id===code.item.id);expect(metadata).toBeDefined();
   expect(metadata).not.toHaveProperty('code');expect(metadata).not.toHaveProperty('codeHash');
   expect(JSON.stringify(listed)).not.toContain(code.code);
   await operator.getByRole('button',{name:'我已保存，隐藏完整码',exact:true}).click();
   await expect(operator.locator('.one-time-code')).toHaveCount(0);
   return code;
  }
  async function redeem(code:string){
   await member.getByLabel('兑换码',{exact:true}).fill(code);
   const result=member.waitForResponse(r=>r.url().endsWith('/api/v1/membership/redeem')&&r.request().method()==='POST');
   await member.getByRole('button',{name:'兑换权益',exact:true}).click();
   return result;
  }
  const credits=await createCode('credits',7);
  await member.goto('/membership');
  expect((await redeem(credits.code)).status()).toBe(201);
  await expect(member.locator('.allowance')).toContainText('额外额度 7 次');
  await expect(member.locator('.credits-ledger table')).toContainText('兑换码领取');
  await expect(member.locator('.credits-ledger table')).toContainText('+7');
  const plus=await createCode('membership',30);
  expect((await redeem(plus.code)).status()).toBe(201);
  await expect(member.getByRole('heading',{name:'Plus 会员',exact:true})).toBeVisible();
  await expect(member.locator('.allowance')).toContainText('今日剩余 / 20 次');
  const redemptionTable=member.locator('.redemption-list table');
  await expect(redemptionTable).toContainText('7 次额外 AI 额度');
  await expect(redemptionTable).toContainText('30 天 Plus');
  await expect(redemptionTable).toContainText(credits.item.codeHint);
  await expect(redemptionTable).toContainText(plus.item.codeHint);
  expect(await redemptionTable.innerText()).not.toContain(credits.code);
  expect(await redemptionTable.innerText()).not.toContain(plus.code);
  const redemptionHistory=await(await memberContext.request.get('/api/v1/membership/redemptions?limit=50')).json() as {items:Record<string,unknown>[]};
  expect(redemptionHistory.items).toHaveLength(2);
  for(const row of redemptionHistory.items){expect(row).not.toHaveProperty('code');expect(row).not.toHaveProperty('codeHash');}
  expect(JSON.stringify(redemptionHistory)).not.toContain(credits.code);
  expect(JSON.stringify(redemptionHistory)).not.toContain(plus.code);
  await fitsViewport(member);
  await fitsViewport(operator);
  await member.screenshot({path:'test-results/membership-'+info.project.name+'.png',fullPage:true,animations:'disabled'});
  await expect(member.getByText('支付尚未开放',{exact:true})).toBeVisible();
  const payment=await(await memberContext.request.get('/api/v1/membership/payment-options')).json();
  expect(payment).toMatchObject({enabled:false,providers:[]});
  const blocked=await createCode('credits',11);
  const codeRow=operator.getByRole('row').filter({hasText:blocked.item.codeHint});
  operator.once('dialog',dialog=>void dialog.accept());
  const disabled=operator.waitForResponse(r=>r.url().endsWith('/api/v1/admin/redeem-codes/'+blocked.item.id)&&r.request().method()==='PATCH');
  await codeRow.getByRole('button',{name:'禁用',exact:true}).click();
  expect((await disabled).status()).toBe(200);
  await expect(codeRow).toContainText('已禁用');
  expect((await redeem(blocked.code)).status()).toBe(400);
  const after=await(await memberContext.request.get('/api/v1/membership')).json();
  expect(after).toMatchObject({tier:'plus',credits:7});

  await operator.getByRole('button',{name:'用户与会员',exact:true}).click();
  const userRow=operator.getByRole('row').filter({hasText:'管理流程用户'});
  await userRow.getByRole('button',{name:'设置权益',exact:true}).click();
  await operator.getByLabel('新的会员类型').selectOption('free');
  // Empty credits input must preserve the existing seven credits.
  await expect(operator.getByLabel('额外额度余额（可选）')).toHaveValue('');
  operator.once('dialog',dialog=>void dialog.accept());
  const memberUser=await db.user.findUniqueOrThrow({where:{username:usernames[0]!},select:{id:true}});
  const adjusted=operator.waitForResponse(r=>r.url().endsWith('/api/v1/admin/users/'+memberUser.id+'/membership')&&r.request().method()==='PATCH');
  await operator.getByRole('button',{name:'保存权益',exact:true}).click();
  expect((await adjusted).status()).toBe(200);
  const finalMembership=await(await memberContext.request.get('/api/v1/membership')).json();
  expect(finalMembership).toMatchObject({tier:'free',credits:7,expiresAt:null});
  await member.reload();
  await expect(member.getByRole('heading',{name:'免费账户',exact:true})).toBeVisible();
  await fitsViewport(member);
  await fitsViewport(operator);
  await operator.screenshot({path:'test-results/management-'+info.project.name+'.png',fullPage:true,animations:'disabled'});
 }finally{
  await Promise.all([memberContext.close(),operatorContext.close(),guestContext.close()]);
  await db.user.deleteMany({where:{username:{in:usernames}}});
  if(codeIds.length)await db.redeemCode.deleteMany({where:{id:{in:codeIds}}});
  if(contentIds.length)await db.siteContent.deleteMany({where:{id:{in:contentIds}}});
  await db.$disconnect();
 }
});

test('PWA public assets decode and worker never persists private requests',async({page,request,baseURL},info)=>{
 test.skip(info.project.name!=='desktop-chromium','Public PWA assets are verified once.');
 test.setTimeout(120000);
 const origin=baseURL??'http://localhost:5173';
 await page.goto('/');
 const manifestResponse=await request.get('/manifest.webmanifest');expect(manifestResponse.ok()).toBeTruthy();
 const manifest=await manifestResponse.json() as {start_url:string;icons:{src:string;sizes:string}[]};
 expect(new URL(manifest.start_url,origin).origin).toBe(origin);
 for(const icon of manifest.icons)expect(new URL(icon.src,origin).origin).toBe(origin);
 const sizes=await page.evaluate(async()=>Promise.all([192,512].map(size=>new Promise<number>((resolve,reject)=>{const icon=new Image();icon.onload=()=>resolve(icon.naturalWidth);icon.onerror=()=>reject(new Error('PWA icon could not decode'));icon.src='/pwa-'+size+'.png';}))));
 expect(sizes).toEqual([192,512]);
 const scriptResponse=await request.get('/sw.js');expect(scriptResponse.ok()).toBeTruthy();
 const source=await scriptResponse.text(),listeners=new Map<string,(event:any)=>void>(),stored=new Map<string,Response>();
 let offline=false;
 const key=(value:string|{url:string})=>typeof value==='string'?new URL(value,origin).href:value.url;
 const cache={put:async(value:string|{url:string},response:Response)=>{stored.set(key(value),response.clone());},match:async(value:string|{url:string})=>stored.get(key(value))?.clone()};
 const cachesFixture={open:async()=>cache,match:cache.match,keys:async()=>[],delete:async()=>true};
 runInNewContext(source,{URL,Response,caches:cachesFixture,self:{location:{origin},clients:{claim:async()=>{}},addEventListener:(name:string,listener:(event:any)=>void)=>listeners.set(name,listener)},fetch:async(value:string|{url:string})=>{if(offline)throw new Error('offline fixture');const pathname=new URL(key(value)).pathname;const response=new Response(pathname==='/index.html'?'<html>public shell</html>':'/* public static asset */',{headers:{'Content-Type':pathname==='/index.html'?'text/html':'application/javascript'}});Object.defineProperty(response,'type',{value:'basic'});return response;}});
 let installing:Promise<unknown>|undefined;
 listeners.get('install')!({waitUntil:(value:Promise<unknown>)=>{installing=value;}});await installing;
 function dispatch(path:string,mode='cors',destination=''){
  let response:Promise<Response>|undefined;
  listeners.get('fetch')!({request:{url:origin+path,method:'GET',mode,destination,credentials:'same-origin'},respondWith:(value:Promise<Response>)=>{response=value;}});
  return response;
 }
 expect(dispatch('/api/v1/me')).toBeUndefined();
 expect(dispatch('/api/auth/get-session')).toBeUndefined();
 expect(dispatch('/api/v1/readings?limit=50')).toBeUndefined();
 expect(dispatch('/account?token=private-fixture','navigate','document')).toBeUndefined();
 offline=true;
 expect((await dispatch('/history','navigate','document'))!.status).toBe(503);
 expect((await dispatch('/journal','navigate','document'))!.status).toBe(503);
 expect((await dispatch('/','navigate','document'))!.status).toBe(200);
 expect([...stored.keys()]).toEqual([origin+'/index.html']);
 expect([...stored.keys()].some(value=>value.includes('/api/')||value.includes('/history')||value.includes('/journal'))).toBe(false);
});
