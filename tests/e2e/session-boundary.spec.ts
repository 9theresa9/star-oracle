import {test,expect} from './fixtures';
// Fault-injection routes must own their requests; the dedicated PWA suite keeps workers enabled.
test.use({serviceWorkers:'block'});
const account=(id:string)=>({id,name:id,email:id+'@example.test',role:'user',twoFactorEnabled:false,sessionBinding:'session-'+id});
test('two tabs revoke old private drafts before another account can save them',async({context,page})=>{
 let actor=account('account-A');const writes:any[]=[];
 await context.route('**/api/**',async route=>{
  const request=route.request(),path=new URL(request.url()).pathname;
  if(path==='/api/v1/me')return route.fulfill({status:actor?200:401,json:actor??{error:{message:'请先登录'}}});
  if(path==='/api/v1/config')return route.fulfill({json:{aiEnabled:false,aiProvider:'Local test'}});
  if(path==='/api/auth/get-session')return route.fulfill({json:actor?{user:actor,session:{id:actor.sessionBinding}}:null});
  if(path==='/api/auth/sign-out'){actor=null as any;return route.fulfill({json:{success:true}});}
  if(path==='/api/auth/sign-in/email'){actor=account('account-B');return route.fulfill({json:{user:actor,redirect:false}});}
  if(path==='/api/v1/readings'&&request.method()==='POST'){writes.push({actor:actor?.id,body:request.postDataJSON()});return route.fulfill({status:409,json:{error:{message:'Test rejects stale input'}}});}
  return route.fulfill({status:503,json:{error:{message:'Synthetic unused endpoint'}}});
 });
 await page.goto('/tarot');await expect(page.getByText('记录默认仅你可见。共享需要你主动开启。')).toBeVisible();
 await page.getByLabel('此刻，你想探索什么？').fill('PRIVATE draft belonging to account A');
 const other=await context.newPage();await other.goto('/account');
 await other.getByRole('button',{name:'退出登录',exact:true}).click();
 await expect(page.getByLabel('此刻，你想探索什么？')).toHaveValue('');
 await other.goto('/account');await other.getByLabel('邮箱',{exact:true}).fill('account-B@example.test');await other.getByLabel('密码',{exact:true}).fill('test-password-twelve-chars');
 await other.getByRole('button',{name:'登录',exact:true}).click();
 await page.bringToFront();await expect(page.getByLabel('此刻，你想探索什么？')).toHaveValue('');
 expect(writes).toEqual([]);
});

test('same verified session keeps a draft when returning to the tab',async({page})=>{
 await page.route('**/api/v1/me',route=>route.fulfill({json:account('stable-owner')}));
 await page.route('**/api/v1/config',route=>route.fulfill({json:{aiEnabled:false,aiProvider:'Synthetic fixture'}}));
 await page.goto('/tarot');await page.getByLabel('此刻，你想探索什么？').fill('Keep this unsaved question');
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect(page.getByLabel('此刻，你想探索什么？')).toHaveValue('Keep this unsaved question');
});
test('real cookie account switch clears another tab and rejects its old actor',async({browser,context,page})=>{
 const origin='http://localhost:5173',password='Synthetic-private-test-password';
 const emailA='cross-a-'+crypto.randomUUID()+'@example.com',emailB='cross-b-'+crypto.randomUUID()+'@example.com';
 const bContext=await browser.newContext();
 const create=async(request:any,email:string,name:string)=>{const response=await request.post(origin+'/api/auth/sign-up/email',{headers:{Origin:origin},data:{name,email,password}});expect(response.status()).toBe(200);return response.json();};
 await create(bContext.request,emailB,'Synthetic B');await bContext.close();await create(context.request,emailA,'Synthetic A');
 const original=await context.request.get(origin+'/api/v1/me');const actor=await original.json();
 await page.goto('/tarot');await expect(page.getByText('记录默认仅你可见。共享需要你主动开启。')).toBeVisible();await page.getByLabel('此刻，你想探索什么？').fill('PRIVATE A draft must not belong to B');
 const second=await context.newPage();await second.goto('/account');await second.getByRole('button',{name:'退出登录',exact:true}).click();await expect(page.getByLabel('此刻，你想探索什么？')).toHaveValue('');
 await second.goto('/account');await second.getByLabel('邮箱',{exact:true}).fill(emailB);await second.getByLabel('密码',{exact:true}).fill(password);await second.getByRole('button',{name:'登录',exact:true}).click();await expect(second.locator('.daily-letter')).toBeVisible();
 await expect(page.getByLabel('此刻，你想探索什么？')).toHaveValue('');
 const stale=await context.request.post(origin+'/api/v1/readings',{headers:{Origin:origin,'X-Expected-Actor':actor.id,'X-Expected-Session':actor.sessionBinding},data:{kind:'tarot',question:'PRIVATE A draft must not belong to B',spread:'single',allowReversed:false,requestId:crypto.randomUUID()}});expect(stale.status()).toBe(409);
 const saved=await context.request.get(origin+'/api/v1/readings');expect((await saved.json()).items).toEqual([]);
});
test('a delayed TOTP enrollment never reveals old-account secrets after switching tabs',async({context,page})=>{
 let actor=account('account-A'),release:()=>void=()=>{},started:()=>void=()=>{};const called=new Promise<void>(resolve=>{started=resolve;});
 await context.route('**/api/**',async route=>{const path=new URL(route.request().url()).pathname;
  if(path==='/api/v1/me')return route.fulfill({status:actor?200:401,json:actor??{error:{message:'请先登录'}}});
  if(path==='/api/auth/get-session')return route.fulfill({json:actor?{user:actor,session:{id:actor.sessionBinding}}:null});
  if(path==='/api/auth/two-factor/enable'){started();await new Promise<void>(resolve=>{release=resolve;});return route.fulfill({json:{method:'totp',totpURI:'otpauth://totp/synthetic?secret=SYNTHETICACCOUNTASECRET',backupCodes:['OLD-ACCOUNT-A-BACKUP']}}).catch(()=>{});}
  if(path==='/api/auth/sign-out'){actor=null as any;return route.fulfill({json:{success:true}});}
  if(path==='/api/auth/sign-in/email'){actor=account('account-B');return route.fulfill({json:{user:actor,redirect:false}});}
  return route.fulfill({status:503,json:{error:{message:'Synthetic unused endpoint'}}});
 });
 await page.goto('/account');await page.getByLabel('当前密码',{exact:true}).fill('synthetic-password-twelve');await page.getByRole('button',{name:'启用两步验证',exact:true}).click();await called;
 const other=await context.newPage();await other.goto('/account');await other.getByRole('button',{name:'退出登录',exact:true}).click();await other.goto('/account');await other.getByLabel('邮箱',{exact:true}).fill('account-B@example.test');await other.getByLabel('密码',{exact:true}).fill('synthetic-password-twelve');await other.getByRole('button',{name:'登录',exact:true}).click();
 release();await expect(page.getByText('account-B，你好。',{exact:true})).toBeVisible();await expect(page.locator('.totp-setup')).toHaveCount(0);await expect(page.locator('.backup-codes')).toHaveCount(0);
});
test('failed focus confirmation clears private content when broadcast and storage are unavailable',async({context,page})=>{
 await context.addInitScript(()=>{Object.defineProperty(window,'BroadcastChannel',{value:undefined});Object.defineProperty(window,'localStorage',{get(){throw new Error('Synthetic unavailable storage');}});});
 let fail=false;await page.route('**/api/v1/me',route=>fail?route.fulfill({status:503,json:{error:{message:'Synthetic confirmation failure'}}}):route.fulfill({json:account('account-A')}));await page.route('**/api/v1/config',route=>route.fulfill({json:{aiEnabled:false,aiProvider:'Synthetic'}}));
 await page.goto('/tarot');await page.getByLabel('此刻，你想探索什么？').fill('PRIVATE A when returning offline');fail=true;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect(page.getByLabel('此刻，你想探索什么？')).toHaveValue('');await expect(page.getByRole('button',{name:'开始抽牌',exact:true})).toBeDisabled();
});
test('malformed identity confirmation cannot keep old private drafts active',async({page})=>{
 let malformed=false;await page.route('**/api/v1/me',route=>route.fulfill({json:malformed?{id:'account-A'}:account('account-A')}));await page.route('**/api/v1/config',route=>route.fulfill({json:{aiEnabled:false,aiProvider:'Synthetic'}}));
 await page.goto('/tarot');await page.getByLabel('此刻，你想探索什么？').fill('PRIVATE draft before malformed me');malformed=true;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(page.getByLabel('此刻，你想探索什么？')).toHaveValue('');await expect(page.getByRole('button',{name:'开始抽牌',exact:true})).toBeDisabled();
});
