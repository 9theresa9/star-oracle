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
        console.log(browserName + ' ' + label + ': tarot, six casts, history, reduced motion and viewport passed.');
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
        assert.deepEqual(previewErrors, []);
        console.log(browserName + ': standalone GPT preview passed.');
        await previewContext.close();
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
