import {test,expect,type Page} from '@playwright/test';

// These tests exercise the real React pages while keeping every account and write synthetic.
test.use({serviceWorkers:'block'});

type Action={id:string;title:string;detail:string;readingId:string|null;dueDate:string|null;completedAt:string|null;version:number;createdAt:string;updatedAt:string};
type Write={method:string;path:string;body:Record<string,unknown>};
type FormEvents={copied:string[];submitted:string[]};
const createdAt='2026-10-01T09:00:00.000Z';
const draft={title:'给自己留一个安静的下午',detail:'先散步，再整理这周的想法。',dueDate:'2030-01-12'};

async function syntheticPages(page:Page,{role='user',actions=[]}:{role?:'user'|'admin';actions?:Action[]}={}){
 const actor={id:'synthetic-form-owner',name:'星空旅人',username:'synthetic-form-owner',email:'form-owner@accounts.invalid',role,twoFactorEnabled:false,sessionBinding:'synthetic-form-session'};
 const headers={'X-Actor-Id':actor.id,'X-Session-Binding':actor.sessionBinding};
 const writes:Write[]=[],codes:{id:string;codeHint:string;kind:string;amount:number;durationDays:null;expiresAt:null;maxUses:number;usedCount:number;disabled:boolean;createdAt:string}[]=[];
 await page.addInitScript(()=>{
  const events:FormEvents={copied:[],submitted:[]};
  Object.defineProperty(window,'__formEvents',{value:events});
  // Clipboard permissions differ across browser engines; retain the real click and form behavior.
  Object.defineProperty(navigator,'clipboard',{value:{writeText:async(text:string)=>{events.copied.push(text);}}});
  document.addEventListener('submit',event=>{
   const submitter=(event as SubmitEvent).submitter;
   events.submitted.push(submitter?.getAttribute('aria-label')??submitter?.textContent??'');
  },true);
 });
 await page.route('**/api/**',async route=>{
  const request=route.request(),method=request.method(),path=new URL(request.url()).pathname;
  if(path==='/api/v1/me')return route.fulfill({json:actor});
  if(path==='/api/v1/config')return route.fulfill({json:{aiEnabled:false,aiProvider:'Synthetic fixture',deploymentMode:'https'}});
  if(method!=='GET')writes.push({method,path,body:request.postDataJSON()});
  if(path==='/api/v1/actions'&&method==='GET')return route.fulfill({headers,json:{items:actions,nextCursor:null}});
  if(path==='/api/v1/actions'&&method==='POST'){
   const body=request.postDataJSON(),item:Action={id:'synthetic-action-'+writes.length,title:body.title,detail:body.detail,readingId:null,dueDate:body.dueDate??null,completedAt:null,version:1,createdAt,updatedAt:createdAt};
   actions.push(item);
   return route.fulfill({status:201,headers,json:item});
  }
  if(path.startsWith('/api/v1/actions/')&&method==='PATCH'){
   const item=actions.find(action=>path==='/api/v1/actions/'+action.id);
   if(item){
    const body=request.postDataJSON();
    Object.assign(item,{title:body.title,detail:body.detail,dueDate:body.dueDate,completedAt:body.completed?createdAt:null,version:item.version+1});
    return route.fulfill({headers,json:item});
   }
  }
  if(path==='/api/v1/admin/overview')return route.fulfill({headers,json:{users:1,readings:0,dailyEntries:0,aiRequestsToday:0,aiDailyLimit:10,aiConfigured:false,database:'Synthetic',redis:'Synthetic'}});
  if(path==='/api/v1/admin/statistics')return route.fulfill({headers,json:{days:30,startDate:'2026-09-10',endDate:'2026-10-09',series:[],readingKinds:[],totals:{users:0,readings:0,dailyEntries:0,aiRequests:0},feedback:{open:0,inProgress:0,resolved:0}}});
  if(path==='/api/v1/admin/redeem-codes'&&method==='GET')return route.fulfill({headers,json:{items:codes,nextCursor:null}});
  if(path==='/api/v1/admin/redeem-codes'&&method==='POST'){
   const body=request.postDataJSON(),id='synthetic-code-'+(codes.length+1);
   const item={id,codeHint:id,kind:body.kind,amount:body.amount,durationDays:null,expiresAt:null,maxUses:body.maxUses,usedCount:0,disabled:false,createdAt};
   codes.push(item);
   return route.fulfill({status:201,headers,json:{code:'SYNTHETIC-FULL-CODE-'+codes.length,item}});
  }
  return route.fulfill({status:503,headers,json:{error:{message:'Unexpected synthetic endpoint: '+method+' '+path}}});
 });
 return writes;
}

async function formEvents(page:Page):Promise<FormEvents>{return page.evaluate(()=>Reflect.get(window,'__formEvents'));}
async function fillAction(page:Page){
 await page.getByLabel('想做的一件小事',{exact:true}).fill(draft.title);
 await page.getByLabel('给自己的补充说明',{exact:true}).fill(draft.detail);
 await page.getByLabel('计划日期 · 可选，上海时间',{exact:true}).fill(draft.dueDate);
}
async function expectDraft(page:Page){
 await expect(page.getByLabel('想做的一件小事',{exact:true})).toHaveValue(draft.title);
 await expect(page.getByLabel('给自己的补充说明',{exact:true})).toHaveValue(draft.detail);
 await expect(page.getByLabel('计划日期 · 可选，上海时间',{exact:true})).toHaveValue(draft.dueDate);
}
async function saveAction(page:Page,name:string,method:'POST'|'PATCH'){
 const saved=page.waitForResponse(response=>new URL(response.url()).pathname.startsWith('/api/v1/actions')&&response.request().method()===method);
 await page.getByRole('button',{name,exact:true}).click();
 expect((await saved).ok()).toBe(true);
 await expect(page.getByRole('status').filter({hasText:'上一条行动已保存到你的私人账户。'})).toBeVisible();
}
async function openCodes(page:Page){
 await page.goto('/admin');
 await page.getByRole('button',{name:'兑换码',exact:true}).click();
 await expect(page.getByRole('heading',{name:'兑换码管理',exact:true})).toBeVisible();
 await page.getByLabel('每次兑换的额度',{exact:true}).fill('23');
 await page.getByLabel('最多可兑换次数',{exact:true}).fill('2');
}
async function createCode(page:Page,index:number){
 const created=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/v1/admin/redeem-codes'&&response.request().method()==='POST');
 await page.getByRole('button',{name:'创建兑换码',exact:true}).click();
 expect((await created).status()).toBe(201);
 await expect(page.locator('.one-time-code code')).toHaveText('SYNTHETIC-FULL-CODE-'+index);
 await expect(page.getByRole('button',{name:'创建兑换码',exact:true})).toBeDisabled();
}

test('copying a new action preserves the draft without POST until Save is clicked',async({page})=>{
 const writes=await syntheticPages(page);
 await page.goto('/actions');
 await fillAction(page);
 for(let count=1;count<=2;count++){
  await page.getByRole('button',{name:'复制解读',exact:true}).click();
  expect((await formEvents(page)).submitted,'Copy must not submit the action form').toEqual([]);
  expect((await formEvents(page)).copied).toEqual(Array(count).fill([draft.title,draft.detail,draft.dueDate].join('\n\n')));
  await expectDraft(page);
  expect(writes).toEqual([]);
 }
 await saveAction(page,'保存这一步','POST');
 expect(writes).toEqual([{method:'POST',path:'/api/v1/actions',body:draft}]);
 expect((await formEvents(page)).submitted).toEqual(['保存这一步']);
 await expect(page.locator('.action-item h3')).toHaveText(draft.title);
});

test('copying an edited action preserves changes without PATCH until Save is clicked',async({page})=>{
 const original:Action={id:'synthetic-existing-action',title:'原来的行动',detail:'原来的说明',readingId:null,dueDate:null,completedAt:null,version:3,createdAt,updatedAt:createdAt};
 const writes=await syntheticPages(page,{actions:[original]});
 await page.goto('/actions');
 await page.locator('.action-item').getByRole('button',{name:'编辑',exact:true}).click();
 await fillAction(page);
 for(let count=1;count<=2;count++){
  await page.getByRole('button',{name:'复制解读',exact:true}).click();
  expect((await formEvents(page)).submitted,'Copy must not submit the edited action').toEqual([]);
  expect((await formEvents(page)).copied).toHaveLength(count);
  await expectDraft(page);
  expect(writes).toEqual([]);
 }
 await saveAction(page,'保存修改','PATCH');
 expect(writes).toEqual([{method:'PATCH',path:'/api/v1/actions/synthetic-existing-action',body:{...draft,completed:false,version:3}}]);
 expect((await formEvents(page)).submitted).toEqual(['保存修改']);
 await expect(page.locator('.action-item h3')).toHaveText(draft.title);
});

test('repeated redemption-code copy keeps the same code without another creation',async({page})=>{
 const writes=await syntheticPages(page,{role:'admin'});
 await openCodes(page);
 await createCode(page,1);
 expect(writes).toEqual([{method:'POST',path:'/api/v1/admin/redeem-codes',body:{kind:'credits',amount:23,maxUses:2}}]);
 for(let count=1;count<=3;count++){
  await page.getByRole('button',{name:count===1?'复制兑换码':'已复制',exact:true}).click();
  expect((await formEvents(page)).submitted,'Copy must not create another redemption code').toEqual(['创建兑换码']);
  expect((await formEvents(page)).copied).toEqual(Array(count).fill('SYNTHETIC-FULL-CODE-1'));
  await expect(page.locator('.one-time-code code')).toHaveText('SYNTHETIC-FULL-CODE-1');
  await expect(page.getByRole('button',{name:'创建兑换码',exact:true})).toBeDisabled();
  expect(writes).toHaveLength(1);
 }
});

test('hiding a redemption code does not create another and explicit Create works once again',async({page})=>{
 const writes=await syntheticPages(page,{role:'admin'});
 await openCodes(page);
 for(let index=1;index<=2;index++){
  await createCode(page,index);
  expect(writes).toHaveLength(index);
  await page.getByRole('button',{name:'我已保存，隐藏完整码',exact:true}).click();
  expect((await formEvents(page)).submitted,'Hide must not submit the redemption-code form').toEqual(Array(index).fill('创建兑换码'));
  await expect(page.locator('.one-time-code')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'创建兑换码',exact:true})).toBeEnabled();
  await expect(page.getByLabel('每次兑换的额度',{exact:true})).toHaveValue('23');
  await expect(page.getByLabel('最多可兑换次数',{exact:true})).toHaveValue('2');
  expect(writes).toHaveLength(index);
 }
 expect(writes).toEqual(Array(2).fill({method:'POST',path:'/api/v1/admin/redeem-codes',body:{kind:'credits',amount:23,maxUses:2}}));
});
