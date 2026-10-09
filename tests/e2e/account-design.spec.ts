import {test,expect} from '@playwright/test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {QRCodeSVG} from 'qrcode.react';
// Fault-injection routes must own their requests; the dedicated PWA suite keeps workers enabled.
test.use({serviceWorkers:'block'});
test.beforeEach(async({page})=>{await page.route('**/api/v1/me',route=>route.fulfill({status:401,json:{error:{message:'请先登录'}}}));});
const accountHelp='账户由管理员预先创建。忘记密码请联系管理员。';
test('pre-created account login has visible username labels and help on a narrow screen',async({page})=>{
 await page.setViewportSize({width:320,height:780});await page.goto('/account');
 await expect(page.getByLabel('用户名',{exact:true})).toHaveAttribute('autocomplete','username');
 const password=page.getByLabel('密码',{exact:true});await password.fill('private-test-password');await expect(password).toHaveAttribute('type','password');
 await expect(page.getByText(accountHelp,{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:/创建.*账户|忘记密码|发送.*邮件/})).toHaveCount(0);
 await expect(page.getByLabel('邮箱',{exact:true})).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'test-results/account-mobile-login-help.png',fullPage:true,animations:'disabled'});
});
test('legacy email links scrub reset tokens and only offer username login',async({page})=>{
 const mailRequests:string[]=[];page.on('request',request=>{if(/\/api\/auth\/(?:reset-password|request-password-reset|send-verification-email|verify-email|sign-up)/.test(new URL(request.url()).pathname))mailRequests.push(request.url());});
 for(const suffix of ['?token=synthetic-reset-token-only','?mode=verify','?mode=forgot','?mode=signup','?verified=true']){
  await page.goto('/account'+suffix);
  await expect(page.getByLabel('用户名',{exact:true})).toBeVisible();
  expect(new URL(page.url()).searchParams.has('token')).toBe(false);
  await expect(page.getByLabel('新密码',{exact:true})).toHaveCount(0);
  await expect(page.getByLabel('邮箱',{exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'登录',exact:true})).toBeVisible();
  await expect(page.getByText(accountHelp,{exact:true})).toBeVisible();
  if(!suffix.includes('signup'))await expect(page.getByText('邮箱验证与邮件重设密码已停用，请使用管理员提供的用户名和密码登录。',{exact:true})).toBeVisible();
 }
 expect(mailRequests).toEqual([]);
});
test('daylight account, navigation and public feature pages remain usable',async({page},info)=>{
 for(const path of ['/','/account','/space','/library','/iching']){
  await page.goto(path);await expect(page.locator('main h1:visible, main h2:visible').first()).toBeVisible();if(path==='/account'){await expect(page.getByRole('button',{name:'登录',exact:true})).toBeVisible();await expect(page.getByText(accountHelp,{exact:true})).toBeVisible();}
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'test-results/luminous-'+(path==='/'?'home':path.slice(1))+'-'+info.project.name+'.png',fullPage:path!=='/library',animations:'disabled'});
 }
});
test('a legacy token cannot override a confirmed private account or reveal its internal email',async({page})=>{
 let confirm:()=>void=()=>{};await page.route('**/api/v1/me',async route=>{await new Promise<void>(resolve=>{confirm=resolve;});return route.fulfill({json:{id:'legacy-owner',name:'Legacy owner',username:null,email:'internal-only@accounts.invalid',role:'user',twoFactorEnabled:false,sessionBinding:'legacy-session'}});});
 await page.goto('/account?token=synthetic-reset-only');await expect(page).toHaveURL(/\/account$/);confirm();await expect(page.getByRole('heading',{name:'Legacy owner，你好。',exact:true})).toBeVisible();await expect(page.getByLabel('新密码',{exact:true})).toHaveCount(0);await expect(page.getByText(/accounts\.invalid/)).toHaveCount(0);
});
test('username login normalizes case and surrounding whitespace and locks pending controls',async({page})=>{
 let release:()=>void=()=>{},called:()=>void=()=>{};const started=new Promise<void>(resolve=>{called=resolve;}),requests:Record<string,unknown>[]=[];
 await page.route('**/api/auth/sign-in/username',async route=>{requests.push(route.request().postDataJSON());called();await new Promise<void>(resolve=>{release=resolve;});return route.fulfill({status:401,json:{message:'Synthetic wrong password',code:'INVALID_USERNAME_OR_PASSWORD'}});});
 await page.goto('/account');await page.getByLabel('用户名',{exact:true}).fill('  Synthetic.User-1  ');await page.getByLabel('密码',{exact:true}).fill('synthetic-private-password');await page.getByRole('button',{name:'登录',exact:true}).click();await started;
 await expect(page.getByLabel('用户名',{exact:true})).toBeDisabled();await expect(page.getByLabel('密码',{exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'登录',exact:true})).toBeDisabled();release();
 await expect(page.getByRole('alert')).toContainText('登录失败，请检查用户名和密码。');expect(requests).toEqual([{username:'synthetic.user-1',password:'synthetic-private-password'}]);
 await expect(page.getByLabel('密码',{exact:true})).toHaveValue('');
});
test('invalid usernames cannot submit an authentication request',async({page})=>{
 const requests:string[]=[];await page.route('**/api/auth/sign-in/username',route=>{requests.push(route.request().url());return route.fulfill({status:401,json:{message:'Unexpected submission'}});});
 await page.goto('/account');
 for(const username of ['xy','-synthetic','synthetic@example.test','用户测试','Ksynthetic','a'.repeat(33)]){
  await page.getByLabel('用户名',{exact:true}).fill(username);await page.getByLabel('密码',{exact:true}).fill('synthetic-private-password');await page.getByRole('button',{name:'登录',exact:true}).click();await expect(page.getByRole('alert')).toContainText('用户名需为 3–32 位小写英文字母、数字、点、下划线或短横线，并以字母或数字开头。');
 }
 expect(requests).toEqual([]);
});
test('password controls are keyboard reachable and respect reduced motion',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/account');await page.getByLabel('用户名',{exact:true}).focus();await page.keyboard.press('Tab');await expect(page.getByLabel('密码',{exact:true})).toBeFocused();await page.keyboard.press('Tab');await expect(page.getByRole('button',{name:'显示密码',exact:true})).toBeFocused();await page.keyboard.press('Enter');await expect(page.getByLabel('密码',{exact:true})).toHaveAttribute('type','text');await page.keyboard.press('Enter');await expect(page.getByLabel('密码',{exact:true})).toHaveAttribute('type','password');
});
test('username two-step login keeps authenticator and recovery codes masked and clears interrupted input',async({page})=>{
 await page.route('**/api/auth/sign-in/username',route=>route.fulfill({json:{twoFactorRedirect:true}}));
 await page.goto('/account');await page.getByLabel('用户名',{exact:true}).fill('synthetic-two-factor');await page.getByLabel('密码',{exact:true}).fill('synthetic-private-password');await page.getByRole('button',{name:'登录',exact:true}).click();
 const authenticator=page.getByLabel('身份验证器中的六位验证码',{exact:true});await expect(authenticator).toHaveAttribute('type','password');await authenticator.fill('123456');
 await page.getByRole('button',{name:'使用恢复码',exact:true}).click();const recovery=page.getByLabel('一次性恢复码',{exact:true});await expect(recovery).toHaveAttribute('type','password');await expect(recovery).toHaveValue('');await recovery.fill('synthetic-recovery-code');
 await page.getByRole('button',{name:'使用身份验证器',exact:true}).click();await expect(authenticator).toHaveValue('');await page.getByRole('button',{name:'返回登录',exact:true}).click();await expect(page.getByLabel('密码',{exact:true})).toHaveValue('');await expect(page.getByLabel('密码',{exact:true})).toHaveAttribute('type','password');await expect(page.getByLabel('身份验证器中的六位验证码',{exact:true})).toHaveCount(0);
});
test('recovery codes must be viewed before confirming offline storage',async({page})=>{
 const owner={id:'synthetic-totp-owner',name:'Synthetic owner',username:'synthetic-owner',email:'totp@accounts.invalid',role:'user',twoFactorEnabled:false,sessionBinding:'synthetic-totp-session'};
 await page.route('**/api/v1/me',route=>route.fulfill({json:owner}));await page.route('**/api/auth/two-factor/enable',route=>route.fulfill({json:{method:'totp',totpURI:'otpauth://totp/opaque%40accounts.invalid?secret=JBSWY3DPEHPK3PXP&issuer=Star%20Oracle&digits=6&period=30',backupCodes:['synthetic-recovery-code']}}));
 await page.goto('/account');await expect(page.getByText('用户名：synthetic-owner',{exact:true})).toBeVisible();await expect(page.getByText(/accounts\.invalid/)).toHaveCount(0);await page.getByLabel('当前密码',{exact:true}).fill('synthetic-private-password');await page.getByRole('button',{name:'启用两步验证',exact:true}).click();const displayURI='otpauth://totp/'+encodeURIComponent('照见 Star Oracle:synthetic-owner')+'?secret=JBSWY3DPEHPK3PXP&issuer=Star%20Oracle&digits=6&period=30';const expectedQR=renderToStaticMarkup(createElement(QRCodeSVG,{value:displayURI,size:180,marginSize:3}));const expectedPath=expectedQR.match(/<path fill="#000000" d="([^"]+)"/)?.[1];expect(expectedPath).toBeTruthy();await expect(page.locator('.totp-setup svg path[fill="#000000"]')).toHaveAttribute('d',expectedPath!);await expect(page.getByRole('button',{name:'我已妥善保存',exact:true})).toBeDisabled();await page.getByRole('button',{name:'显示恢复码',exact:true}).click();await expect(page.locator('.backup-codes code')).toContainText('synthetic-recovery-code');await page.getByRole('button',{name:'隐藏恢复码',exact:true}).click();await page.getByRole('button',{name:'我已妥善保存',exact:true}).click();await expect(page.locator('.backup-codes')).toHaveCount(0);await page.getByLabel('确认两步验证验证码',{exact:true}).fill('123456');await expect(page.getByRole('button',{name:'确认启用',exact:true})).toBeEnabled();
});
test('legacy accounts without usernames use their display name in the authenticator QR',async({page})=>{
 await page.route('**/api/v1/me',route=>route.fulfill({json:{id:'legacy-totp-owner',name:'Legacy display name',email:'opaque@accounts.invalid',role:'user',twoFactorEnabled:false,sessionBinding:'legacy-totp-session'}}));
 await page.route('**/api/auth/two-factor/enable',route=>route.fulfill({json:{method:'totp',totpURI:'otpauth://totp/opaque%40accounts.invalid?secret=JBSWY3DPEHPK3PXP&issuer=Star%20Oracle',backupCodes:['synthetic-backup']}}));
 await page.goto('/account');await page.getByLabel('当前密码',{exact:true}).fill('synthetic-private-password');await page.getByRole('button',{name:'启用两步验证',exact:true}).click();
 const displayURI='otpauth://totp/'+encodeURIComponent('照见 Star Oracle:Legacy display name')+'?secret=JBSWY3DPEHPK3PXP&issuer=Star%20Oracle';const expectedQR=renderToStaticMarkup(createElement(QRCodeSVG,{value:displayURI,size:180,marginSize:3}));const expectedPath=expectedQR.match(/<path fill="#000000" d="([^"]+)"/)?.[1];expect(expectedPath).toBeTruthy();await expect(page.locator('.totp-setup svg path[fill="#000000"]')).toHaveAttribute('d',expectedPath!);await expect(page.getByText(/accounts\.invalid/)).toHaveCount(0);
});
