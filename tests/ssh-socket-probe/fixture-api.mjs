import http from 'node:http';
import {pathToFileURL} from 'node:url';
import {sshRequestAllowed} from '../../apps/api/src/ssh-transport.ts';

// Synthetic data only. The actual application peer/header guard is imported,
// and its Origin check is repeated here without auth, MySQL, or Redis.
export function createFixtureServer() {
  return http.createServer((request, response) => {
    const origin = request.headers.origin;
    const allowed = sshRequestAllowed(request, true)
      && (!origin || origin === 'http://localhost:17777');
    response.writeHead(allowed ? 200 : 403, {'Content-Type':'application/json'});
    response.end(JSON.stringify({fixture:'ssh-socket', allowed,
      peer:request.socket.remoteAddress, node:process.version}));
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.version.startsWith('v24.')) throw new Error('Node 24 required');
  createFixtureServer().listen(3001, '172.30.77.2');
}
