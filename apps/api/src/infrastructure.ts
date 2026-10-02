import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';
import { randomUUID, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { config } from './config.js';
export const db = new PrismaClient({log:[]});
export const redis = new Redis(config.REDIS_URL,{enableOfflineQueue:false,maxRetriesPerRequest:1,connectTimeout:3000});
redis.on('error',()=>{/* Error details may contain credentials; never log them. */});
const key = Buffer.from(config.DATA_ENCRYPTION_KEY,'hex');
export function seal(text:string,context=''):string {
  const iv=randomBytes(12), cipher=createCipheriv('aes-256-gcm',key,iv);
  cipher.setAAD(Buffer.from(context));
  const body=Buffer.concat([cipher.update(text,'utf8'),cipher.final()]);
  return ['v1',iv.toString('base64'),cipher.getAuthTag().toString('base64'),body.toString('base64')].join('.');
}
export function open(value:string,context=''):string {
  const [version,iv,tag,body]=value.split('.');
  if(version!=='v1'||!iv||!tag||body===undefined) throw new Error('Invalid encrypted record');
  const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(iv,'base64'));
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(Buffer.from(tag,'base64'));
  return Buffer.concat([decipher.update(Buffer.from(body,'base64')),decipher.final()]).toString('utf8');
}
export async function audit(actorId:string|null,action:string,targetId:string|null,requestId:string) {
  await db.auditLog.create({data:{id:randomUUID(),actorId,action,targetId,requestId}});
}
export async function consumeLimit(key:string,limit:number,seconds:number):Promise<boolean> {
  const count=await redis.eval("local n=redis.call('INCR',KEYS[1]);if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end;return n",1,'limit:'+key,seconds);
  return Number(count)<=limit;
}
export async function acquireAILease():Promise<string|null> {
  const id=randomUUID(), now=Date.now();
  const ok=await redis.eval("redis.call('ZREMRANGEBYSCORE',KEYS[1],'-inf',ARGV[1]);if redis.call('ZCARD',KEYS[1])>=4 then return 0 end;redis.call('ZADD',KEYS[1],ARGV[2],ARGV[3]);redis.call('EXPIRE',KEYS[1],120);return 1",1,'ai:leases',now,now+60000,id);
  return Number(ok)===1?id:null;
}
export function chinaDate(now=new Date()):string {
  return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
}
