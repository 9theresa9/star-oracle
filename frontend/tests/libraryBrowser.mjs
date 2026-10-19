import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {existsSync} from 'node:fs';
import {TAROT_LIBRARY,HEXAGRAM_LIBRARY} from '../../packages/domain/index.js';

const require=createRequire(import.meta.url),{chromium}=require(process.env.ORACLE_TEST_PLAYWRIGHT_MODULE??'@playwright/test');
const executablePath=process.env.ORACLE_TEST_BROWSER_EXE;
if(executablePath&&!existsSync(executablePath))throw Error('Configured test browser is absent');
const origin='http://127.0.0.1:5177',url=origin+'/vue/library?keep=a&keep=b&tab=tarot#guide',root=fileURLToPath(new URL('../',import.meta.url));
const server=spawn(process.execPath,[fileURLToPath(new URL('../node_modules/vite/bin/vite.js',import.meta.url)),'--host','127.0.0.1','--port','5177','--strictPort'],{cwd:root,stdio:['ignore','pipe','pipe'],windowsHide:true});
let output='',browser;server.stdout.on('data',data=>output+=data);server.stderr.on('data',data=>output+=data);
try{
 let ready=false;
 for(let attempt=0;attempt<80;attempt++){
  if(server.exitCode!==null)throw Error('Task-owned Vite exited: '+output);
  if(output.includes('Local:')&&output.includes('127.0.0.1:5177')){
   const response=await fetch(url);if(response.ok){ready=true;break;}
  }
  await new Promise(resolve=>setTimeout(resolve,250));
 }
 assert.ok(ready,'Task-owned Vite readiness failed: '+output);
 browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
 const context=await browser.newContext();await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 const page=await context.newPage(),errors=[],consoleErrors=[],apiRequests=[];
 page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text());});page.on('request',request=>{if(new URL(request.url()).pathname.startsWith('/api/'))apiRequests.push(request.url());});
 await page.goto(url,{waitUntil:'networkidle'});assert.equal(await page.locator('.library-tarot').count(),78);
 assert.equal(await page.locator('.oracle-card-art').first().getAttribute('viewBox'),'0 0 160 220');
 for(const card of TAROT_LIBRARY){
  const opener=page.getByRole('button',{name:'查看 '+card.name+' 的含义',exact:true});await opener.click();
  const modal=page.getByRole('dialog');await modal.waitFor({state:'visible'});const text=await modal.innerText();
  for(const value of [card.name,card.en,card.element,card.description,card.uprightMeaning,card.reversedMeaning,card.symbolism,card.practice,card.reflection,...card.upright,...card.reversed])assert.ok(text.includes(value),card.id+': '+value);
  await modal.getByRole('button',{name:'关闭详情',exact:true}).click();assert.equal(await opener.evaluate(element=>element===document.activeElement),true);
 }
 await page.getByRole('button',{name:'圣杯',exact:true}).click();assert.equal(await page.locator('.library-tarot').count(),14);
 await page.getByRole('searchbox',{name:'搜索图鉴'}).fill('no-synthetic-match');assert.equal(await page.locator('.library-tarot').count(),0);
 await page.getByRole('button',{name:'易经 · 64 卦',exact:true}).click();assert.equal(await page.locator('.library-hex').count(),64);
 assert.equal(await page.getByRole('searchbox').inputValue(),'');assert.deepEqual(new URL(page.url()).searchParams.getAll('keep'),['a','b']);assert.equal(new URL(page.url()).hash,'#guide');
 for(const hex of HEXAGRAM_LIBRARY){
  const opener=page.getByRole('button',{name:'查看第 '+hex.number+' 卦 '+hex.name,exact:true});await opener.click();const modal=page.getByRole('dialog');await modal.waitFor({state:'visible'});const text=await modal.innerText();
  for(const value of [hex.name,hex.description,hex.guidance,hex.prompt,hex.lower.name,hex.upper.name,...hex.keywords])assert.ok(text.includes(value),String(hex.number)+': '+value);
  assert.equal(await modal.locator('.yao').count(),6);await page.keyboard.press('Escape');assert.equal(await opener.evaluate(element=>element===document.activeElement),true);
 }
 await page.goBack();assert.equal(await page.locator('.library-tarot').count(),14);assert.equal(new URL(page.url()).searchParams.get('tab'),'tarot');
 await page.getByRole('button',{name:'全部',exact:true}).click();await page.getByRole('searchbox').fill(TAROT_LIBRARY[0].en.toUpperCase());assert.ok(await page.locator('.library-tarot').count()>0);
 await page.getByRole('searchbox').fill('no-synthetic-match');assert.equal(await page.locator('.empty').count(),1);await page.getByRole('searchbox').fill('');
 const opener=page.locator('.library-tarot').first();await opener.click();const box=await page.getByRole('dialog').boundingBox();assert.ok(box&&box.x>1);await page.mouse.click(box.x/2,box.y+10);assert.equal(await page.getByRole('dialog').count(),0);
 await page.setViewportSize({width:375,height:812});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'Mobile library overflow');
 await opener.click();assert.ok(await page.getByRole('dialog').evaluate(element=>element.scrollWidth<=element.clientWidth),'Mobile dialog overflow');
 if(process.env.ORACLE_TEST_SCREENSHOT)await page.screenshot({path:process.env.ORACLE_TEST_SCREENSHOT,fullPage:true});
 await page.keyboard.press('Escape');await page.getByRole('link',{name:'从入门开始',exact:false}).click();await page.locator('.tutorial-card').first().waitFor({state:'visible'});assert.equal(await page.locator('.tutorial-card').count(),10);
 assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);assert.deepEqual(apiRequests,[]);
 console.log(JSON.stringify({browser:'actual isolated headless Edge',tarotDetails:78,hexagramDetails:64,canonicalFields:true,focusReturn:true,escape:true,backdrop:true,searchSuitQueryHistory:true,mobileWidth:375,pageErrors:errors.length,consoleErrors:consoleErrors.length,apiRequests:apiRequests.length,backendIntegration:'not exercised; original library is public static content'},null,2));
}finally{if(browser)await browser.close();server.kill();}
