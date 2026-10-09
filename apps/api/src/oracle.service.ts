import { RateLimitException } from './exceptions.js';
import { Injectable, NotFoundException, ConflictException, ServiceUnavailableException, BadRequestException, HttpException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { drawTarot,castCoinLine,castNumberLines,castTimeLines,validateReading,basicInterpretation,evidenceFor,TAROT_DECK,randomInt,dailyMessage,type Reading,type Interpretation,type ScenarioId } from '@star-oracle/domain';
import type { CreateReadingInput,JournalData } from '@star-oracle/contracts';
import { db,seal,open,consumeLimit,chinaDate } from './infrastructure.js';
import { requestModel,modelRequestState,failedModelAttempt,initialInterpretationId,type ModelRequest } from './model.service.js';

type Stored=Prisma.ReadingGetPayload<Record<string,never>>;
export type ReadingFilters={cursor?:string;limit:number;q?:string;kind?:'tarot'|'iching';favorite?:boolean;tag?:string;dateFrom?:string;dateTo?:string};
export type ReadingMetadata={favorite:boolean;tags:string[];note:string;version:number};
export type ReadingProjection=Pick<Stored,'id'|'userId'|'payload'|'question'|'interpretation'|'ai'|'shared'|'createdAt'>&Partial<Pick<Stored,'favorite'|'tagsCipher'|'annotation'|'metadataVersion'>>;
export function decodeReading(row:ReadingProjection,includeMetadata=true) {
 const reading=validateReading({...row.payload as object,question:open(row.question,'question:'+row.userId+':'+row.id)});
 return {id:row.id,reading,interpretation:row.interpretation?JSON.parse(open(row.interpretation,'interpretation:'+row.userId+':'+row.id)) as Interpretation:basicInterpretation(reading),
   ai:row.ai,shared:row.shared,createdAt:row.createdAt.toISOString(),favorite:includeMetadata?(row.favorite??false):false,
   tags:includeMetadata&&row.tagsCipher?JSON.parse(open(row.tagsCipher,'reading-tags:'+row.userId+':'+row.id)) as string[]:[],
   note:includeMetadata&&row.annotation?open(row.annotation,'reading-note:'+row.userId+':'+row.id):'',metadataVersion:includeMetadata?(row.metadataVersion??0):0};
}
function verifyDuplicate(row:Stored,input:CreateReadingInput) {
 const saved=decodeReading(row),reading=saved.reading,options=(row.payload as Record<string,unknown>)._createOptions as {allowReversed?:boolean}|undefined;
 if(reading.question!==input.question.trim()||reading.kind!==input.kind||(reading.scenario??'general')!==(input.scenario??'general')||
   (reading.kind==='tarot'&&(reading.spread!==input.spread||(options&&options.allowReversed!==input.allowReversed)))||
   (reading.kind==='iching'&&((reading.method??'coins')!==(input.method??'coins')||
    (input.method==='numbers'&&JSON.stringify((reading.casting as {numbers?:[number,number,number]}|undefined)?.numbers)!==JSON.stringify(input.numbers))||
    (input.method==='time'&&(reading.casting as {timestamp?:string}|undefined)?.timestamp!==new Date(input.time!).toISOString()))))throw new ConflictException('请求标识已用于另一个问题，请重新开始');
 return saved;
}
function dateBoundary(date:string,end=false):Date {
 // The date-only filter is a Shanghai calendar day, not UTC midnight.
 const start=new Date(date+'T00:00:00+08:00');
 if(!Number.isFinite(start.getTime())||chinaDate(start)!==date)throw new BadRequestException('日期无效');
 return end?new Date(start.getTime()+86400000):start;
}
type ConversationRow=Prisma.ReadingConversationGetPayload<Record<string,never>>;
type ConversationInput=Pick<ModelRequest,'question'|'evidence'|'context'>;
function conversationModelRequest(row:ConversationRow):ModelRequest {
 if(!row.inputCipher)throw new ServiceUnavailableException('这条追问缺少恢复快照，请开始新的追问');
 const snapshot=JSON.parse(open(row.inputCipher,'conversation-input:'+row.userId+':'+row.id)) as ConversationInput;
 if(snapshot.question!==open(row.promptCipher,'conversation-prompt:'+row.userId+':'+row.id))throw new ConflictException('追问内容已改变，请刷新');
 // Source/nonce identifiers always come from the owned row, never the snapshot.
 return {userId:row.userId,requestId:row.requestId,readingId:row.readingId,conversationId:row.id,question:snapshot.question,evidence:snapshot.evidence,context:snapshot.context};
}
export function decodeConversation(row:ConversationRow) {
 return {id:row.id,prompt:open(row.promptCipher,'conversation-prompt:'+row.userId+':'+row.id),answer:row.answerCipher?JSON.parse(open(row.answerCipher,'conversation-answer:'+row.userId+':'+row.id)) as Interpretation:null,status:row.status,createdAt:row.createdAt.toISOString()};
}
@Injectable()
export class OracleService {
 async create(userId:string,input:CreateReadingInput,requestId:string) {
  const previous=await db.reading.findUnique({where:{userId_requestId:{userId,requestId:input.requestId}}});
  if(previous)return verifyDuplicate(previous,input);
  if(!await consumeLimit('draw:'+userId,20,60))throw new RateLimitException('请稍后再探索');
  const base={version:1 as const,id:randomUUID(),createdAt:new Date().toISOString(),question:input.question.trim(),scenario:(input.scenario??'general') as ScenarioId};
  let reading:Reading;
  if(input.kind==='tarot')reading={...base,kind:'tarot',spread:input.spread,cards:drawTarot(input.spread,input.allowReversed)};
  else{
   const method=input.method??'coins';
   if(method==='numbers'){
    if(!input.numbers)throw new BadRequestException('请输入三个起卦数字');
    const cast=castNumberLines(input.numbers);
    reading={...base,kind:'iching',method,lines:cast.lines,casting:cast.inputs};
   }else if(method==='time'){
    if(!input.time)throw new BadRequestException('请选择起卦时间');
    const cast=castTimeLines(input.time);
    reading={...base,kind:'iching',method,lines:cast.lines,casting:cast.inputs};
   }else reading={...base,kind:'iching',method:'coins',lines:Array.from({length:6},()=>castCoinLine().value)};
  }
  reading=validateReading(reading);
  const payload={...reading,question:'',...(reading.kind==='tarot'?{_createOptions:{allowReversed:input.allowReversed}}:{})};
  try{
   const row=await db.$transaction(async tx=>{
    const r=await tx.reading.create({data:{id:reading.id,userId,kind:reading.kind,question:seal(reading.question,'question:'+userId+':'+reading.id),payload:payload as Prisma.InputJsonValue,requestId:input.requestId}});
    await tx.auditLog.create({data:{id:randomUUID(),actorId:userId,action:'reading.create',targetId:r.id,requestId}});
    return r;
   });
   return decodeReading(row);
  }catch(error){
   if(error instanceof Prisma.PrismaClientKnownRequestError&&error.code==='P2002'){
    const row=await db.reading.findUniqueOrThrow({where:{userId_requestId:{userId,requestId:input.requestId}}});return verifyDuplicate(row,input);
   }
   throw error;
  }
 }
 async owned(userId:string,id:string) {
  const row=await db.reading.findFirst({where:{id,userId}});
  if(!row)throw new NotFoundException('记录不存在');return row;
 }
 async list(userId:string,query:ReadingFilters) {
  const {cursor,limit,q,tag,kind,favorite,dateFrom,dateTo}=query;
  if(cursor&&!await db.reading.findFirst({where:{id:cursor,userId},select:{id:true}}))throw new NotFoundException('记录不存在');
  const where:Prisma.ReadingWhereInput={userId,...(kind?{kind}:{}),...(favorite!==undefined?{favorite}:{}),
   ...(dateFrom||dateTo?{createdAt:{...(dateFrom?{gte:dateBoundary(dateFrom)}:{}),...(dateTo?{lt:dateBoundary(dateTo,true)}:{})}}:{})};
  if(!q&&!tag){
   const rows=await db.reading.findMany({where,orderBy:[{createdAt:'desc'},{id:'desc'}],take:limit+1,...(cursor?{cursor:{id:cursor},skip:1}:{})});
   return {items:rows.slice(0,limit).map(row=>decodeReading(row)),nextCursor:rows.length>limit?rows[limit-1]!.id:null};
  }
  const needle=q?.trim().toLocaleLowerCase();
  type SearchRow=Pick<Stored,'id'|'question'|'tagsCipher'|'annotation'>;
  const matches=(row:SearchRow)=>{
   const tags=row.tagsCipher?JSON.parse(open(row.tagsCipher,'reading-tags:'+userId+':'+row.id)) as string[]:[];
   if(tag&&!tags.includes(tag))return false;
   if(!needle)return true;
   const question=open(row.question,'question:'+userId+':'+row.id);
   const note=row.annotation?open(row.annotation,'reading-note:'+userId+':'+row.id):'';
   return [question,note,...tags].some(text=>text.toLocaleLowerCase().includes(needle));
  };
  // Read one lookahead row, but scan at most 600. Only matching rows need a full payload.
  const matchedIds:string[]=[];let position=cursor,scanned=0,hasMore=false;
  while(scanned<600&&matchedIds.length<limit){
   const scanLimit=Math.min(150,600-scanned);
   const rows=await db.reading.findMany({where,orderBy:[{createdAt:'desc'},{id:'desc'}],take:scanLimit+1,
    select:{id:true,question:true,tagsCipher:true,annotation:true},...(position?{cursor:{id:position},skip:1}:{})});
   hasMore=false;
   for(let index=0;index<Math.min(scanLimit,rows.length);index++){
    const row=rows[index]!;position=row.id;scanned++;hasMore=index+1<rows.length;
    if(matches(row))matchedIds.push(row.id);
    if(matchedIds.length===limit)break;
   }
   if(!hasMore)break;
  }
  if(!matchedIds.length)return {items:[],nextCursor:hasMore?position??null:null};
  const records=await db.reading.findMany({where:{...where,id:{in:matchedIds}}});
  const byId=new Map(records.map(row=>[row.id,row]));
  const items=matchedIds.flatMap(id=>{const row=byId.get(id);return row&&matches(row)?[decodeReading(row)]:[];});
  return {items,nextCursor:hasMore?position??null:null};
 }
 async get(userId:string,id:string){return decodeReading(await this.owned(userId,id));}
 async metadata(userId:string,id:string,input:ReadingMetadata,requestId:string) {
  const tags=[...new Set(input.tags.map(tag=>tag.trim()).filter(Boolean))];
  const data={favorite:input.favorite,tagsCipher:seal(JSON.stringify(tags),'reading-tags:'+userId+':'+id),annotation:seal(input.note.trim(),'reading-note:'+userId+':'+id),metadataVersion:{increment:1}};
  await db.$transaction(async tx=>{
   const changed=await tx.reading.updateMany({where:{id,userId,metadataVersion:input.version},data});
   if(changed.count!==1){
    if(!await tx.reading.findFirst({where:{id,userId},select:{id:true}}))throw new NotFoundException('记录不存在');
    throw new ConflictException('记录已在其他设备更新，请先加载云端版本');
   }
   await tx.auditLog.create({data:{id:randomUUID(),actorId:userId,action:'reading.metadata',targetId:id,requestId}});
  });
  return this.get(userId,id);
 }
 async remove(userId:string,id:string,requestId:string) {
  await this.owned(userId,id);
  await db.$transaction(async tx=>{
   await tx.reading.deleteMany({where:{id,userId}});
   await tx.auditLog.create({data:{id:randomUUID(),actorId:userId,action:'reading.delete',targetId:id,requestId}});
  });return {ok:true};
 }
 async share(userId:string,id:string,shared:boolean,requestId:string) {
  await db.$transaction(async tx=>{
   const changed=await tx.reading.updateMany({where:{id,userId},data:{shared}});
   if(changed.count!==1&&!await tx.reading.findFirst({where:{id,userId},select:{id:true}}))throw new NotFoundException('记录不存在');
   await tx.auditLog.create({data:{id:randomUUID(),actorId:userId,action:shared?'reading.share':'reading.unshare',targetId:id,requestId}});
  });return this.get(userId,id);
 }
 async interpret(userId:string,id:string,auditRequestId:string,modelRequestId?:string) {
  const original=await this.owned(userId,id);
  if(original.ai)return decodeReading(original);
  const started=new Date();
  const claimed=await db.reading.updateMany({where:{id,userId,ai:false,OR:[{aiStatus:'idle'},{aiStatus:'pending',aiStartedAt:{lt:new Date(Date.now()-120000)}}]},data:{aiStatus:'pending',aiStartedAt:started}});
  if(claimed.count!==1)throw new ConflictException('这份解读正在生成，请稍后刷新');
  try{
   const reading=decodeReading(original).reading;
   const result=await requestModel({userId,requestId:modelRequestId??initialInterpretationId(id),readingId:id,question:reading.question,evidence:evidenceFor(reading)});
   await db.$transaction(async tx=>{
    const saved=await tx.reading.updateMany({where:{id,userId,ai:false,aiStatus:'pending',aiStartedAt:started},data:{interpretation:seal(JSON.stringify(result),'interpretation:'+userId+':'+id),ai:true,aiStatus:'done'}});
    if(saved.count!==1)throw new ConflictException('记录状态已改变，请刷新');
    await tx.auditLog.create({data:{id:randomUUID(),actorId:userId,action:'reading.ai',targetId:id,requestId:auditRequestId}});
   });
   return this.get(userId,id);
  }catch(error){
   await db.reading.updateMany({where:{id,userId,aiStatus:'pending',aiStartedAt:started},data:{aiStatus:'idle'}}).catch(()=>{});
   if(error instanceof HttpException)throw error;
   throw new ServiceUnavailableException('AI 暂时不可用，已保留基础解读');
  }
 }
 async conversations(userId:string,readingId:string,{cursor,limit}:{cursor?:string;limit:number}) {
  await this.owned(userId,readingId);
  await db.readingConversation.updateMany({where:{userId,readingId,status:'pending',pendingSince:{lt:new Date(Date.now()-120000)}},data:{status:'failed',pendingSince:null}});
  if(cursor&&!await db.readingConversation.findFirst({where:{id:cursor,userId,readingId}}))throw new NotFoundException('追问不存在');
  const rows=await db.readingConversation.findMany({where:{userId,readingId},orderBy:[{createdAt:'asc'},{id:'asc'}],take:limit+1,...(cursor?{cursor:{id:cursor},skip:1}:{})});
  return {items:rows.slice(0,limit).map(decodeConversation),nextCursor:rows.length>limit?rows[limit-1]!.id:null};
 }
 async followUp(userId:string,readingId:string,input:{prompt:string;requestId:string;consent:true},auditRequestId:string) {
  await this.owned(userId,readingId);
  const where={userId_requestId:{userId,requestId:input.requestId}};
  const previous=await db.readingConversation.findUnique({where});
  if(previous){
   if(previous.readingId!==readingId||decodeConversation(previous).prompt!==input.prompt.trim())throw new ConflictException('请求标识已用于其他追问');
   if(previous.status==='done')return decodeConversation(previous);
   if(previous.inputCipher){
    const model=await modelRequestState(conversationModelRequest(previous));
    if(model.result)return this.saveConversation(previous,model.result,auditRequestId);
    if(model.status==='failed'||(previous.status==='failed'&&model.status==='missing'))throw failedModelAttempt('本次追问未完成，请选择重新尝试');
   }
   if(previous.status==='failed')throw new ServiceUnavailableException('本次追问未完成，请选择重新尝试');
   if(previous.pendingSince&&previous.pendingSince.getTime()<Date.now()-120000){
    await db.readingConversation.updateMany({where:{id:previous.id,status:'pending',pendingSince:previous.pendingSince},data:{status:'failed',pendingSince:null}});
    throw new ServiceUnavailableException('上次追问已中断，请选择重新尝试');
   }
   throw new ConflictException('这次追问正在生成，请稍后刷新');
  }
  // This lock also keeps the context stable while requests for the same reading
  // race. No client supplied cards or alternative results reach the model.
  const id=randomUUID(),started=new Date();
  let row:ConversationRow;
  try{
   row=await db.$transaction(async tx=>{
    const exists=await tx.reading.findFirst({where:{id:readingId,userId}});
    if(!exists)throw new NotFoundException('记录不存在');
    const pending=await tx.readingConversation.findFirst({where:{userId,readingId,status:'pending',pendingSince:{gte:new Date(Date.now()-120000)}}});
    if(pending)throw new ConflictException('上一条追问正在生成，请稍后再问');
    const record=decodeReading(exists);
    const recent=await tx.readingConversation.findMany({where:{userId,readingId,status:'done'},orderBy:[{createdAt:'desc'},{id:'desc'}],take:6});
    const context=JSON.stringify({originalQuestion:record.reading.question,originalInterpretation:{summary:record.interpretation.summary.slice(0,1000),reflection:record.interpretation.reflection.slice(0,300)},history:recent.reverse().map(item=>{const value=decodeConversation(item);return {prompt:value.prompt,answer:{summary:value.answer!.summary.slice(0,800),reflection:value.answer!.reflection.slice(0,200)}};})});
    const snapshot:ConversationInput={question:input.prompt.trim(),evidence:evidenceFor(record.reading),context};
    return tx.readingConversation.create({data:{id,userId,readingId,requestId:input.requestId,promptCipher:seal(snapshot.question,'conversation-prompt:'+userId+':'+id),inputCipher:seal(JSON.stringify(snapshot),'conversation-input:'+userId+':'+id),status:'pending',pendingSince:started}});
   },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
  }catch(error){
   if(error instanceof Prisma.PrismaClientKnownRequestError&&(error.code==='P2002'||error.code==='P2034'))throw new ConflictException('这次追问已经开始，请稍后刷新');
   throw error;
  }
  try{
   const answer=await requestModel(conversationModelRequest(row));
   return await this.saveConversation(row,answer,auditRequestId);
  }catch(error){
   await db.readingConversation.updateMany({where:{id,userId,status:'pending',pendingSince:started},data:{status:'failed',pendingSince:null}}).catch(()=>{});
   if(error instanceof HttpException)throw error;
   throw new ServiceUnavailableException('追问暂时不可用，已有记录仍可查看');
  }
 }
 private async saveConversation(row:ConversationRow,answer:Interpretation,auditRequestId:string) {
  const {id,userId,readingId,requestId,inputCipher}=row;
  try{
   const saved=await db.$transaction(async tx=>{
    const identity={id,userId,readingId,requestId,inputCipher};
    const changed=await tx.readingConversation.updateMany({where:{...identity,status:{in:['pending','failed']}},data:{answerCipher:seal(JSON.stringify(answer),'conversation-answer:'+userId+':'+id),status:'done',pendingSince:null}});
    if(changed.count!==1){
     const completed=await tx.readingConversation.findFirst({where:{...identity,status:'done'}});
     if(completed)return completed;
     throw new ConflictException('追问状态已改变，请刷新');
    }
    await tx.auditLog.create({data:{id:randomUUID(),actorId:userId,action:'reading.follow-up',targetId:readingId,requestId:auditRequestId}});
    return tx.readingConversation.findUniqueOrThrow({where:{id}});
   });
   return decodeConversation(saved);
  }catch(error){
   if(error instanceof HttpException)throw error;
   throw new ServiceUnavailableException('追问暂时不可用，已有记录仍可查看');
  }
 }
 async dailyOne(userId:string,id:string) {
  const row=await db.dailyEntry.findFirst({where:{id,userId}});
  if(!row)throw new NotFoundException('星笺不存在');
  return this.decodeDaily(row);
 }
 async daily(userId:string) {
  const date=chinaDate(),where={userId_date:{userId,date}};
  let row=await db.dailyEntry.findUnique({where});
  if(!row) {
   const card=TAROT_DECK[randomInt(TAROT_DECK.length)]!;
   const id=randomUUID();
   const reading:Reading={version:1,id,createdAt:new Date().toISOString(),question:'今天，我可以怎样更好地照顾自己？',kind:'tarot',spread:'single',cards:[{id:card.id,reversed:false}]};
   try {row=await db.dailyEntry.create({data:{id,userId,date,payload:reading as Prisma.InputJsonValue,note:seal('','journal:'+userId+':'+id)}});}
   catch(error){if(error instanceof Prisma.PrismaClientKnownRequestError&&error.code==='P2002')row=await db.dailyEntry.findUniqueOrThrow({where});else throw error;}
  }
  return this.decodeDaily(row);
 }
 decodeDaily(row:Prisma.DailyEntryGetPayload<Record<string,never>>) {
  const reading=validateReading(row.payload);
  if(reading.kind!=='tarot') throw new BadRequestException('星笺无效');
  return {id:row.id,date:row.date,reading,message:dailyMessage(reading.cards[0]!.id),journal:{note:open(row.note,'journal:'+row.userId+':'+row.id),mood:row.mood,version:row.version}};
 }
 async dailyHistory(userId:string,{cursor,limit}:{cursor?:string;limit:number}) {
  if(cursor&&!await db.dailyEntry.findFirst({where:{id:cursor,userId}}))throw new NotFoundException('星笺不存在');
  const rows=await db.dailyEntry.findMany({where:{userId},orderBy:[{date:'desc'},{id:'desc'}],take:limit+1,...(cursor?{cursor:{id:cursor},skip:1}:{})});
  return {items:rows.slice(0,limit).map(x=>this.decodeDaily(x)),nextCursor:rows.length>limit?rows[limit-1]!.id:null};
 }
 async journal(userId:string,id:string,input:JournalData) {
  const row=await db.dailyEntry.findFirst({where:{id,userId}});
  if(!row) throw new NotFoundException('星笺不存在');
  const changed=await db.dailyEntry.updateMany({where:{id,userId,version:input.version},data:{note:seal(input.note.trim(),'journal:'+userId+':'+id),mood:input.mood,version:{increment:1}}});
  if(changed.count!==1) throw new ConflictException('日记已在其他设备更新，请刷新后再保存');
  return this.decodeDaily(await db.dailyEntry.findUniqueOrThrow({where:{id}}));
 }
}
