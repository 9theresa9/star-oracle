import { test,before,after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db,redis,connectRedis,seal,open,chinaDate } from '../src/infrastructure.js';
import { PersonalService,periodRange,validDate } from '../src/personal.service.js';
import { MembershipService,consumeAIAllowance } from '../src/membership.service.js';
import { TAROT_DECK } from '@star-oracle/domain';
import { modelFingerprint } from '../src/model.service.js';
import { AdminService } from '../src/admin.service.js';
const personal=new PersonalService(),membership=new MembershipService(),admin=new AdminService();
const ids:string[]=[];
async function user(label:string){
 const id=randomUUID();ids.push(id);
 return db.user.create({data:{id,name:label,email:id+'@example.com',emailVerified:true}});
}
before(async()=>{await connectRedis();});
after(async()=>{await db.user.deleteMany({where:{id:{in:ids}}});await db.$disconnect();redis.disconnect();});
test('Shanghai week/month ranges and invalid dates are explicit',()=>{
 assert.equal(validDate('2026-02-30'),false);assert.equal(validDate('2028-02-29'),true);
 const week=periodRange('week','2026-10-03');assert.equal(week.startDate,'2026-09-28');assert.equal(week.endDate,'2026-10-04');
 assert.equal(week.from.toISOString(),'2026-09-27T16:00:00.000Z');
 const month=periodRange('month','2026-12-31');assert.equal(month.endExclusive,'2027-01-01');
});
test('private actions enforce ownership, encrypted fields and optimistic versions',async()=>{
 const a=await user('action-owner'),b=await user('action-other');
 const action=await personal.createAction(a.id,{title:'PRIVATE-ACTION',detail:'PRIVATE-ACTION-DETAIL',dueDate:'2026-10-05'},randomUUID());
 const raw=await db.actionPlan.findUniqueOrThrow({where:{id:action.id}});assert.ok(!raw.titleCipher.includes('PRIVATE-ACTION'));assert.equal(open(raw.titleCipher,'action-title:'+a.id+':'+action.id),'PRIVATE-ACTION');
 await assert.rejects(()=>personal.action(b.id,action.id),/行动不存在/);
 await assert.rejects(()=>personal.updateAction(b.id,action.id,{title:'attack',detail:'',dueDate:null,completed:true,version:0},randomUUID()),/行动不存在/);
 await assert.rejects(()=>personal.actions(b.id,{cursor:action.id,limit:20,status:'all'}),/行动不存在/);
 const done=await personal.updateAction(a.id,action.id,{title:action.title,detail:action.detail,dueDate:action.dueDate,completed:true,version:0},randomUUID());
 assert.equal(done.version,1);assert.ok(done.completedAt);
 await assert.rejects(()=>personal.updateAction(a.id,action.id,{title:'stale',detail:'',dueDate:null,completed:false,version:0},randomUUID()),/行动已更新/);
 await assert.rejects(()=>personal.removeAction(b.id,action.id,randomUUID()),/行动不存在/);
 assert.equal((await personal.actions(a.id,{limit:20,status:'done'})).items.length,1);
 await personal.removeAction(a.id,action.id,randomUUID());assert.equal((await personal.actions(a.id,{limit:20,status:'all'})).items.length,0);
});
test('calendar and local insights aggregate only owned dates without diary text',async()=>{
 const a=await user('calendar-owner'),b=await user('calendar-other');
 const id=randomUUID();await db.dailyEntry.create({data:{id,userId:a.id,date:'2026-10-02',payload:{},mood:'hopeful',note:seal('PRIVATE-CALENDAR-NOTE','journal:'+a.id+':'+id)}});
 const calendar=await personal.calendar(a.id,'2026-10');assert.equal(calendar.days.length,1);assert.equal(calendar.days[0]!.notePresent,true);assert.ok(!JSON.stringify(calendar).includes('PRIVATE-CALENDAR'));
 assert.equal((await personal.calendar(b.id,'2026-10')).days.length,0);
 const insights=await personal.insights(a.id,'month','2026-10-02');assert.equal(insights.summary.dailyEntries,1);assert.equal(insights.journalIncluded,false);assert.equal(insights.summary.moods.find(m=>m.mood==='hopeful')!.count,1);
 assert.ok(!JSON.stringify(insights).includes('PRIVATE-CALENDAR'));
});
test('draft content remains private, feedback has owner access and versioned replies',async()=>{
 const a=await user('feedback-owner'),b=await user('feedback-other');
 const content=await admin.createContent(b.id,{slug:'test-'+randomUUID(),kind:'announcement',title:'Test notice',body:'Plain text <script> must render as text.',published:false},randomUUID());
 await assert.rejects(()=>personal.contentItem(content.slug),/内容不存在/);
 const published=await admin.updateContent(b.id,content.id,{slug:content.slug,kind:'announcement',title:content.title,body:content.body,published:true,version:0},randomUUID());
 assert.equal(published.version,1);assert.equal((await personal.contentItem(content.slug)).published,true);
 await assert.rejects(()=>admin.updateContent(b.id,content.id,{slug:content.slug,kind:'announcement',title:'stale',body:'',published:false,version:0},randomUUID()),/内容已更新/);
 const feedback=await personal.createFeedback(a.id,{category:'bug',body:'PRIVATE-FEEDBACK'},randomUUID());
 const raw=await db.feedback.findUniqueOrThrow({where:{id:feedback.id}});assert.ok(!raw.bodyCipher.includes('PRIVATE-FEEDBACK'));
 await assert.rejects(()=>personal.feedback(b.id,{cursor:feedback.id,limit:20}),/反馈不存在/);
 const reply=await admin.replyFeedback(b.id,feedback.id,{status:'resolved',reply:'已处理',version:0},randomUUID());assert.equal(reply.version,1);assert.equal(reply.adminReply,'已处理');
 await assert.rejects(()=>admin.replyFeedback(b.id,feedback.id,{status:'open',reply:'stale',version:0},randomUUID()),/反馈已更新/);
 await db.siteContent.delete({where:{id:content.id}});
});
test('parallel AI allowances cannot exceed five free requests and two real credits',async()=>{
 const a=await user('quota-owner');await db.membership.create({data:{userId:a.id,credits:2}});
 const requests=Array.from({length:12},()=>randomUUID());
 const results=await Promise.allSettled(requests.map(id=>consumeAIAllowance(a.id,id)));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,7);
 const usage=await db.userAIUsage.findUniqueOrThrow({where:{userId_date:{userId:a.id,date:chinaDate()}}});assert.equal(usage.requests,7);
 assert.equal((await membership.get(a.id)).credits,0);
 const allowances=await db.aIAllowance.findMany({where:{userId:a.id}});assert.equal(allowances.length,7);assert.equal(allowances.filter(x=>x.source==='credit').length,2);
 await consumeAIAllowance(a.id,allowances[0]!.requestId);
 assert.equal((await db.userAIUsage.findUniqueOrThrow({where:{userId_date:{userId:a.id,date:chinaDate()}}})).requests,7);
 const ledger=await membership.ledger(a.id,{limit:20});assert.equal(ledger.items.length,2);assert.equal(ledger.items.reduce((sum,row)=>sum+row.amount,0),-2);
});
test('redeem codes have atomic max-use limits, owner-only ledger and revocable plus tier',async()=>{
 const a=await user('redeem-owner'),b=await user('redeem-other'),manager=await user('redeem-manager');
 const code=await membership.createCode(manager.id,{kind:'credits',amount:3,maxUses:1},randomUUID());
 const races=await Promise.allSettled([membership.redeem(a.id,code.code,randomUUID()),membership.redeem(b.id,code.code,randomUUID())]);
 assert.equal(races.filter(r=>r.status==='fulfilled').length,1);
 const row=await db.redeemCode.findUniqueOrThrow({where:{id:code.item.id}});assert.equal(row.usedCount,1);assert.ok(!JSON.stringify(await membership.codes({limit:50})).includes(code.code));assert.ok(!JSON.stringify(await membership.codes({limit:50})).includes(row.codeHash));
 const winner=(await membership.get(a.id)).credits===3?a:b,loser=winner.id===a.id?b:a;
 const ledger=await membership.ledger(winner.id,{limit:20});assert.equal(ledger.items[0]!.amount,3);
 const redemptions=await membership.redemptions(winner.id,{limit:20});assert.equal(redemptions.items[0]!.codeId,code.item.id);assert.equal(redemptions.items[0]!.codeHint,code.item.codeHint);assert.ok(!JSON.stringify(redemptions).includes(row.codeHash));assert.ok(!JSON.stringify(redemptions).includes(code.code));
 await assert.rejects(()=>membership.redemptions(loser.id,{cursor:redemptions.items[0]!.id,limit:20}),/兑换记录不存在/);
 const exported=await personal.export(winner.id);assert.equal(exported.redemptions.length,1);assert.equal(exported.redemptions[0]!.amount,3);assert.ok(!JSON.stringify(exported).includes(row.codeHash));
 await assert.rejects(()=>membership.ledger(loser.id,{cursor:ledger.items[0]!.id,limit:20}),/额度记录不存在/);
 await assert.rejects(()=>membership.redeem(winner.id,code.code,randomUUID()),/已使用过/);
 const plus=await membership.assign(manager.id,winner.id,{tier:'plus',expiresAt:new Date(Date.now()+86400000).toISOString()},randomUUID());assert.equal(plus.dailyLimit,20);
 const revoke=await membership.assign(manager.id,winner.id,{tier:'free'},randomUUID());assert.equal(revoke.dailyLimit,5);assert.equal(revoke.credits,3);
 assert.equal(membership.paymentOptions().enabled,false);
 await db.redemption.deleteMany({where:{codeId:code.item.id}});await db.redeemCode.delete({where:{id:code.item.id}});
});
test('statistics expose counts only and export covers own private growth and quota data',async()=>{
 const a=await user('export-owner'),b=await user('export-other');
 const action=await personal.createAction(a.id,{title:'OWNER-EXPORT',detail:'own private detail'},randomUUID());
 await personal.createAction(b.id,{title:'OTHER-PRIVATE-EXPORT'},randomUUID());
 const exported=await personal.export(a.id);assert.ok(exported.actions.some(row=>row.id===action.id));assert.ok(!JSON.stringify(exported).includes('OTHER-PRIVATE-EXPORT'));assert.ok(!JSON.stringify(exported).includes('codeHash'));assert.ok(!JSON.stringify(exported).includes('backupCodes'));
 const stats=await admin.statistics(30);assert.equal(stats.series.length,30);assert.ok(!JSON.stringify(stats).includes('OWNER-EXPORT'));assert.ok(!JSON.stringify(stats).includes('own private detail'));
});

test('account deletion cascades private actions, journals, reports, conversations and quota ledgers',async()=>{
 const owner=await user('cascade-owner'),readingId=randomUUID(),entryId=randomUUID(),chatId=randomUUID(),reportId=randomUUID();
 const reading={version:1,id:readingId,createdAt:new Date().toISOString(),question:'',kind:'tarot',spread:'single',cards:[{id:TAROT_DECK[0]!.id,reversed:false}]};
 await db.reading.create({data:{id:readingId,userId:owner.id,kind:'tarot',question:seal('PRIVATE-CASCADE','question:'+owner.id+':'+readingId),payload:reading,requestId:randomUUID()}});
 await personal.createAction(owner.id,{title:'cascade action',readingId},randomUUID());
 await personal.createFeedback(owner.id,{category:'other',body:'cascade feedback'},randomUUID());
 await db.dailyEntry.create({data:{id:entryId,userId:owner.id,date:chinaDate(),payload:{...reading,question:'今天可以怎样照顾自己？'},note:seal('cascade diary','journal:'+owner.id+':'+entryId)}});
 await db.reviewReport.create({data:{id:reportId,userId:owner.id,period:'week',startDate:'2026-09-28',endDate:'2026-10-04',includeJournal:false,requestId:randomUUID(),status:'failed'}});
 await db.readingConversation.create({data:{id:chatId,userId:owner.id,readingId,promptCipher:seal('cascade prompt','conversation-prompt:'+owner.id+':'+chatId),requestId:randomUUID(),status:'failed'}});
 await consumeAIAllowance(owner.id,randomUUID());
 await membership.assign(owner.id,owner.id,{tier:'free',credits:2},randomUUID());
 const exported=await personal.export(owner.id);assert.equal(exported.daily.length,1);assert.equal(exported.reports.length,1);assert.equal(exported.conversations.length,1);assert.equal(exported.creditLedger.length,1);
 await db.user.delete({where:{id:owner.id}});
 const where={userId:owner.id};
 const remaining=await Promise.all([db.reading.count({where}),db.dailyEntry.count({where}),db.actionPlan.count({where}),db.feedback.count({where}),db.reviewReport.count({where}),db.readingConversation.count({where}),db.membership.count({where}),db.userAIUsage.count({where}),db.aIAllowance.count({where}),db.creditLedger.count({where})]);
 assert.deepEqual(remaining,Array(10).fill(0));
});

test('allowance accounting uses one captured Shanghai day across a midnight boundary',async()=>{
 const owner=await user('fixed-day-owner'),requestId=randomUUID(),capturedDay='2026-01-02';
 await consumeAIAllowance(owner.id,requestId,undefined,capturedDay);
 await consumeAIAllowance(owner.id,requestId,undefined,'2026-01-03');
 const usage=await db.userAIUsage.findMany({where:{userId:owner.id}});
 assert.equal(usage.length,1);assert.equal(usage[0]!.date,capturedDay);assert.equal(usage[0]!.requests,1);
});

test('deleting an owned review removes its private AI cache and keeps consumed allowance history',async()=>{
 const owner=await user('delete-report-owner'),other=await user('delete-report-other'),id=randomUUID(),requestId=randomUUID();
 const result={summary:'真实记录回顾',insights:[{reference:'period',text:'观察实际记录。'}],actions:['记录一个行动。','观察后再调整。'],reflection:'什么值得保留？'};
 await db.reviewReport.create({data:{id,userId:owner.id,period:'week',startDate:'2026-09-28',endDate:'2026-10-04',includeJournal:true,requestId,status:'done',inputCipher:seal('PRIVATE-SNAPSHOT-NOT-FOR-EXPORT','review-input:'+owner.id+':'+id),resultCipher:seal(JSON.stringify(result),'review:'+owner.id+':'+id)}});
 await db.aIRequest.create({data:{id:randomUUID(),userId:owner.id,requestId,reportId:id,fingerprint:'a'.repeat(64),status:'done',resultCipher:seal(JSON.stringify(result),'ai-request:'+owner.id+':'+requestId)}});
 await consumeAIAllowance(owner.id,requestId);
 await assert.rejects(()=>personal.reports(other.id,{cursor:id,limit:20}),/回顾不存在/);
 await assert.rejects(()=>personal.removeReport(other.id,id,randomUUID()),/回顾不存在/);
 const exported=await personal.export(owner.id);assert.equal(exported.reports[0]!.result!.summary,result.summary);assert.ok(!JSON.stringify(exported).includes('PRIVATE-SNAPSHOT-NOT-FOR-EXPORT'));assert.ok(!JSON.stringify(exported).includes('inputCipher'));
 await personal.removeReport(owner.id,id,randomUUID());
 assert.equal(await db.reviewReport.count({where:{id}}),0);assert.equal(await db.aIRequest.count({where:{userId:owner.id,requestId}}),0);
 assert.equal(await db.aIAllowance.count({where:{userId:owner.id,requestId}}),1,'nonprivate allowance usage remains accounted');
});

test('report recovery reuses its encrypted original input after diary changes without billing again',{skip:!process.env.AI_API_KEY},async()=>{
 const owner=await user('snapshot-owner'),id=randomUUID(),requestId=randomUUID(),entryId=randomUUID();
 const evidence=[{reference:'period',name:'原始记录',position:'统计',keywords:['星笺 1 天']}];
 const snapshot={question:'请回顾原始记录。',evidence,context:JSON.stringify({daily:[{date:'2026-10-02',note:'ORIGINAL-PRIVATE-SNAPSHOT'}],journalIncluded:true})};
 const result={summary:'原始快照的已完成回顾',insights:[{reference:'period',text:'基于原始记录整理。'}],actions:['记录可验证的行动。','观察之后再调整。'],reflection:'这段时间什么值得保留？'};
 await db.reviewReport.create({data:{id,userId:owner.id,period:'week',startDate:'2026-09-28',endDate:'2026-10-04',includeJournal:true,requestId,status:'pending',inputCipher:seal(JSON.stringify(snapshot),'review-input:'+owner.id+':'+id)}});
 const modelInput={userId:owner.id,requestId,reportId:id,...snapshot};
 await db.aIRequest.create({data:{id:randomUUID(),userId:owner.id,requestId,reportId:id,fingerprint:modelFingerprint(modelInput),status:'done',resultCipher:seal(JSON.stringify(result),'ai-request:'+owner.id+':'+requestId)}});
 await consumeAIAllowance(owner.id,requestId);
 const reading={version:1,id:entryId,createdAt:new Date().toISOString(),question:'今天如何照顾自己？',kind:'tarot',spread:'single',cards:[{id:TAROT_DECK[0]!.id,reversed:false}]};
 await db.dailyEntry.create({data:{id:entryId,userId:owner.id,date:'2026-10-02',payload:reading,note:seal('CHANGED-DIARY-AFTER-PROVIDER','journal:'+owner.id+':'+entryId)}});
 const usageBefore=await db.userAIUsage.findUniqueOrThrow({where:{userId_date:{userId:owner.id,date:chinaDate()}}});
 const globalBefore=(await db.aIUsage.findUnique({where:{date:chinaDate()}}))?.requests??0;
 const recovered=await personal.report(owner.id,{period:'week',date:'2026-10-03',includeJournal:true,consent:true,requestId},randomUUID());
 assert.equal(recovered.status,'done');assert.deepEqual(recovered.result,result);
 assert.equal((await db.userAIUsage.findUniqueOrThrow({where:{userId_date:{userId:owner.id,date:chinaDate()}}})).requests,usageBefore.requests);
 assert.equal((await db.aIUsage.findUnique({where:{date:chinaDate()}}))?.requests??0,globalBefore);
 const saved=await db.reviewReport.findUniqueOrThrow({where:{id}});
 const decrypted=open(saved.inputCipher!,'review-input:'+owner.id+':'+id);assert.ok(decrypted.includes('ORIGINAL-PRIVATE-SNAPSHOT'));assert.ok(!decrypted.includes('CHANGED-DIARY'));
 assert.throws(()=>open(saved.inputCipher!,'review-input:'+owner.id+':'+randomUUID()),'snapshots cannot move between reports');
 assert.ok(!JSON.stringify(await personal.reports(owner.id,{limit:20})).includes('ORIGINAL-PRIVATE-SNAPSHOT'));
});
test('a completed AI cache belonging to a different report cannot recover this report',async()=>{
 const owner=await user('scope-owner'),id=randomUUID(),otherId=randomUUID(),requestId=randomUUID(),otherRequestId=randomUUID();
 const snapshot={question:'回顾记录',evidence:[{reference:'period',name:'本期',position:'统计'}],context:'{}'};
 await db.reviewReport.createMany({data:[
  {id,userId:owner.id,period:'week',startDate:'2026-09-28',endDate:'2026-10-04',includeJournal:false,requestId,status:'pending',inputCipher:seal(JSON.stringify(snapshot),'review-input:'+owner.id+':'+id)},
  {id:otherId,userId:owner.id,period:'week',startDate:'2026-09-28',endDate:'2026-10-04',includeJournal:false,requestId:otherRequestId,status:'done'}
 ]});
 await db.aIRequest.create({data:{id:randomUUID(),userId:owner.id,requestId,reportId:otherId,fingerprint:'b'.repeat(64),status:'done'}});
 await assert.rejects(()=>personal.report(owner.id,{period:'week',date:'2026-10-03',includeJournal:false,consent:true,requestId},randomUUID()),/请求标识已用于其他内容/);
 assert.equal((await db.reviewReport.findUniqueOrThrow({where:{id}})).status,'pending');
});
