import {test,expect} from '@playwright/test';
// Fault-injection routes must own their requests; the dedicated PWA suite keeps workers enabled.
test.use({serviceWorkers:'block'});
test('daylight public and account text meets normal-text contrast on its computed surfaces',async({page})=>{
 await page.route('**/api/v1/me',route=>route.fulfill({status:401,json:{error:{message:'Synthetic guest'}}}));
 for(const path of ['/','/account','/tarot','/iching','/space']){
  await page.goto(path);await expect(page.locator('main h1:visible, main h2:visible').first()).toBeVisible();if(path==='/account')await expect(page.getByRole('button',{name:'登录',exact:true})).toBeVisible();
  const failures=await page.evaluate(()=>{
   const parse=(s:string)=>{const nums=s.match(/[\d.]+/g)?.map(Number)??[0,0,0];return [nums[0]!,nums[1]!,nums[2]!,nums[3]??1];};
   const blend=(front:number[],back:number[])=>[0,1,2].map(i=>front[i]!*front[3]!+back[i]!*(1-front[3]!)).concat(1);
   const lum=(c:number[])=>c.slice(0,3).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i]!,0);
   const result:{text:string;ratio:number;color:string}[]=[];
   const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let node:Node|null;
   while((node=walker.nextNode())){
    const text=node.textContent?.trim();const el=node.parentElement;if(!text||!el||el.closest('svg,script,style,[aria-hidden="true"],button:disabled,input:disabled'))continue;
    if(!el.getClientRects().length)continue;const style=getComputedStyle(el);if(style.visibility==='hidden')continue;
    let bg=[255,255,255,1];const ancestors:Element[]=[];for(let p:Element|null=el;p;p=p.parentElement)ancestors.unshift(p);
    for(const p of ancestors)bg=blend(parse(getComputedStyle(p).backgroundColor),bg);
    const fg=blend(parse(style.color),bg),a=lum(fg),b=lum(bg),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
    if(ratio<4.5)result.push({text:text.slice(0,65),ratio:Math.round(ratio*100)/100,color:style.color});
   }return result;
  });
  expect(failures,`${path}: computed text contrast (artwork gradients reviewed separately)`).toEqual([]);
 }
});
