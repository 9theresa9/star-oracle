import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {once} from 'node:events';
import http from 'node:http';

const file = new URL('./fixture-api.mjs', import.meta.url);
test('fixture exists and exercises the real strict-peer guard on actual sockets', async () => {
  assert.ok(existsSync(file), 'the bounded fixture API must exist');
  const {createFixtureServer} = await import(file);
  const server = createFixtureServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const request = (path, headers = {}) => new Promise((resolve, reject) => {
      http.get({host:'127.0.0.1', port:server.address().port, path,
        headers:{Host:'localhost:17777', ...headers}}, response => {
        let body=''; response.on('data', chunk => body += chunk);
        response.on('end', () => resolve({status:response.statusCode, body:JSON.parse(body)}));
      }).on('error', reject);
    });
    const health = await request('/api/v1/health');
    assert.equal(health.status, 200);
    assert.equal(health.body.peer, '127.0.0.1');
    assert.match(health.body.node, /^v24\./);
    assert.equal((await request('/api/fixture')).status, 403);
    assert.equal((await request('/api/v1/health', {'X-Forwarded-For':'172.30.77.3'})).status, 403);
    assert.equal((await request('/api/v1/health', {'X-Forwarded-Unusual':''})).status, 403);
    assert.equal((await request('/api/v1/health', {Origin:'https://untrusted.invalid'})).status, 403);
    assert.equal((await request('/api/v1/health', {Host:'LOCALHOST:17777'})).status, 403);
  } finally { server.close(); await once(server, 'close'); }
});
