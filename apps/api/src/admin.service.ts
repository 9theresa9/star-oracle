import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { db,redis,chinaDate,audit } from './infrastructure.js';
import { decodeReading } from './oracle.service.js';
import { config } from './config.js';
@Injectable()
export class AdminService {
 async overview() {
  const [users,readings,daily,ai]=await Promise.all([db.user.count(),db.reading.count(),db.dailyEntry.count(),db.aIUsage.findUnique({where:{date:chinaDate()}})]);
  return {users,readings,dailyEntries:daily,aiRequestsToday:ai?.requests??0,aiDailyLimit:config.AI_DAILY_LIMIT,aiConfigured:!!config.AI_API_KEY,database:'ready',redis:await redis.ping()==='PONG'?'ready':'unavailable'};
 }
 async users({cursor,limit}:{cursor?:string;limit:number}) {
  const rows=await db.user.findMany({take:limit+1,orderBy:[{createdAt:'desc'},{id:'desc'}],...(cursor?{cursor:{id:cursor},skip:1}:{}),select:{id:true,name:true,email:true,role:true,disabled:true,createdAt:true}});
  return {items:rows.slice(0,limit),nextCursor:rows.length>limit?rows[limit-1]!.id:null};
 }
 async status(actorId:string,id:string,disabled:boolean,requestId:string) {
  const user=await db.user.findUnique({where:{id}});
  if(!user) throw new NotFoundException('用户不存在');
  if(user.role==='admin'||id===actorId) throw new ForbiddenException('管理员账户只能通过服务器维护命令修改');
  await db.$transaction(async tx=>{
   await tx.user.update({where:{id},data:{disabled}});
   if(disabled) await tx.session.deleteMany({where:{userId:id}});
   await tx.auditLog.create({data:{id:randomUUID(),actorId,action:disabled?'user.disable':'user.enable',targetId:id,requestId}});
  });return {ok:true};
 }
 async shared(actorId:string,requestId:string,{cursor,limit}:{cursor?:string;limit:number}) {
  if(cursor&&!await db.reading.findFirst({where:{id:cursor,shared:true}}))throw new NotFoundException('共享记录不存在');
  const rows=await db.reading.findMany({where:{shared:true},take:limit+1,orderBy:[{createdAt:'desc'},{id:'desc'}],...(cursor?{cursor:{id:cursor},skip:1}:{})});
  await audit(actorId,'admin.read_shared',null,requestId);
  return {items:rows.slice(0,limit).map(decodeReading),nextCursor:rows.length>limit?rows[limit-1]!.id:null};
 }
 async logs({cursor,limit}:{cursor?:string;limit:number}) {
  const rows=await db.auditLog.findMany({take:limit+1,orderBy:[{createdAt:'desc'},{id:'desc'}],...(cursor?{cursor:{id:cursor},skip:1}:{}),select:{id:true,actorId:true,action:true,targetId:true,requestId:true,createdAt:true}});
  return {items:rows.slice(0,limit),nextCursor:rows.length>limit?rows[limit-1]!.id:null};
 }
}
