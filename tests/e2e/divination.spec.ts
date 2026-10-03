import { test,expect,type Page } from './fixtures';
import { readFile } from 'node:fs/promises';

test.setTimeout(90_000);
async function fitsViewport(page:Page){
 await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
}
test('all themes and spreads support ten-card and thirteen-card exploration',async({page},info)=>{
 await page.goto('/tarot');
 await expect(page.locator('.scenario-chips button')).toHaveCount(15);
 await expect(page.locator('.spread-option')).toHaveCount(32);
 const celtic=page.getByRole('button',{name:/凯尔特十字/});
 await celtic.click();await expect(celtic).toHaveAttribute('aria-pressed','true');
 await page.getByLabel('此刻，你想探索什么？').fill('怎样为眼前的新机会做好准备？');
 await page.getByRole('button',{name:'静心洗牌'}).click();
 await page.getByRole('button',{name:'开始抽牌'}).click();
 await expect(page.getByRole('heading',{name:'怎样为眼前的新机会做好准备？'})).toBeVisible();
 await expect(page.locator('.tarot-card')).toHaveCount(10);
 await expect(page.locator('.is-covered')).toHaveCount(10);
 await page.getByRole('button',{name:/翻开第 1 张牌/}).click();
 await expect(page.locator('.is-revealed')).toHaveCount(1);
 await page.getByRole('button',{name:'全部翻开'}).click();
 await expect(page.locator('.is-revealed')).toHaveCount(10);
 await expect(page.locator('.card-position')).toHaveCount(10);
 await fitsViewport(page);
 await page.locator('.extended-card-row').screenshot({animations:'disabled',path:info.outputPath('celtic-cross.png')});
 if(process.env.CI_VISUAL_REVIEW_DETAIL==='true'&&info.project.name!=='small-chromium'){
  console.log('DIVINATION_UI_PREVIEW_'+info.project.name+' '+(await page.locator('.extended-card-row').screenshot({type:'jpeg',quality:60,animations:'disabled'})).toString('base64'));
 }
 await page.getByRole('button',{name:/再探索一个问题/}).click();
 await page.getByRole('button',{name:/年度十二宫格/}).click();
 await page.getByRole('button',{name:'开始抽牌'}).click();
 await expect(page.locator('.tarot-card')).toHaveCount(13);
 await page.getByRole('button',{name:'全部翻开'}).click();
 await expect(page.locator('.is-revealed')).toHaveCount(13);
 const names=await page.locator('.tarot-card .card-number').allTextContents();
 expect(new Set(names).size).toBe(13);
 await fitsViewport(page);
 await page.locator('.extended-card-row').screenshot({animations:'disabled',path:info.outputPath('year-wheel.png')});
});

test('number and Shanghai solar-time casting show reproducible inputs and auxiliary hexagrams',async({page})=>{
 await page.goto('/iching');
 await page.getByLabel('此刻，你想探索什么？').fill('面对变化，我可以采取怎样的行动？');
 await page.getByRole('button',{name:'三个数字',exact:true}).click();
 for(const [index,value] of ['1','2','3'].entries())await page.getByLabel('第 '+(index+1)+' 个数字').fill(value);
 await expect(page.locator('.rule-note')).toContainText('第三个数字取余 6');
 await page.getByRole('button',{name:'开始起卦'}).click();
 await expect(page.locator('.hex-title')).toContainText(/本卦.*履.*变卦.*乾/);
 await expect(page.locator('.reading-view')).toContainText('动爻（由下而上）：3');
 await expect(page.locator('.casting-source')).toContainText('1、2、3');
 await page.getByText('展开互卦、错卦与综卦',{exact:true}).click();
 const auxiliary=page.locator('.aux-hex-grid');
 await expect(auxiliary.getByRole('heading',{name:'37 · 家人'})).toBeVisible();
 await expect(auxiliary.getByRole('heading',{name:'15 · 谦'})).toBeVisible();
 await expect(auxiliary.getByRole('heading',{name:'9 · 小畜'})).toBeVisible();
 await fitsViewport(page);
 await page.getByRole('button',{name:/再探索一个问题/}).click();
 await page.getByRole('button',{name:'公历时间',exact:true}).click();
 await page.getByLabel('上海时间（公历，UTC+8）').fill('2026-10-03T09:00');
 await expect(page.locator('.rule-note')).toContainText('不等同传统农历梅花易数');
 await page.getByRole('button',{name:'开始起卦'}).click();
 await expect(page.locator('.hex-title')).toContainText(/本卦.*蛊.*变卦.*巽/);
 await expect(page.locator('.casting-source')).toContainText('09:00');
 await expect(page.locator('.casting-source')).toContainText('Asia/Shanghai（UTC+8）');
 const first=await page.locator('.hex-title').textContent();
 await page.getByRole('button',{name:/再探索一个问题/}).click();
 await page.getByRole('button',{name:'开始起卦'}).click();
 await expect(page.locator('.hex-title')).toHaveText(first!);
 await fitsViewport(page);
});

test('full learning catalogs support search, keyboard dialogs and device-local progress',async({page},info)=>{
 await page.goto('/library');
 await expect(page.locator('.library-tarot')).toHaveCount(78);
 await page.getByLabel('搜索图鉴').fill('愚者');
 const fool=page.getByRole('button',{name:'查看 愚者 的含义',exact:true});
 await expect(fool).toBeVisible();await fool.focus();await page.keyboard.press('Enter');
 const tarotDialog=page.getByRole('dialog',{name:'愚者 · 塔罗图鉴'});
 await expect(tarotDialog).toBeVisible();
 await expect(tarotDialog.getByRole('heading',{name:'正位 · 可以看见的力量'})).toBeVisible();
 await expect(tarotDialog).toContainText('一个小练习');
 await page.keyboard.press('Escape');await expect(tarotDialog).toBeHidden();await expect(fool).toBeFocused();
 await page.getByRole('button',{name:'易经 · 64 卦',exact:true}).click();
 await expect(page.locator('.library-hex')).toHaveCount(64);
 await page.getByLabel('搜索图鉴').fill('乾');
 const qian=page.getByRole('button',{name:'查看第 1 卦 乾',exact:true});
 await expect(qian).toBeVisible();await qian.focus();await page.keyboard.press('Enter');
 const hexDialog=page.getByRole('dialog',{name:'乾 · 易经图鉴'});
 await expect(hexDialog).toBeVisible();await expect(hexDialog).toContainText('下乾上乾');
 await hexDialog.getByRole('button',{name:'关闭详情'}).focus();await page.keyboard.press('Enter');
 await expect(hexDialog).toBeHidden();await expect(qian).toBeFocused();
 await fitsViewport(page);
 await page.screenshot({animations:'disabled',path:info.outputPath('library.png')});
 await page.goto('/tutorials');
 await expect(page.locator('.tutorial-card')).toHaveCount(10);
 const firstStep=page.locator('.tutorial-steps input[type="checkbox"]').first();
 await expect(firstStep).not.toBeChecked();await firstStep.check();
 await expect(page.getByRole('progressbar',{name:'学习完成进度'})).toHaveAttribute('value','1');
 await page.reload();await expect(page.locator('.tutorial-steps input[type="checkbox"]').first()).toBeChecked();
 await expect(page.getByRole('progressbar',{name:'学习完成进度'})).toHaveAttribute('value','1');
 await expect(page.locator('.learning-progress')).toContainText('本机保存');
 await fitsViewport(page);
});

test('PNG poster downloads contain original graphics and exclude the question until explicit opt-in',async({page},info)=>{
 await page.addInitScript(()=>{
  const target=window as Window&{__posterDrawnTexts:string[]};target.__posterDrawnTexts=[];
  const original=CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText=function(text:string,x:number,y:number,maxWidth?:number){
   target.__posterDrawnTexts.push(text);
   if(maxWidth===undefined)original.call(this,text,x,y);else original.call(this,text,x,y,maxWidth);
  };
 });
 const question='海报私密测试问题：请不要默认分享这句话。';
 await page.goto('/tarot');
 await page.getByLabel('此刻，你想探索什么？').fill(question);
 await page.getByRole('button',{name:'开始抽牌'}).click();
 await expect(page.getByRole('heading',{name:question})).toBeVisible();
 await page.getByText('制作分享海报',{exact:true}).click();
 const poster=page.locator('.poster-panel'),consent=poster.getByRole('checkbox');
 await expect(consent).not.toBeChecked();
 await poster.getByRole('button',{name:'生成 PNG 海报'}).click();
 const image=poster.locator('.poster-preview');
 await expect(image).toBeVisible();await expect(image).toHaveAttribute('src',/^blob:/);
 await expect.poll(()=>image.evaluate(node=>(node as HTMLImageElement).naturalWidth)).toBe(1080);
 const drawn=await page.evaluate(()=>(window as Window&{__posterDrawnTexts:string[]}).__posterDrawnTexts);
 expect(drawn.some(text=>text.includes(question))).toBe(false);
 expect(drawn).toContain('STAR ORACLE · 照见');
 const downloadEvent=page.waitForEvent('download');
 await poster.getByRole('link',{name:'保存图片',exact:true}).click();
 const download=await downloadEvent;
 expect(download.suggestedFilename()).toMatch(/^star-oracle-[a-z0-9-]+\.png$/);
 const filename=info.outputPath('anonymous-poster.png');await download.saveAs(filename);
 const bytes=await readFile(filename);
 expect(bytes.subarray(0,8).toString('hex')).toBe('89504e470d0a1a0a');
 expect(bytes.subarray(12,16).toString('ascii')).toBe('IHDR');
 expect(bytes.readUInt32BE(16)).toBe(1080);expect(bytes.readUInt32BE(20)).toBeGreaterThanOrEqual(1500);
 expect(await download.failure()).toBeNull();
 await page.evaluate(()=>{(window as Window&{__posterDrawnTexts:string[]}).__posterDrawnTexts=[];});
 await consent.check();await poster.getByRole('button',{name:'生成 PNG 海报'}).click();
 await expect(image).toBeVisible();
 await expect.poll(()=>page.evaluate(()=>(window as Window&{__posterDrawnTexts:string[]}).__posterDrawnTexts.some(text=>text.includes('海报私密测试问题')))).toBe(true);
 await fitsViewport(page);
});
