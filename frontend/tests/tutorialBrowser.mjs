import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {existsSync} from 'node:fs';
import {TUTORIALS} from '../../packages/domain/index.js';

const require=createRequire(import.meta.url),{chromium}=require(process.env.ORACLE_TEST_PLAYWRIGHT_MODULE??'@playwright/test');
const executablePath=process.env.ORACLE_TEST_BROWSER_EXE;
if(executablePath&&!existsSync(executablePath))throw Error('Configured test browser is absent');
const url='http://127.0.0.1:5177/vue/',root=fileURLToPath(new URL('../',import.meta.url));
const server=spawn(process.execPath,[fileURLToPath(new URL('../node_modules/vite/bin/vite.js',import.meta.url)),'--host','127.0.0.1','--port','5177','--strictPort'],{cwd:root,stdio:['ignore','pipe','pipe'],windowsHide:true});
let output='',browser;server.stdout.on('data',data=>output+=data);server.stderr.on('data',data=>output+=data);
try{
 let ready=false,lastReadinessError='';
 for(let attempt=0;attempt<80;attempt++){
  if(server.exitCode!==null)throw Error('Task-owned Vite server exited: '+output);
  if(!output.includes('Local:')||!output.includes('127.0.0.1:5177')){await new Promise(resolve=>setTimeout(resolve,250));continue;}
  try{const response=await fetch(url);if(response.ok){ready=true;break;}lastReadinessError='HTTP '+response.status;}catch(error){lastReadinessError=String(error.cause??error);}
  await new Promise(resolve=>setTimeout(resolve,250));
 }
 assert.ok(ready,'Task-owned Vite server did not start: '+lastReadinessError+'\n'+output);
 browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
 const context=await browser.newContext();
 await context.route('**/*',route=>new URL(route.request().url()).origin===new URL(url).origin?route.continue():route.abort());
 const page=await context.newPage(),errors=[],consoleErrors=[],apiRequests=[];
 page.on('pageerror',error=>errors.push(error.message));
 page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text());});
 page.on('request',request=>{if(new URL(request.url()).pathname.startsWith('/api/'))apiRequests.push(request.url());});
 await page.goto(url,{waitUntil:'networkidle'});
 assert.equal(await page.locator('.tutorial-card').count(),10);assert.equal(await page.getByRole('checkbox').count(),40);
 await page.getByRole('checkbox').first().check();
 assert.match(await page.locator('.learning-progress').innerText(),/1\/40/);
 await page.reload({waitUntil:'networkidle'});assert.equal(await page.getByRole('checkbox').first().isChecked(),true);
 await page.getByRole('button',{name:'塔罗入门',exact:true}).click();
 assert.equal(await page.locator('.tutorial-card').count(),TUTORIALS.filter(item=>item.category==='tarot').length);
 await page.getByRole('button',{name:'全部课程',exact:true}).click();
 for(let index=0;index<TUTORIALS[0].steps.length;index++)await page.getByRole('checkbox').nth(index).check();
 assert.equal(await page.locator('.tutorial-complete').count(),1);
 await page.setViewportSize({width:375,height:812});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'Mobile page must not overflow horizontally');
 if(process.env.ORACLE_TEST_SCREENSHOT)await page.screenshot({path:process.env.ORACLE_TEST_SCREENSHOT,fullPage:true});
 assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);assert.deepEqual(apiRequests,[]);
 console.log(JSON.stringify({browser:'actual isolated headless browser',courses:10,steps:40,toggleAndReload:true,categoryFilter:true,completionBadge:true,mobileWidth:375,pageErrors:errors.length,consoleErrors:consoleErrors.length,apiRequests:apiRequests.length,backendIntegration:'not exercised; original tutorials persist locally'},null,2));
}finally{if(browser)await browser.close();server.kill();}
