import {test,expect} from '@playwright/test';
import {basicInterpretation,type Reading} from '@star-oracle/domain';
const actor={id:'synthetic-owner',name:'星空旅人',email:'synthetic@example.test',role:'user',twoFactorEnabled:false,sessionBinding:'synthetic-session'};
const headers={'X-Actor-Id':actor.id,'X-Session-Binding':actor.sessionBinding};
const makeRecord=(question:string,id=crypto.randomUUID())=>{const reading:Reading={version:1,id,createdAt:new Date().toISOString(),kind:'tarot',question,spread:'single',scenario:'general',cards:[{id:'major-star',reversed:false}]};return {id,reading,interpretation:basicInterpretation(reading),shared:false,ai:false,createdAt:reading.createdAt};};
async function start(page:any,question:string){await page.goto('/tarot');await page.getByLabel('此刻，你想探索什么？').fill(question);await page.getByRole('button',{name:'开始抽牌',exact:true}).click();await page.getByRole('button',{name:'全部翻开',exact:true}).click();}
test('a late AI response cannot replace a newer reading',async({page})=>{
 let release:()=>void=()=>{};let started:()=>void=()=>{};const pending=new Promise<void>(r=>{started=r;});let first:any;
 await page.route('**/api/v1/**',async route=>{const url=new URL(route.request().url()),path=url.pathname;
  if(path.endsWith('/me'))return route.fulfill({json:actor});
  if(path.endsWith('/config'))return route.fulfill({json:{aiEnabled:true,aiProvider:'Synthetic local fixture'}});
  if(path.endsWith('/readings')&&route.request().method()==='POST'){const record=makeRecord(route.request().postDataJSON().question);first??=record;return route.fulfill({headers,json:record});}
  if(path.endsWith('/interpret')){started();await new Promise<void>(resolve=>{release=resolve;});return route.fulfill({headers,json:{...first,ai:true}});}
  return route.fulfill({headers,json:{items:[],nextCursor:null}});
 });
 await start(page,'问题 A：先观察什么？');await page.getByLabel('我同意发送本次问题与结果进行 AI 解读').check();await page.getByRole('button',{name:'生成 AI 解读',exact:true}).click();await pending;
 await page.getByRole('button',{name:'再探索一个问题',exact:true}).click();await page.getByLabel('此刻，你想探索什么？').fill('问题 B：下一步做什么？');await page.getByRole('button',{name:'开始抽牌',exact:true}).click();await page.getByRole('button',{name:'全部翻开',exact:true}).click();
 release();await expect(page.locator('.question')).toContainText('问题 B');await expect(page.locator('.question')).not.toContainText('问题 A');
});
test('lost follow-up response retries the immutable ID and prompt',async({page})=>{
 const attempts:any[]=[];
 await page.route('**/api/v1/**',async route=>{const request=route.request(),path=new URL(request.url()).pathname;
  if(path.endsWith('/me'))return route.fulfill({json:actor});
  if(path.endsWith('/config'))return route.fulfill({json:{aiEnabled:true,aiProvider:'Synthetic local fixture'}});
  if(path.endsWith('/readings')&&request.method()==='POST')return route.fulfill({headers,json:makeRecord(request.postDataJSON().question)});
  if(path.endsWith('/conversation')&&request.method()==='POST'){
   attempts.push(request.postDataJSON());if(attempts.length===1)return route.abort('failed');
   return route.fulfill({headers,json:{id:crypto.randomUUID(),prompt:attempts[0].prompt,answer:makeRecord('fixture').interpretation,status:'done',createdAt:new Date().toISOString()}});
  }
  return route.fulfill({headers,json:{items:[],nextCursor:null}});
 });
 await start(page,'我想整理本周的安排。');await page.getByText('围绕这次结果，继续聊聊',{exact:true}).click();await page.getByLabel('你还想了解什么？').fill('哪一步可以先尝试？');await page.getByLabel('我同意将上述问题、结果及相关对话发送给模型服务').check();
 await page.getByRole('button',{name:'发送追问',exact:true}).click();await expect(page.getByRole('button',{name:'重试追问',exact:true})).toBeVisible();await expect(page.getByLabel('你还想了解什么？')).toHaveAttribute('readonly','');
 await page.getByRole('button',{name:'重试追问',exact:true}).click();await expect(page.getByLabel('你还想了解什么？')).toHaveValue('');expect(attempts).toHaveLength(2);expect(attempts[1]).toEqual(attempts[0]);
});
test('whitespace-only follow-up validation does not lock the editor',async({page})=>{
 let posts=0;
 await page.route('**/api/v1/**',async route=>{const request=route.request(),path=new URL(request.url()).pathname;
  if(path.endsWith('/me'))return route.fulfill({json:actor});if(path.endsWith('/config'))return route.fulfill({json:{aiEnabled:true,aiProvider:'Synthetic fixture'}});
  if(path.endsWith('/readings')&&request.method()==='POST')return route.fulfill({headers,json:makeRecord(request.postDataJSON().question)});
  if(path.endsWith('/conversation')&&request.method()==='POST'){posts++;return route.fulfill({status:400,json:{error:{message:'Invalid input'}}});}
  return route.fulfill({headers,json:{items:[],nextCursor:null}});
 });
 await start(page,'如何安排这一天？');await page.getByText('围绕这次结果，继续聊聊',{exact:true}).click();await page.getByLabel('你还想了解什么？').fill('x ');await page.getByLabel('我同意将上述问题、结果及相关对话发送给模型服务').check();await page.getByRole('button',{name:'发送追问',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('至少输入两个非空白字符');await expect(page.getByLabel('你还想了解什么？')).toBeEditable();expect(posts).toBe(0);
});
test('a truncated successful response remains an unknown outcome with the same retry ID',async({page})=>{
 const attempts:any[]=[];
 await page.route('**/api/v1/**',async route=>{const request=route.request(),path=new URL(request.url()).pathname;
  if(path.endsWith('/me'))return route.fulfill({json:actor});if(path.endsWith('/config'))return route.fulfill({json:{aiEnabled:true,aiProvider:'Synthetic fixture'}});
  if(path.endsWith('/readings')&&request.method()==='POST')return route.fulfill({headers,json:makeRecord(request.postDataJSON().question)});
  if(path.endsWith('/conversation')&&request.method()==='POST'){attempts.push(request.postDataJSON());return attempts.length===1?route.fulfill({status:200,headers:{...headers,'Content-Type':'application/json'},body:'{"id":'}):route.fulfill({headers,json:{id:crypto.randomUUID(),prompt:attempts[0].prompt,answer:makeRecord('fixture').interpretation,status:'done',createdAt:new Date().toISOString()}});}
  return route.fulfill({headers,json:{items:[],nextCursor:null}});
 });
 await start(page,'这周从哪里开始？');await page.getByText('围绕这次结果，继续聊聊',{exact:true}).click();await page.getByLabel('你还想了解什么？').fill('怎样具体行动？');await page.getByLabel('我同意将上述问题、结果及相关对话发送给模型服务').check();await page.getByRole('button',{name:'发送追问',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('响应未完整收到');await expect(page.getByLabel('你还想了解什么？')).toHaveValue('怎样具体行动？');await page.getByRole('button',{name:'重试追问',exact:true}).click();await expect(page.getByLabel('你还想了解什么？')).toHaveValue('');expect(attempts[1]).toEqual(attempts[0]);
});
