import { z } from 'zod';
const raw = z.object({
  NODE_ENV:z.enum(['development','test','production']).default('development'),
  PORT:z.coerce.number().int().min(1).max(65535).default(3001),
  WEB_ORIGIN:z.string().url().default('http://localhost:5173'),
  API_PUBLIC_URL:z.string().url().default('http://localhost:5173'),
  DATABASE_URL:z.string().startsWith('mysql://'),
  REDIS_URL:z.string().startsWith('redis'),
  AUTH_SECRET:z.string().min(32),
  DATA_ENCRYPTION_KEY:z.string().regex(/^[a-f0-9]{64}$/i),
  SMTP_HOST:z.string().optional(),SMTP_PORT:z.coerce.number().default(587),
  SMTP_SECURE:z.enum(['true','false']).default('false'),
  SMTP_USER:z.string().optional(),SMTP_PASSWORD:z.string().optional(),
  SMTP_FROM:z.string().default('照见 <noreply@localhost>'),
  REQUIRE_EMAIL_VERIFICATION:z.enum(['true','false']).default('true'),
  ADMIN_REQUIRE_2FA:z.enum(['true','false']).default('true'),
  AI_API_KEY:z.string().optional(),AI_BASE_URL:z.string().url().default('https://api.deepseek.com/v1'),
  AI_PROVIDER_NAME:z.string().min(1).max(100).default('DeepSeek'),
  AI_MODEL:z.string().max(100).default('deepseek-chat'),
  AI_DAILY_LIMIT:z.coerce.number().int().min(1).max(10000).default(200),
  TRUST_PROXY:z.enum(['false','loopback','linklocal,uniquelocal']).default('false'),
}).parse(process.env);
export const config = {...raw, WEB_ORIGIN:new URL(raw.WEB_ORIGIN).origin};
if (raw.NODE_ENV === 'production') {
  if (!raw.WEB_ORIGIN.startsWith('https://') || !raw.API_PUBLIC_URL.startsWith('https://')) throw new Error('Production requires HTTPS origins');
  if (!raw.SMTP_HOST || raw.REQUIRE_EMAIL_VERIFICATION !== 'true' || raw.ADMIN_REQUIRE_2FA !== 'true') throw new Error('Production requires SMTP, verified email and administrator 2FA');
  if (/example|change|development/i.test(raw.AUTH_SECRET) || /^([a-f0-9])\1{63}$/i.test(raw.DATA_ENCRYPTION_KEY)) throw new Error('Replace example secrets before production');
  if (!new URL(raw.REDIS_URL).password) throw new Error('Production Redis requires a password');
}
if (raw.AI_API_KEY && !raw.AI_BASE_URL.startsWith('https://')) throw new Error('AI provider requires HTTPS');
