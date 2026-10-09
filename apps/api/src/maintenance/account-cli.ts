import { emitKeypressEvents, type Key } from 'node:readline';
import { pathToFileURL } from 'node:url';
import type { ReadStream, WriteStream } from 'node:tty';
import type { PrismaClient } from '@prisma/client';
import {
 AccountMaintenanceError, provisionAccount, assignAccountUsername, resetAccountPassword, revokeAllAccountSessions,
 normalizeUsername, validatePassword, validateAccountName, validateUserId, type AccountRedis,
} from './account-service.js';

type Terminal = { input: ReadStream; output: WriteStream };
type Command = 'create' | 'assign-username' | 'reset-password' | 'revoke-all-sessions';
type Resources = { db: PrismaClient; redis?: AccountRedis; close(): Promise<void> };
type CliOptions = Terminal & { connect?: (command: Command) => Promise<Resources> };
function fail(message: string): never { throw new AccountMaintenanceError(message); }

/** Raw terminal entry prevents kernel echo, including pasted passwords. */
export function promptLine({ input, output }: Terminal, label: string, hidden = false): Promise<string> {
 if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== 'function') return Promise.reject(new AccountMaintenanceError('An interactive terminal is required.'));
 return new Promise((resolve, reject) => {
  const wasRaw = input.isRaw, wasPaused = input.isPaused(); let value = '', finished = false;
  const finish = (cancelled: boolean) => {
   if (finished) return; finished = true;
   input.off('keypress', keypress); input.off('end', cancel); input.off('close', cancel); input.off('error', cancel);
   process.off('SIGTERM', cancel); process.off('SIGINT', cancel);
   // A terminal can disappear during close/error/signal handling. Cleanup is
   // best effort, but the promise must always settle once with a safe message.
   try { input.setRawMode(wasRaw); } catch { cancelled = true; }
   try { if (wasPaused) input.pause(); } catch { cancelled = true; }
   try { if (!output.destroyed) output.write('\n'); } catch { cancelled = true; }
   // Keep a listener through pending stream error events from the final write.
   setImmediate(() => { output.off('error', cancel); output.off('close', cancel); });
   if (cancelled) { value = ''; reject(new AccountMaintenanceError('Operation cancelled.')); } else resolve(value);
  };
  const cancel = () => finish(true);
  const keypress = (text: string | undefined, key: Key = {}) => {
   if (key.ctrl && (key.name === 'c' || key.name === 'd')) return cancel();
   if (key.name === 'return' || key.name === 'enter') return finish(false);
   if (key.name === 'backspace') {
    if (value) { value = Array.from(value).slice(0, -1).join(''); if (!hidden) { try { output.write('\b \b'); } catch { cancel(); } } }
    return;
   }
   if (key.ctrl || key.meta || !text || /[\u0000-\u001f\u007f]/.test(text)) return;
   // Bound terminal input without ever printing discarded password material.
   if (value.length + text.length > 4096) return;
   value += text; if (!hidden) { try { output.write(text); } catch { cancel(); } }
  };
  try {
   output.once('error', cancel); output.once('close', cancel);
   emitKeypressEvents(input); input.setRawMode(true); input.on('keypress', keypress);
   input.once('end', cancel); input.once('close', cancel); input.once('error', cancel);
   process.once('SIGTERM', cancel); process.once('SIGINT', cancel);
   output.write(label); input.resume();
  } catch { finish(true); }
 });
}

/** Load only after prompts, validation and explicit offline/target confirmation. */
async function connectResources(command: Command): Promise<Resources> {
 let db: PrismaClient | undefined;
 let redis: (AccountRedis & { connect(): Promise<void>; disconnect(): void; on(event: string, listener: () => void): unknown }) | undefined;
 try {
  const database = new URL(process.env.DATABASE_URL ?? '');
  if (database.protocol !== 'mysql:') fail('Maintenance requires DATABASE_URL for MySQL.');
  if (command === 'reset-password' || command === 'revoke-all-sessions') {
   const cache = new URL(process.env.REDIS_URL ?? '');
   if (!['redis:', 'rediss:'].includes(cache.protocol)) fail('Session revocation requires REDIS_URL. Keep all API replicas stopped.');
  }
  const { PrismaClient } = await import('@prisma/client');
  db = new PrismaClient({ log: [] }); await db.$connect();
  if (command === 'reset-password' || command === 'revoke-all-sessions') {
   const { Redis } = await import('ioredis');
   redis = new Redis(process.env.REDIS_URL!, { lazyConnect: true, enableOfflineQueue: false, maxRetriesPerRequest: 1, connectTimeout: 5000, retryStrategy: () => null });
   redis.on('error', () => { /* Provider errors can contain credentials. */ }); await redis.connect();
  }
  return { db, redis, close: async () => { redis?.disconnect(); await db?.$disconnect(); } };
 } catch (error) {
  redis?.disconnect(); await db?.$disconnect().catch(() => {});
  if (error instanceof AccountMaintenanceError) throw error;
  fail('Unable to connect to maintenance services. Keep all API replicas stopped and check database and Redis availability.');
 }
}

export async function runAccountCli(args: string[], options: CliOptions = { input: process.stdin, output: process.stderr }): Promise<number> {
 const { input, output } = options; let resources: Resources | undefined;
 const ignoreOutputError = () => {}; output.on('error', ignoreOutputError);
 try {
  if (args.length !== 1 || !['create', 'assign-username', 'reset-password', 'revoke-all-sessions'].includes(args[0]!)) fail('Usage: account-cli create|assign-username|reset-password|revoke-all-sessions. Enter all account details interactively; arguments, environment variables, files and pipes are not accepted for credentials.');
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== 'function') fail('An interactive terminal is required; redirected or piped account details are not accepted.');
  const command = args[0] as Command, io = { input, output };
  const userId = command === 'assign-username' ? validateUserId((await promptLine(io, 'Existing user ID: ')).trim()) : undefined;
  const username = command !== 'revoke-all-sessions' ? normalizeUsername(await promptLine(io, 'Username: ')) : undefined;
  const name = command === 'create' ? validateAccountName(await promptLine(io, 'Display name: ')) : undefined;
  let password: string | undefined;
  if (command === 'create' || command === 'reset-password') {
   password = await promptLine(io, 'Password (hidden): ', true); validatePassword(password);
   if (password !== await promptLine(io, 'Confirm password (hidden): ', true)) fail('Passwords do not match.');
  }
  output.write('Stop and drain ALL API replicas and authentication writers. Keep MySQL and Redis running. Online maintenance is unsupported.\n');
  output.write('Operation: ' + command + (command === 'revoke-all-sessions' ? '; ALL accounts, including disabled and legacy accounts' : '; username: ' + username + (userId ? '; user ID: ' + userId : '')) + '.\n');
  if (await promptLine(io, 'Type STOPPED to confirm all API replicas are stopped: ') !== 'STOPPED') fail('Operation cancelled; offline acknowledgement was not given.');
  const target = command === 'revoke-all-sessions' ? 'ALL' : userId ?? username;
  if (await promptLine(io, 'Type ' + target + ' to confirm this operation target: ') !== target) fail('Operation cancelled; target confirmation did not match.');
  resources = await (options.connect ?? connectResources)(command);
  if (command === 'create') await provisionAccount(resources.db, { username: username!, name: name!, password: password! });
  else if (command === 'assign-username') await assignAccountUsername(resources.db, { userId: userId!, username: username! });
  else {
   if (!resources.redis) fail('Redis is required. Keep all API replicas stopped.');
   if (command === 'revoke-all-sessions') await revokeAllAccountSessions(resources.db, resources.redis);
   else await resetAccountPassword(resources.db, resources.redis, { username: username!, password: password! });
  }
  password = undefined;
  output.write(command === 'revoke-all-sessions' ? 'All account sessions, pending challenges and trusted devices revoked and verified. API replicas may now restart.\n' : command === 'reset-password' ? 'Password reset and targeted session revocation verified. API replicas may now restart.\n' : 'Account maintenance completed. API replicas may now restart.\n');
  return 0;
 } catch (error) {
  // Do not print arbitrary exception text/stack, submitted values, URLs or hashes.
  try { output.write((error instanceof AccountMaintenanceError ? error.message : 'Account maintenance failed. Keep all API replicas stopped and check the services before retrying.') + '\n'); } catch { /* A disconnected terminal cannot receive a message. */ }
  return 1;
 } finally {
  try { input.pause(); } catch { /* The terminal may already be closed. */ }
  await resources?.close().catch(() => {}); setImmediate(() => output.off('error', ignoreOutputError));
 }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await runAccountCli(process.argv.slice(2));
