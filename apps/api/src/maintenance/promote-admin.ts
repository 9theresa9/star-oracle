import { PrismaClient } from '@prisma/client';
const username=process.argv[2];
if(!username||! /^[a-z0-9][a-z0-9._-]{2,31}$/.test(username)) throw new Error('Usage: npm run admin:promote -- provisioned-username');
const db=new PrismaClient();
try {
 const user=await db.user.findUnique({where:{username}});
 if(!user||user.disabled) throw new Error('Provision an enabled username account first');
 if(!user.twoFactorEnabled) throw new Error('Enable and confirm TOTP in account settings first');
 await db.$transaction(async tx=>{
  await tx.user.update({where:{id:user.id},data:{role:'admin'}});
  await tx.session.deleteMany({where:{userId:user.id}});
  await tx.auditLog.create({data:{id:crypto.randomUUID(),actorId:null,action:'admin.promote.offline',targetId:user.id,requestId:crypto.randomUUID()}});
 });
 console.log('Administrator assigned; sign in again with password and TOTP.');
}finally{await db.$disconnect();}
