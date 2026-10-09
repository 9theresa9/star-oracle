import {test,expect,type Page,type Route} from '@playwright/test';

// Own fault-injection requests without the PWA worker; the actual React page still runs.
test.use({serviceWorkers:'block'});

type Attempt={period:'week'|'month';date:string;includeJournal:boolean;consent:true;requestId:string};
type Report={id:string;period:'week'|'month';startDate:string;endDate:string;includeJournal:boolean;status:'pending'|'done'|'failed';createdAt:string;result?:{summary:string;insights:{reference:string;text:string}[];actions:string[];reflection:string}};
const actor={id:'synthetic-review-owner',name:'星空旅人',email:'synthetic-review@example.test',role:'user',twoFactorEnabled:false,sessionBinding:'synthetic-review-session'};
const headers={'X-Actor-Id':actor.id,'X-Session-Binding':actor.sessionBinding};
const consentLabel='我同意为这次回顾发送上述信息。';
const journalLabel='另外允许发送本期间最近 10 天的私人日记，每条最多 500 字。默认不发送。';
const dateLabel='选择这一周／月中的任意一天 · 上海时间';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function makeReport(attempt:Attempt,status:Report['status']='done'):Report{
 return {id:'9fa4d86f-9c5b-4b65-ab6d-7f390d390a16',period:attempt.period,startDate:'2026-10-01',endDate:'2026-10-31',includeJournal:attempt.includeJournal,status,createdAt:'2026-10-09T09:00:00.000Z',...(status==='done'?{result:{summary:'这是本次请求保存的回顾。',insights:[{reference:'period',text:'把已有记录放在一起观察。'}],actions:['留十分钟回看记录。','选择一件小事尝试。'],reflection:'哪一步值得保留？'}}:{})};
}

async function setup(page:Page,onPost:(route:Route,attempt:Attempt,index:number)=>Promise<void>){
 const fixture={attempts:[] as Attempt[],reports:[] as Report[],readings:2};
 await page.route('**/api/v1/**',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.pathname.endsWith('/me'))return route.fulfill({json:actor});
  if(url.pathname.endsWith('/config'))return route.fulfill({json:{aiEnabled:true,aiProvider:'Synthetic local fixture'}});
  if(url.pathname.endsWith('/insights/reports')){
   if(request.method()==='POST'){
    const attempt=request.postDataJSON() as Attempt;
    fixture.attempts.push(attempt);
    return onPost(route,attempt,fixture.attempts.length);
   }
   return route.fulfill({headers,json:{items:fixture.reports,nextCursor:null}});
  }
  if(url.pathname.endsWith('/insights'))return route.fulfill({headers,json:{period:url.searchParams.get('period'),startDate:'2026-10-01',endDate:'2026-10-31',summary:{readings:fixture.readings,dailyEntries:3,completedActions:1,moods:[]},readingKinds:[],reflection:{summary:'这一程有值得回看的记录。',actions:['看一看已经完成的小事。'],reflection:'你想保留什么？'},journalIncluded:false}});
  return route.fulfill({headers,json:{items:[],nextCursor:null}});
 });
 await page.goto('/insights');
 await page.getByRole('button',{name:'每月回顾',exact:true}).click();
 await page.getByLabel(dateLabel,{exact:true}).fill('2026-10-01');
 await page.getByRole('checkbox',{name:journalLabel,exact:true}).check();
 await page.getByRole('checkbox',{name:consentLabel,exact:true}).check();
 await expect(page.getByRole('button',{name:'生成仅属于你的月回顾',exact:true})).toBeEnabled();
 return fixture;
}

async function expectInputsLocked(page:Page){
 await expect(page.getByRole('button',{name:'每周回顾',exact:true})).toBeDisabled();
 await expect(page.getByRole('button',{name:'每月回顾',exact:true})).toBeDisabled();
 await expect(page.getByLabel(dateLabel,{exact:true})).toBeDisabled();
 await expect(page.getByRole('checkbox',{name:journalLabel,exact:true})).toBeDisabled();
 await expect(page.getByRole('checkbox',{name:consentLabel,exact:true})).toBeDisabled();
 await expect(page.getByLabel(dateLabel,{exact:true})).toHaveValue('2026-10-01');
 await expect(page.getByRole('button',{name:'每月回顾',exact:true})).toHaveAttribute('aria-pressed','true');
 await expect(page.getByRole('checkbox',{name:journalLabel,exact:true})).toBeChecked();
}

const faults:{name:string;respond:(route:Route)=>Promise<void>}[]=[
 {name:'a lost response',respond:route=>route.abort('failed')},
 {name:'a truncated 200 response',respond:route=>route.fulfill({status:200,headers:{...headers,'Content-Type':'application/json'},body:'{"id":'})},
 {name:'a pending report response',respond:route=>route.fulfill({headers,json:makeReport(route.request().postDataJSON() as Attempt,'pending')})},
 {name:'a failed report projection response',respond:route=>route.fulfill({headers,json:makeReport(route.request().postDataJSON() as Attempt,'failed')})},
 {name:'a pending 409 response',respond:route=>route.fulfill({status:409,headers,json:{error:{message:'回顾正在生成，请稍后刷新'}}})},
 {name:'a generic 503 response',respond:route=>route.fulfill({status:503,headers,json:{error:{message:'暂时无法完成，请稍后再试'}}})},
 // A failed cache/state lookup may use terminal-sounding prose without durable terminal evidence.
 {name:'a cache lookup failure without a terminal code',respond:route=>route.fulfill({status:503,headers,json:{error:{message:'上次尝试已中断，请选择重新尝试'}}})},
];

for(const fault of faults){
 test(`review keeps one immutable attempt after ${fault.name}`,async({page})=>{
  let release!:()=>void;
  const barrier=new Promise<void>(resolve=>{release=resolve;});
  const fixture=await setup(page,async(route,attempt,index)=>{
   if(index===1){await barrier;return fault.respond(route);}
   const report=makeReport(attempt);
   fixture.reports=[report];
   return route.fulfill({headers,json:report});
  });
  await page.getByRole('button',{name:'生成仅属于你的月回顾',exact:true}).click();
  await expect.poll(()=>fixture.attempts.length).toBe(1);
  try{
   await expectInputsLocked(page);
   await expect(page.getByRole('button',{name:'开始新的回顾',exact:true})).toHaveCount(0);
  }finally{release();}
  await expect(page.getByRole('button',{name:'重试上次回顾',exact:true})).toBeVisible();
  await expectInputsLocked(page);
  await expect(page.getByRole('button',{name:'开始新的回顾',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'重试上次回顾',exact:true})).toBeEnabled();
  expect(fixture.attempts[0]).toEqual({period:'month',date:'2026-10-01',includeJournal:true,consent:true,requestId:expect.stringMatching(uuid)});

  await page.getByRole('button',{name:'重试上次回顾',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'回顾已保存到你的私人账户。'})).toBeVisible();
  expect(fixture.attempts).toHaveLength(2);
  expect(fixture.attempts[1]).toEqual(fixture.attempts[0]);
  await expect(page.getByRole('button',{name:'每周回顾',exact:true})).toBeEnabled();
  await expect(page.getByLabel(dateLabel,{exact:true})).toBeEnabled();
  await expect(page.getByRole('checkbox',{name:journalLabel,exact:true})).toBeEnabled();
  await expect(page.getByRole('checkbox',{name:consentLabel,exact:true})).not.toBeChecked();
  await expect(page.getByRole('button',{name:'生成仅属于你的月回顾',exact:true})).toBeDisabled();
 });
}

test('failed archive projection and changed source data do not authorize a fresh attempt',async({page})=>{
 const fixture=await setup(page,async(route,attempt,index)=>{
  if(index===1){
   fixture.reports=[makeReport(attempt,'failed')];
   return route.fulfill({status:503,headers,json:{error:{message:'暂时无法读取已保存的结果'}}});
  }
  const report=makeReport(attempt);
  fixture.reports=[report];
  return route.fulfill({headers,json:report});
 });
 await page.getByRole('button',{name:'生成仅属于你的月回顾',exact:true}).click();
 await expect(page.getByRole('button',{name:'重试上次回顾',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'刷新',exact:true}).click();
 const archived=page.locator('.insight-report');
 await expect(archived).toHaveCount(1);
 await expect(archived).toContainText('这份回顾暂时没有可显示的内容');
 await expect(archived).not.toContainText('重新发起');
 await expect(page.getByRole('button',{name:'开始新的回顾',exact:true})).toHaveCount(0);

 // Another device changes the source data. A reconnect refetches the real page's queries.
 fixture.readings=9;
 await page.evaluate(()=>{window.dispatchEvent(new Event('offline'));window.dispatchEvent(new Event('online'));});
 await expect(page.locator('.personal-stats article').first().locator('strong')).toHaveText('9');
 await expectInputsLocked(page);
 await page.getByRole('button',{name:'重试上次回顾',exact:true}).click();
 await expect(page.getByRole('status').filter({hasText:'回顾已保存到你的私人账户。'})).toBeVisible();
 expect(fixture.attempts).toHaveLength(2);
 expect(fixture.attempts[1]).toEqual(fixture.attempts[0]);
});

test('only a terminal attempt code permits an explicit new UUID with renewed consent',async({page})=>{
 const fixture=await setup(page,async(route,attempt,index)=>{
  if(index===1)return route.fulfill({status:503,headers,json:{error:{message:'本次 AI 尝试未完成，请选择重新尝试',code:'AI_ATTEMPT_FAILED'}}});
  return route.fulfill({headers,json:makeReport(attempt)});
 });
 await page.getByRole('button',{name:'生成仅属于你的月回顾',exact:true}).click();
 const startNew=page.getByRole('button',{name:'开始新的回顾',exact:true});
 await expect(startNew).toBeVisible();
 await expectInputsLocked(page);
 await expect(page.getByRole('button',{name:'重试上次回顾',exact:true})).toBeDisabled();
 await expect(page.locator('.ai-review')).toContainText('AI 额度');
 expect(fixture.attempts).toHaveLength(1);

 await startNew.click();
 await expect(startNew).toHaveCount(0);
 await expect(page.getByLabel(dateLabel,{exact:true})).toBeEnabled();
 await expect(page.getByRole('checkbox',{name:journalLabel,exact:true})).toBeEnabled();
 await expect(page.getByRole('checkbox',{name:consentLabel,exact:true})).not.toBeChecked();
 const generate=page.getByRole('button',{name:'生成仅属于你的月回顾',exact:true});
 await expect(generate).toBeDisabled();
 expect(fixture.attempts).toHaveLength(1);
 await page.getByRole('checkbox',{name:consentLabel,exact:true}).check();
 await generate.click();
 await expect(page.getByRole('status').filter({hasText:'回顾已保存到你的私人账户。'})).toBeVisible();
 expect(fixture.attempts).toHaveLength(2);
 expect(fixture.attempts[1]).toEqual({...fixture.attempts[0],requestId:expect.stringMatching(uuid)});
 expect(fixture.attempts[1]!.requestId).not.toBe(fixture.attempts[0]!.requestId);
});
