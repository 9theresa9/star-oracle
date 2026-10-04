import { Injectable, NotFoundException, ForbiddenException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { decodeContent,decodeFeedback } from './personal.service.js';
import { randomUUID } from 'node:crypto';
import { db,redis,chinaDate,audit,seal } from './infrastructure.js';
import { decodeReading } from './oracle.service.js';
import { config } from './config.js';
@Injectable()
export class AdminService {
 async overview() {
  const [users,readings,daily,ai]=await Promise.all([db.user.count(),db.reading.count(),db.dailyEntry.count(),db.aIUsage.findUnique({where:{date:chinaDate()}})]);
  return {users,readings,dailyEntries:daily,aiRequestsToday:ai?.requests??0,aiDailyLimit:config.AI_DAILY_LIMIT,aiConfigured:!!config.AI_API_KEY,database:'ready',redis:await redis.ping()==='PONG'?'ready':'unavailable'};
 }
 async users({cursor,limit}:{cursor?:string;limit:number}) {
  const rows=await db.user.findMany({take:limit+1,orderBy:[{createdAt:'desc'},{id:'desc'}],...(cursor?{cursor:{id:cursor},skip:1}:{}),select:{id:true,name:true,email:true,role:true,disabled:true,createdAt:true,membership:{select:{tier:true,expiresAt:true,credits:true}}}});
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
  if(cursor&&!await db.reading.findFirst({where:{id:cursor,shared:true},select:{id:true}}))throw new NotFoundException('共享记录不存在');
  const rows=await db.reading.findMany({where:{shared:true},select:{id:true,userId:true,payload:true,question:true,interpretation:true,ai:true,shared:true,createdAt:true},take:limit+1,orderBy:[{createdAt:'desc'},{id:'desc'}],...(cursor?{cursor:{id:cursor},skip:1}:{})});
  await audit(actorId,'admin.read_shared',null,requestId);
  return {items:rows.slice(0,limit).map(row=>decodeReading(row,false)),nextCursor:rows.length>limit?rows[limit-1]!.id:null};
 }
 async logs({cursor,limit}:{cursor?:string;limit:number}) {
  const rows=await db.auditLog.findMany({take:limit+1,orderBy:[{createdAt:'desc'},{id:'desc'}],...(cursor?{cursor:{id:cursor},skip:1}:{}),select:{id:true,actorId:true,action:true,targetId:true,requestId:true,createdAt:true}});
  return {items:rows.slice(0,limit),nextCursor:rows.length>limit?rows[limit-1]!.id:null};
 }
 async statistics(days:30|90){
  const endDate=chinaDate(),to=new Date(endDate+'T00:00:00Z');to.setUTCDate(to.getUTCDate()+1);
  const fromDay=new Date(endDate+'T00:00:00Z');fromDay.setUTCDate(fromDay.getUTCDate()-(days-1));
  const startDate=fromDay.toISOString().slice(0,10),endExclusive=to.toISOString().slice(0,10);
  const from=new Date(startDate+'T00:00:00+08:00'),end=new Date(endExclusive+'T00:00:00+08:00');
  const [users,readingGroups,daily,ai,feedback]=await Promise.all([
   db.$queryRaw<{date:string;count:bigint}[]>(Prisma.sql`SELECT DATE_FORMAT(CONVERT_TZ(createdAt,'+00:00','+08:00'),'%Y-%m-%d') AS date,COUNT(*) AS count FROM user WHERE createdAt >= ${from} AND createdAt < ${end} GROUP BY date`),
   db.$queryRaw<{date:string;kind:string;count:bigint}[]>(Prisma.sql`SELECT DATE_FORMAT(CONVERT_TZ(createdAt,'+00:00','+08:00'),'%Y-%m-%d') AS date,kind,COUNT(*) AS count FROM reading WHERE createdAt >= ${from} AND createdAt < ${end} GROUP BY date,kind`),
   db.dailyEntry.groupBy({by:['date'],where:{date:{gte:startDate,lt:endExclusive}},_count:{_all:true}}),
   db.aIUsage.findMany({where:{date:{gte:startDate,lt:endExclusive}},select:{date:true,requests:true}}),
   db.feedback.groupBy({by:['status'],_count:{_all:true}})
  ]);
  const readingCounts=new Map<string,number>(),kindCounts=new Map<string,number>();
  for(const row of readingGroups){const count=Number(row.count);readingCounts.set(row.date,(readingCounts.get(row.date)??0)+count);kindCounts.set(row.kind,(kindCounts.get(row.kind)??0)+count);}
  const series=Array.from({length:days},(_,index)=>{
   const date=new Date(fromDay);date.setUTCDate(date.getUTCDate()+index);const key=date.toISOString().slice(0,10);
   return {date:key,users:Number(users.find(row=>row.date===key)?.count??0),readings:readingCounts.get(key)??0,dailyEntries:daily.find(row=>row.date===key)?._count._all??0,aiRequests:ai.find(row=>row.date===key)?.requests??0};
  });
  return {days,startDate,endDate,series,readingKinds:[...kindCounts].map(([kind,count])=>({kind,count})),totals:series.reduce((sum,row)=>({users:sum.users+row.users,readings:sum.readings+row.readings,dailyEntries:sum.dailyEntries+row.dailyEntries,aiRequests:sum.aiRequests+row.aiRequests}),{users:0,readings:0,dailyEntries:0,aiRequests:0}),feedback:{open:feedback.find(row=>row.status==='open')?._count._all??0,inProgress:feedback.find(row=>row.status==='in_progress')?._count._all??0,resolved:feedback.find(row=>row.status==='resolved')?._count._all??0}};
 }
 async content(page:{cursor?:string;limit:number;kind?:'announcement'|'guide'}){
  const where=page.kind?{kind:page.kind}:{};
  if(page.cursor&&!await db.siteContent.findFirst({where:{id:page.cursor,...where}}))throw new NotFoundException('内容不存在');
  const rows=await db.siteContent.findMany({where,take:page.limit+1,orderBy:[{createdAt:'desc'},{id:'desc'}],...(page.cursor?{cursor:{id:page.cursor},skip:1}:{})});
  return {items:rows.slice(0,page.limit).map(decodeContent),nextCursor:rows.length>page.limit?rows[page.limit-1]!.id:null};
 }
 async createContent(actorId:string,input:{slug:string;kind:'announcement'|'guide';title:string;body:string;published:boolean},requestId:string){
  try{
   const value=await db.$transaction(async tx=>{
    const row=await tx.siteContent.create({data:{id:randomUUID(),...input}});
    await tx.auditLog.create({data:{id:randomUUID(),actorId,action:'content.create',targetId:row.id,requestId}});return row;
   });return decodeContent(value);
  }catch(error){if(error instanceof Prisma.PrismaClientKnownRequestError&&error.code==='P2002')throw new ConflictException('内容地址已存在');throw error;}
 }
 async updateContent(actorId:string,id:string,input:{slug:string;kind:'announcement'|'guide';title:string;body:string;published:boolean;version:number},requestId:string){
  if(!await db.siteContent.findUnique({where:{id}}))throw new NotFoundException('内容不存在');
  try{
   const value=await db.$transaction(async tx=>{
    const {version,...data}=input;
    const changed=await tx.siteContent.updateMany({where:{id,version},data:{...data,version:{increment:1}}});
    if(changed.count!==1)throw new ConflictException('内容已更新，请刷新后再保存');
    await tx.auditLog.create({data:{id:randomUUID(),actorId,action:'content.update',targetId:id,requestId}});
    return tx.siteContent.findUniqueOrThrow({where:{id}});
   });return decodeContent(value);
  }catch(error){if(error instanceof Prisma.PrismaClientKnownRequestError&&error.code==='P2002')throw new ConflictException('内容地址已存在');throw error;}
 }
 async feedback(actorId:string,requestId:string,page:{cursor?:string;limit:number;status?:'open'|'in_progress'|'resolved'}){
  const where=page.status?{status:page.status}:{};
  if(page.cursor&&!await db.feedback.findFirst({where:{id:page.cursor,...where}}))throw new NotFoundException('反馈不存在');
  const rows=await db.feedback.findMany({where,take:page.limit+1,orderBy:[{createdAt:'desc'},{id:'desc'}],...(page.cursor?{cursor:{id:page.cursor},skip:1}:{})});
  await audit(actorId,'admin.read_feedback',null,requestId);
  return {items:rows.slice(0,page.limit).map(row=>({...decodeFeedback(row),userId:row.userId})),nextCursor:rows.length>page.limit?rows[page.limit-1]!.id:null};
 }
 async replyFeedback(actorId:string,id:string,input:{status:'open'|'in_progress'|'resolved';reply:string;version:number},requestId:string){
  const previous=await db.feedback.findUnique({where:{id}});if(!previous)throw new NotFoundException('反馈不存在');
  const value=await db.$transaction(async tx=>{
   const changed=await tx.feedback.updateMany({where:{id,version:input.version},data:{status:input.status,adminReplyCipher:input.reply.trim()?seal(input.reply.trim(),'feedback-reply:'+previous.userId+':'+id):null,version:{increment:1}}});
   if(changed.count!==1)throw new ConflictException('反馈已更新，请刷新后再保存');
   await tx.auditLog.create({data:{id:randomUUID(),actorId,action:'feedback.reply',targetId:id,requestId}});
   return tx.feedback.findUniqueOrThrow({where:{id}});
  });return {...decodeFeedback(value),userId:value.userId};
 }
}
