import { Injectable, NotFoundException, ConflictException, BadRequestException, PayloadTooLargeException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { evidenceFor,DAILY_MOODS,type Interpretation,type Evidence } from '@star-oracle/domain';
import { db,seal,open,chinaDate,consumeLimit } from './infrastructure.js';
import { OracleService,decodeReading } from './oracle.service.js';
import { requestModel } from './model.service.js';
import { MembershipService } from './membership.service.js';
import { RateLimitException } from './exceptions.js';
export type Period='week'|'month';
export type ActionInput={title:string;detail?:string;readingId?:string;dueDate?:string|null};
export type ActionUpdate={title:string;detail:string;dueDate:string|null;completed:boolean;version:number};
export type FeedbackInput={category:'bug'|'idea'|'account'|'other';body:string};
export type ReportInput={period:Period;date:string;includeJournal:boolean;consent:true;requestId:string};
export function validDate(value:string):boolean {
 if(!/^20\d\d-\d{2}-\d{2}$/.test(value))return false;
 const date=new Date(value+'T00:00:00Z');return !Number.isNaN(date.getTime())&&date.toISOString().slice(0,10)===value;
}
export function periodRange(period:Period,date:string){
 if(!validDate(date))throw new BadRequestException('日期无效');
 const anchor=new Date(date+'T00:00:00Z'),start=new Date(anchor);
 if(period==='month')start.setUTCDate(1);else start.setUTCDate(start.getUTCDate()-((start.getUTCDay()+6)%7));
 const end=new Date(start);if(period==='month')end.setUTCMonth(end.getUTCMonth()+1);else end.setUTCDate(end.getUTCDate()+7);
 const startDate=start.toISOString().slice(0,10),endExclusive=end.toISOString().slice(0,10);
 end.setUTCDate(end.getUTCDate()-1);const endDate=end.toISOString().slice(0,10);
 return {period,startDate,endDate,endExclusive,from:new Date(startDate+'T00:00:00+08:00'),to:new Date(endExclusive+'T00:00:00+08:00')};
}
function decodeAction(row:Prisma.ActionPlanGetPayload<Record<string,never>>){
 return {id:row.id,title:open(row.titleCipher,'action-title:'+row.userId+':'+row.id),detail:row.detailCipher?open(row.detailCipher,'action-detail:'+row.userId+':'+row.id):'',readingId:row.readingId,dueDate:row.dueDate,completedAt:row.completedAt?.toISOString()??null,version:row.version,createdAt:row.createdAt.toISOString(),updatedAt:row.updatedAt.toISOString()};
}
export function decodeFeedback(row:Prisma.FeedbackGetPayload<Record<string,never>>){
 return {id:row.id,category:row.category,body:open(row.bodyCipher,'feedback:'+row.userId+':'+row.id),status:row.status,adminReply:row.adminReplyCipher?open(row.adminReplyCipher,'feedback-reply:'+row.userId+':'+row.id):null,version:row.version,createdAt:row.createdAt.toISOString(),updatedAt:row.updatedAt.toISOString()};
}
function decodeReport(row:Prisma.ReviewReportGetPayload<Record<string,never>>){
 return {id:row.id,period:row.period,startDate:row.startDate,endDate:row.endDate,includeJournal:row.includeJournal,status:row.status,result:row.resultCipher?JSON.parse(open(row.resultCipher,'review:'+row.userId+':'+row.id)) as Interpretation:null,createdAt:row.createdAt.toISOString()};
}
export function decodeContent(row:Prisma.SiteContentGetPayload<Record<string,never>>){
 return {id:row.id,slug:row.slug,kind:row.kind,title:row.title,body:row.body,published:row.published,version:row.version,createdAt:row.createdAt.toISOString(),updatedAt:row.updatedAt.toISOString()};
}
@Injectable()
export class PersonalService {
 async calendar(userId:string,month:string){
  const range=periodRange('month',month+'-01');
  const rows=await db.dailyEntry.findMany({where:{userId,date:{gte:range.startDate,lt:range.endExclusive}},orderBy:{date:'asc'}});
  return {month,days:rows.map(row=>({id:row.id,date:row.date,mood:row.mood,notePresent:!!open(row.note,'journal:'+userId+':'+row.id).trim()})),summary:{entries:rows.length,moods:DAILY_MOODS.map(m=>({mood:m.id,count:rows.filter(row=>row.mood===m.id).length}))}};
 }
 async insights(userId:string,period:Period,date:string){
  const range=periodRange(period,date),where={userId,createdAt:{gte:range.from,lt:range.to}};
  const [readings,dailyEntries,completedActions,kinds,moods]=await Promise.all([
   db.reading.count({where}),db.dailyEntry.count({where:{userId,date:{gte:range.startDate,lt:range.endExclusive}}}),
   db.actionPlan.count({where:{userId,completedAt:{gte:range.from,lt:range.to}}}),
   db.reading.groupBy({by:['kind'],where,_count:{_all:true}}),
   db.dailyEntry.groupBy({by:['mood'],where:{userId,date:{gte:range.startDate,lt:range.endExclusive}},_count:{_all:true}})
  ]);
  return {period,startDate:range.startDate,endDate:range.endDate,summary:{readings,dailyEntries,completedActions,moods:DAILY_MOODS.map(m=>({mood:m.id,count:moods.find(row=>row.mood===m.id)?._count._all??0}))},readingKinds:kinds.map(row=>({kind:row.kind,count:row._count._all})),journalIncluded:false,
   reflection:{summary:'这段时间，你保存了 '+readings+' 次探索、'+dailyEntries+' 天星笺，完成了 '+completedActions+' 个行动。',actions:['选择一条仍然有帮助的建议，写成下一步小行动。','回看事实与感受有哪些变化，允许自己调整原来的计划。'],reflection:'这段时间，什么最值得保留，什么可以放下？'}};
 }
 async actions(userId:string,page:{cursor?:string;limit:number;status:'all'|'open'|'done'}){
  const where={userId,...(page.status==='open'?{completedAt:null}:page.status==='done'?{completedAt:{not:null}}:{})};
  if(page.cursor&&!await db.actionPlan.findFirst({where:{id:page.cursor,...where}}))throw new NotFoundException('行动不存在');
  const rows=await db.actionPlan.findMany({where,take:page.limit+1,orderBy:[{createdAt:'desc'},{id:'desc'}],...(page.cursor?{cursor:{id:page.cursor},skip:1}:{})});
  return {items:rows.slice(0,page.limit).map(decodeAction),nextCursor:rows.length>page.limit?rows[page.limit-1]!.id:null};
 }
 async action(userId:string,id:string){const row=await db.actionPlan.findFirst({where:{id,userId}});if(!row)throw new NotFoundException('行动不存在');return decodeAction(row);}
 async createAction(userId:string,input:ActionInput,requestId:string){
  if(!await consumeLimit('action:'+userId,30,60))throw new RateLimitException('操作较多，请稍后再试');
  if(input.readingId&&!await db.reading.findFirst({where:{id:input.readingId,userId}}))throw new NotFoundException('关联记录不存在');
  const id=randomUUID();
  const row=await db.$transaction(async tx=>{
   const value=await tx.actionPlan.create({data:{id,userId,readingId:input.readingId??null,titleCipher:seal(input.title.trim(),'action-title:'+userId+':'+id),detailCipher:seal(input.detail?.trim()??'','action-detail:'+userId+':'+id),dueDate:input.dueDate??null}});
   await tx.auditLog.create({data:{id:randomUUID(),actorId:userId,action:'action.create',targetId:id,requestId}});return value;
  });return decodeAction(row);
 }
 async updateAction(userId:string,id:string,input:ActionUpdate,requestId:string){
  const previous=await db.actionPlan.findFirst({where:{id,userId}});if(!previous)throw new NotFoundException('行动不存在');
  const row=await db.$transaction(async tx=>{
   const changed=await tx.actionPlan.updateMany({where:{id,userId,version:input.version},data:{titleCipher:seal(input.title.trim(),'action-title:'+userId+':'+id),detailCipher:seal(input.detail.trim(),'action-detail:'+userId+':'+id),dueDate:input.dueDate,completedAt:input.completed?previous.completedAt??new Date():null,version:{increment:1}}});
   if(changed.count!==1)throw new ConflictException('行动已更新，请刷新后再保存');
   await tx.auditLog.create({data:{id:randomUUID(),actorId:userId,action:'action.update',targetId:id,requestId}});
   return tx.actionPlan.findUniqueOrThrow({where:{id}});
  });return decodeAction(row);
 }
 async removeAction(userId:string,id:string,requestId:string){
  if(!await db.actionPlan.findFirst({where:{id,userId}}))throw new NotFoundException('行动不存在');
  await db.$transaction(async tx=>{
   await tx.actionPlan.deleteMany({where:{id,userId}});
   await tx.auditLog.create({data:{id:randomUUID(),actorId:userId,action:'action.delete',targetId:id,requestId}});
  });return {ok:true};
 }
 async feedback(userId:string,page:{cursor?:string;limit:number}){
  if(page.cursor&&!await db.feedback.findFirst({where:{id:page.cursor,userId}}))throw new NotFoundException('反馈不存在');
  const rows=await db.feedback.findMany({where:{userId},take:page.limit+1,orderBy:[{createdAt:'desc'},{id:'desc'}],...(page.cursor?{cursor:{id:page.cursor},skip:1}:{})});
  return {items:rows.slice(0,page.limit).map(decodeFeedback),nextCursor:rows.length>page.limit?rows[page.limit-1]!.id:null};
 }
 async createFeedback(userId:string,input:FeedbackInput,requestId:string){
  if(!await consumeLimit('feedback:'+userId,3,3600))throw new RateLimitException('反馈已收到，请稍后再提交');
  const id=randomUUID();
  const row=await db.$transaction(async tx=>{
   const value=await tx.feedback.create({data:{id,userId,category:input.category,bodyCipher:seal(input.body.trim(),'feedback:'+userId+':'+id)}});
   await tx.auditLog.create({data:{id:randomUUID(),actorId:userId,action:'feedback.create',targetId:id,requestId}});return value;
  });return decodeFeedback(row);
 }
 async reports(userId:string,page:{cursor?:string;limit:number}){
  if(page.cursor&&!await db.reviewReport.findFirst({where:{id:page.cursor,userId}}))throw new NotFoundException('回顾不存在');
  const rows=await db.reviewReport.findMany({where:{userId},take:page.limit+1,orderBy:[{createdAt:'desc'},{id:'desc'}],...(page.cursor?{cursor:{id:page.cursor},skip:1}:{})});
  return {items:rows.slice(0,page.limit).map(decodeReport),nextCursor:rows.length>page.limit?rows[page.limit-1]!.id:null};
 }
 async removeReport(userId:string,id:string,requestId:string){
  if(!await db.reviewReport.findFirst({where:{id,userId}}))throw new NotFoundException('回顾不存在');
  await db.$transaction(async tx=>{
   await tx.reviewReport.deleteMany({where:{id,userId}});
   await tx.auditLog.create({data:{id:randomUUID(),actorId:userId,action:'review.delete',targetId:id,requestId}});
  });return {ok:true};
 }
 async report(userId:string,input:ReportInput,requestId:string){
  const range=periodRange(input.period,input.date);
  let existing=await db.reviewReport.findUnique({where:{userId_requestId:{userId,requestId:input.requestId}}});
  if(existing&&(existing.period!==input.period||existing.startDate!==range.startDate||existing.includeJournal!==input.includeJournal))throw new ConflictException('请求标识已用于其他回顾');
  if(existing?.status==='done')return decodeReport(existing);
  const completed=existing?await db.aIRequest.findUnique({where:{userId_requestId:{userId,requestId:existing.requestId}}}):null;
  if(completed&&completed.reportId!==existing!.id)throw new ConflictException('请求标识已用于其他内容');
  if(existing?.status==='pending'&&existing.updatedAt>new Date(Date.now()-120000)&&completed?.status!=='done')throw new ConflictException('回顾正在生成，请稍后刷新');
  if(existing&&!existing.inputCipher&&completed)throw new ServiceUnavailableException('这份回顾缺少恢复快照，请开始新的回顾');
  const id=existing?.id??randomUUID();
  try{
   if(existing){
    const claim=await db.reviewReport.updateMany({where:{id,userId,updatedAt:existing.updatedAt},data:{status:'pending'}});
    if(claim.count!==1)throw new ConflictException('回顾正在生成，请稍后刷新');
    existing=await db.reviewReport.findUniqueOrThrow({where:{id}});
   } else existing=await db.reviewReport.create({data:{id,userId,period:input.period,startDate:range.startDate,endDate:range.endDate,includeJournal:input.includeJournal,requestId:input.requestId,status:'pending'}});
  }catch(error){if(error instanceof Prisma.PrismaClientKnownRequestError&&error.code==='P2002')throw new ConflictException('回顾正在生成，请稍后刷新');throw error;}
  try {
   let snapshot:{question:string;evidence:Evidence[];context:string};
   if(existing.inputCipher)snapshot=JSON.parse(open(existing.inputCipher,'review-input:'+userId+':'+id));
   else {
    const summary=await this.insights(userId,input.period,input.date);
    const [records,journal]=await Promise.all([db.reading.findMany({where:{userId,createdAt:{gte:range.from,lt:range.to}},orderBy:{createdAt:'desc'},take:6}),db.dailyEntry.findMany({where:{userId,date:{gte:range.startDate,lt:range.endExclusive}},orderBy:{date:'asc'},take:31})]);
    const readings=records.map(row=>decodeReading(row).reading);
    const evidence:Evidence[]=[{reference:'period',name:range.startDate+' 至 '+range.endDate,position:'本人的实际记录统计',keywords:['探索 '+summary.summary.readings+' 次','星笺 '+summary.summary.dailyEntries+' 天','完成行动 '+summary.summary.completedActions+' 项']}];
    for(const reading of readings)for(const e of evidenceFor(reading).slice(0,2))evidence.push({...e,reference:reading.id+':'+e.reference});
    const context=JSON.stringify({period:input.period,startDate:range.startDate,endDate:range.endDate,statistics:summary.summary,selection:'最多最近6次探索；未覆盖的记录不推断',readings:readings.map(r=>({id:r.id,question:r.question})),daily:(input.includeJournal?journal.slice(-10):journal).map(row=>({date:row.date,mood:row.mood,...(input.includeJournal?{note:open(row.note,'journal:'+userId+':'+row.id).slice(0,500)}:{})})),journalIncluded:input.includeJournal,journalSelection:input.includeJournal?'最多最近10天，每条最多500字；不推断未包含的日记':'日记正文未发送'});
    snapshot={question:'请基于我的真实记录做一份'+(input.period==='week'?'每周':'每月')+'反思回顾，分清记录事实与建议，不预测未来或诊断心理状况。',evidence,context};
    const savedInput=await db.reviewReport.updateMany({where:{id,userId,status:'pending',inputCipher:null},data:{inputCipher:seal(JSON.stringify(snapshot),'review-input:'+userId+':'+id)}});
    if(savedInput.count!==1)throw new ConflictException('回顾状态已改变，请刷新');
   }
   // Only the authenticated report owner's identifiers are used. The encrypted
   // snapshot supplies content, never request IDs or another report's scope.
   const result=await requestModel({userId,requestId:existing.requestId,reportId:id,question:snapshot.question,evidence:snapshot.evidence,context:snapshot.context});
   const saved=await db.$transaction(async tx=>{
    const changed=await tx.reviewReport.updateMany({where:{id,userId,status:'pending'},data:{resultCipher:seal(JSON.stringify(result),'review:'+userId+':'+id),status:'done'}});
    if(changed.count!==1)throw new ConflictException('回顾已删除或状态已改变，请刷新');
    await tx.auditLog.create({data:{id:randomUUID(),actorId:userId,action:'review.generate',targetId:id,requestId}});
    return tx.reviewReport.findUniqueOrThrow({where:{id}});
   });return decodeReport(saved);
  }catch(error){await db.reviewReport.updateMany({where:{id,userId,status:'pending'},data:{status:'failed'}}).catch(()=>{});throw error;}
 }
 async export(userId:string){
  if(!await consumeLimit('export:'+userId,2,300))throw new RateLimitException('导出较多，请稍后再试');
  const where={userId};
  const counts=await Promise.all([db.reading.count({where}),db.dailyEntry.count({where}),db.actionPlan.count({where}),db.reviewReport.count({where}),db.readingConversation.count({where}),db.feedback.count({where}),db.creditLedger.count({where}),db.redemption.count({where})]);
  if(counts.reduce((a,b)=>a+b,0)>20000)throw new PayloadTooLargeException('记录较多，请联系管理员安排分批导出');
  // Reject oversized exports before loading/decrypting all rows into server memory.
  const sizes=await db.$queryRaw<{size:bigint|null}[]>(Prisma.sql`SELECT SUM(bytes) AS size FROM (
   SELECT COALESCE(SUM(OCTET_LENGTH(question)+OCTET_LENGTH(CAST(payload AS CHAR))+COALESCE(OCTET_LENGTH(interpretation),0)+COALESCE(OCTET_LENGTH(annotation),0)+COALESCE(OCTET_LENGTH(tagsCipher),0)),0) AS bytes FROM reading WHERE userId = ${userId}
   UNION ALL SELECT COALESCE(SUM(OCTET_LENGTH(note)+OCTET_LENGTH(CAST(payload AS CHAR))),0) FROM daily_entry WHERE userId = ${userId}
   UNION ALL SELECT COALESCE(SUM(OCTET_LENGTH(titleCipher)+COALESCE(OCTET_LENGTH(detailCipher),0)),0) FROM action_plan WHERE userId = ${userId}
   UNION ALL SELECT COALESCE(SUM(COALESCE(OCTET_LENGTH(resultCipher),0)),0) FROM review_report WHERE userId = ${userId}
   UNION ALL SELECT COALESCE(SUM(OCTET_LENGTH(promptCipher)+COALESCE(OCTET_LENGTH(answerCipher),0)),0) FROM reading_conversation WHERE userId = ${userId}
   UNION ALL SELECT COALESCE(SUM(OCTET_LENGTH(bodyCipher)+COALESCE(OCTET_LENGTH(adminReplyCipher),0)),0) FROM feedback WHERE userId = ${userId}
  ) AS owned_sizes`);
  if(Number(sizes[0]?.size??0)>12000000)throw new PayloadTooLargeException('导出文件较大，请联系管理员安排分批导出');
  const [readings,daily,actions,reports,conversations,feedback,ledger,membership,redemptions]=await Promise.all([
   db.reading.findMany({where,orderBy:{createdAt:'asc'}}),db.dailyEntry.findMany({where,orderBy:{date:'asc'}}),db.actionPlan.findMany({where,orderBy:{createdAt:'asc'}}),db.reviewReport.findMany({where,orderBy:{createdAt:'asc'}}),db.readingConversation.findMany({where,orderBy:{createdAt:'asc'}}),db.feedback.findMany({where,orderBy:{createdAt:'asc'}}),db.creditLedger.findMany({where,orderBy:{createdAt:'asc'},select:{id:true,kind:true,amount:true,balance:true,createdAt:true}}),new MembershipService().get(userId),db.redemption.findMany({where,orderBy:{createdAt:'asc'},select:{id:true,createdAt:true,codeId:true,code:{select:{codeHint:true,kind:true,amount:true,durationDays:true}}}})
  ]);
  const oracle=new OracleService();
  const result={version:2,exportedAt:new Date().toISOString(),readings:readings.map(row=>decodeReading(row)),daily:daily.map(row=>oracle.decodeDaily(row)),actions:actions.map(decodeAction),reports:reports.map(decodeReport),conversations:conversations.map(row=>({id:row.id,readingId:row.readingId,prompt:open(row.promptCipher,'conversation-prompt:'+userId+':'+row.id),answer:row.answerCipher?JSON.parse(open(row.answerCipher,'conversation-answer:'+userId+':'+row.id)):null,status:row.status,createdAt:row.createdAt.toISOString()})),feedback:feedback.map(decodeFeedback),membership,creditLedger:ledger,redemptions:redemptions.map(({code,...row})=>({...row,...code,createdAt:row.createdAt.toISOString()}))};
  if(Buffer.byteLength(JSON.stringify(result),'utf8')>20000000)throw new PayloadTooLargeException('导出文件较大，请联系管理员安排分批导出');
  return result;
 }
 async content(page:{cursor?:string;limit:number;kind?:'announcement'|'guide'}){
  const where={published:true,...(page.kind?{kind:page.kind}:{})};
  if(page.cursor&&!await db.siteContent.findFirst({where:{id:page.cursor,...where}}))throw new NotFoundException('内容不存在');
  const rows=await db.siteContent.findMany({where,take:page.limit+1,orderBy:[{createdAt:'desc'},{id:'desc'}],...(page.cursor?{cursor:{id:page.cursor},skip:1}:{})});
  return {items:rows.slice(0,page.limit).map(decodeContent),nextCursor:rows.length>page.limit?rows[page.limit-1]!.id:null};
 }
 async contentItem(slug:string){const row=await db.siteContent.findFirst({where:{slug,published:true}});if(!row)throw new NotFoundException('内容不存在');return decodeContent(row);}
}
