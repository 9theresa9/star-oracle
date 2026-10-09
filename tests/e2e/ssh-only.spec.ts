import {test,expect,type Page} from './fixtures';
import {provisionBrowserAccount} from './fixtures/accounts';
import {createHmac,randomUUID} from 'node:crypto';
import {beginRefreshDiagnostics,finishRefreshDiagnostics,refreshAfterSecondFactor} from './fixtures/ssh-refresh-diagnostics';

test.use({serviceWorkers:'block'});
const origin='http://localhost:17777';
const password='Synthetic-SSH-account-password';
const noticeName='访问方式与安全边界';

test.describe('deployment notice',()=>{
 test.beforeEach(async({page})=>{
  await page.route('**/api/v1/me',route=>route.fulfill({status:401,json:{error:{message:'请先登录'}}}));
 });
 test('SSH access notice remains available across pages and fits narrow screens',async({page},info)=>{
  await page.route('**/api/v1/config',route=>route.fulfill({json:{aiEnabled:false,aiProvider:'Synthetic fixture',deploymentMode:'ssh-only'}}));
  await page.goto('/account');
  const notice=page.getByRole('note',{name:noticeName});
  await expect(notice).toContainText('仅 SSH 访问 · 正式账号与数据');
  await expect(notice).toContainText('电脑到服务器的传输由 SSH 隧道加密。');
  await expect(page.getByLabel('用户名',{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath('ssh-login-'+info.project.name+'.png'),fullPage:true,animations:'disabled'});
  await notice.getByText('了解本机访问边界',{exact:true}).click();
  await expect(notice).toContainText('本机 HTTP 不保护你免受本机恶意进程影响');
  await expect(notice).toContainText('localhost 的 Cookie 不按端口隔离');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.getByRole('link',{name:'隐私与使用说明',exact:true}).click();
  await expect(notice).toBeVisible();
  await expect(page.locator('main')).toContainText('电脑到服务器的连接由 SSH 隧道加密');
  await expect(page.locator('main')).toContainText('浏览器通过本机 HTTP 访问');
  await page.getByRole('button',{name:'添加桌面入口',exact:true}).click();
  const install=page.getByRole('dialog',{name:'把星空，留在桌面。'});
  await expect(install).toContainText('取决于浏览器对 localhost 的支持');
  await expect(install).toContainText('每台设备都需要自己的 SSH 隧道');
  await expect(install).toContainText('电脑的 localhost 地址不能直接用于手机访问');
 });
 test('public HTTPS profile does not show an SSH access notice',async({page})=>{
  await page.route('**/api/v1/config',route=>route.fulfill({json:{aiEnabled:false,aiProvider:'Synthetic fixture',deploymentMode:'https'}}));
  await page.goto('/account');
  await expect(page.getByLabel('用户名',{exact:true})).toBeVisible();
  await expect(page.getByRole('note',{name:noticeName})).toHaveCount(0);
  await page.getByRole('link',{name:'隐私与使用说明',exact:true}).click();
  await expect(page.locator('main')).toContainText('传输使用 HTTPS');
  await expect(page.locator('main')).not.toContainText('浏览器通过本机 HTTP 访问');
 });
});

const uniqueUsername=()=> 'synthetic-ssh-'+randomUUID().replaceAll('-','').slice(0,12);
async function signIn(page:Page,username:string,secret=password){
 await page.goto('/account');
 await page.getByLabel('用户名',{exact:true}).fill(username);
 await page.getByLabel('密码',{exact:true}).fill(secret);
 const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/auth/sign-in/username'&&r.request().method()==='POST');
 await page.getByRole('button',{name:'登录',exact:true}).click();
 return response;
}
async function signOut(page:Page){
 await page.goto('/account');
 await page.getByRole('button',{name:'退出登录',exact:true}).click();
 await expect(page).toHaveURL(/\/$/);
}
async function browserIdentity(page:Page){
 return page.evaluate(async()=>{
  const response=await fetch('/api/v1/me',{credentials:'same-origin'});
  return {status:response.status,body:await response.json()};
 });
}
function currentTotp(uri:string){
 const parameters=new URL(uri).searchParams;
 const secret=parameters.get('secret')!.toUpperCase().replace(/=+$/,'');
 const bits=[...secret].map(char=>{
  const value='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(char);
  if(value<0)throw new Error('Invalid synthetic authenticator secret');
  return value.toString(2).padStart(5,'0');
 }).join('');
 const key=Buffer.from((bits.match(/.{8}/g)??[]).map(byte=>parseInt(byte,2)));
 const counter=Buffer.alloc(8);
 counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/1000/Number(parameters.get('period')??30))));
 const hash=createHmac('sha1',key).update(counter).digest(),offset=hash[hash.length-1]!&15;
 const digits=Number(parameters.get('digits')??6);
 return ((hash.readUInt32BE(offset)&0x7fffffff)%10**digits).toString().padStart(digits,'0');
}

test.describe('formal SSH production sessions',()=>{
 test.beforeEach(async({baseURL})=>{
  test.skip(baseURL!==origin,'Runs only with the dedicated formal SSH production server');
 });
 test.beforeEach(async({page})=>{beginRefreshDiagnostics(page);});
 test.afterEach(async({page,context},info)=>{await finishRefreshDiagnostics(page,context,info);});

 test('HTTP login uses host-only HttpOnly Lax cookies, survives refresh, and logs out',async({page,context},info)=>{
  const username=uniqueUsername();
  const user=await provisionBrowserAccount(username,'Synthetic SSH reader',password);
  await page.goto('/account');
  const health=await page.request.get('/api/v1/health');
  expect(health.status()).toBe(200);
  expect(health.headers()['strict-transport-security']).toBeUndefined();
  const config=await page.request.get('/api/v1/config');
  expect((await config.json()).deploymentMode).toBe('ssh-only');
  await expect(page.getByRole('note',{name:noticeName})).toBeVisible();
  await expect(page.getByLabel('用户名',{exact:true})).toBeVisible();
  await page.screenshot({path:info.outputPath('formal-ssh-login-'+info.project.name+'.png'),fullPage:true,animations:'disabled'});
  const response=await signIn(page,username);
  expect(response.status()).toBe(200);
  expect(response.headers()['strict-transport-security']).toBeUndefined();
  await expect(page).toHaveURL(/\/daily$/);
  const session=(await context.cookies(origin)).find(cookie=>cookie.name==='star-oracle-ssh.session_token');
  expect(session).toBeDefined();
  expect(session).toMatchObject({domain:'localhost',path:'/',httpOnly:true,secure:false,sameSite:'Lax'});
  expect(session!.expires).toBeGreaterThan(Date.now()/1000);
  const headers=(await response.headersArray()).filter(header=>header.name.toLowerCase()==='set-cookie'&&header.value.startsWith('star-oracle-ssh.session_token='));
  expect(headers).toHaveLength(1);
  expect(headers[0]!.value).toMatch(/;\s*HttpOnly(?:;|$)/i);
  expect(headers[0]!.value).toMatch(/;\s*SameSite=Lax(?:;|$)/i);
  expect(headers[0]!.value).toMatch(/;\s*Path=\/(?:;|$)/i);
  expect(headers[0]!.value).toMatch(/;\s*Max-Age=604800(?:;|$)/i);
  expect(headers[0]!.value).not.toMatch(/;\s*(?:Secure(?:;|$)|Domain=)/i);
  expect(await page.evaluate(()=>document.cookie)).not.toContain('star-oracle-ssh.session_token');
  await page.reload();
  expect((await browserIdentity(page)).body.id).toBe(user.id);
  await page.goto('/account');
  await expect(page.getByRole('heading',{name:'Synthetic SSH reader，你好。',exact:true})).toBeVisible();
  await signOut(page);
  expect((await browserIdentity(page)).status).toBe(401);
  expect((await context.cookies(origin)).some(cookie=>cookie.name==='star-oracle-ssh.session_token')).toBe(false);
  await page.reload();
  await page.goto('/account');
  await expect(page.getByLabel('用户名',{exact:true})).toBeVisible();
 });

 test('a wrong password cannot create a formal SSH session',async({page,context})=>{
  const username=uniqueUsername();
  await provisionBrowserAccount(username,'Synthetic wrong password',password);
  expect((await signIn(page,username,'Synthetic-wrong-password')).status()).toBe(401);
  await expect(page.getByRole('alert')).toContainText('登录失败，请检查用户名和密码。');
  await expect(page.getByLabel('密码',{exact:true})).toHaveValue('');
  expect((await browserIdentity(page)).status).toBe(401);
  expect((await context.cookies(origin)).some(cookie=>cookie.name==='star-oracle-ssh.session_token')).toBe(false);
 });

 test('an existing default-prefix cookie cannot authenticate the new SSH profile',async({page,context})=>{
  const username=uniqueUsername();
  const user=await provisionBrowserAccount(username,'Synthetic profile upgrade',password);
  expect((await signIn(page,username)).status()).toBe(200);
  await expect(page).toHaveURL(/\/daily$/);
  const current=(await context.cookies(origin)).find(cookie=>cookie.name==='star-oracle-ssh.session_token')!;
  expect(current).toBeDefined();
  // Keep the server-side session valid, but emulate the cookie name left by the
  // previous HTTP profile. The new profile must never read that old namespace.
  await context.clearCookies();
  await context.addCookies([{...current,name:'better-auth.session_token'}]);
  await page.reload();
  expect((await browserIdentity(page)).status).toBe(401);
  await page.goto('/account');
  await expect(page.getByLabel('用户名',{exact:true})).toBeVisible();
  expect((await signIn(page,username)).status()).toBe(200);
  await expect(page).toHaveURL(/\/daily$/);
  expect((await browserIdentity(page)).body.id).toBe(user.id);
  const names=(await context.cookies(origin)).map(cookie=>cookie.name);
  expect(names).toContain('better-auth.session_token');
  expect(names).toContain('star-oracle-ssh.session_token');
 });

 test('TOTP and single-use recovery codes complete SSH browser sessions',async({page,context})=>{
  const username=uniqueUsername();
  const user=await provisionBrowserAccount(username,'Synthetic SSH authenticator',password);
  expect((await signIn(page,username)).status()).toBe(200);
  await expect(page).toHaveURL(/\/daily$/);
  await page.goto('/account');
  await page.getByLabel('当前密码',{exact:true}).fill(password);
  const enrollmentResponse=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/auth/two-factor/enable');
  await page.getByRole('button',{name:'启用两步验证',exact:true}).click();
  const enrollment=await enrollmentResponse;
  expect(enrollment.status()).toBe(200);
  const {totpURI,backupCodes}=await enrollment.json();
  expect(backupCodes.length).toBeGreaterThan(0);
  await page.getByRole('button',{name:'显示恢复码',exact:true}).click();
  await expect(page.locator('.backup-codes code')).toContainText(backupCodes[0]);
  await page.getByRole('button',{name:'我已妥善保存',exact:true}).click();
  await page.getByLabel('确认两步验证验证码',{exact:true}).fill(currentTotp(totpURI));
  await page.getByRole('button',{name:'确认启用',exact:true}).click();
  await expect(page.getByRole('button',{name:'关闭两步验证',exact:true})).toBeVisible();
  await signOut(page);

  expect((await signIn(page,username)).status()).toBe(200);
  const code=page.getByLabel('身份验证器中的六位验证码',{exact:true});
  await expect(code).toBeVisible();
  expect((await browserIdentity(page)).status).toBe(401);
  expect((await context.cookies(origin)).some(cookie=>cookie.name==='star-oracle-ssh.session_token')).toBe(false);
  const challenge=(await context.cookies(origin)).find(cookie=>cookie.name==='star-oracle-ssh.two_factor');
  expect(challenge).toMatchObject({domain:'localhost',path:'/',httpOnly:true,secure:false,sameSite:'Lax'});
  await code.fill(currentTotp(totpURI));
  await page.getByRole('button',{name:'确认验证码',exact:true}).click();
  await expect(page).toHaveURL(/\/daily$/);
  await refreshAfterSecondFactor(page);
  expect((await browserIdentity(page)).body.id).toBe(user.id);
  await signOut(page);

  expect((await signIn(page,username)).status()).toBe(200);
  await page.getByRole('button',{name:'使用恢复码',exact:true}).click();
  await page.getByLabel('一次性恢复码',{exact:true}).fill(backupCodes[0]);
  await page.getByRole('button',{name:'确认验证码',exact:true}).click();
  await expect(page).toHaveURL(/\/daily$/);
  await refreshAfterSecondFactor(page);
  expect((await browserIdentity(page)).body.id).toBe(user.id);
  await signOut(page);

  expect((await signIn(page,username)).status()).toBe(200);
  await page.getByRole('button',{name:'使用恢复码',exact:true}).click();
  await page.getByLabel('一次性恢复码',{exact:true}).fill(backupCodes[0]);
  const reused=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/auth/two-factor/verify-backup-code');
  await page.getByRole('button',{name:'确认验证码',exact:true}).click();
  expect((await reused).ok()).toBe(false);
  await expect(page.getByRole('alert')).toBeVisible();
  expect((await browserIdentity(page)).status).toBe(401);
 });

 test('A-B-A tab switching clears private drafts and rejects both old sessions',async({page,context})=>{
  const usernameA=uniqueUsername(),usernameB=uniqueUsername();
  const a=await provisionBrowserAccount(usernameA,'Synthetic SSH A',password);
  const b=await provisionBrowserAccount(usernameB,'Synthetic SSH B',password);
  expect((await signIn(page,usernameA)).status()).toBe(200);
  await expect(page).toHaveURL(/\/daily$/);
  const oldA=(await browserIdentity(page)).body;
  await page.goto('/tarot');
  const draft=page.getByLabel('此刻，你想探索什么？');
  await expect(page.getByText('记录默认仅你可见。共享需要你主动开启。')).toBeVisible();
  await draft.fill('PRIVATE synthetic A draft');
  const second=await context.newPage();
  await signOut(second);
  await expect(draft).toHaveValue('');
  expect((await signIn(second,usernameB)).status()).toBe(200);
  await expect(second).toHaveURL(/\/daily$/);
  await page.bringToFront();
  await expect(draft).toHaveValue('');
  const oldB=(await browserIdentity(page)).body;
  expect(oldB.id).toBe(b.id);
  await expect(page.getByText('记录默认仅你可见。共享需要你主动开启。')).toBeVisible();
  await draft.fill('PRIVATE synthetic B draft');
  await signOut(second);
  await expect(draft).toHaveValue('');
  expect((await signIn(second,usernameA)).status()).toBe(200);
  await expect(second).toHaveURL(/\/daily$/);
  await page.bringToFront();
  await expect(draft).toHaveValue('');
  const current=(await browserIdentity(page)).body;
  expect(current.id).toBe(a.id);
  expect(current.sessionBinding).not.toBe(oldA.sessionBinding);
  for(const previous of [oldA,oldB]){
   const stale=await context.request.post(origin+'/api/v1/readings',{
    headers:{Origin:origin,'X-Expected-Actor':previous.id,'X-Expected-Session':previous.sessionBinding},
    data:{kind:'tarot',question:'PRIVATE stale synthetic draft',spread:'single',allowReversed:false,requestId:randomUUID()},
   });
   expect(stale.status()).toBe(409);
  }
  const readings=await context.request.get(origin+'/api/v1/readings');
  expect((await readings.json()).items).toEqual([]);
 });
});
