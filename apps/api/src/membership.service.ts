import { Injectable, ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID,randomBytes,createHash } from 'node:crypto';
import { db,chinaDate,consumeLimit } from './infrastructure.js';
import { RateLimitException } from './exceptions.js';

const retryable=(error:unknown)=>error instanceof Prisma.PrismaClientKnownRequestError&&['P2002','P2034'].includes(error.code);
async function retryTransaction<T>(work:(tx:Prisma.TransactionClient)=>Promise<T>):Promise<T> {
 for(let attempt=0;;attempt++){
  try{return await db.$transaction(work,{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:10000});}
  catch(error){if(!retryable(error)||attempt>=5)throw error;await new Promise(resolve=>setTimeout(resolve,20+Math.floor(Math.random()*40)*(attempt+1)));}
 }
}
function activeTier(row:{tier:string;expiresAt:Date|null}|null,now=new Date()):'free'|'plus' {
 return row?.tier==='plus'&&row.expiresAt!==null&&row.expiresAt>now?'plus':'free';
}
export async function consumeAIAllowance(userId:string,requestId:string,transaction?:Prisma.TransactionClient,accountingDay=chinaDate()):Promise<void> {
 const work=async(tx:Prisma.TransactionClient)=>{
  if(await tx.aIAllowance.findUnique({where:{userId_requestId:{userId,requestId}}}))return;
  const member=await tx.membership.upsert({where:{userId},create:{userId},update:{}});
  const date=accountingDay,limit=activeTier(member)==='plus'?20:5;
  await tx.userAIUsage.upsert({where:{userId_date:{userId,date}},create:{id:randomUUID(),userId,date},update:{}});
  const daily=await tx.userAIUsage.updateMany({where:{userId,date,requests:{lt:limit}},data:{requests:{increment:1}}});
  let source='daily';
  if(daily.count!==1){
   const credit=await tx.membership.updateMany({where:{userId,credits:{gt:0}},data:{credits:{decrement:1}}});
   if(credit.count!==1)throw new RateLimitException('今日 AI 次数已用完，可明天继续或使用兑换额度');
   source='credit';
   await tx.userAIUsage.update({where:{userId_date:{userId,date}},data:{requests:{increment:1}}});
   const balance=await tx.membership.findUniqueOrThrow({where:{userId}});
   await tx.creditLedger.create({data:{id:randomUUID(),userId,kind:'ai.consume',amount:-1,balance:balance.credits,requestId}});
  }
  await tx.aIAllowance.create({data:{id:randomUUID(),userId,requestId,source,creditsSpent:source==='credit'?1:0}});
 };
 if(transaction){await work(transaction);return;}
 await retryTransaction(work);
}
export type MemberUpdate={tier:'free'|'plus';expiresAt?:string|null;credits?:number};
export type CodeInput={kind:'credits'|'membership';amount:number;durationDays?:number;expiresAt?:string|null;maxUses:number};
function codeHash(value:string){return createHash('sha256').update(value.trim().replace(/-/g,'').toUpperCase()).digest('hex');}
function decodeCode(row:{id:string;codeHint:string;kind:string;amount:number;durationDays:number|null;expiresAt:Date|null;maxUses:number;usedCount:number;disabled:boolean;createdAt:Date}){
 return {...row,expiresAt:row.expiresAt?.toISOString()??null,createdAt:row.createdAt.toISOString()};
}
@Injectable()
export class MembershipService {
 async get(userId:string){
  const [member,usage]=await Promise.all([db.membership.findUnique({where:{userId}}),db.userAIUsage.findUnique({where:{userId_date:{userId,date:chinaDate()}}})]);
  const tier=activeTier(member),dailyLimit=tier==='plus'?20:5,usedToday=usage?.requests??0;
  return {tier,expiresAt:member?.expiresAt?.toISOString()??null,credits:member?.credits??0,dailyLimit,usedToday,remainingToday:Math.max(0,dailyLimit-usedToday),paymentEnabled:false};
 }
 paymentOptions(){return {enabled:false,providers:[],message:'当前仅支持管理员发放与兑换码，尚未接入微信、支付宝等支付服务；不会创建收款订单。'};}
 async redeem(userId:string,code:string,requestId:string){
  if(!await consumeLimit('redeem:'+userId,6,300))throw new RateLimitException('兑换尝试较多，请稍后再试');
  const hash=codeHash(code);
  await retryTransaction(async tx=>{
   const row=await tx.redeemCode.findUnique({where:{codeHash:hash}});
   if(!row||row.disabled||(row.expiresAt&&row.expiresAt<=new Date()))throw new BadRequestException('兑换码无效或已过期');
   if(await tx.redemption.findUnique({where:{userId_codeId:{userId,codeId:row.id}}}))throw new ConflictException('你已使用过此兑换码');
   const used=await tx.redeemCode.updateMany({where:{id:row.id,disabled:false,usedCount:{lt:row.maxUses},OR:[{expiresAt:null},{expiresAt:{gt:new Date()}}]},data:{usedCount:{increment:1}}});
   if(used.count!==1)throw new BadRequestException('兑换码已用完或失效');
   const member=await tx.membership.upsert({where:{userId},create:{userId},update:{}});
   if(row.kind==='credits'){
    if(member.credits>100000000-row.amount)throw new BadRequestException('额度余额过大，请联系管理员');
    const value=await tx.membership.update({where:{userId},data:{credits:{increment:row.amount}}});
    await tx.creditLedger.create({data:{id:randomUUID(),userId,kind:'redeem.credits',amount:row.amount,balance:value.credits,requestId}});
   }
   else {
    const start=activeTier(member)==='plus'?member.expiresAt!:new Date();
    await tx.membership.update({where:{userId},data:{tier:'plus',expiresAt:new Date(start.getTime()+(row.durationDays??row.amount)*86400000)}});
   }
   await tx.redemption.create({data:{id:randomUUID(),userId,codeId:row.id}});
   await tx.auditLog.create({data:{id:randomUUID(),actorId:userId,action:'membership.redeem',targetId:row.id,requestId}});
  });
  return this.get(userId);
 }
 async redemptions(userId:string,page:{cursor?:string;limit:number}){
  if(page.cursor&&!await db.redemption.findFirst({where:{id:page.cursor,userId}}))throw new NotFoundException('兑换记录不存在');
  const rows=await db.redemption.findMany({where:{userId},take:page.limit+1,orderBy:[{createdAt:'desc'},{id:'desc'}],...(page.cursor?{cursor:{id:page.cursor},skip:1}:{}),select:{id:true,createdAt:true,codeId:true,code:{select:{codeHint:true,kind:true,amount:true,durationDays:true}}}});
  return {items:rows.slice(0,page.limit).map(({code,...row})=>({...row,...code,createdAt:row.createdAt.toISOString()})),nextCursor:rows.length>page.limit?rows[page.limit-1]!.id:null};
 }
 async ledger(userId:string,page:{cursor?:string;limit:number}){
  if(page.cursor&&!await db.creditLedger.findFirst({where:{id:page.cursor,userId}}))throw new NotFoundException('额度记录不存在');
  const rows=await db.creditLedger.findMany({where:{userId},take:page.limit+1,orderBy:[{createdAt:'desc'},{id:'desc'}],...(page.cursor?{cursor:{id:page.cursor},skip:1}:{}),select:{id:true,kind:true,amount:true,balance:true,createdAt:true}});
  return {items:rows.slice(0,page.limit).map(row=>({...row,createdAt:row.createdAt.toISOString()})),nextCursor:rows.length>page.limit?rows[page.limit-1]!.id:null};
 }
 async codes(page:{cursor?:string;limit:number}){
  if(page.cursor&&!await db.redeemCode.findUnique({where:{id:page.cursor}}))throw new NotFoundException('兑换码不存在');
  const rows=await db.redeemCode.findMany({take:page.limit+1,orderBy:[{createdAt:'desc'},{id:'desc'}],...(page.cursor?{cursor:{id:page.cursor},skip:1}:{}),select:{id:true,codeHint:true,kind:true,amount:true,durationDays:true,expiresAt:true,maxUses:true,usedCount:true,disabled:true,createdAt:true}});
  return {items:rows.slice(0,page.limit).map(decodeCode),nextCursor:rows.length>page.limit?rows[page.limit-1]!.id:null};
 }
 async createCode(actorId:string,input:CodeInput,requestId:string){
  const raw=randomBytes(18).toString('hex').toUpperCase(),id=randomUUID();
  const row=await db.$transaction(async tx=>{
   const code=await tx.redeemCode.create({data:{id,codeHash:codeHash(raw),codeHint:raw.slice(-6),kind:input.kind,amount:input.amount,durationDays:input.kind==='membership'?input.durationDays??input.amount:null,expiresAt:input.expiresAt?new Date(input.expiresAt):null,maxUses:input.maxUses}});
   await tx.auditLog.create({data:{id:randomUUID(),actorId,action:'redeem_code.create',targetId:id,requestId}});
   return code;
  });
  return {code:raw.match(/.{1,6}/g)!.join('-'),item:decodeCode({id:row.id,codeHint:row.codeHint,kind:row.kind,amount:row.amount,durationDays:row.durationDays,expiresAt:row.expiresAt,maxUses:row.maxUses,usedCount:row.usedCount,disabled:row.disabled,createdAt:row.createdAt})};
 }
 async codeStatus(actorId:string,id:string,disabled:boolean,requestId:string){
  if(!await db.redeemCode.findUnique({where:{id}}))throw new NotFoundException('兑换码不存在');
  await db.$transaction(async tx=>{
   await tx.redeemCode.update({where:{id},data:{disabled}});
   await tx.auditLog.create({data:{id:randomUUID(),actorId,action:disabled?'redeem_code.disable':'redeem_code.enable',targetId:id,requestId}});
  });return {ok:true};
 }
 async assign(actorId:string,userId:string,input:MemberUpdate,requestId:string){
  if(!await db.user.findUnique({where:{id:userId}}))throw new NotFoundException('用户不存在');
  if(input.tier==='plus'&&(!input.expiresAt||new Date(input.expiresAt)<=new Date()))throw new BadRequestException('会员需要未来的到期时间');
  await retryTransaction(async tx=>{
   const previous=await tx.membership.findUnique({where:{userId}});
   const data={tier:input.tier,expiresAt:input.tier==='plus'?new Date(input.expiresAt!):null,...(input.credits!==undefined?{credits:input.credits}:{})};
   const value=await tx.membership.upsert({where:{userId},create:{userId,...data},update:data});
   if(input.credits!==undefined&&input.credits!==(previous?.credits??0))await tx.creditLedger.create({data:{id:randomUUID(),userId,kind:'admin.adjust',amount:input.credits-(previous?.credits??0),balance:value.credits,requestId}});
   await tx.auditLog.create({data:{id:randomUUID(),actorId,action:'membership.assign',targetId:userId,requestId}});
  });return this.get(userId);
 }
}
