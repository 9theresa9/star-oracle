import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough, Writable } from 'node:stream';
import { spawnSync } from 'node:child_process';
import { tsImport } from 'tsx/esm/api';
const { promptLine, runAccountCli } = await tsImport('../apps/api/src/maintenance/account-cli.ts', import.meta.url);
const accountService = await tsImport('../apps/api/src/maintenance/account-service.ts', import.meta.url);
function terminal() {
 const input = new PassThrough(); input.isTTY = true; input.isRaw = false;
 const rawModes = []; input.setRawMode = value => { input.isRaw = value; rawModes.push(value); return input; };
 let text = ''; const output = new Writable({ write(chunk, _, done) { text += chunk; done(); } }); output.isTTY = true;
 return { input, output, rawModes, get text() { return text; } };
}
test('hidden terminal entry never echoes text and handles backspace', async () => {
 const io = terminal(), pending = promptLine(io, 'Password: ', true);
 io.input.write('secretX\u007f!\r'); assert.equal(await pending, 'secret!');
 assert.equal(io.text, 'Password: \n'); assert.deepEqual(io.rawModes, [true, false]); assert.equal(io.input.listenerCount('keypress'), 0);
});
test('hidden terminal entry restores terminal state after Ctrl-C and closed input', async () => {
 for (const event of ['cancel', 'end']) {
  const io = terminal(), pending = promptLine(io, 'Password: ', true);
  io.input.write('synthetic-secret'); if (event === 'cancel') io.input.write('\u0003'); else io.input.end();
  await assert.rejects(pending, /cancelled/); assert.equal(io.input.isRaw, false); assert.ok(!io.text.includes('synthetic-secret')); assert.equal(io.input.listenerCount('keypress'), 0);
 }
});
test('CLI refuses command-line credential arguments and redirected input before connecting', async () => {
 for (const args of [['create', 'user', 'password'], ['reset-password', '--password=secret'], ['create']]) {
  const io = terminal(); if (args.length === 1) io.input.isTTY = false; let connected = false;
  const code = await runAccountCli(args, { ...io, connect: async () => { connected = true; throw new Error('must not connect'); } });
  assert.equal(code, 1); assert.equal(connected, false); assert.ok(!io.text.includes('secret'));
 }
});
test('CLI validates and confirms hidden password before opening resources', async () => {
 const io = terminal(); let connected = false;
 const running = runAccountCli(['create'], { ...io, connect: async () => { connected = true; throw new Error('must not connect'); } });
 const send = async value => { await new Promise(resolve => setImmediate(resolve)); io.input.write(value + '\r'); };
 await send('fixture-user'); await send('Synthetic fixture'); await send('synthetic-password-123'); await send('synthetic-password-456');
 assert.equal(await running, 1); assert.equal(connected, false); assert.match(io.text, /do not match/); assert.ok(!io.text.includes('synthetic-password'));
});
test('CLI requires explicit offline acknowledgement and exact target confirmation', async () => {
 const io = terminal(); let connected = false;
 const running = runAccountCli(['reset-password'], { ...io, connect: async () => { connected = true; throw new Error('must not connect'); } });
 const send = async value => { await new Promise(resolve => setImmediate(resolve)); io.input.write(value + '\r'); };
 await send('fixture-user'); await send('synthetic-password-123'); await send('synthetic-password-123'); await send('no');
 assert.equal(await running, 1); assert.equal(connected, false); assert.match(io.text, /all API replicas/i);
});
test('standalone CLI rejects piped passwords without initializing API configuration or printing environment secrets', () => {
 const result = spawnSync(process.execPath, ['--import', 'tsx', 'apps/api/src/maintenance/account-cli.ts', 'create'], { encoding: 'utf8', input: 'secret\n', env: { ...process.env, DATABASE_URL: 'mysql://secret-url.invalid', AUTH_SECRET: '', PASSWORD: 'secret-environment-value' } });
 assert.equal(result.status, 1); assert.match(result.stderr + result.stdout, /interactive terminal/i);
 assert.ok(!(result.stderr + result.stdout).includes('secret-url')); assert.ok(!(result.stderr + result.stdout).includes('secret-environment'));
});
test('CLI rejects wrong target confirmation and suppresses raw provider failures after confirmation', async () => {
 for (const correct of [false, true]) {
  const io = terminal(); let connected = false;
  const running = runAccountCli(['reset-password'], { ...io, connect: async () => { connected = true; throw new Error('mysql://private-db.invalid synthetic-password-123 hash:secret'); } });
  const send = async value => { await new Promise(resolve => setImmediate(resolve)); io.input.write(value + '\r'); };
  for (const value of ['fixture-user', 'synthetic-password-123', 'synthetic-password-123', 'STOPPED', correct ? 'fixture-user' : 'wrong-user']) await send(value);
  assert.equal(await running, 1); assert.equal(connected, correct);
  assert.ok(!io.text.includes('private-db')); assert.ok(!io.text.includes('synthetic-password')); assert.ok(!io.text.includes('hash:secret'));
  assert.match(io.text, correct ? /Keep all API replicas stopped/ : /target confirmation did not match/);
 }
});
test('terminal cancellation by Ctrl-D and SIGTERM restores raw state without echoing the secret', async () => {
 for (const cancel of [io => io.input.write('\u0004'), () => process.emit('SIGTERM')]) {
  const io = terminal(), pending = promptLine(io, 'Password: ', true); io.input.write('fixture-secret'); cancel(io);
  await assert.rejects(pending, /cancelled/); assert.equal(io.input.isRaw, false); assert.equal(io.text, 'Password: \n');
 }
});
test('terminal cancellation settles safely even when the disconnected terminal cannot restore raw mode', async () => {
 const io = terminal(), setRawMode = io.input.setRawMode;
 io.input.setRawMode = value => { if (!value) throw new Error('private terminal device detail'); return setRawMode(value); };
 const pending = promptLine(io, 'Password: ', true);
 assert.doesNotThrow(() => io.input.write('\u0003'));
 await assert.rejects(pending, error => /cancelled/.test(error.message) && !error.message.includes('private terminal'));
 assert.equal(io.input.listenerCount('keypress'), 0);
});
test('terminal setup and cleanup write failures expose only a safe cancellation', async () => {
 for (const phase of ['setup', 'cleanup']) {
  const io = terminal(), write = io.output.write.bind(io.output);
  io.output.write = value => { if ((phase === 'setup' && value !== '\n') || (phase === 'cleanup' && value === '\n')) throw new Error('private terminal output'); return write(value); };
  const pending = promptLine(io, 'Password: ', true);
  if (phase === 'cleanup') assert.doesNotThrow(() => io.input.write('\r'));
  await assert.rejects(pending, error => /cancelled/.test(error.message) && !error.message.includes('private terminal'));
  assert.equal(io.input.isRaw, false);
 }
});

test('all-session CLI requires exact STOPPED and ALL before connecting, without asking for credentials', async () => {
 for (const answers of [['no'], ['STOPPED', 'all'], ['STOPPED', 'ALL']]) {
  const io = terminal(); let connected = false;
  const running = runAccountCli(['revoke-all-sessions'], { ...io, connect: async command => {
   connected = true; assert.equal(command, 'revoke-all-sessions'); throw new Error('redis://private-fixture.invalid');
  } });
  for (const value of answers) { await new Promise(resolve => setImmediate(resolve)); io.input.write(value + '\r'); }
  assert.equal(await running, 1); assert.equal(connected, answers.at(-1) === 'ALL');
  assert.match(io.text, /all API replicas/i); assert.doesNotMatch(io.text, /Username:|Password.*:|private-fixture/);
  if (answers[0] === 'STOPPED') assert.match(io.text, /Type ALL/);
 }
});

test('all-session CLI refuses arguments and noninteractive terminals before connecting', async () => {
 for (const args of [['revoke-all-sessions', 'ALL'], ['revoke-all-sessions']]) {
  const io = terminal();
  if (args.length === 1) io.output.isTTY = false;
  let connected = false;
  assert.equal(await runAccountCli(args, { ...io, connect: async () => { connected = true; } }), 1);
  assert.equal(connected, false);
  assert.match(io.text, args.length === 1 ? /interactive terminal/ : /Usage:/);
 }
});

function cutoverFixture() {
 let state = {
  users: [{ id: 'a', username: 'fixture-a', role: 'user', disabled: false }, { id: 'b', username: null, role: 'admin', disabled: true }],
  accounts: [{ userId: 'a', password: 'unchanged-hash-a' }, { userId: 'b', password: 'unchanged-hash-b' }],
  twoFactors: [{ userId: 'b', secret: 'unchanged-encrypted-totp', backupCodes: 'unchanged-encrypted-backups' }],
  sessions: [{ userId: 'a', token: 'database-a' }, { userId: 'b', token: 'database-b' }],
  verifications: [
   { identifier: '2fa-a', value: 'a' }, { identifier: '2fa-attempts-2fa-a', value: '2' },
   { identifier: 'trust-device-b', value: 'b' }, { identifier: 'unrelated', value: 'unrelated-value' },
  ], audits: [],
 };
 const matches = (record, where) => !where || (where.OR ? where.OR.some(clause => matches(record, clause)) : Object.entries(where).every(([key, value]) => typeof value === 'object' ? value.in.includes(record[key]) : record[key] === value));
 const models = {
  session: {
   findMany: async ({ where }) => state.sessions.filter(record => matches(record, where)),
   deleteMany: async ({ where }) => { state.sessions = state.sessions.filter(record => !matches(record, where)); },
   count: async ({ where } = {}) => state.sessions.filter(record => matches(record, where)).length,
  },
  verification: {
   findMany: async ({ where }) => state.verifications.filter(record => matches(record, where)),
   deleteMany: async ({ where }) => { state.verifications = state.verifications.filter(record => !matches(record, where)); },
   count: async ({ where } = {}) => state.verifications.filter(record => matches(record, where)).length,
  },
  auditLog: { create: async ({ data }) => { state.audits.push(data); } },
 };
 const database = { ...models,
  user: { findMany: async () => structuredClone(state.users) },
  $transaction: async work => { const saved = structuredClone(state); try { return await work(models); } catch (error) { state = saved; throw error; } },
 };
 const store = new Map(Object.entries({
  'auth:database-a': { session: { token: 'database-a' } },
  'auth:database-b': { session: { token: 'database-b' } },
  'auth:active-sessions-a': [{ token: 'indexed-a' }],
  'auth:indexed-a': { session: { token: 'indexed-a' } },
  'auth:orphan-b': { session: { userId: 'b' }, user: { id: 'b' } },
  'auth:verification:2fa-a': { identifier: '2fa-a', value: 'a' },
  'auth:verification:2fa-attempts-2fa-a': { value: '2' },
  'auth:verification:trust-device-b': { identifier: 'trust-device-b', value: 'b' },
  'auth:verification:2fa-cache-only-b': { value: 'b' },
  'auth:verification:2fa-attempts-2fa-cache-only-b': { value: '3' },
  'auth:unrelated-cache': { user: { id: 'another-system-user' } },
  'auth:rate-limit:fixture': { count: 4, lastRequest: 1 },
  'limit:login:a': { count: 4 },
  'business:a': { keep: true },
 }).map(([key, value]) => [key, JSON.stringify(value)]));
 const cache = {
  get: async key => store.get(key) ?? null,
  scan: async (_cursor, match, pattern, count, size) => {
   assert.deepEqual([match, pattern, count, size], ['MATCH', 'auth:*', 'COUNT', 200]);
   return ['0', [...store.keys()].filter(key => key.startsWith('auth:'))];
  },
  del: async (...keys) => keys.reduce((deleted, key) => deleted + Number(store.delete(key)), 0),
 };
 return { database, cache, store, get state() { return state; } };
}

test('mode cutover revokes every user session and challenge while preserving passwords, TOTP, roles and unrelated cache', async () => {
 assert.equal(typeof accountService.revokeAllAccountSessions, 'function', 'offline cutover service must exist');
 const f = cutoverFixture(), original = structuredClone(f.state);
 await accountService.revokeAllAccountSessions(f.database, f.cache);
 assert.deepEqual(f.state.sessions, []);
 assert.deepEqual(f.state.verifications, [{ identifier: 'unrelated', value: 'unrelated-value' }]);
 for (const field of ['users', 'accounts', 'twoFactors']) assert.deepEqual(f.state[field], original[field]);
 assert.deepEqual(f.state.audits.map(row => [row.action, row.targetId]), [['account.sessions-revoked.offline', 'a'], ['account.sessions-revoked.offline', 'b']]);
 assert.deepEqual([...f.store.keys()].sort(), ['auth:rate-limit:fixture', 'auth:unrelated-cache', 'business:a', 'limit:login:a']);
});

test('partial cutover failure keeps current-user DB references and safely retries already-revoked users', async () => {
 assert.equal(typeof accountService.revokeAllAccountSessions, 'function', 'offline cutover service must exist');
 const f = cutoverFixture(), remove = f.cache.del;
 f.cache.del = async (...keys) => { if (keys.includes('auth:database-b')) throw new Error('redis://private-connection.invalid'); return remove(...keys); };
 await assert.rejects(accountService.revokeAllAccountSessions(f.database, f.cache), error => /Keep all API replicas stopped/.test(error.message) && !error.message.includes('private-connection'));
 assert.deepEqual(f.state.sessions, [{ userId: 'b', token: 'database-b' }]);
 assert.deepEqual(f.state.audits.map(row => row.targetId), ['a']);
 assert.equal(f.state.verifications.some(row => row.value === 'b'), true);
 assert.equal(f.store.has('auth:verification:2fa-cache-only-b'), true);
 assert.equal(f.store.has('auth:verification:2fa-attempts-2fa-cache-only-b'), false);
 f.cache.del = remove;
 await accountService.revokeAllAccountSessions(f.database, f.cache);
 assert.deepEqual(f.state.sessions, []); assert.deepEqual([...f.store.keys()].sort(), ['auth:rate-limit:fixture', 'auth:unrelated-cache', 'business:a', 'limit:login:a']);
});

test('cutover refuses success when Redis pretends to delete sessions', async () => {
 assert.equal(typeof accountService.revokeAllAccountSessions, 'function', 'offline cutover service must exist');
 const f = cutoverFixture(); f.cache.del = async () => 0;
 await assert.rejects(accountService.revokeAllAccountSessions(f.database, f.cache), /Keep all API replicas stopped/);
 assert.equal(f.state.sessions.length, 2); assert.equal(f.state.audits.length, 0);
});

test('all-session CLI reports completion only after verified revocation and closes resources', async () => {
 const f = cutoverFixture(), io = terminal(); let closed = false;
 const running = runAccountCli(['revoke-all-sessions'], { ...io, connect: async () => ({ db: f.database, redis: f.cache, close: async () => { closed = true; } }) });
 for (const value of ['STOPPED', 'ALL']) { await new Promise(resolve => setImmediate(resolve)); io.input.write(value + '\r'); }
 assert.equal(await running, 0); assert.equal(closed, true); assert.equal(f.state.sessions.length, 0);
 assert.match(io.text, /revoked and verified/); assert.match(io.text, /API replicas may now restart/);
 assert.doesNotMatch(io.text, /Username:|Password.*:/);
});

test('cutover final verification rejects sessions, user verifications and orphan cache restored after per-user commits', async () => {
 for (const residual of ['session', 'verification', 'orphan', 'index']) {
  const f = cutoverFixture(), transaction = f.database.$transaction;
  let transactions = 0;
  f.database.$transaction = async work => {
   const result = await transaction(work);
   if (++transactions === 2) {
    if (residual === 'session') f.state.sessions.push({ userId: 'a', token: 'late-session' });
    else if (residual === 'verification') f.state.verifications.push({ identifier: 'late-challenge', value: 'a' });
    else f.store.set(residual === 'orphan' ? 'auth:late-orphan' : 'auth:active-sessions-a', JSON.stringify(residual === 'orphan' ? { user: { id: 'a' } } : []));
   }
   return result;
  };
  await assert.rejects(accountService.revokeAllAccountSessions(f.database, f.cache), /Keep all API replicas stopped/, residual);
 }
});

test('all-session command accepts genuine PTY STOPPED and ALL without loading secrets or connecting early', () => {
 const script = `import errno, json, os, pty, select, subprocess, sys, time
master, slave = pty.openpty()
env = dict(os.environ, DATABASE_URL='file:fixture', REDIS_URL='redis://private-fixture.invalid', AUTH_SECRET='')
child = subprocess.Popen([sys.argv[1], '--import', 'tsx', 'apps/api/src/maintenance/account-cli.ts', 'revoke-all-sessions'], stdin=slave, stdout=slave, stderr=slave, env=env)
os.close(slave)
output = b''
step = 0
deadline = time.monotonic() + 10
try:
 while time.monotonic() < deadline:
  if select.select([master], [], [], 0.1)[0]:
   try: chunk = os.read(master, 65536)
   except OSError as error:
    if error.errno == errno.EIO: break
    raise
   if not chunk: break
   output += chunk
   if step == 0 and b'Type STOPPED to confirm' in output:
    os.write(master, b'STOPPED\\r'); step = 1
   if step == 1 and b'Type ALL to confirm' in output:
    os.write(master, b'ALL\\r'); step = 2
  elif child.poll() is not None: break
 if child.poll() is None: child.wait(timeout=2)
 print(json.dumps({'status': child.returncode, 'step': step, 'output': output.decode()}))
finally:
 if child.poll() is None: child.kill(); child.wait()
 os.close(master)
`;
 const result = spawnSync('python3', ['-c', script, process.execPath], { encoding: 'utf8', timeout: 15_000 });
 assert.equal(result.status, 0, result.stderr);
 const child = JSON.parse(result.stdout);
 assert.equal(child.step, 2); assert.equal(child.status, 1);
 assert.match(child.output, /Maintenance requires DATABASE_URL for MySQL/);
 assert.doesNotMatch(child.output, /Username:|Password.*:|private-fixture|API replicas may now restart/);
});

test('real Better Auth rejects relabeled old signed cookies after offline cutover and accepts fresh login', async () => {
 const { betterAuth } = await import('better-auth');
 const { memoryAdapter } = await import('better-auth/adapters/memory');
 const { username } = await import('better-auth/plugins');
 const { hashPassword } = await import('better-auth/crypto');
 const f = cutoverFixture(), password = 'synthetic-cookie-fixture-only-123';
 const user = { id: 'fixture-cookie-user', name: 'Fixture', username: 'fixture_cookie_user', email: 'fixture@accounts.invalid', emailVerified: false, createdAt: new Date(), updatedAt: new Date() };
 f.state.users = [user]; f.state.accounts = [{ id: 'fixture-credential', userId: user.id, accountId: user.id, providerId: 'credential', password: await hashPassword(password) }];
 f.state.sessions = []; f.state.verifications = []; f.store.clear();
 const authData = {
  get user() { return f.state.users; }, set user(value) { f.state.users = value; },
  get account() { return f.state.accounts; }, set account(value) { f.state.accounts = value; },
  get session() { return f.state.sessions; }, set session(value) { f.state.sessions = value; },
  get verification() { return f.state.verifications; }, set verification(value) { f.state.verifications = value; },
 };
 const instance = (cookiePrefix, secure, baseURL) => betterAuth({
  logger: { disabled: true }, baseURL, secret: 'synthetic-cookie-cutover-secret-1234567890', database: memoryAdapter(authData),
  secondaryStorage: { get: key => f.cache.get('auth:' + key), set: async (key, value) => { f.store.set('auth:' + key, value); }, delete: async key => { f.store.delete('auth:' + key); } },
  emailAndPassword: { enabled: true, disableSignUp: true }, plugins: [username({ displayUsername: false })],
  session: { storeSessionInDatabase: true, cookieCache: { enabled: false } },
  advanced: { cookiePrefix, useSecureCookies: secure }, rateLimit: { enabled: false },
 });
 const legacy = instance('better-auth', true, 'https://cutover.example.invalid'), ssh = instance('star-oracle-ssh', false, 'http://localhost:17777');
 const login = async (auth, cookieName) => {
  const response = await auth.api.signInUsername({ body: { username: user.username, password }, asResponse: true });
  assert.equal(response.status, 200);
  const cookie = response.headers.getSetCookie().find(value => value.startsWith(cookieName + '='));
  assert.ok(cookie); return cookie.split(';')[0];
 };
 const oldCookie = await login(legacy, '__Secure-better-auth.session_token');
 const renamed = oldCookie.replace('__Secure-better-auth.session_token=', 'star-oracle-ssh.session_token=');
 assert.equal((await ssh.api.getSession({ headers: new Headers({ cookie: renamed }) }))?.user.id, user.id);
 await accountService.revokeAllAccountSessions(f.database, f.cache);
 assert.equal(await legacy.api.getSession({ headers: new Headers({ cookie: oldCookie }) }), null);
 assert.equal(await ssh.api.getSession({ headers: new Headers({ cookie: renamed }) }), null);
 const fresh = await login(ssh, 'star-oracle-ssh.session_token');
 assert.equal((await ssh.api.getSession({ headers: new Headers({ cookie: fresh }) }))?.user.id, user.id);
});
