import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';

const root = resolve(import.meta.dirname, '..');

// Real bash scripts and real gzip; only unavailable external age/Docker boundaries
// are simulated. These tests do NOT assert cryptographic or container behavior.
function fixture(t, overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'oracle-operations-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bin = join(dir, 'bin'); mkdirSync(bin);
  mkdirSync(join(dir, 'temp')); mkdirSync(join(dir, 'backups'));
  writeFileSync(join(dir, 'identity'), 'FAKE-TEST-IDENTITY');
  writeFileSync(join(dir, 'env'), 'TEST_FIXTURE_ONLY=true\n');
  writeFileSync(join(dir, 'live-data'), 'original newer_table and live sessions');
  writeFileSync(join(dir, 'backup.age'), gzipSync('CREATE TABLE old_table (id INT);\n'));
  const stub = `#!${process.execPath} --
const fs = require('node:fs');
const args = process.argv.slice(2), kind = process.argv[1].split('/').pop();
const log = event => fs.appendFileSync(process.env.EVENTS, JSON.stringify(event) + '\\n');
if (kind === 'age') {
  if (args.includes('-d')) {
    process.stdout.write(fs.readFileSync(args.at(-1)));
    log({kind:'age', event:'decrypt-output'});
    if(process.env.AGE_FAIL === '1') process.exitCode=1;
    else log({kind:'age',event:'authenticated'});
  } else {
    const input=fs.readFileSync(0);
    const outputIndex=args.indexOf('-o');
    if(outputIndex>=0) fs.writeFileSync(args[outputIndex+1],input);
    else process.stdout.write(input);
    if(process.env.AGE_FAIL==='1') process.exitCode=1;
  }
} else {
  log({kind:'docker',args});
  if(args[0]==='volume' && args[1]==='inspect') process.exit(process.env.VOLUME_EXISTS==='1'?0:1);
  const projectIndex=args.indexOf('--project-name');
  const shadow=projectIndex>=0 && args[projectIndex+1].startsWith('star-oracle-restore-');
  const cmd=args.join(' ');
  if(cmd.includes('information_schema.tables')) { process.stdout.write(process.env.NONEMPTY==='1'?'2\\n':'0\\n'); }
  else if(cmd.includes('SELECT COUNT(*) FROM session')) process.stdout.write(process.env.SESSION_REMAINS==='1'?'1\\n':'0\\n');
  else if(args.includes('exec') && args.includes('mysql') && !cmd.includes(' -e ') && !cmd.includes('mysqldump')) {
    const input=fs.readFileSync(0,'utf8'); log({kind:'import',input,shadow});
    if(!shadow) fs.writeFileSync(process.env.LIVE_DATA,input);
    if(process.env.IMPORT_FAIL==='1') process.exit(1);
  }
  else if(cmd.includes('mysqldump')) {
    process.stdout.write('CREATE TABLE old_table (id INT);\\n');
    if(process.env.DUMP_FAIL==='1') process.exit(1);
  }
  if(args.includes('diff') && process.env.SCHEMA_DIFF==='1') process.exit(2);
  if(args.includes('run') && args.includes('migrate') && process.env.MIGRATE_FAIL==='1') process.exit(1);
  if(args.includes('up') && args.includes('api') && process.env.HEALTH_FAIL==='1') process.exit(1);
}
`;
  for (const tool of ['age', 'docker']) writeFileSync(join(bin, tool), stub, { mode: 0o700 });
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, TMPDIR: join(dir, 'temp'),
    AGE_IDENTITY_FILE: join(dir, 'identity'), AGE_RECIPIENT: 'FAKE-PUBLIC-RECIPIENT',
    ENV_FILE: join(dir, 'env'), BACKUP_DIR: join(dir, 'backups'),
    RESTORE_WORK_DIR: join(dir, 'recovery'), CONFIRM_RESTORE: 'prepare-isolated-restore',
    EVENTS: join(dir, 'events'), LIVE_DATA: join(dir, 'live-data'), ...overrides };
  return { dir, env,
    run: script => spawnSync('bash', [join(root, 'scripts', script), join(dir, 'backup.age')], { cwd: dir, env, encoding: 'utf8', timeout: 60000 }),
    events: () => existsSync(env.EVENTS) ? readFileSync(env.EVENTS, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [],
    assertOriginal: () => assert.equal(readFileSync(env.LIVE_DATA, 'utf8'), 'original newer_table and live sessions'),
    assertPrivateCleanup: () => assert.deepEqual(readdirSync(join(dir, 'temp')), []),
  };
}

for (const [name, env, invalidGzip] of [
  ['age failure after emitting plaintext', { AGE_FAIL: '1' }, false],
  ['invalid gzip after authenticated decryption', {}, true],
]) test(`restore ${name} never invokes Docker or changes the original database`, t => {
  const f = fixture(t, env);
  if (invalidGzip) writeFileSync(join(f.dir, 'backup.age'), Buffer.from('corrupt compressed payload'));
  const result = f.run('restore.sh');
  assert.notEqual(result.status, 0);
  assert.equal(f.events().filter(e => e.kind === 'docker').length, 0);
  f.assertOriginal(); f.assertPrivateCleanup();
});

test('restore rejects the obsolete replace-in-place confirmation before any external action', t => {
  const f = fixture(t, { CONFIRM_RESTORE: 'replace-star-oracle-data' });
  const result = f.run('restore.sh');
  assert.notEqual(result.status, 0);
  assert.deepEqual(f.events(), []); f.assertOriginal();
});

test('successful restore authenticates first and only prepares a fresh isolated candidate', t => {
  const f = fixture(t), result = f.run('restore.sh');
  assert.equal(result.status, 0, result.stderr);
  const events = f.events(), docker = events.filter(e => e.kind === 'docker');
  assert.ok(events.findIndex(e => e.event === 'authenticated') < events.findIndex(e => e.kind === 'docker'));
  const compose = docker.filter(e => e.args[0] === 'compose');
  assert.ok(compose.length > 0);
  for (const { args } of compose) {
    const index = args.indexOf('--project-name');
    assert.ok(index >= 0 && /^star-oracle-restore-[a-z0-9-]+$/.test(args[index + 1]));
    assert.ok(!args.includes('gateway') && !args.includes('web'));
    assert.doesNotMatch(args.join(' '), /FLUSHDB|DROP DATABASE|\bdown\b/);
  }
  assert.equal(events.filter(e => e.kind === 'import').length, 1);
  assert.equal(events.find(e => e.kind === 'import').shadow, true);
  const commands = compose.map(e => e.args.join(' '));
  const importIndex = commands.findIndex(c => c.includes('exec -T mysql') && c.includes('--binary-mode=1'));
  assert.ok(commands.findIndex(c => c.includes('information_schema.tables')) < importIndex);
  assert.ok(commands.some(c => c.includes('run') && c.includes('migrate')));
  assert.ok(commands.some(c => c.includes('migrate diff') && c.includes('--exit-code')), 'verify actual schema as well as migration history');
  assert.ok(commands.some(c => c.includes('DELETE FROM session')));
  assert.ok(commands.some(c => c.includes('SELECT COUNT(*) FROM session')));
  assert.match(result.stdout, /manual cutover/i);
  assert.match(result.stdout, /original.*unchanged/i);
  f.assertOriginal(); f.assertPrivateCleanup();
  const recovery = join(f.dir, 'recovery');
  const paths = readdirSync(recovery);
  assert.equal(paths.length, 1);
  const metadata = join(recovery, paths[0]);
  assert.equal(statSync(metadata).mode & 0o777, 0o700);
  assert.ok(existsSync(join(metadata, 'compose.restore.yml')));
  assert.ok(existsSync(join(metadata, 'VERIFIED')));
  assert.ok(!readdirSync(metadata).some(name => /\.sql(?:\.gz)?$/.test(name)));
});

for (const [name, env] of [
  ['existing volume', { VOLUME_EXISTS: '1' }], ['nonempty target schema', { NONEMPTY: '1' }],
  ['SQL import failure', { IMPORT_FAIL: '1' }], ['migration failure', { MIGRATE_FAIL: '1' }],
  ['candidate health failure', { HEALTH_FAIL: '1' }],
  ['schema drift after migration', { SCHEMA_DIFF: '1' }], ['remaining sessions', { SESSION_REMAINS: '1' }],
]) test(`restore ${name} preserves original data and never announces readiness`, t => {
  const f = fixture(t, env), result = f.run('restore.sh');
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.stdout, /ready for manual cutover/i);
  f.assertOriginal(); f.assertPrivateCleanup();
  if (env.VOLUME_EXISTS || env.NONEMPTY) assert.equal(f.events().filter(e => e.kind === 'import').length, 0);
  for (const e of f.events().filter(e => e.kind === 'docker' && e.args.includes('stop'))) {
    assert.ok(e.args[e.args.indexOf('--project-name') + 1].startsWith('star-oracle-restore-'));
  }
  if (existsSync(join(f.dir, 'recovery'))) {
    for (const dir of readdirSync(join(f.dir, 'recovery'))) assert.ok(!existsSync(join(f.dir, 'recovery', dir, 'VERIFIED')));
  }
});

for (const [name, env] of [['dump failure', { DUMP_FAIL: '1' }], ['encryption failure', { AGE_FAIL: '1' }]])
  test(`backup ${name} leaves no misleading completed or partial backup`, t => {
    const f = fixture(t, env), result = f.run('backup.sh');
    assert.notEqual(result.status, 0);
    assert.deepEqual(readdirSync(join(f.dir, 'backups')), []);
    assert.doesNotMatch(result.stdout, /backup created/i);
  });

test('successful backup publishes one private encrypted file only after all pipeline stages succeed', t => {
  const f = fixture(t), result = f.run('backup.sh');
  assert.equal(result.status, 0, result.stderr);
  const files = readdirSync(join(f.dir, 'backups'));
  assert.equal(files.length, 1);
  assert.match(files[0], /\.sql\.gz\.age$/);
  assert.equal(statSync(join(f.dir, 'backups', files[0])).mode & 0o777, 0o600);
});

test('Nginx log format cannot include fake query tokens, referrers, headers or raw requests', () => {
  const nginx = readFileSync(join(root, 'infra/nginx.conf'), 'utf8');
  const format = nginx.match(/log_format\s+privacy\s+escape=json\s+([\s\S]*?);/);
  assert.ok(format, 'must override inherited combined format');
  const allowed = new Set(['time_iso8601', 'request_id', 'status', 'body_bytes_sent', 'request_time']);
  for (const [, name] of format[1].matchAll(/\$([a-z_][a-z0-9_]*)/g)) assert.ok(allowed.has(name), `unsafe log variable ${name}`);
  const fake = 'ONLY-A-VIRTUAL-RESET-TOKEN';
  const sample = format[1].replace(/\$([a-z_][a-z0-9_]*)/g, (_, name) => ({ time_iso8601: '2026-10-09', request_id: 'generated-id', status: '200', body_bytes_sent: '20', request_time: '0.001', request: `GET /account?token=${fake}`, http_referer: `https://test.invalid/account?token=${fake}` }[name] ?? fake));
  assert.ok(!sample.includes(fake));
  assert.match(nginx, /access_log\s+\/dev\/stdout\s+privacy\s+if=\$loggable_request\s*;/);
  assert.match(nginx, /map\s+\$request_uri\s+\$loggable_request/);
  const suppression = nginx.match(/~\*([^\s]+)\s+0\s*;/);
  assert.ok(suppression, 'sensitive routes must map to logging disabled');
  const sensitiveRoute = new RegExp(suppression[1], 'i');
  for (const uri of [`/account?token=${fake}`, '/account/reset', '/api/auth/reset-password']) assert.ok(sensitiveRoute.test(uri));
  assert.ok(!sensitiveRoute.test('/assets/app.js'));
  // Log phase may see $uri=/index.html, but suppression must use $request_uri.
  assert.match(nginx, /map\s+\$request_uri\s+\$loggable_request/);
  assert.match(nginx, /error_log\s+\/dev\/null\s*;/);
  assert.match(nginx, /add_header\s+Referrer-Policy\s+no-referrer\s+always\s*;/);
});

test('production and development services have bounded Docker log retention', () => {
  for (const file of ['compose.yml', 'compose.dev.yml']) {
    const compose = readFileSync(join(root, file), 'utf8');
    const serviceSection = compose.split(/^services:\s*$/m)[1].split(/^[^\s#]/m)[0];
    const services = [...serviceSection.matchAll(/^  ([\w-]+):\n([\s\S]*?)(?=^  [\w-]+:|$(?![\s\S]))/gm)];
    assert.ok(services.length > 0);
    for (const [, name, config] of services) {
      const effective = config.includes('<<: *api') ? compose.split('services:')[0] + config : config;
      assert.match(effective, /logging:/, `${file} ${name}`);
      assert.match(effective, /max-size:\s*["']?10m/, `${file} ${name}`);
      assert.match(effective, /max-file:\s*["']?3/, `${file} ${name}`);
    }
  }
});

test('gateway runtime error logs remove request URLs and headers too',()=>{
 const caddy=readFileSync(join(root,'infra/Caddyfile'),'utf8');
 assert.match(caddy,/log\s*\{[\s\S]*format filter\s*\{[\s\S]*request delete/);
});
