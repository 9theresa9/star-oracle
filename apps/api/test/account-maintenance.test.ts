import { test, describe, before, after, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';
import { hashPassword, verifyPassword } from 'better-auth/crypto';
import { normalizeUsername, provisionAccount, assignAccountUsername, resetAccountPassword } from '../src/maintenance/account-service.js';

const password = 'synthetic-password-only-123';
const changedPassword = 'synthetic-changed-only-456';

test('username normalization accepts ASCII only before case folding', () => {
 assert.equal(normalizeUsername('  Fixture.Name-1_2  '), 'fixture.name-1_2');
 assert.equal(normalizeUsername('A'.repeat(32)), 'a'.repeat(32));
 for (const value of ['', 'ab', 'a'.repeat(33), '.alice', 'a b', 'a@b', 'Ａlice', 'Kelvin', 'aliсe', 'a\u0000b', 'alice\nroot']) {
  assert.throws(() => normalizeUsername(value), /Username/);
 }
});

describe('isolated offline account maintenance', () => {
 let db: PrismaClient, redis: Redis;
 before(async () => {
  const database = new URL(process.env.DATABASE_URL ?? 'file:missing');
  const cache = new URL(process.env.REDIS_URL ?? 'file:missing');
  const local = (host: string) => ['127.0.0.1', 'localhost', '[::1]'].includes(host);
  if (process.env.NODE_ENV !== 'test' || database.protocol !== 'mysql:' || database.pathname !== '/star_oracle' || !local(database.hostname) || cache.protocol !== 'redis:' || !local(cache.hostname)) {
   throw new Error('Account fixtures require NODE_ENV=test and isolated loopback MySQL /star_oracle and Redis');
  }
  db = new PrismaClient({ log: [] });
  redis = new Redis(process.env.REDIS_URL!, { lazyConnect: true, enableOfflineQueue: false, maxRetriesPerRequest: 1 });
  redis.on('error', () => {});
  await db.$connect(); await redis.connect();
 });
 after(async () => { redis?.disconnect(); await db?.$disconnect(); });
 function fixture(t: TestContext) {
  const ids: string[] = [], keys: string[] = [];
  t.after(async () => {
   if (keys.length) await redis.del(...keys);
   await db.auditLog.deleteMany({ where: { targetId: { in: ids } } });
   await db.verification.deleteMany({ where: { value: { in: ids } } });
   await db.user.deleteMany({ where: { id: { in: ids } } });
  });
  return {
   ids, keys,
   async create() { const user = await provisionAccount(db, { username: 'f' + randomUUID().replaceAll('-', '').slice(0, 25), name: 'Synthetic fixture', password }); ids.push(user.id); return user; },
   async cache(key: string, value: unknown) { keys.push(key); await redis.set(key, typeof value === 'string' ? value : JSON.stringify(value)); },
  };
 }
 test('provisions a normalized ordinary account with a compatible credential and opaque internal email', async t => {
  const f = fixture(t), username = 'T' + randomUUID().replaceAll('-', '').slice(0, 25);
  const user = await provisionAccount(db, { username: ' ' + username + ' ', name: 'Synthetic fixture', password }); f.ids.push(user.id);
  assert.equal(user.username, username.toLowerCase()); assert.equal(user.name, 'Synthetic fixture');
  assert.equal(user.email, user.id + '@accounts.invalid'); assert.equal(user.role, 'user');
  assert.equal(user.emailVerified, false); assert.equal(user.disabled, false); assert.equal(user.twoFactorEnabled, false);
  const accounts = await db.account.findMany({ where: { userId: user.id } }); assert.equal(accounts.length, 1);
  assert.equal(accounts[0]!.providerId, 'credential'); assert.equal(accounts[0]!.accountId, user.id);
  assert.notEqual(accounts[0]!.password, password); assert.equal(await verifyPassword({ hash: accounts[0]!.password!, password }), true);
 });
 test('concurrent case-insensitive duplicate creation leaves one complete account', async t => {
  const f = fixture(t), username = 'f' + randomUUID().replaceAll('-', '').slice(0, 25);
  const results = await Promise.allSettled([username, username.toUpperCase()].map(username => provisionAccount(db, { username, name: 'Synthetic fixture', password })));
  const users = await db.user.findMany({ where: { username } }); f.ids.push(...users.map(user => user.id));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1); assert.equal(users.length, 1);
  assert.equal(await db.account.count({ where: { userId: users[0]!.id } }), 1);
  const error = (results.find(result => result.status === 'rejected') as PromiseRejectedResult).reason;
  assert.match(error.message, /Username is already assigned/); assert.ok(!String(error).includes(password));
 });
 test('validates input before any write and does not promote through surplus fields', async t => {
  const f = fixture(t), user = await f.create();
  for (const value of ['', 'short', 'a'.repeat(129)]) await assert.rejects(provisionAccount(db, { username: user.username!, name: 'Fixture', password: value }), /Password/);
  await assert.rejects(provisionAccount(db, { username: 'fixture', name: '', password }), /Name/);
  await assert.rejects(provisionAccount(db, { username: 'fixture', name: 'a'.repeat(101), password }), /Name/);
  const username = 'f' + randomUUID().replaceAll('-', '').slice(0, 25);
  const ordinary = await provisionAccount(db, { username, name: 'Fixture', password, role: 'admin', disabled: true, emailVerified: true } as any); f.ids.push(ordinary.id);
  assert.equal(ordinary.role, 'user'); assert.equal(ordinary.disabled, false); assert.equal(ordinary.emailVerified, false);
 });
 test('username assignment preserves existing identity, hash, privilege, TOTP and records', async t => {
  const f = fixture(t), user = await f.create();
  await db.user.update({ where: { id: user.id }, data: { username: null, role: 'admin', disabled: true, emailVerified: true, twoFactorEnabled: true } });
  await db.twoFactor.create({ data: { id: randomUUID(), userId: user.id, secret: 'synthetic-encrypted-secret', backupCodes: 'synthetic-encrypted-backups' } });
  const oldAccount = await db.account.findFirstOrThrow({ where: { userId: user.id } });
  await db.session.create({ data: { id: randomUUID(), userId: user.id, token: randomUUID(), expiresAt: new Date(Date.now() + 60_000) } });
  const username = 'f' + randomUUID().replaceAll('-', '').slice(0, 25);
  const assigned = await assignAccountUsername(db, { userId: user.id, username: username.toUpperCase() });
  assert.equal(assigned.username, username); assert.equal(assigned.email, user.email); assert.equal(assigned.role, 'admin');
  assert.equal(assigned.disabled, true); assert.equal(assigned.emailVerified, true); assert.equal(assigned.twoFactorEnabled, true);
  assert.equal((await db.account.findUniqueOrThrow({ where: { id: oldAccount.id } })).password, oldAccount.password);
  assert.equal(await db.session.count({ where: { userId: user.id } }), 0);
  assert.equal(await db.auditLog.count({ where: { targetId: user.id, action: 'account.username-assigned.offline' } }), 1);
  assert.equal((await db.twoFactor.findFirstOrThrow({ where: { userId: user.id } })).secret, 'synthetic-encrypted-secret');
  await assert.rejects(assignAccountUsername(db, { userId: user.id, username: 'different-fixture' }), /already has a username/);
 });
 test('assignment rejects absent, malformed or ambiguous credential accounts', async t => {
  const f = fixture(t), user = await f.create(); await db.user.update({ where: { id: user.id }, data: { username: null } });
  const account = await db.account.findFirstOrThrow({ where: { userId: user.id } });
  await db.account.update({ where: { id: account.id }, data: { password: 'not-a-valid-hash' } });
  await assert.rejects(assignAccountUsername(db, { userId: user.id, username: 'fixture-assign' }), /credential/);
  await db.account.update({ where: { id: account.id }, data: { password: await hashPassword(password) } });
  await db.account.create({ data: { id: randomUUID(), userId: user.id, accountId: user.id, providerId: 'credential', password: await hashPassword(password) } });
  await assert.rejects(assignAccountUsername(db, { userId: user.id, username: 'fixture-assign' }), /credential/);
  await db.account.deleteMany({ where: { userId: user.id } });
  await assert.rejects(assignAccountUsername(db, { userId: user.id, username: 'fixture-assign' }), /credential/);
  await assert.rejects(assignAccountUsername(db, { userId: randomUUID(), username: 'fixture-assign' }), /not found/);
 });
 test('reset revokes only the target sessions and every target verification, preserving account security and other users', async t => {
  const f = fixture(t), user = await f.create(), other = await f.create();
  await db.user.update({ where: { id: user.id }, data: { role: 'admin', disabled: true, twoFactorEnabled: true, emailVerified: true } });
  await db.twoFactor.create({ data: { id: randomUUID(), userId: user.id, secret: 'keep-secret', backupCodes: 'keep-backups' } });
  const dbToken = randomUUID(), redisToken = randomUUID(), otherToken = randomUUID(), orphanToken = randomUUID();
  await f.cache('auth:' + orphanToken, { session: { token: orphanToken, userId: user.id }, user: { id: user.id } });
  await db.session.create({ data: { id: randomUUID(), userId: user.id, token: dbToken, expiresAt: new Date(Date.now() + 60_000) } });
  for (const token of [dbToken, redisToken, otherToken]) await f.cache('auth:' + token, { session: { token } });
  await f.cache('auth:active-sessions-' + user.id, [{ token: redisToken, expiresAt: Date.now() + 60_000 }]);
  await f.cache('auth:active-sessions-' + other.id, [{ token: otherToken, expiresAt: Date.now() + 60_000 }]);
  const targetKeys: string[] = [];
  for (const prefix of ['2fa-', 'trust-device-', 'reset-password-', 'delete-user-']) {
   const identifier = prefix + randomUUID(), key = 'auth:verification:' + identifier, attempts = 'auth:verification:2fa-attempts-' + identifier;
   await f.cache(key, { identifier, value: user.id }); await f.cache(attempts, { value: '2' }); targetKeys.push(key, attempts);
   await db.verification.create({ data: { id: randomUUID(), identifier, value: user.id, expiresAt: new Date(Date.now() + 60_000) } });
  }
  const otherVerification = 'auth:verification:2fa-' + randomUUID(); await f.cache(otherVerification, { value: other.id });
  await f.cache('unrelated:business-record:' + user.id, 'keep');
  await resetAccountPassword(db, redis, { username: user.username!, password: changedPassword });
  const current = await db.user.findUniqueOrThrow({ where: { id: user.id } });
  assert.equal(current.role, 'admin'); assert.equal(current.disabled, true); assert.equal(current.twoFactorEnabled, true); assert.equal(current.emailVerified, true);
  assert.equal((await db.twoFactor.findFirstOrThrow({ where: { userId: user.id } })).backupCodes, 'keep-backups');
  assert.equal(await db.session.count({ where: { userId: user.id } }), 0); assert.equal(await db.verification.count({ where: { value: user.id } }), 0);
  for (const key of ['auth:' + dbToken, 'auth:' + redisToken, 'auth:' + orphanToken, 'auth:active-sessions-' + user.id, ...targetKeys]) assert.equal(await redis.get(key), null, key);
  assert.ok(await redis.get('auth:' + otherToken)); assert.ok(await redis.get('auth:active-sessions-' + other.id)); assert.ok(await redis.get(otherVerification));
  assert.equal(await redis.get('unrelated:business-record:' + user.id), 'keep');
  const hash = (await db.account.findFirstOrThrow({ where: { userId: user.id, providerId: 'credential' } })).password!;
  assert.equal(await verifyPassword({ hash, password: changedPassword }), true); assert.equal(await verifyPassword({ hash, password }), false);
  assert.equal(await db.auditLog.count({ where: { targetId: user.id, action: 'account.password-reset.offline' } }), 1);
 });
 test('Redis failure rolls back reset and retains DB-only session targets for safe retry', async t => {
  const f = fixture(t), user = await f.create(), token = randomUUID();
  await db.session.create({ data: { id: randomUUID(), userId: user.id, token, expiresAt: new Date(Date.now() + 60_000) } });
  await f.cache('auth:' + token, { session: { token } });
  const original = await db.account.findFirstOrThrow({ where: { userId: user.id } });
  const brokenRedis = { get: async () => { throw new Error('redis://secret@example.invalid password=' + password); }, del: async () => 0, scan: async () => ['0', []] } as any;
  await assert.rejects(resetAccountPassword(db, brokenRedis, { username: user.username!, password: changedPassword }), error => error instanceof Error && /Keep all API replicas stopped/.test(error.message) && !error.message.includes(password) && !error.message.includes('redis://'));
  assert.equal((await db.account.findUniqueOrThrow({ where: { id: original.id } })).password, original.password);
  assert.equal(await db.session.count({ where: { userId: user.id } }), 1); assert.equal(await db.auditLog.count({ where: { targetId: user.id, action: 'account.password-reset.offline' } }), 0);
  await resetAccountPassword(db, redis, { username: user.username!, password: changedPassword });
  assert.equal(await redis.get('auth:' + token), null); assert.equal(await db.session.count({ where: { userId: user.id } }), 0);
 });
 test('reset verifies Redis deletions and refuses success when a target cache entry remains', async t => {
  const f = fixture(t), user = await f.create(), token = randomUUID();
  await db.session.create({ data: { id: randomUUID(), userId: user.id, token, expiresAt: new Date(Date.now() + 60_000) } });
  await f.cache('auth:' + token, { session: { token } });
  const refusesDelete = { get: redis.get.bind(redis), scan: redis.scan.bind(redis), del: async () => 0 } as any;
  await assert.rejects(resetAccountPassword(db, refusesDelete, { username: user.username!, password: changedPassword }), /Keep all API replicas stopped/);
  assert.equal(await db.session.count({ where: { userId: user.id } }), 1);
 });
});

test('reset retry clears paired verification attempts after an interrupted batched Redis revocation', async () => {
 // Fault injection needs deterministic batch boundaries. Real-database coverage
 // above verifies the same transaction path against MySQL and Redis.
 const user = { id: randomUUID(), username: 'fixture-retry' }, token = randomUUID(), store = new Map<string, string>();
 const original = 'a'.repeat(32) + ':' + 'b'.repeat(128);
 let state = { hash: original, sessions: [{ token }], audits: 0 }, deleteCalls = 0, failSecondDelete = true;
 const targetKeys: string[] = ['auth:' + token]; store.set('auth:' + token, JSON.stringify({ session: { userId: user.id } }));
 for (let index = 0; index < 51; index++) {
  const identifier = '2fa-fixture-' + index, key = 'auth:verification:' + identifier, attempts = 'auth:verification:2fa-attempts-' + identifier;
  store.set(key, JSON.stringify({ value: user.id, identifier })); store.set(attempts, JSON.stringify({ value: '2' })); targetKeys.push(key, attempts);
 }
 const tx = {
  user: { findUnique: async () => user },
  account: { findMany: async () => [{ id: 'credential', password: state.hash }], update: async ({ data }: any) => { state.hash = data.password; } },
  session: { findMany: async () => [...state.sessions], deleteMany: async () => { state.sessions = []; }, count: async () => state.sessions.length },
  verification: { findMany: async () => [], deleteMany: async () => {}, count: async () => 0 },
  auditLog: { create: async () => { state.audits++; } },
 };
 const database = { $transaction: async (work: any) => { const saved = structuredClone(state); try { return await work(tx); } catch (error) { state = saved; throw error; } } } as unknown as PrismaClient;
 const cache = {
  get: async (key: string) => store.get(key) ?? null,
  scan: async () => ['0', [...store.keys()]] as [string, string[]],
  del: async (...keys: string[]) => { deleteCalls++; if (failSecondDelete && deleteCalls === 2) throw new Error('Injected Redis interruption'); let count = 0; for (const key of keys) if (store.delete(key)) count++; return count; },
 };
 await assert.rejects(resetAccountPassword(database, cache, { username: user.username, password: changedPassword }), /Keep all API replicas stopped/);
 assert.equal(state.hash, original); assert.equal(state.sessions.length, 1); assert.equal(state.audits, 0);
 failSecondDelete = false;
 await resetAccountPassword(database, cache, { username: user.username, password: changedPassword });
 for (const key of targetKeys) assert.equal(store.has(key), false, 'stale target remained: ' + key);
 assert.equal(state.sessions.length, 0); assert.equal(state.audits, 1);
});
