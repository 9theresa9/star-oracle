import { z } from 'zod';
const raw = z.object({
  NODE_ENV:z.enum(['development','test','production']).default('development'),
  DEPLOYMENT_MODE:z.enum(['https','ssh-only']).default('https'),
  SSH_ONLY_CONTAINER:z.enum(['true','false']).default('false'),
  PORT:z.coerce.number().int().min(1).max(65535).default(3001),
  WEB_ORIGIN:z.string().url().default('http://localhost:5173'),
  API_PUBLIC_URL:z.string().url().default('http://localhost:5173'),
  DATABASE_URL:z.string().startsWith('mysql://'),
  REDIS_URL:z.string().startsWith('redis'),
  AUTH_SECRET:z.string().min(32),
  DATA_ENCRYPTION_KEY:z.string().regex(/^[a-f0-9]{64}$/i),
  ADMIN_REQUIRE_2FA:z.enum(['true','false']).default('true'),
  AI_API_KEY:z.string().optional(),AI_BASE_URL:z.string().url().default('https://api.deepseek.com/v1'),
  AI_PROVIDER_NAME:z.string().min(1).max(100).default('DeepSeek'),
  AI_MODEL:z.string().max(100).default('deepseek-chat'),
  AI_DAILY_LIMIT:z.coerce.number().int().min(1).max(10000).default(200),
  TRUST_PROXY:z.enum(['false','loopback','linklocal,uniquelocal']).default('false'),
}).parse(process.env);
// A literal comparison is intentional: URL normalization must not admit aliases,
// userinfo, paths, fragments, IPv6 or non-loopback origins into this profile.
const sshOnly=raw.DEPLOYMENT_MODE==='ssh-only';
if(sshOnly){
  if(raw.NODE_ENV!=='production')throw new Error('SSH-only requires production runtime safeguards');
  if(raw.WEB_ORIGIN!=='http://localhost:17777'||raw.API_PUBLIC_URL!=='http://localhost:17777')throw new Error('SSH-only requires the exact localhost origin on port 17777');
  if(raw.TRUST_PROXY!=='false')throw new Error('SSH-only does not trust forwarded headers');
}else if(raw.SSH_ONLY_CONTAINER!=='false')throw new Error('SSH-only container option requires SSH-only mode');
export const config = {...raw, WEB_ORIGIN:new URL(raw.WEB_ORIGIN).origin,
  LISTEN_HOST:sshOnly&&raw.SSH_ONLY_CONTAINER==='false'?'127.0.0.1':'0.0.0.0',
  SECURE_COOKIES:raw.NODE_ENV==='production'&&!sshOnly,
  COOKIE_PREFIX:sshOnly?'star-oracle-ssh':'better-auth',
};
if (raw.NODE_ENV === 'production') {
  if (!sshOnly&&(!raw.WEB_ORIGIN.startsWith('https://') || !raw.API_PUBLIC_URL.startsWith('https://'))) throw new Error('Production requires HTTPS origins');
  if (raw.ADMIN_REQUIRE_2FA !== 'true') throw new Error('Production requires administrator 2FA');
  if (/example|change|development/i.test(raw.AUTH_SECRET) || /^([a-f0-9])\1{63}$/i.test(raw.DATA_ENCRYPTION_KEY)) throw new Error('Replace example secrets before production');
  if (!new URL(raw.REDIS_URL).password) throw new Error('Production Redis requires a password');
}
if (raw.AI_API_KEY && !raw.AI_BASE_URL.startsWith('https://')) throw new Error('AI provider requires HTTPS');
