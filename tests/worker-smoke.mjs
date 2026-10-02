import assert from 'node:assert/strict';
import worker from '../dist/server/index.js';
const origin = 'https://oracle.example';
for (const path of ['/', '/styles.css', '/app.js', '/daily.js', '/shared/data.js', '/shared/engine.js', '/shared/daily.js']) {
  const response = await worker.fetch(new Request(origin + path), {});
  assert.equal(response.status, 200); assert.ok((await response.text()).length > 100);
}
const config = await worker.fetch(new Request(origin + '/api/config'), {});
assert.deepEqual(await config.json(), { aiEnabled: false });
assert.equal((await worker.fetch(new Request(origin + '/.env'), {})).status, 404);
const reading = { version:1, id:'worker-reading-123', createdAt:'2026-10-02T00:00:00Z',
  question:'我可以怎样开始？', kind:'iching', lines:[9,7,7,7,7,7] };
const request = new Request(origin + '/api/interpret', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({reading})});
assert.equal((await worker.fetch(request, {})).status, 503);
console.log('Built Worker: static assets, shared data, private-file hiding and AI-disabled API passed.');
