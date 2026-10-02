import { PrismaClient } from '@prisma/client';
const email=process.argv[2];
if(!email||!email.includes('@')) throw new Error('Usage: npm run admin:promote -- verified-email@example.com');
const db=new PrismaClient();
try {
 const user=await db.user.findUnique({where:{email}});
 if(!user||!user.emailVerified) throw new Error('Create and verify this account in the application first');
 if(!user.twoFactorEnabled) throw new Error('Enable and confirm TOTP in account settings first');
 await db.$transaction(async tx=>{
  await tx.user.update({where:{id:user.id},data:{role:'admin',disabled:false}});
  await tx.session.deleteMany({where:{userId:user.id}});
  await tx.auditLog.create({data:{id:crypto.randomUUID(),actorId:null,action:'admin.promote.offline',targetId:user.id,requestId:crypto.randomUUID()}});
 });
 console.log('Administrator assigned; sign in again with password and TOTP.');
}finally{await db.$disconnect();}
