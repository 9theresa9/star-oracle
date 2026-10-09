import {PrismaClient} from '@prisma/client';

/** Offline fixtures may only write synthetic identities into the isolated test database. */
export async function provisionBrowserAccount(username:string,name:string,password:string){
 const url=new URL(process.env.DATABASE_URL??'mysql://invalid');
 if(process.env.NODE_ENV!=='test'||url.protocol!=='mysql:'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.pathname!=='/star_oracle')throw new Error('Account fixtures require NODE_ENV=test and the isolated loopback test database.');
 if(!/^synthetic-[a-z0-9._-]{1,22}$/.test(username))throw new Error('Browser accounts must use a unique normalized synthetic username of at most 32 characters.');
 const {provisionAccount}=await import('../../../apps/api/src/maintenance/account-service.ts');
 const db=new PrismaClient();
 try{return await provisionAccount(db,{username,name,password});}finally{await db.$disconnect();}
}
