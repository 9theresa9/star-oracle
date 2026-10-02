import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium, webkit } from 'playwright';
import { createAppServer } from '../server/index.js';
import { basicInterpretation } from '../shared/engine.js';
await mkdir('artifacts/screenshots', { recursive: true });
const server = createAppServer({ env: {} }); server.listen(0, '127.0.0.1'); await once(server, 'listening');
const baseURL = 'http://127.0.0.1:' + server.address().port;
try {
  for (const [browserName, browserType] of [['chromium', chromium], ['webkit', webkit]]) {
    const browser = await browserType.launch();
    try {
      for (const [label, viewport] of [['desktop', { width: 1440, height: 1000 }], ['mobile', { width: 390, height: 844 }]]) {
        const context = await browser.newContext({ viewport, reducedMotion: 'reduce', baseURL });
        const page = await context.newPage(); const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        async function noOverflow() {
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'Horizontal overflow');
        }
        await page.goto('/'); await page.locator('#question-form').waitFor(); await noOverflow();
        await page.screenshot({ path: 'artifacts/screenshots/' + browserName + '-' + label + '-home.png', fullPage: true });
        await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; }); await noOverflow();
        await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
        await page.getByRole('button', { name: '每日星笺', exact: true }).click(); await noOverflow();
        await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; }); await noOverflow();
        await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
        await page.getByRole('button', { name: '领取今日星笺', exact: true }).click();
        await page.locator('#daily-note').waitFor(); await noOverflow();
        const dailyFirst = JSON.parse(await page.evaluate(() => localStorage.getItem('star-oracle.daily.v1')))[0];
        await page.locator('input[name="daily-mood"][value="calm"]').check();
        await page.locator('#daily-note').fill('今天给自己一点时间。<img src=x onerror=alert(1)>');
        await page.getByRole('button', { name: '保存这份心情', exact: true }).click();
        await page.waitForFunction(() => JSON.parse(localStorage.getItem('star-oracle.daily.v1'))[0].mood === 'calm');
        await page.screenshot({ path: 'artifacts/screenshots/' + browserName + '-' + label + '-daily.png', fullPage: true });
        await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true,
          value: { writeText: async () => { throw new Error('Clipboard unavailable for fallback test'); } } }));
        await page.getByRole('button', { name: '复制星笺', exact: true }).click();
        await page.locator('#copy-dialog[open]').waitFor();
        assert.ok((await page.locator('#copy-text').inputValue()).includes('今天可以做的一件小事'));
        assert.ok(!(await page.locator('#copy-text').inputValue()).includes('今天给自己一点时间。'));
        await page.getByRole('button', { name: '关闭复制窗口', exact: true }).click();
        await page.reload(); await page.getByRole('button', { name: '每日星笺', exact: true }).click();
        assert.equal(await page.locator('#daily-card').isDisabled(), true);
        assert.deepEqual(JSON.parse(await page.evaluate(() => localStorage.getItem('star-oracle.daily.v1')))[0].reading, dailyFirst.reading);
        assert.equal(await page.locator('#daily-note').inputValue(), '今天给自己一点时间。<img src=x onerror=alert(1)>');
        await page.getByRole('button', { name: '星笺日记', exact: true }).click();
        assert.equal(await page.locator('.daily-history-note img').count(), 0);
        await page.locator('.daily-history-open').click(); await page.locator('#daily-note').waitFor();
        await page.getByRole('button', { name: '星笺日记', exact: true }).click();
        await page.locator('[data-daily="delete-note"]').click();
        await page.getByRole('button', { name: '关闭星笺日记', exact: true }).click();
        assert.equal(await page.locator('#daily-note').inputValue(), '');
        assert.deepEqual(JSON.parse(await page.evaluate(() => localStorage.getItem('star-oracle.daily.v1')))[0].reading, dailyFirst.reading);
        await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; }); await noOverflow();
        await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
        await page.getByRole('button', { name: '照见首页', exact: true }).click();
        await page.locator('#question').fill('面对新机会，我需要留意什么？');
        await page.getByRole('button', { name: '开始抽牌', exact: true }).click();
        assert.equal(await page.locator('.flip-card').count(), 3);
        await page.getByRole('button', { name: '全部翻开', exact: true }).click();
        await page.getByRole('button', { name: '查看解读', exact: true }).click();
        await page.getByRole('heading', { name: '基础解读', exact: true }).waitFor(); await noOverflow();
        const saved = JSON.parse(await page.evaluate(() => localStorage.getItem('star-oracle.history.v1')));
        assert.equal(saved.length, 1); assert.equal(new Set(saved[0].reading.cards.map(x => x.id)).size, 3);
        await page.screenshot({ path: 'artifacts/screenshots/' + browserName + '-' + label + '-tarot.png', fullPage: true });
        await page.reload(); await page.getByRole('button', { name: '我的记录', exact: true }).click();
        await page.locator('.history-open').click(); await page.getByRole('heading', { name: '基础解读', exact: true }).waitFor();
        await page.getByRole('button', { name: '新的探索', exact: true }).click();
        await page.locator('input[name="mode"][value="iching"]').click();
        await page.locator('#question').fill('我可以怎样面对当前的变化？');
        await page.getByRole('button', { name: '开始起卦', exact: true }).click();
        for (let i = 0; i < 6; i++) {
          await page.getByRole('button', { name: '抛掷三枚硬币', exact: true }).click();
          await page.waitForFunction(count => document.querySelectorAll('.forming-hexagram .hex-row:not(.empty-line)').length === count &&
            !document.querySelector('#toss-button').disabled, i + 1);
        }
        await page.getByRole('button', { name: '查看卦象与解读', exact: true }).click();
        await page.getByRole('heading', { name: '基础解读', exact: true }).waitFor(); await noOverflow();
        const records = JSON.parse(await page.evaluate(() => localStorage.getItem('star-oracle.history.v1')));
        assert.equal(records[0].reading.kind, 'iching'); assert.equal(records[0].reading.lines.length, 6);
        await page.screenshot({ path: 'artifacts/screenshots/' + browserName + '-' + label + '-iching.png', fullPage: true });
        await page.getByRole('button', { name: '我的记录', exact: true }).click(); await page.locator('#clear-history').click();
        assert.equal(await page.locator('.history-open').count(), 0);
        assert.deepEqual(JSON.parse(await page.evaluate(() => localStorage.getItem('star-oracle.history.v1'))), []);
        assert.deepEqual(errors, []);
        assert.deepEqual(JSON.parse(await page.evaluate(() => localStorage.getItem('star-oracle.daily.v1')))[0].reading, dailyFirst.reading);
        console.log(browserName + ' ' + label + ': daily draw, diary, reload, tarot, six casts, history, reduced motion and viewport passed.');
        await context.close();
      }
      {
        const previewContext = await browser.newContext({ viewport: { width: 390, height: 844 }, baseURL, reducedMotion: 'reduce' });
        const previewPage = await previewContext.newPage(); const previewErrors = [];
        previewPage.on('pageerror', error => previewErrors.push(error.message));
        const html = await readFile('artifacts/preview.html', 'utf8');
        await previewPage.route('**/standalone-preview', route => route.fulfill({ contentType: 'text/html', body: html }));
        await previewPage.goto('/standalone-preview'); await previewPage.locator('#question').fill('我可以怎样开始？');
        await previewPage.getByRole('button', { name: '开始抽牌', exact: true }).click();
        await previewPage.getByRole('button', { name: '全部翻开', exact: true }).click();
        await previewPage.getByRole('button', { name: '查看解读', exact: true }).click();
        await previewPage.getByRole('heading', { name: '基础解读', exact: true }).waitFor();
        assert.equal(await previewPage.getByRole('button', { name: 'AI 解读尚未配置', exact: true }).isDisabled(), true);
        await previewPage.getByRole('button', { name: '每日星笺', exact: true }).click();
        await previewPage.getByRole('button', { name: '领取今日星笺', exact: true }).click();
        await previewPage.locator('#daily-note').waitFor();
        assert.equal(await previewPage.locator('#daily-card').isDisabled(), true);
        assert.deepEqual(previewErrors, []);
        console.log(browserName + ': standalone GPT preview passed.');
        await previewContext.close();
      }
      {
        const dayContext = await browser.newContext({ viewport: { width: 320, height: 720 },
          timezoneId: 'Asia/Shanghai', baseURL, reducedMotion: 'reduce' });
        const dayPage = await dayContext.newPage(); const dayErrors = [];
        dayPage.on('pageerror', error => dayErrors.push(error.message));
        await dayPage.clock.install({ time: new Date('2026-10-02T15:59:00Z') });
        await dayPage.goto('/'); await dayPage.getByRole('button', { name: '每日星笺', exact: true }).click();
        await dayPage.getByRole('button', { name: '领取今日星笺', exact: true }).click();
        await dayPage.locator('#daily-note').fill('午夜前尚未保存的文字');
        const firstDay = JSON.parse(await dayPage.evaluate(() => localStorage.getItem('star-oracle.daily.v1')))[0];
        assert.equal(firstDay.date, '2026-10-02');
        await dayPage.clock.setSystemTime(new Date('2026-10-02T16:00:01Z'));
        await dayPage.evaluate(() => window.dispatchEvent(new Event('focus')));
        await dayPage.getByRole('button', { name: '领取今日星笺', exact: true }).waitFor();
        await dayPage.getByRole('button', { name: '领取今日星笺', exact: true }).click();
        await dayPage.waitForFunction(() => JSON.parse(localStorage.getItem('star-oracle.daily.v1'))[0].date === '2026-10-03');
        const secondDay = JSON.parse(await dayPage.evaluate(() => localStorage.getItem('star-oracle.daily.v1')))[0];
        assert.equal(secondDay.date, '2026-10-03');
        await dayPage.getByRole('button', { name: '星笺日记', exact: true }).click();
        await dayPage.locator('[data-daily="open-entry"][data-date="2026-10-02"]').click();
        assert.equal(await dayPage.locator('#daily-note').inputValue(), '午夜前尚未保存的文字');
        await dayPage.getByRole('button', { name: '保存这份心情', exact: true }).click();
        await dayPage.waitForFunction(() => JSON.parse(localStorage.getItem('star-oracle.daily.v1'))[1].note === '午夜前尚未保存的文字');
        assert.deepEqual(JSON.parse(await dayPage.evaluate(() => localStorage.getItem('star-oracle.daily.v1')))[1].reading, firstDay.reading);
        await dayPage.getByRole('button', { name: '回到今日星笺', exact: true }).click();
        assert.equal(await dayPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true);
        const peer = await dayContext.newPage();
        await peer.clock.install({ time: new Date('2026-10-02T16:00:01Z') });
        await peer.goto('/'); await peer.getByRole('button', { name: '每日星笺', exact: true }).click();
        assert.deepEqual(JSON.parse(await peer.evaluate(() => localStorage.getItem('star-oracle.daily.v1')))[0].reading, secondDay.reading);
        await peer.locator('input[name="daily-mood"][value="hopeful"]').check();
        await peer.getByRole('button', { name: '保存这份心情', exact: true }).click();
        await dayPage.waitForFunction(() => document.querySelector('input[name="daily-mood"][value="hopeful"]').checked);
        dayPage.on('dialog', prompt => prompt.accept());
        await dayPage.getByRole('button', { name: '星笺日记', exact: true }).click();
        await dayPage.getByRole('button', { name: '清空心情与日记', exact: true }).click();
        await dayPage.waitForFunction(() => JSON.parse(localStorage.getItem('star-oracle.daily.v1')).every(entry => !entry.note && entry.mood === null));
        const cleared = JSON.parse(await dayPage.evaluate(() => localStorage.getItem('star-oracle.daily.v1')));
        assert.ok(cleared.every(entry => !entry.note && entry.mood === null));
        assert.deepEqual(cleared.map(entry => entry.reading), [secondDay.reading, firstDay.reading]);
        await dayPage.getByRole('button', { name: '关闭星笺日记', exact: true }).click();
        await dayPage.getByRole('button', { name: '继续探索这张牌', exact: true }).click();
        await dayPage.getByRole('heading', { name: '基础解读', exact: true }).waitFor();
        const deeper = JSON.parse(await dayPage.evaluate(() => localStorage.getItem('star-oracle.history.v1')))[0].reading;
        assert.deepEqual(deeper, secondDay.reading);
        assert.deepEqual(dayErrors, []);
        console.log(browserName + ': local midnight rollover, unsaved draft, past-day editing, shared tabs and diary clearing passed.');
        await dayContext.close();
      }
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, baseURL, reducedMotion: 'reduce' });
      const page = await context.newPage(); const snapshots = [];
      await page.route('**/api/config', route => route.fulfill({ json: { aiEnabled: true } }));
      await page.route('**/api/interpret', async route => {
        const input = route.request().postDataJSON(); snapshots.push(input.reading);
        const interpretation = basicInterpretation(input.reading);
        interpretation.summary = input.followUp ? '这是针对追问的模拟响应。' : '这是 AI 接口的模拟响应。';
        await route.fulfill({ json: { readingId: input.reading.id, source: 'ai', interpretation } });
      });
      await page.goto('/'); await page.locator('#question').fill('我需要留意什么？');
      await page.getByRole('button', { name: '开始抽牌', exact: true }).click();
      await page.getByRole('button', { name: '全部翻开', exact: true }).click();
      await page.getByRole('button', { name: '查看解读', exact: true }).click();
      await page.getByRole('button', { name: '用 AI 深入解读', exact: true }).click();
      await page.getByRole('heading', { name: 'AI 解读', exact: true }).waitFor();
      await page.locator('#followup').fill('我可以怎样开始？');
      await page.getByRole('button', { name: '继续追问', exact: true }).click();
      await page.locator('.followup-answer').waitFor();
      assert.equal(snapshots.length, 2); assert.deepEqual(snapshots[0], snapshots[1]);
      console.log(browserName + ': AI follow-up retains the fixed reading (mocked provider).');
      await context.close();
    } finally { await browser.close(); }
  }
} finally { await new Promise(resolve => server.close(resolve)); }
