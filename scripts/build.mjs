import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'dist');
await rm(out, { recursive: true, force: true });
await mkdir(resolve(out, 'server'), { recursive: true });
await mkdir(resolve(out, '.openai'), { recursive: true });
const stripModule = source => source.replace(/^import .*;\n/gm, '').replace(/^export \{[^}]+\};?\n/gm, '').replace(/^export /gm, '');
const parts = await Promise.all(['shared/data.js', 'shared/engine.js', 'server/api.js'].map(async path => stripModule(await readFile(resolve(root, path), 'utf8'))));
const assetPaths = ['index.html', 'styles.css', 'app.js', 'daily.js', 'favicon.svg', 'shared/data.js', 'shared/engine.js', 'shared/daily.js'];
const assets = {};
for (const path of assetPaths) {
  const shared = path.startsWith('shared/');
  const file = resolve(root, shared ? path : 'public/' + path);
  assets['/' + path] = { body: await readFile(file, 'utf8'),
    type: path.endsWith('.html') ? 'text/html; charset=utf-8' : path.endsWith('.css') ? 'text/css; charset=utf-8' :
      path.endsWith('.svg') ? 'image/svg+xml' : 'text/javascript; charset=utf-8' };
}
const handler = [
  'const staticAssets = ' + JSON.stringify(assets) + ';',
  'const api = createAPIHandler();',
  'export default { async fetch(request, env) {',
  '  const url = new URL(request.url);',
  "  if (url.pathname.startsWith('/api/')) return api(request, env, request.headers.get('cf-connecting-ip') || 'unknown');",
  "  if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', {status: 405});",
  "  const asset = staticAssets[url.pathname === '/' ? '/index.html' : url.pathname];",
  "  if (!asset) return new Response('Not found', {status: 404, headers: SECURITY_HEADERS});",
  "  return new Response(request.method === 'HEAD' ? null : asset.body, {headers: {...SECURITY_HEADERS, 'content-type': asset.type, 'cache-control': 'no-cache'}});",
  '}};'
].join('\n');
await writeFile(resolve(out, 'server/index.js'), parts.join('\n') + '\n' + handler + '\n');
await writeFile(resolve(out, '.openai/hosting.json'), await readFile(resolve(root, '.openai/hosting.json')));
console.log('Built dist/server/index.js for Sites (Cloudflare Worker).');
