import { randomUUID } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import type { PrismaClient, Prisma, User } from '@prisma/client';

/** Safe operator messages only: never wrap provider messages, URLs or credentials. */
export class AccountMaintenanceError extends Error {
 constructor(message: string) { super(message); this.name = 'AccountMaintenanceError'; }
}
function safe(message: string): never { throw new AccountMaintenanceError(message); }
export function normalizeUsername(raw: string): string {
 // Validate before lowercasing: Unicode Kelvin signs and similar characters can
 // otherwise fold into ASCII and impersonate an existing account name.
 if (typeof raw !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{2,31}$/.test(raw.trim())) {
  safe('Username must be 3–32 ASCII letters, numbers, dots, underscores or hyphens and start with a letter or number.');
 }
 return raw.trim().toLowerCase();
}
export function validatePassword(password: string): void {
 if (typeof password !== 'string' || password.length < 12 || password.length > 128) safe('Password must contain 12–128 characters.');
}
export function validateAccountName(name: string): string {
 if (typeof name !== 'string' || !name.trim() || name.trim().length > 100 || /[\u0000-\u001f\u007f]/.test(name)) safe('Name must contain 1–100 printable characters.');
 return name.trim();
}
export function validateUserId(userId: string): string {
 if (typeof userId !== 'string' || !/^[a-zA-Z0-9_-]{1,36}$/.test(userId)) safe('User ID is invalid.');
 return userId;
}
function rethrowSafe(error: unknown): never {
 if (error instanceof AccountMaintenanceError) throw error;
 if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') safe('Username is already assigned.');
 safe('Account maintenance failed. Keep all API replicas stopped and retry after checking database and Redis availability.');
}
async function credential(tx: Prisma.TransactionClient, userId: string) {
 const accounts = await tx.account.findMany({ where: { userId, providerId: 'credential' } });
 if (accounts.length !== 1 || !/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(accounts[0]?.password ?? '')) {
  safe('Account must have exactly one valid password credential; resolve the credential records offline first.');
 }
 return accounts[0]!;
}
const auditData = (action: string, userId: string) => ({ id: randomUUID(), actorId: null, action, targetId: userId, requestId: randomUUID() });

export async function provisionAccount(db: PrismaClient, input: { username: string; name: string; password: string }): Promise<User> {
 const username = normalizeUsername(input.username), name = validateAccountName(input.name); validatePassword(input.password);
 try {
  const password = await hashPassword(input.password), id = randomUUID();
  return await db.$transaction(async tx => {
   // The nested user/credential write and the unique username constraint make
   // concurrent duplicate requests atomic. There is no check-then-insert race.
   const user = await tx.user.create({ data: {
    id, username, name, email: id + '@accounts.invalid', emailVerified: false,
    role: 'user', disabled: false, twoFactorEnabled: false,
    accounts: { create: { id: randomUUID(), accountId: id, providerId: 'credential', password } },
   } });
   await tx.auditLog.create({ data: auditData('account.provisioned.offline', id) });
   return user;
  });
 } catch (error) { return rethrowSafe(error); }
}

/** Offline only. Never infer an existing identity from its email address. */
export async function assignAccountUsername(db: PrismaClient, input: { userId: string; username: string }): Promise<User> {
 const username = normalizeUsername(input.username), userId = validateUserId(input.userId);
 try {
  return await db.$transaction(async tx => {
   const user = await tx.user.findUnique({ where: { id: userId } });
   if (!user) safe('Account not found.');
   if (user.username !== null) safe('Account already has a username.');
   await credential(tx, userId);
   const updated = await tx.user.updateMany({ where: { id: userId, username: null }, data: { username } });
   if (updated.count !== 1) safe('Account already has a username.');
   // Old email-era cookies must not become valid when the account gains a name.
   // API authorization requires a live DB session, even when a cache remains.
   await tx.session.deleteMany({ where: { userId } });
   await tx.auditLog.create({ data: auditData('account.username-assigned.offline', userId) });
   return tx.user.findUniqueOrThrow({ where: { id: userId } });
  });
 } catch (error) { return rethrowSafe(error); }
}

export interface AccountRedis {
 get(key: string): Promise<string | null>;
 del(...keys: string[]): Promise<number>;
 scan(cursor: string, match: 'MATCH', pattern: string, count: 'COUNT', size: number): Promise<[string, string[]]>;
}
function jsonRecord(raw: string | null): Record<string, unknown> | undefined {
 if (raw === null) return;
 try { const value: unknown = JSON.parse(raw); if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>; } catch { /* Unrelated rate-limit/cache records need not be JSON. */ }
}
function object(value: unknown): Record<string, unknown> | undefined {
 return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
async function scanOwnedCache(redis: AccountRedis, userId: string): Promise<Set<string>> {
 const owned = new Set<string>(); let cursor = '0';
 do {
  const page = await redis.scan(cursor, 'MATCH', 'auth:*', 'COUNT', 200); cursor = page[0];
  for (const key of page[1]) {
   const record = jsonRecord(await redis.get(key));
   if (!record) continue;
   if (key.startsWith('auth:verification:') && record.value === userId) {
    owned.add(key);
    owned.add('auth:verification:2fa-attempts-' + key.slice('auth:verification:'.length));
    if (typeof record.identifier === 'string') owned.add('auth:verification:2fa-attempts-' + record.identifier);
   } else if (object(record.session)?.userId === userId || object(record.user)?.id === userId) {
    // Older cache-only/orphan sessions may be missing from both the DB and
    // active-session index. Inspect ownership; never clear a whole namespace.
    owned.add(key);
   }
  }
 } while (cursor !== '0');
 return owned;
}
async function revokeCache(redis: AccountRedis, userId: string, tokens: string[], identifiers: string[]): Promise<void> {
 const activeKey = 'auth:active-sessions-' + userId, keys = new Set(tokens.map(token => 'auth:' + token));
 const active = await redis.get(activeKey);
 if (active !== null) {
  const references: unknown = JSON.parse(active);
  if (!Array.isArray(references) || references.some(reference => typeof object(reference)?.token !== 'string' || !object(reference)?.token)) throw new Error('Invalid session index');
  for (const reference of references) keys.add('auth:' + (reference as { token: string }).token);
 }
 for (const identifier of identifiers) {
  keys.add('auth:verification:' + identifier); keys.add('auth:verification:2fa-attempts-' + identifier);
 }
 for (const key of await scanOwnedCache(redis, userId)) keys.add(key);
 // Keep the active index until its session keys have been removed and verified.
 const allKeys = [...keys];
 // Remove paired attempt counters first. If a later batch fails, its parent
 // verification remains discoverable for retry; no orphan counter is stranded.
 const attempts = allKeys.filter(key => key.startsWith('auth:verification:2fa-attempts-'));
 const remaining = allKeys.filter(key => !key.startsWith('auth:verification:2fa-attempts-'));
 for (const group of [attempts, remaining]) {
  for (let offset = 0; offset < group.length; offset += 100) await redis.del(...group.slice(offset, offset + 100));
  for (const key of group) if (await redis.get(key) !== null) throw new Error('Revocation incomplete');
 }
 await redis.del(activeKey);
 if (await redis.get(activeKey) !== null || (await scanOwnedCache(redis, userId)).size !== 0) throw new Error('Revocation incomplete');
}

/**
 * OFFLINE MODE CUTOVER: stop and drain ALL API replicas and authentication
 * writers before calling, and keep them stopped until this command succeeds.
 * Cookie names do not bind session signatures to a deployment mode. Revoke the
 * underlying sessions instead of rotating AUTH_SECRET, which also protects TOTP.
 *
 * Each user's DB changes commit only after verified targeted Redis revocation.
 * On failure, earlier users may already be signed out; the failed user's DB
 * references survive rollback, so retry the whole command while still offline.
 * This intentionally never updates users, password credentials or TwoFactor.
 */
export async function revokeAllAccountSessions(db: PrismaClient, redis: AccountRedis): Promise<void> {
 try {
  // Include disabled users and legacy users without usernames or credentials.
  const users = await db.user.findMany({ select: { id: true }, orderBy: { id: 'asc' } });
  for (const user of users) {
   await db.$transaction(async tx => {
    const sessions = await tx.session.findMany({ where: { userId: user.id }, select: { token: true } });
    const verifications = await tx.verification.findMany({ where: { value: user.id }, select: { identifier: true } });
    const identifiers = verifications.map(value => value.identifier);
    await tx.session.deleteMany({ where: { userId: user.id } });
    await tx.verification.deleteMany({ where: { OR: [{ value: user.id }, { identifier: { in: identifiers.map(value => '2fa-attempts-' + value) } }] } });
    await revokeCache(redis, user.id, sessions.map(session => session.token), identifiers);
    if (await tx.session.count({ where: { userId: user.id } }) || await tx.verification.count({ where: { value: user.id } })) throw new Error('Revocation incomplete');
    await tx.auditLog.create({ data: auditData('account.sessions-revoked.offline', user.id) });
   }, { maxWait: 10_000, timeout: 120_000 });
  }
  // Verify again after all commits, including cache-only/orphan sessions. Never
  // claim the cutover is complete merely because each delete returned success.
  if (await db.session.count() || await db.verification.count({ where: { value: { in: users.map(user => user.id) } } })) throw new Error('Revocation incomplete');
  for (const user of users) {
   if (await redis.get('auth:active-sessions-' + user.id) !== null || (await scanOwnedCache(redis, user.id)).size !== 0) throw new Error('Revocation incomplete');
  }
 } catch {
  safe('All-session revocation did not complete verification. Keep all API replicas stopped; correct the database or Redis problem and retry revoke-all-sessions.');
 }
}

/**
 * OFFLINE ONLY: stop and drain ALL API replicas and other authentication writers
 * before calling, keeping MySQL and Redis running. Restart only after success.
 * Online resets are unsupported: a concurrent login could create new credentials
 * or tokens between revocation and verification. This code is not a distributed
 * lock and cannot establish the operational precondition itself.
 *
 * Redis revocation runs inside the DB transaction. If it fails, DB password,
 * audit, session and verification changes roll back, retaining token references
 * for a safe retry. Redis deletions already performed are harmless. Never restart
 * APIs on a failure; repeat the reset while the deployment remains stopped.
 */
export async function resetAccountPassword(db: PrismaClient, redis: AccountRedis, input: { username: string; password: string }): Promise<void> {
 const username = normalizeUsername(input.username); validatePassword(input.password);
 try {
  const password = await hashPassword(input.password);
  await db.$transaction(async tx => {
   const user = await tx.user.findUnique({ where: { username } });
   if (!user) safe('Account not found. Keep all API replicas stopped.');
   const account = await credential(tx, user.id);
   const sessions = await tx.session.findMany({ where: { userId: user.id }, select: { token: true } });
   const verifications = await tx.verification.findMany({ where: { value: user.id }, select: { identifier: true } });
   const identifiers = verifications.map(value => value.identifier);
   await tx.account.update({ where: { id: account.id }, data: { password } });
   await tx.session.deleteMany({ where: { userId: user.id } });
   await tx.verification.deleteMany({ where: { OR: [{ value: user.id }, { identifier: { in: identifiers.map(value => '2fa-attempts-' + value) } }] } });
   await tx.auditLog.create({ data: auditData('account.password-reset.offline', user.id) });
   await revokeCache(redis, user.id, sessions.map(session => session.token), identifiers);
   if (await tx.session.count({ where: { userId: user.id } }) || await tx.verification.count({ where: { value: user.id } })) throw new Error('Revocation incomplete');
  }, { maxWait: 10_000, timeout: 120_000 });
 } catch (error) {
  if (error instanceof AccountMaintenanceError) {
   safe(error.message + (error.message.includes('Keep all API replicas stopped') ? '' : ' Keep all API replicas stopped.'));
  }
  safe('Password reset did not complete verification. Keep all API replicas stopped; correct the database or Redis problem and retry the offline reset.');
 }
}
