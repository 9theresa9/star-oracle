import { test as base,expect } from '@playwright/test';
import { Redis } from 'ioredis';
export const test=base.extend<{rateIsolation:void}>({
 rateIsolation:[async({},use)=>{
  if(process.env.CI==='true'){
   const dbURL=new URL(process.env.DATABASE_URL??''),redisURL=new URL(process.env.REDIS_URL??'');
   const local=(host:string)=>['127.0.0.1','localhost','[::1]'].includes(host);
   if(process.env.NODE_ENV!=='test'||!local(dbURL.hostname)||!local(redisURL.hostname)||dbURL.pathname!=='/star_oracle')throw new Error('Browser isolation requires ephemeral loopback test services');
   // This dedicated ephemeral CI Redis is not a shared production instance.
   // Keep production rate limits intact; each independent browser fixture starts fresh.
   const client=new Redis(process.env.REDIS_URL!);try{await client.flushdb();}finally{client.disconnect();}
  }
  await use();
 },{auto:true}]
});
export {expect};

export type { Page, Response, TestInfo } from '@playwright/test';
