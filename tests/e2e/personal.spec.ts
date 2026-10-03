import { test,expect,type Page,type Response,type TestInfo } from './fixtures';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';

function write(page:Page,path:string,method:'POST'|'PATCH'|'DELETE'){
 return page.waitForResponse(response=>new URL(response.url()).pathname===path&&response.request().method()===method);
}
async function succeeded(response:Response,status=200){
 expect(response.status(),response.request().method()+' '+new URL(response.url()).pathname+' should persist successfully').toBe(status);
 return response.json();
}
async function fits(page:Page){
 const viewport=await page.evaluate(()=>({
  fits:document.documentElement.scrollWidth<=window.innerWidth,
  scale:window.visualViewport?.scale??1,
  offsetLeft:window.visualViewport?.offsetLeft??0,
  scrollX:window.scrollX,scrollY:window.scrollY,innerWidth:window.innerWidth,innerHeight:window.innerHeight,
  visual:window.visualViewport?{width:window.visualViewport.width,height:window.visualViewport.height,offsetTop:window.visualViewport.offsetTop,pageLeft:window.visualViewport.pageLeft,pageTop:window.visualViewport.pageTop}:null
 }));
 if(process.env.CI_REVIEW_DETAIL==='true'&&(!viewport.fits||Math.abs(viewport.scale-1)>=0.005||Math.abs(viewport.offsetLeft)>1||Math.abs(viewport.scrollX)>1))console.log('PERSONAL_VIEWPORT_ANOMALY '+JSON.stringify(viewport));
 expect(viewport.fits,'页面应适合当前屏幕，不能出现横向溢出').toBeTruthy();
 expect(viewport.scale,'没有缩放手势时，输入与导航不应自动放大页面').toBeCloseTo(1,2);
 expect(Math.abs(viewport.offsetLeft),'可视区域不能向左右偏移').toBeLessThanOrEqual(1);
 expect(Math.abs(viewport.scrollX),'页面不能发生横向滚动').toBeLessThanOrEqual(1);
}
async function capture(page:Page,info:TestInfo,name:'history'|'insights'|'space'){
 // Check the actual viewport before blur so the overview capture cannot hide input zoom.
 await fits(page);
 await page.evaluate(()=>{if(document.activeElement instanceof HTMLElement)document.activeElement.blur();window.scrollTo({top:0,left:0,behavior:'instant'});});
 await expect.poll(()=>page.evaluate(()=>window.scrollY),'完整页面截图应从页面顶部开始').toBe(0);
 await fits(page);
 await expect(page.locator('main .reveal')).toHaveCSS('opacity','1');
 if(process.env.CI_REVIEW_DETAIL==='true')console.log('PERSONAL_VIEWPORT_'+name+'_'+info.project.name+' '+JSON.stringify(await page.evaluate(()=>({innerWidth:window.innerWidth,innerHeight:window.innerHeight,scrollX:window.scrollX,scrollY:window.scrollY,visual:window.visualViewport?{width:window.visualViewport.width,height:window.visualViewport.height,scale:window.visualViewport.scale,offsetLeft:window.visualViewport.offsetLeft,offsetTop:window.visualViewport.offsetTop,pageLeft:window.visualViewport.pageLeft,pageTop:window.visualViewport.pageTop}:null}))));
 const file=info.outputPath('personal-'+name+'.png');
 await page.screenshot({animations:'disabled',fullPage:true,path:file});
 await info.attach(name,{path:file,contentType:'image/png'});
 if(process.env.CI_REVIEW_DETAIL==='true'&&name!=='insights'&&info.project.name!=='small-chromium'){
  console.log('DETAIL_PREVIEW_'+name+'_'+info.project.name+' '+(await page.screenshot({type:'jpeg',quality:60,animations:'disabled'})).toString('base64'));
 }
}
function privateKeys(value:unknown):string[]{
 if(!value||typeof value!=='object')return [];
 const forbidden=/^(?:password|passwordHash|token|accessToken|refreshToken|idToken|session|sessions|sessionId|sessionToken|authSecret|secret|twoFactorSecret|backupCodes|apiKey)$/i;
 return Object.entries(value).flatMap(([key,item])=>[...(forbidden.test(key)?[key]:[]),...privateKeys(item)]);
}

test('saved explorations, private calendar, actions, reviews and export survive real user navigation',async({page,context},info)=>{
 test.setTimeout(90000);
 const fixtureURL=new URL(process.env.DATABASE_URL??'mysql://invalid');
 if(process.env.NODE_ENV!=='test'||!['localhost','127.0.0.1','[::1]'].includes(fixtureURL.hostname)||fixtureURL.pathname!=='/star_oracle')throw new Error('Private review fixtures require the isolated loopback test database.');
 const email='personal-'+info.project.name+'-'+Date.now()+'@example.com';
 const password='journey-test-password-123';
 const question='我如何把这次领悟转化成一个可以尝试的小行动？';
 const note='记得先做一件很小的事。';
 const journal='今天先放慢脚步，再看见自己真正想做的事。';

 await page.goto('/account');
 await page.getByRole('button',{name:'创建新账户',exact:true}).click();
 await page.getByLabel('怎么称呼你',{exact:true}).fill('星空旅人');
 await page.getByLabel('邮箱',{exact:true}).fill(email);
 await page.getByLabel('密码',{exact:true}).fill(password);
 const signup=page.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/sign-up/email')&&r.request().method()==='POST');
 await page.getByRole('button',{name:'创建账户',exact:true}).click();
 expect((await signup).status()).toBe(200);
 await expect(page.getByRole('button',{name:'登录',exact:true})).toBeVisible();
 await page.getByLabel('邮箱',{exact:true}).fill(email);
 await page.getByLabel('密码',{exact:true}).fill(password);
 const login=page.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/sign-in/email')&&r.request().method()==='POST');
 await page.getByRole('button',{name:'登录',exact:true}).click();
 expect((await login).status()).toBe(200);
 await expect(page.locator('.daily-letter')).toBeVisible();

 await page.getByRole('button',{name:'平静',exact:true}).click();
 await page.getByLabel('私人日记',{exact:true}).fill(journal);
 const dailySave=write(page,'/api/v1/daily/'+(await page.locator('[id^="note-"]').getAttribute('id'))!.slice(5)+'/journal','PATCH');
 await page.getByRole('button',{name:'保存',exact:true}).click();
 const daily=await succeeded(await dailySave);
 await expect(page.getByRole('status').filter({hasText:'已保存到你的私人记录'})).toBeVisible();
 expect(daily.journal.note).toBe(journal);

 // Keep the real account request pending without making document readiness depend on it.
 // The bounded observation gives a useful failure if the browser never routes the request.
 await test.step('真实会话延迟期间禁止访客回退',async()=>{
  let releaseSession!:()=>void,sessionSeen=false;
  const sessionBarrier=new Promise<void>(resolve=>{releaseSession=resolve;});
  await page.route('**/api/v1/me',async route=>{
   sessionSeen=true;
   console.log('PERSONAL_STAGE '+info.project.name+' session-request-held');
   await sessionBarrier;
   await route.continue();
  },{times:1});
  try{
   await test.step('页面可交互时观察未完成的真实会话请求',async()=>{
    console.log('PERSONAL_STAGE '+info.project.name+' tarot-navigation-start');
    await page.goto('/tarot',{waitUntil:'domcontentloaded'});
    console.log('PERSONAL_STAGE '+info.project.name+' tarot-dom-ready');
    await expect.poll(()=>sessionSeen,{timeout:10000,message:'真实会话请求应被延迟拦截观察到'}).toBe(true);
   });
   await test.step('确认账户之前无法提交抽牌',async()=>{
    await page.getByLabel('此刻，你想探索什么？',{exact:true}).fill(question);
    await page.getByRole('button',{name:/情境 · 提醒 · 行动/}).click();
    await expect(page.getByRole('button',{name:'开始抽牌',exact:true}),'账户确认前不可触发访客抽牌').toBeDisabled();
    console.log('PERSONAL_STAGE '+info.project.name+' pending-draw-disabled');
   });
  }finally{
   releaseSession();
   console.log('PERSONAL_STAGE '+info.project.name+' session-request-released');
  }
  await test.step('真实账户确认恢复云端抽牌',async()=>{
   await expect(page.getByRole('button',{name:'开始抽牌',exact:true})).toBeEnabled();
   console.log('PERSONAL_STAGE '+info.project.name+' account-confirmed');
  });
 });
 const drawing=write(page,'/api/v1/readings','POST');
 await page.getByRole('button',{name:'开始抽牌',exact:true}).click();
 const reading=await succeeded(await drawing,201);
 console.log('PERSONAL_STAGE '+info.project.name+' cloud-reading-persisted');
 expect(reading.reading.spread).toBe('three');
 expect(reading.reading.cards).toHaveLength(3);
 await expect(page.getByRole('heading',{name:question,exact:true})).toBeVisible();
 await page.getByRole('button',{name:'全部翻开',exact:true}).click();
 await expect(page.locator('.reading-view .tarot-card')).toHaveCount(3);
 await fits(page);

 await page.goto('/history');
 const entry=page.locator('.history-item').filter({has:page.getByRole('heading',{name:question,exact:true})});
 await entry.locator('.history-toggle').click();
 await page.getByRole('button',{name:'☆ 收藏',exact:true}).click();
 await page.locator('.record-metadata').getByLabel('标签',{exact:true}).fill('成长、行动');
 await page.getByLabel('私人备注',{exact:true}).fill(note);
 const metadataSave=write(page,'/api/v1/readings/'+reading.id+'/metadata','PATCH');
 await page.getByRole('button',{name:'保存记号',exact:true}).click();
 const metadata=await succeeded(await metadataSave);
 expect(metadata.favorite).toBe(true);
 expect(metadata.tags).toEqual(['成长','行动']);
 expect(metadata.note).toBe(note);
 await expect(page.getByRole('status').filter({hasText:'收藏、标签与备注已保存'})).toBeVisible();

 await page.reload();
 await page.locator('.history-toggle').filter({hasText:question}).click();
 await expect(page.getByRole('button',{name:'★ 已收藏',exact:true})).toHaveAttribute('aria-pressed','true');
 await expect(page.locator('.record-metadata').getByLabel('标签',{exact:true})).toHaveValue('成长、行动');
 await expect(page.getByLabel('私人备注',{exact:true})).toHaveValue(note);
 await page.getByLabel('搜索问题与备注',{exact:true}).fill('很小的事');
 await page.locator('.history-filters').getByLabel('标签',{exact:true}).fill('成长');
 await page.getByRole('checkbox',{name:'仅看收藏',exact:true}).check();
 const search=page.waitForResponse(response=>{
  const url=new URL(response.url());
  return url.pathname==='/api/v1/readings'&&response.request().method()==='GET'&&url.searchParams.get('q')==='很小的事'&&url.searchParams.get('favorite')==='true'&&url.searchParams.get('tag')==='成长';
 });
 await page.getByRole('button',{name:'查找记录',exact:true}).click();
 expect((await search).status()).toBe(200);
 await expect(page.locator('.history-toggle').filter({hasText:question})).toBeVisible();
 await page.locator('.history-toggle').filter({hasText:question}).click();
 await fits(page);
 await capture(page,info,'history');

 await page.getByRole('link',{name:'把解读建议存为行动 →',exact:true}).click();
 await expect(page.getByRole('heading',{name:'从这次探索开始',exact:true})).toBeVisible();
 const firstTitle='给自己安排十分钟的安静时间';
 const editedTitle='今晚给自己安排十分钟的安静时间';
 await page.getByLabel('想做的一件小事',{exact:true}).fill(firstTitle);
 await page.getByLabel('给自己的补充说明',{exact:true}).fill('放下手机，只做一件小事。');
 await page.getByLabel('计划日期 · 可选，上海时间',{exact:true}).fill(daily.date);
 const actionCreate=write(page,'/api/v1/actions','POST');
 await page.getByRole('button',{name:'保存这一步',exact:true}).click();
 const action=await succeeded(await actionCreate,201);
 expect(action.readingId).toBe(reading.id);
 await expect(page.getByRole('status').filter({hasText:'上一条行动已保存'})).toBeVisible();
 await expect(page.getByLabel('想做的一件小事',{exact:true})).toHaveValue('');
 let actionRow=page.locator('.action-item').filter({has:page.getByRole('heading',{name:firstTitle,exact:true})});
 await expect(actionRow).toBeVisible();
 const complete=write(page,'/api/v1/actions/'+action.id,'PATCH');
 await actionRow.getByRole('button',{name:'标记完成',exact:true}).click();
 expect((await succeeded(await complete)).completedAt).toBeTruthy();
 await expect(actionRow).toHaveCount(0);
 await page.getByRole('button',{name:'已完成',exact:true}).click();
 await expect(actionRow).toBeVisible();
 await actionRow.getByRole('button',{name:'编辑',exact:true}).click();
 await page.getByLabel('想做的一件小事',{exact:true}).fill(editedTitle);
 const editing=write(page,'/api/v1/actions/'+action.id,'PATCH');
 await page.getByRole('button',{name:'保存修改',exact:true}).click();
 expect((await succeeded(await editing)).title).toBe(editedTitle);
 await expect(page.getByLabel('想做的一件小事',{exact:true})).toHaveValue('');
 actionRow=page.locator('.action-item').filter({has:page.getByRole('heading',{name:editedTitle,exact:true})});
 await expect(actionRow).toBeVisible();
 page.once('dialog',dialog=>dialog.accept());
 const deletion=write(page,'/api/v1/actions/'+action.id,'DELETE');
 await actionRow.getByRole('button',{name:'删除',exact:true}).click();
 await succeeded(await deletion);
 await expect(actionRow).toHaveCount(0);

 const retainedTitle='今晚写下一句自己的感受';
 await page.getByLabel('想做的一件小事',{exact:true}).fill(retainedTitle);
 await page.getByLabel('给自己的补充说明',{exact:true}).fill('不用写得完美，先写下来。');
 const retainedCreate=write(page,'/api/v1/actions','POST');
 await page.getByRole('button',{name:'保存这一步',exact:true}).click();
 const retained=await succeeded(await retainedCreate,201);
 await expect(page.getByLabel('想做的一件小事',{exact:true})).toHaveValue('');
 await expect(page.getByRole('button',{name:'保存这一步',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'待行动',exact:true}).click();
 await expect(page.locator('.action-item').filter({hasText:retainedTitle})).toBeVisible();
 await fits(page);

 await page.goto('/journal');
 await expect(page.getByLabel('心情日历月份',{exact:true})).toHaveValue(daily.date.slice(0,7));
 await page.getByRole('button',{name:daily.date+'，平静，有日记',exact:true}).click();
 await expect(page.getByLabel('私人日记',{exact:true})).toHaveValue(journal);
 await page.getByLabel('搜索已载入的私人日记',{exact:true}).fill('真正想做');
 await expect(page.locator('.journal-list .journal-item')).toHaveCount(1);
 await expect(page.locator('.journal-snippet')).toHaveText(journal);
 await expect(page.getByText(/搜索范围：已载入 1 天/)).toBeVisible();
 await fits(page);

 await page.getByRole('link',{name:'周月回顾 →',exact:true}).click();
 await expect(page.getByRole('heading',{name:'留给自己的几个问题',exact:true})).toBeVisible();
 await expect(page.locator('.personal-stats article').filter({hasText:'占卜探索'}).locator('strong')).toHaveText('1');
 await expect(page.locator('.personal-stats article').filter({hasText:'每日星笺'}).locator('strong')).toHaveText('1');
 await expect(page.getByRole('checkbox',{name:/另外允许发送本期间最近 10 天/})).not.toBeChecked();
 await expect(page.getByRole('checkbox',{name:'我同意为这次回顾发送上述信息。',exact:true})).not.toBeChecked();
 await expect(page.getByRole('button',{name:'生成仅属于你的周回顾',exact:true})).toBeDisabled();
 await expect(page.getByText('网站尚未配置 AI 服务，暂时无法生成 AI 回顾。上面的统计与本地提示仍可使用。',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'每月回顾',exact:true}).click();
 await expect(page.getByRole('button',{name:'生成仅属于你的月回顾',exact:true})).toBeDisabled();
 await expect(page.getByRole('heading',{name:'留给自己的几个问题',exact:true})).toBeVisible();

 // A failed, content-free report exercises deletion without enabling a fake AI service.
 // Only this disposable test user's row is seeded; the deletion itself uses the real UI and API.
 const failedReportId=randomUUID(),fixtureDb=new PrismaClient();
 try{
  const owner=await fixtureDb.user.findUniqueOrThrow({where:{email},select:{id:true}});
  await fixtureDb.reviewReport.create({data:{id:failedReportId,userId:owner.id,period:'month',startDate:daily.date,endDate:daily.date,includeJournal:false,requestId:randomUUID(),status:'failed',inputCipher:null,resultCipher:null}});
  const loadedReports=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/v1/insights/reports'&&response.request().method()==='GET');
  await page.getByRole('button',{name:'刷新',exact:true}).click();
  expect((await loadedReports).status()).toBe(200);
  const failedReport=page.locator('.insight-report').filter({has:page.getByText('这次生成未完成。报告没有可用的 AI 内容，请稍后重新发起。',{exact:true})});
  await expect(failedReport).toHaveCount(1);
  await expect(failedReport.getByRole('button',{name:'删除这份回顾',exact:true})).toBeVisible();
  const deletingReport=write(page,'/api/v1/insights/reports/'+failedReportId,'DELETE');
  const openingDialog=page.waitForEvent('dialog');
  const clickingDelete=failedReport.getByRole('button',{name:'删除这份回顾',exact:true}).click();
  const dialog=await openingDialog;
  try{
   expect(dialog.type()).toBe('confirm');
   expect(dialog.message()).toContain('AI 输入快照');
   expect(dialog.message()).toContain('不会返还');
  }finally{await dialog.accept();}
  await clickingDelete;
  await succeeded(await deletingReport);
  await expect(failedReport).toHaveCount(0);
  await expect(page.getByRole('status').filter({hasText:'回顾与其 AI 输入快照已删除'})).toBeVisible();
  expect(await fixtureDb.reviewReport.count({where:{id:failedReportId,userId:owner.id}}),'删除应持久化到本人报告数据库').toBe(0);
 }finally{
  await fixtureDb.reviewReport.deleteMany({where:{id:failedReportId}});
  await fixtureDb.$disconnect();
 }
 await fits(page);
 await capture(page,info,'insights');

 await page.goto('/space');
 await expect(page.getByRole('heading',{name:'星空旅人，欢迎回到星空。',exact:true})).toBeVisible();
 await expect(page.getByRole('link',{name:/占卜档案/})).toBeVisible();
 await expect(page.getByRole('link',{name:/行动计划/})).toBeVisible();
 await fits(page);
 await capture(page,info,'space');

 await page.goto('/account');
 const exportResponse=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/v1/me/export'&&response.request().method()==='GET');
 const downloading=page.waitForEvent('download');
 await page.getByRole('button',{name:'导出我的记录',exact:true}).click();
 expect((await exportResponse).status()).toBe(200);
 const download=await downloading;
 expect(download.suggestedFilename()).toBe('star-oracle-records.json');
 const stream=await download.createReadStream();
 if(!stream)throw new Error('导出没有产生可读取的下载文件');
 const chunks:Buffer[]=[];
 for await(const chunk of stream)chunks.push(Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk));
 const exported=JSON.parse(Buffer.concat(chunks).toString('utf8'));
 expect(exported.version).toBe(2);
 expect(exported.reports.some((item:{id:string})=>item.id===failedReportId),'本人导出也不应包含已删除的回顾').toBe(false);
 expect(exported.readings).toEqual(expect.arrayContaining([expect.objectContaining({id:reading.id,note,favorite:true,tags:['成长','行动'],reading:expect.objectContaining({spread:'three',question})})]));
 expect(exported.daily).toEqual(expect.arrayContaining([expect.objectContaining({id:daily.id,journal:expect.objectContaining({note:journal,mood:'calm'})})]));
 expect(exported.actions).toEqual(expect.arrayContaining([expect.objectContaining({id:retained.id,title:retainedTitle,readingId:reading.id})]));
 expect(exported.actions.some((item:{id:string})=>item.id===action.id)).toBe(false);
 expect(privateKeys(exported),'导出不应包含密码、认证令牌或登录会话').toEqual([]);
 const serialized=JSON.stringify(exported);
 expect(serialized.includes(password),'导出不应包含登录密码').toBe(false);
 for(const cookie of await context.cookies()){
  if(/session.*token/i.test(cookie.name))expect(serialized.includes(cookie.value),'导出不应包含会话凭据').toBe(false);
 }
 await fits(page);
});
