import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, dirname, join, extname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createAPIHandler, SECURITY_HEADERS, json } from './api.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8' };
export function createAppServer({ env = process.env, fetchImpl = fetch } = {}) {
  const handleAPI = createAPIHandler({ fetchImpl });
  const server = createServer(async (req, res) => {
    try {
      const requestURL = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
      let response;
      if (requestURL.pathname.startsWith('/api/')) {
        let size = 0; const chunks = [];
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 20000) {
            res.writeHead(413, { ...SECURITY_HEADERS, 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: '请求内容过长', code: 'BODY_TOO_LARGE' }));
            return;
          }
          chunks.push(chunk);
        }
        // Compare against the externally supplied Origin host, without trusting proxy IP headers.
        const headers = new Headers();
        for (const [name, value] of Object.entries(req.headers)) {
          if (value != null) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
        }
        const origin = headers.get('origin');
        if (origin) {
          try {
            const url = new URL(origin);
            if (url.host !== requestURL.host) response = json({ error: '请求来源无效', code: 'INVALID_ORIGIN' }, 403);
            else headers.set('origin', requestURL.origin);
          } catch { response = json({ error: '请求来源无效', code: 'INVALID_ORIGIN' }, 403); }
        }
        if (!response) {
          const body = Buffer.concat(chunks);
          const request = new Request(requestURL, { method: req.method, headers,
            ...(!['GET', 'HEAD'].includes(req.method) ? { body } : {}) });
          response = await handleAPI(request, env, req.socket.remoteAddress || 'unknown');
        }
      } else {
        if (!['GET', 'HEAD'].includes(req.method)) response = new Response('Method not allowed', { status: 405 });
        else {
          let pathname;
          try { pathname = decodeURIComponent(requestURL.pathname); } catch { pathname = ''; }
          const shared = pathname.startsWith('/shared/');
          const relative = shared ? pathname.slice('/shared/'.length) : pathname === '/' ? 'index.html' : pathname.slice(1);
          const dir = join(root, shared ? 'shared' : 'public');
          const path = resolve(dir, relative);
          if (!relative || !path.startsWith(dir + sep) || relative.includes('\0') || !types[extname(path)]) {
            response = new Response('Not found', { status: 404 });
          } else {
            try {
              response = new Response(await readFile(path), {
                headers: { 'content-type': types[extname(path)], 'cache-control': 'no-cache' }
              });
            } catch { response = new Response('Not found', { status: 404 }); }
          }
        }
      }
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
      for (const [name, value] of response.headers) res.setHeader(name, value);
      res.writeHead(response.status);
      res.end(req.method === 'HEAD' ? undefined : Buffer.from(await response.arrayBuffer()));
    } catch {
      if (!res.headersSent) res.writeHead(500, { ...SECURITY_HEADERS, 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: '请求未完成', code: 'INTERNAL_ERROR' }));
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '127.0.0.1';
  const server = createAppServer();
  server.listen(port, host, () => console.log('Star Oracle listening on http://' + host + ':' + port));
  const shutdown = () => server.close(() => process.exit(0));
  process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
}
