import {test,expect,type BrowserContext,type Page,type Response} from '@playwright/test';
import {spawnSync} from 'node:child_process';
import {createHmac,randomUUID} from 'node:crypto';
import {closeSync,constants,fstatSync,openSync,readFileSync} from 'node:fs';
import {isAbsolute} from 'node:path';

// Fail before reading credentials or touching infrastructure outside the dedicated
// synthetic CI harness. This suite never provisions accounts or opens a database.
if(process.env.CI!=='true')throw new Error('Shared browser verification is restricted to isolated CI.');

type Account={username:string;password:string;id:string;name:string};
type Fixture={accounts:Account[];redisContainer:string;redisPassword:string};
type Identity={id:string;sessionBinding:string};
const origin='http://localhost:17777';
const sessionCookie='star-oracle-ssh.session_token';
const noticeName='访问方式与安全边界';

function loadFixture():Fixture{
 const path=process.env.SHARED_BROWSER_FIXTURE;
 if(!path||!isAbsolute(path))throw new Error('An absolute private SHARED_BROWSER_FIXTURE path is required.');
 let fd:number|undefined;
 let value:unknown;
 try{
  fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  const stat=fstatSync(fd);
  if(!stat.isFile()||(stat.mode&0o077)!==0||stat.size>65536)throw new Error('Invalid private fixture file');
  value=JSON.parse(readFileSync(fd,'utf8'));
 }catch{
  throw new Error('Cannot read the private shared browser fixture; it must be a small regular file with owner-only permissions.');
 }finally{if(fd!==undefined)closeSync(fd);}
 const fixture=value as Partial<Fixture>|null;
 if(!fixture||typeof fixture!=='object'||!Array.isArray(fixture.accounts)||fixture.accounts.length!==6||
    typeof fixture.redisContainer!=='string'||!/^star-oracle-shared-redis-\d+$/.test(fixture.redisContainer)||
    typeof fixture.redisPassword!=='string'||fixture.redisPassword.length<12){
  throw new Error('Invalid isolated shared browser fixture.');
 }
 for(const account of fixture.accounts){
  if(!account||typeof account!=='object'||typeof account.username!=='string'||
     !/^synthetic-[a-z0-9._-]{1,22}$/.test(account.username)||typeof account.password!=='string'||
     account.password.length<12||account.password.length>128||typeof account.id!=='string'||!account.id||
     typeof account.name!=='string'||!account.name){
   throw new Error('Shared browser fixture requires six complete synthetic accounts.');
  }
 }
 if(new Set(fixture.accounts.map(account=>account.id)).size!==6||
    new Set(fixture.accounts.map(account=>account.username)).size!==6){
  throw new Error('Shared browser fixture accounts must be distinct.');
 }
 return fixture as Fixture;
}

const fixture=loadFixture();

function resetSyntheticLoginLimits(){
 if(process.env.CI!=='true'||!/^star-oracle-shared-redis-\d+$/.test(fixture.redisContainer)){
  throw new Error('Refusing to reset anything except isolated shared CI Redis.');
 }
 // Explicitly select the local CI daemon; inherited Docker contexts/hosts cannot
 // redirect this destructive operation to any remote or external Redis instance.
 const result=spawnSync('docker',['--host','unix:///var/run/docker.sock','exec','-e','REDISCLI_AUTH',
  fixture.redisContainer,'redis-cli','FLUSHDB'],{
  env:{...process.env,REDISCLI_AUTH:fixture.redisPassword},encoding:'utf8',timeout:15000,
 });
 if(result.error||result.status!==0||result.stdout.trim()!=='OK'){
  // Child output and arguments are intentionally omitted from errors.
  throw new Error('Could not reset the dedicated ephemeral CI Redis before sign-in.');
 }
}

async function signIn(page:Page,account:Account,password=account.password){
 resetSyntheticLoginLimits();
 await page.goto('/account');
 await page.getByLabel('用户名',{exact:true}).fill(account.username);
 await page.getByLabel('密码',{exact:true}).fill(password);
 const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/auth/sign-in/username'&&r.request().method()==='POST');
 await page.getByRole('button',{name:'登录',exact:true}).click();
 return response;
}

async function signOut(page:Page){
 await page.goto('/account');
 const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/auth/sign-out'&&r.request().method()==='POST');
 await page.getByRole('button',{name:'退出登录',exact:true}).click();
 expect((await response).status()).toBe(200);
 await expect(page).toHaveURL(origin+'/');
}

async function browserIdentity(page:Page){
 return page.evaluate(async()=>{
  const response=await fetch('/api/v1/me',{credentials:'same-origin'});
  return {status:response.status,body:await response.json() as Partial<Identity>};
 });
}

async function authenticatedIdentity(page:Page,account:Account):Promise<Identity>{
 const response=await browserIdentity(page);
 expect(response.status).toBe(200);
 expect(response.body.id).toBe(account.id);
 expect(typeof response.body.sessionBinding==='string'&&response.body.sessionBinding.length>0).toBe(true);
 return response.body as Identity;
}

async function expectSessionCookie(context:BrowserContext,response:Response,name=sessionCookie){
 const cookie=(await context.cookies(origin)).find(item=>item.name===name);
 expect(Boolean(cookie)).toBe(true);
 // Assert only public attributes so failure messages cannot print cookie values.
 expect(cookie&&{domain:cookie.domain,path:cookie.path,httpOnly:cookie.httpOnly,secure:cookie.secure,sameSite:cookie.sameSite})
  .toEqual({domain:'localhost',path:'/',httpOnly:true,secure:false,sameSite:'Lax'});
 expect(cookie!.expires>Date.now()/1000).toBe(true);
 const headers=(await response.headersArray()).filter(header=>header.name.toLowerCase()==='set-cookie'&&header.value.startsWith(name+'='));
 expect(headers.length).toBe(1);
 const value=headers[0]!.value;
 expect({
  httpOnly:/;\s*HttpOnly(?:;|$)/i.test(value),sameSite:/;\s*SameSite=Lax(?:;|$)/i.test(value),
  path:/;\s*Path=\/(?:;|$)/i.test(value),domain:/;\s*Domain=/i.test(value),secure:/;\s*Secure(?:;|$)/i.test(value),
 }).toEqual({httpOnly:true,sameSite:true,path:true,domain:false,secure:false});
 if(name===sessionCookie)expect(/;\s*Max-Age=604800(?:;|$)/i.test(value)).toBe(true);
}

async function expectSignedOut(page:Page,context:BrowserContext){
 expect((await browserIdentity(page)).status).toBe(401);
 expect((await context.cookies(origin)).some(cookie=>cookie.name===sessionCookie)).toBe(false);
}

function currentTotp(uri:string){
 let parameters:URLSearchParams;
 try{
  const parsed=new URL(uri);
  if(parsed.protocol!=='otpauth:'||parsed.hostname!=='totp')throw new Error();
  parameters=parsed.searchParams;
 }catch{throw new Error('Invalid synthetic authenticator URI.');}
 const secret=(parameters.get('secret')??'').toUpperCase().replace(/=+$/,'');
 const period=Number(parameters.get('period')??30),digits=Number(parameters.get('digits')??6);
 if(!/^[A-Z2-7]+$/.test(secret)||!Number.isSafeInteger(period)||period<1||digits!==6||
    (parameters.get('algorithm')??'SHA1').toUpperCase()!=='SHA1')throw new Error('Invalid synthetic authenticator parameters.');
 const bits=[...secret].map(char=>'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(char).toString(2).padStart(5,'0')).join('');
 const key=Buffer.from((bits.match(/.{8}/g)??[]).map(byte=>parseInt(byte,2)));
 const counter=Buffer.alloc(8);
 counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/1000/period)));
 const hash=createHmac('sha1',key).update(counter).digest(),offset=hash[hash.length-1]!&15;
 return ((hash.readUInt32BE(offset)&0x7fffffff)%10**digits).toString().padStart(digits,'0');
}

test('built shared images enforce browser sessions, private tab boundaries and single-use recovery',async({page,context,baseURL},info)=>{
 expect(baseURL).toBe(origin);
 const offset=info.project.metadata.accountOffset;
 if(typeof offset!=='number'||![0,2,4].includes(offset))throw new Error('A distinct shared account pair is required for each browser project.');
 const a=fixture.accounts[offset]!,b=fixture.accounts[offset+1]!;

 await test.step('real SSH entry and invalid username-password authentication',async()=>{
  await page.goto('/account');
  const health=await page.request.get('/api/v1/health');
  expect(health.status()).toBe(200);
  expect(health.headers()['strict-transport-security']).toBeUndefined();
  const config=await page.request.get('/api/v1/config');
  expect(config.status()).toBe(200);
  expect((await config.json()).deploymentMode).toBe('ssh-only');
  await expect(page.getByRole('note',{name:noticeName})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await expect(page.getByLabel('用户名',{exact:true})).toHaveValue('');
  await expect(page.getByLabel('密码',{exact:true})).toHaveValue('');
  await page.evaluate(()=>document.fonts.ready);
  await page.screenshot({path:info.outputPath('shared-login-'+info.project.name+'.png'),fullPage:true,animations:'disabled'});
  expect((await signIn(page,a,'Synthetic-invalid-'+randomUUID())).status()).toBe(401);
  await expect(page.getByRole('alert')).toContainText('登录失败，请检查用户名和密码。');
  await expect(page.getByLabel('密码',{exact:true})).toHaveValue('');
  await expectSignedOut(page,context);
 });

 await test.step('host-only HttpOnly Lax session survives refresh and logout revokes it',async()=>{
  const response=await signIn(page,a);
  expect(response.status()).toBe(200);
  expect(response.headers()['strict-transport-security']).toBeUndefined();
  await expect(page).toHaveURL(origin+'/daily');
  await expectSessionCookie(context,response);
  expect(await page.evaluate(name=>document.cookie.includes(name),sessionCookie)).toBe(false);
  await page.reload();
  await authenticatedIdentity(page,a);
  await expect(page.getByLabel('私人日记',{exact:true})).toBeVisible();
  await expect(page.getByLabel('私人日记',{exact:true})).toHaveValue('');
  await page.evaluate(()=>document.fonts.ready);
  await expect.poll(()=>page.evaluate(()=>[...document.images].every(image=>image.complete&&image.naturalWidth>0))).toBe(true);
  await page.screenshot({path:info.outputPath('shared-daily-'+info.project.name+'.png'),fullPage:true,animations:'disabled'});
  await page.goto('/account');
  await expect(page.getByRole('heading',{name:a.name+'，你好。',exact:true})).toBeVisible();
  await signOut(page);
  await expectSignedOut(page,context);
  await page.reload();
  await page.goto('/account');
  await expect(page.getByLabel('用户名',{exact:true})).toBeVisible();
 });

 await test.step('A-B-A switches clear private drafts and reject both obsolete session bindings',async()=>{
  expect((await signIn(page,a)).status()).toBe(200);
  await expect(page).toHaveURL(origin+'/daily');
  const oldA=await authenticatedIdentity(page,a);
  await page.goto('/tarot');
  const draft=page.getByLabel('此刻，你想探索什么？');
  await expect(page.getByText('记录默认仅你可见。共享需要你主动开启。')).toBeVisible();
  await draft.fill('PRIVATE synthetic shared A draft');
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect(draft).toHaveValue('PRIVATE synthetic shared A draft');
  const second=await context.newPage();
  await signOut(second);
  await expect(draft).toHaveValue('');
  expect((await signIn(second,b)).status()).toBe(200);
  await expect(second).toHaveURL(origin+'/daily');
  await page.bringToFront();
  await expect(draft).toHaveValue('');
  const oldB=await authenticatedIdentity(page,b);
  const bReadings=await context.request.get(origin+'/api/v1/readings');
  expect(bReadings.status()).toBe(200);
  expect((await bReadings.json()).items).toEqual([]);
  await expect(page.getByText('记录默认仅你可见。共享需要你主动开启。')).toBeVisible();
  await draft.fill('PRIVATE synthetic shared B draft');
  await signOut(second);
  await expect(draft).toHaveValue('');
  expect((await signIn(second,a)).status()).toBe(200);
  await expect(second).toHaveURL(origin+'/daily');
  await page.bringToFront();
  await expect(draft).toHaveValue('');
  const current=await authenticatedIdentity(page,a);
  expect(current.sessionBinding!==oldA.sessionBinding).toBe(true);
  for(const previous of [oldA,oldB]){
   const stale=await context.request.post(origin+'/api/v1/readings',{
    headers:{Origin:origin,'X-Expected-Actor':previous.id,'X-Expected-Session':previous.sessionBinding},
    data:{kind:'tarot',question:'PRIVATE stale synthetic shared draft',spread:'single',allowReversed:false,requestId:randomUUID()},
   });
   expect(stale.status()).toBe(409);
  }
  const readings=await context.request.get(origin+'/api/v1/readings');
  expect(readings.status()).toBe(200);
  expect((await readings.json()).items).toEqual([]);
  await second.close();
 });

 let totpURI='',backupCodes:string[]=[];
 await test.step('enroll this browser project’s dedicated TOTP account',async()=>{
  await page.goto('/account');
  await page.getByLabel('当前密码',{exact:true}).fill(a.password);
  const enrollmentResponse=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/auth/two-factor/enable'&&r.request().method()==='POST');
  await page.getByRole('button',{name:'启用两步验证',exact:true}).click();
  const enrollment=await enrollmentResponse;
  expect(enrollment.status()).toBe(200);
  const data=await enrollment.json();
  expect(typeof data.totpURI==='string'&&Array.isArray(data.backupCodes)&&data.backupCodes.length>=2&&
   data.backupCodes.every((code:unknown)=>typeof code==='string'&&code.length>0)).toBe(true);
  totpURI=data.totpURI;backupCodes=data.backupCodes;
  await page.getByRole('button',{name:'显示恢复码',exact:true}).click();
  expect((await page.locator('.backup-codes code').textContent())?.includes(backupCodes[0]!)).toBe(true);
  await page.getByRole('button',{name:'我已妥善保存',exact:true}).click();
  await expect(page.locator('.backup-codes')).toHaveCount(0);
  await page.getByLabel('确认两步验证验证码',{exact:true}).fill(currentTotp(totpURI));
  const verification=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/auth/two-factor/verify-totp'&&r.request().method()==='POST');
  await page.getByRole('button',{name:'确认启用',exact:true}).click();
  expect((await verification).status()).toBe(200);
  await expect(page.getByRole('button',{name:'关闭两步验证',exact:true})).toBeVisible();
  await signOut(page);
  await expectSignedOut(page,context);
 });

 await test.step('TOTP challenge has no authenticated session until the browser verifies it',async()=>{
  const response=await signIn(page,a);
  expect(response.status()).toBe(200);
  const code=page.getByLabel('身份验证器中的六位验证码',{exact:true});
  await expect(code).toBeVisible();
  await expectSignedOut(page,context);
  await expectSessionCookie(context,response,'star-oracle-ssh.two_factor');
  await code.fill(currentTotp(totpURI));
  await page.getByRole('button',{name:'确认验证码',exact:true}).click();
  await expect(page).toHaveURL(origin+'/daily');
  await page.reload();
  await authenticatedIdentity(page,a);
  await signOut(page);
  await expectSignedOut(page,context);
 });

 await test.step('a recovery code authenticates once and the same code cannot authenticate again',async()=>{
  expect((await signIn(page,a)).status()).toBe(200);
  await page.getByRole('button',{name:'使用恢复码',exact:true}).click();
  await page.getByLabel('一次性恢复码',{exact:true}).fill(backupCodes[0]!);
  await page.getByRole('button',{name:'确认验证码',exact:true}).click();
  await expect(page).toHaveURL(origin+'/daily');
  await page.reload();
  await authenticatedIdentity(page,a);
  await signOut(page);
  await expectSignedOut(page,context);
  expect((await signIn(page,a)).status()).toBe(200);
  await page.getByRole('button',{name:'使用恢复码',exact:true}).click();
  await page.getByLabel('一次性恢复码',{exact:true}).fill(backupCodes[0]!);
  const reused=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/auth/two-factor/verify-backup-code'&&r.request().method()==='POST');
  await page.getByRole('button',{name:'确认验证码',exact:true}).click();
  expect((await reused).status()).toBe(401);
  await expect(page.getByRole('alert')).toBeVisible();
  await expectSignedOut(page,context);
  // A different recovery code still works, distinguishing single-use enforcement
  // from an indiscriminately broken challenge or a rate-limit response.
  await page.getByLabel('一次性恢复码',{exact:true}).fill(backupCodes[1]!);
  await page.getByRole('button',{name:'确认验证码',exact:true}).click();
  await expect(page).toHaveURL(origin+'/daily');
  await authenticatedIdentity(page,a);
  // Leave this real authenticated session in the synthetic source database so
  // encrypted candidate recovery must demonstrably revoke recovered sessions.
 });
});
