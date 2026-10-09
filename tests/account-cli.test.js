import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough, Writable } from 'node:stream';
import { spawnSync } from 'node:child_process';
import { tsImport } from 'tsx/esm/api';
const { promptLine, runAccountCli } = await tsImport('../apps/api/src/maintenance/account-cli.ts', import.meta.url);
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
