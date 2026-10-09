/** Opt-in only. The normal HTTPS and standalone image CMD are unchanged. */
import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import type { PrismaClient } from '@prisma/client';
import { databasePolicy, identityQuery, roleIdentity, validateDatabaseIdentity, type SharedRole, type DatabaseIdentity } from './shared-db-policy.js';

type QueryDatabase = {$connect(): Promise<void>; $disconnect(): Promise<void>; $queryRawUnsafe(sql: string): Promise<unknown>};
type Interfaces = Record<string, Array<Pick<NetworkInterfaceInfo, 'family'|'address'|'internal'>> | undefined>;
type Environment = Record<string, string | undefined>;
export async function checkSharedDatabase({role, env = process.env, interfaces = networkInterfaces(), db}: {role: SharedRole; env?: Environment; interfaces?: Interfaces; db: QueryDatabase}): Promise<void> {
 const database = role.startsWith('candidate') ? env.SHARED_CANDIDATE_DATABASE ?? '' : 'staroracle';
 const expected = roleIdentity(role, database);
 const url = new RegExp('^mysql://' + expected.user + ':[a-fA-F0-9]{64}@oracle-mysql:3306/' + database + '\\?connection_limit=5$');
 databasePolicy(url.test(env.DATABASE_URL ?? ''), 'SHARED_DB_URL');
 databasePolicy(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(env.SHARED_MYSQL_UUID ?? '') && /^8\.4\.\d+$/.test(env.SHARED_MYSQL_VERSION ?? ''), 'SHARED_DB_IDENTITY');
 const source = Object.values(interfaces).flatMap(addresses => addresses ?? []).filter(address => address.family === 'IPv4' && !address.internal && address.address.startsWith('172.30.78.'));
 databasePolicy(source.length === 1 && source[0]!.address === expected.sourceIp, 'SHARED_DB_SOURCE');
 try {
  await db.$connect();
  const identities = await db.$queryRawUnsafe(identityQuery) as DatabaseIdentity[];
  const rows = await db.$queryRawUnsafe('SHOW GRANTS') as Array<Record<string, unknown>>;
  databasePolicy(Array.isArray(identities) && identities.length === 1 && Array.isArray(rows) && rows.every(row => Object.keys(row).length === 1 && typeof Object.values(row)[0] === 'string'), 'SHARED_DB_IDENTITY');
  validateDatabaseIdentity({role, identity: identities[0]!, grants: rows.map(row => Object.values(row)[0] as string), expectedUuid: env.SHARED_MYSQL_UUID!, expectedVersion: env.SHARED_MYSQL_VERSION!, database, sourceIp: source[0]!.address});
 } catch (error) {
  if (error instanceof Error && /^SHARED_DB_[A-Z_]+$/.test(error.message)) throw error;
  throw new Error('SHARED_DB_CONNECTION');
 }
}
async function executePrisma(action: string, env: Environment): Promise<void> {
 const subcommand = action === 'migrate' ? ['deploy'] : action === 'status' ? ['status'] : ['diff','--from-schema-datasource','apps/api/prisma/schema.prisma','--to-schema-datamodel','apps/api/prisma/schema.prisma','--exit-code'];
 const args = ['node_modules/prisma/build/index.js','migrate',...subcommand];
 if (action !== 'diff') args.push('--schema','apps/api/prisma/schema.prisma');
 await new Promise<void>((resolve, reject) => {
  const child = spawn(process.execPath, args, {env, stdio:'ignore'});
  const interrupt = () => child.kill('SIGTERM');
  process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
  const cleanup = () => {process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt);};
  child.once('error', () => {cleanup(); reject(new Error('SHARED_DB_MIGRATION'));});
  child.once('exit', code => {cleanup(); code === 0 ? resolve() : reject(new Error('SHARED_DB_MIGRATION'));});
 });
}
type EntrypointOptions = {env?: Environment; interfaces?: Interfaces; createDatabase?: () => QueryDatabase | Promise<QueryDatabase>; serve?: () => Promise<void>; migrate?: (action: string, env: Environment) => Promise<void>};
export async function runSharedEntrypoint(args: string[], options: EntrypointOptions = {}): Promise<void> {
 const [rawRole, action, ...extra] = args;
 const allowed: Record<string, string[]> = {app:['check','serve'],migrator:['check','migrate'],maintenance:['check','account'],candidateMigrator:['check','migrate','status','diff'],candidateApp:['check','verify']};
 databasePolicy(rawRole && action && allowed[rawRole]?.includes(action) && (action === 'account' ? extra.length === 1 && ['create','assign-username','reset-password','revoke-all-sessions'].includes(extra[0]!) : extra.length === 0), 'SHARED_DB_ENTRYPOINT');
 const role = rawRole as SharedRole, env = options.env ?? process.env;
 const createDatabase = options.createDatabase ?? (async () => {const {PrismaClient} = await import('@prisma/client'); return new PrismaClient({log:[],datasourceUrl:env.DATABASE_URL});});
 // The existing account CLI performs hidden prompts and confirmations before
 // invoking this connector, preserving its zero-connection cancellation path.
 if (action === 'account') {
  const {runAccountCli} = await import('./account-cli.js');
  const result = await runAccountCli(extra, {input:process.stdin,output:process.stderr,connect:async command => {
   const db = await createDatabase(); let redis: import('ioredis').Redis | undefined;
   try {
    await checkSharedDatabase({role,env,interfaces:options.interfaces,db});
    if (command === 'reset-password' || command === 'revoke-all-sessions') {
     databasePolicy(/^redis:\/\/:[a-fA-F0-9]{64}@redis:6379$/.test(env.REDIS_URL ?? ''), 'SHARED_DB_REDIS');
     const {Redis} = await import('ioredis'); redis = new Redis(env.REDIS_URL!, {lazyConnect:true,enableOfflineQueue:false,maxRetriesPerRequest:1,connectTimeout:5000,retryStrategy:()=>null});
     redis.on('error', () => {}); await redis.connect();
    }
    return {db:db as PrismaClient,redis,close:async()=>{redis?.disconnect();await db.$disconnect();}};
   } catch {redis?.disconnect();await db.$disconnect().catch(()=>{});throw new Error('SHARED_DB_ACCOUNT');}
  }});
  databasePolicy(result === 0, 'SHARED_DB_ACCOUNT'); return;
 }
 const db = await createDatabase();
 try {
  await checkSharedDatabase({role,env,interfaces:options.interfaces,db});
  if (action === 'verify') {
   const {verifyCandidateRecovery} = await import('./shared-recovery.js');
   const result = await verifyCandidateRecovery(db as PrismaClient, env);
   console.log(JSON.stringify(result));
  }
 } finally {await db.$disconnect().catch(() => {});}
 if (action === 'serve') {
  if (options.serve) await options.serve();
  else {const url = new URL('../main.js',import.meta.url); process.argv[1] = fileURLToPath(url); await import(url.href);}
 }
 if (['migrate','status','diff'].includes(action)) await (options.migrate ?? executePrisma)(action,env);
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) runSharedEntrypoint(process.argv.slice(2)).catch(() => {console.error('Shared database operation failed; raw diagnostics withheld. Keep API/Web stopped.');process.exitCode=1;});
