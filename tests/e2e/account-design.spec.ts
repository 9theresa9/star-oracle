import {test,expect} from '@playwright/test';
test.beforeEach(async({page})=>{await page.route('**/api/v1/me',route=>route.fulfill({status:401,json:{error:{message:'请先登录'}}}));});
test('account modes discard passwords, keep visible labels and fit a narrow screen',async({page})=>{
 await page.setViewportSize({width:320,height:780});await page.goto('/account');
 const password=page.getByLabel('密码',{exact:true});await password.fill('private-test-password');await expect(password).toHaveAttribute('type','password');
 await page.getByRole('button',{name:'创建新账户',exact:true}).click();await expect(page.getByLabel('密码',{exact:true})).toHaveValue('');
 await page.getByRole('button',{name:'已有账户，登录',exact:true}).click();await page.getByRole('button',{name:'忘记密码',exact:true}).click();
 await expect(page.getByRole('button',{name:'发送重设邮件',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'test-results/account-mobile-reset-request.png',fullPage:true,animations:'disabled'});
});
test('reset token is removed from address bar without removing reset capability',async({page})=>{
 await page.goto('/account?token=synthetic-reset-token-only');
 await expect(page.getByLabel('新密码',{exact:true})).toBeVisible();
 await expect(page).toHaveURL(/\/account$/);
 await expect(page.getByLabel('新密码',{exact:true})).toHaveAttribute('type','password');
});
test('daylight account, navigation and public feature pages remain usable',async({page},info)=>{
 for(const path of ['/','/account','/space','/library','/iching']){
  await page.goto(path);await expect(page.locator('main h1, main h2').first()).toBeVisible();if(path==='/account')await expect(page.getByRole('button',{name:'登录',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'test-results/luminous-'+(path==='/'?'home':path.slice(1))+'-'+info.project.name+'.png',fullPage:true,animations:'disabled'});
 }
 await page.goto('/account');await page.getByRole('button',{name:'创建新账户',exact:true}).click();await expect(page.getByLabel('怎么称呼你')).toBeVisible();await page.screenshot({path:'test-results/luminous-signup-'+info.project.name+'.png',fullPage:true,animations:'disabled'});
 await page.getByRole('button',{name:'已有账户，登录',exact:true}).click();await page.getByRole('button',{name:'重新发送验证邮件',exact:true}).click();await expect(page.getByRole('button',{name:'发送验证邮件',exact:true})).toBeVisible();
});
test('reset token survives initial signed-in session confirmation but stays out of the URL',async({page})=>{
 let confirm:()=>void=()=>{};await page.route('**/api/v1/me',async route=>{await new Promise<void>(resolve=>{confirm=resolve;});return route.fulfill({json:{id:'reset-owner',name:'Reset owner',email:'reset@example.test',role:'user',twoFactorEnabled:false,sessionBinding:'reset-session'}});});
 await page.goto('/account?token=synthetic-reset-only');await expect(page.getByLabel('新密码',{exact:true})).toBeVisible();await expect(page).toHaveURL(/\/account$/);confirm();await expect(page.getByLabel('新密码',{exact:true})).toBeVisible();
});
test('mode changes stay disabled while an email request is pending',async({page})=>{
 let release:()=>void=()=>{};await page.route('**/api/auth/request-password-reset',async route=>{await new Promise<void>(resolve=>{release=resolve;});return route.fulfill({json:{status:true}});});
 await page.goto('/account');await page.getByRole('button',{name:'忘记密码',exact:true}).click();await page.getByLabel('邮箱',{exact:true}).fill('synthetic@example.test');await page.getByRole('button',{name:'发送重设邮件',exact:true}).click();await expect(page.getByRole('button',{name:'返回登录',exact:true})).toBeDisabled();release();await expect(page.getByRole('button',{name:'返回登录',exact:true})).toBeEnabled();
});
test('a transient reset failure preserves the stripped token for a safe retry',async({page})=>{
 const tokens:string[]=[];await page.route('**/api/auth/reset-password',route=>{tokens.push(route.request().postDataJSON().token);return tokens.length===1?route.fulfill({status:503,json:{message:'Synthetic retryable failure',code:'TEMPORARY'}}):route.fulfill({json:{status:true}});});
 await page.goto('/account?token=synthetic-retry-reset-token');await page.getByLabel('新密码',{exact:true}).fill('synthetic-new-password-123');await page.getByRole('button',{name:'保存新密码',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Synthetic retryable failure');await expect(page.getByLabel('新密码',{exact:true})).toBeVisible();await page.getByRole('button',{name:'保存新密码',exact:true}).click();await expect(page.getByRole('button',{name:'登录',exact:true})).toBeVisible();expect(tokens).toEqual(['synthetic-retry-reset-token','synthetic-retry-reset-token']);
});
test('password controls are keyboard reachable and respect reduced motion',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/account');await page.getByLabel('邮箱',{exact:true}).focus();await page.keyboard.press('Tab');await expect(page.getByLabel('密码',{exact:true})).toBeFocused();await page.keyboard.press('Tab');await expect(page.getByRole('button',{name:'显示密码',exact:true})).toBeFocused();await page.keyboard.press('Enter');await expect(page.getByLabel('密码',{exact:true})).toHaveAttribute('type','text');await page.keyboard.press('Enter');await expect(page.getByLabel('密码',{exact:true})).toHaveAttribute('type','password');
});
test('recovery codes must be viewed before confirming offline storage',async({page})=>{
 const owner={id:'synthetic-totp-owner',name:'Synthetic owner',email:'totp@example.test',role:'user',twoFactorEnabled:false,sessionBinding:'synthetic-totp-session'};
 await page.route('**/api/v1/me',route=>route.fulfill({json:owner}));await page.route('**/api/auth/two-factor/enable',route=>route.fulfill({json:{method:'totp',totpURI:'otpauth://totp/synthetic?secret=JBSWY3DPEHPK3PXP',backupCodes:['synthetic-recovery-code']}}));
 await page.goto('/account');await page.getByLabel('当前密码',{exact:true}).fill('synthetic-private-password');await page.getByRole('button',{name:'启用两步验证',exact:true}).click();await expect(page.getByRole('button',{name:'我已妥善保存',exact:true})).toBeDisabled();await page.getByRole('button',{name:'显示恢复码',exact:true}).click();await expect(page.locator('.backup-codes code')).toContainText('synthetic-recovery-code');await page.getByRole('button',{name:'隐藏恢复码',exact:true}).click();await page.getByRole('button',{name:'我已妥善保存',exact:true}).click();await expect(page.locator('.backup-codes')).toHaveCount(0);await page.getByLabel('确认两步验证验证码',{exact:true}).fill('123456');await expect(page.getByRole('button',{name:'确认启用',exact:true})).toBeEnabled();
});
