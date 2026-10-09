/** Offline candidate verification. No application server or model provider starts. */
import {createDecipheriv} from 'node:crypto';
import type {PrismaClient} from '@prisma/client';
import {symmetricDecrypt} from 'better-auth/crypto';
import {databasePolicy,roleIdentity} from './shared-db-policy.js';
import {revokeAllAccountSessions,type AccountRedis} from './account-service.js';
type Row = Record<string, unknown>;
const fields: Record<string, Array<[string,string,boolean?]>> = {
 reading:[['question','question',true],['interpretation','interpretation'],['tagsCipher','reading-tags'],['annotation','reading-note']],
 dailyEntry:[['note','journal',true]],actionPlan:[['titleCipher','action-title',true],['detailCipher','action-detail']],
 feedback:[['bodyCipher','feedback',true],['adminReplyCipher','feedback-reply']],
 reviewReport:[['inputCipher','review-input'],['resultCipher','review']],aIRequest:[['resultCipher','ai-request']],
 readingConversation:[['promptCipher','conversation-prompt',true],['inputCipher','conversation-input'],['answerCipher','conversation-answer']],
};
export async function validateEncryptedRecoveryRow(model: string,row: Row,dataKey: string,authSecret: string): Promise<number> {
 try {
  databasePolicy(/^[a-fA-F0-9]{64}$/.test(dataKey) && authSecret.length>=32,'SHARED_RESTORE_CIPHERTEXT');
  if(model==='twoFactor') {
   const secret=await symmetricDecrypt({key:authSecret,data:String(row.secret)});
   const codes:unknown=JSON.parse(await symmetricDecrypt({key:authSecret,data:String(row.backupCodes)}));
   databasePolicy(secret.length>0&&Array.isArray(codes)&&codes.every(code=>typeof code==='string'),'SHARED_RESTORE_CIPHERTEXT');
   return 2;
  }
  databasePolicy(fields[model],'SHARED_RESTORE_CIPHERTEXT');let count=0;
  for(const [field,prefix,required] of fields[model]!) {
   const value=row[field];if(!required&&value===null)continue;
   databasePolicy(typeof value==='string','SHARED_RESTORE_CIPHERTEXT');
   const [version,iv,tag,body,...extra]=value.split('.');
   databasePolicy(version==='v1'&&iv&&tag&&body!==undefined&&extra.length===0,'SHARED_RESTORE_CIPHERTEXT');
   const decipher=createDecipheriv('aes-256-gcm',Buffer.from(dataKey,'hex'),Buffer.from(iv,'base64'));
   decipher.setAAD(Buffer.from(prefix+':'+String(row.userId)+':'+String(model==='aIRequest'?row.requestId:row.id)));
   decipher.setAuthTag(Buffer.from(tag,'base64'));
   // Authentication and ownership binding are verified; plaintext is discarded.
   decipher.update(Buffer.from(body,'base64'));decipher.final();count++;
  }
  return count;
 }catch{throw new Error('SHARED_RESTORE_CIPHERTEXT');}
}
const userTables=['session','account','twoFactor','reading','daily_entry','action_plan','feedback','membership','user_ai_usage','ai_allowance','ai_request','reading_conversation','redemption','review_report','credit_ledger'];
const relationshipChecks=userTables.map(table=>'SELECT COUNT(*) AS invalid FROM `'+table+'` child LEFT JOIN `user` parent ON parent.id=child.userId WHERE parent.id IS NULL');
for(const [table,column,parent] of [['reading_conversation','readingId','reading'],['action_plan','readingId','reading'],['ai_request','readingId','reading'],['ai_request','reportId','review_report']])relationshipChecks.push('SELECT COUNT(*) AS invalid FROM `'+table+'` child LEFT JOIN `'+parent+'` parent ON parent.id=child.`'+column+'` WHERE child.`'+column+'` IS NOT NULL AND (parent.id IS NULL OR parent.userId<>child.userId)');
relationshipChecks.push('SELECT COUNT(*) AS invalid FROM `redemption` child LEFT JOIN `redeem_code` parent ON parent.id=child.codeId WHERE parent.id IS NULL');
export async function verifyCandidateData(db: PrismaClient,{dataKey,authSecret}:{dataKey:string;authSecret:string}) {
 let rowsChecked=0,ciphertextsChecked=0,ownershipChecks=0;
 for(const sql of relationshipChecks) {
  const rows=await db.$queryRawUnsafe<Array<{invalid:bigint|number}>>(sql);
  databasePolicy(rows.length===1&&String(rows[0]!.invalid)==='0','SHARED_RESTORE_OWNERSHIP');ownershipChecks++;
 }
 const models=db as unknown as Record<string,{findMany(options:unknown):Promise<Row[]>}>;
 for(const model of [...Object.keys(fields),'twoFactor']) {
  let cursor:string|undefined;
  while(true) {
   const rows=await models[model]!.findMany({orderBy:{id:'asc'},take:10,...(cursor?{cursor:{id:cursor},skip:1}:{})});
   for(const row of rows){ciphertextsChecked+=await validateEncryptedRecoveryRow(model,row,dataKey,authSecret);rowsChecked++;}
   if(rows.length<10)break;
   databasePolicy(typeof rows.at(-1)!.id==='string'&&rows.at(-1)!.id!==cursor,'SHARED_RESTORE_CURSOR');cursor=rows.at(-1)!.id as string;
  }
 }
 return {rowsChecked,ciphertextsChecked,ownershipChecks};
}
type RecoveryCache=AccountRedis&{connect():Promise<unknown>;dbsize():Promise<number>;disconnect():void;on(event:string,listener:()=>void):unknown};
export async function verifyCandidateRecovery(db: PrismaClient,env:Record<string,string|undefined>,options:{createRedis?:(url:string)=>Promise<RecoveryCache>}={}) {
 roleIdentity('candidateApp',env.SHARED_CANDIDATE_DATABASE??'');
 databasePolicy(/^redis:\/\/:[a-fA-F0-9]{64}@candidate-redis:6379$/.test(env.REDIS_URL??''),'SHARED_RESTORE_CACHE');
 const encoded=env.AUTH_SECRET_BASE64??'',authSecret=Buffer.from(encoded,'base64').toString('utf8');
 databasePolicy(Buffer.from(authSecret).toString('base64')===encoded&&authSecret.length>=32&&/^[a-fA-F0-9]{64}$/.test(env.DATA_ENCRYPTION_KEY??''),'SHARED_RESTORE_KEYS');
 const createRedis=options.createRedis??(async(url:string)=>{const {Redis}=await import('ioredis');return new Redis(url,{lazyConnect:true,enableOfflineQueue:false,maxRetriesPerRequest:1,connectTimeout:5000,retryStrategy:()=>null});});
 const redis=await createRedis(env.REDIS_URL!);redis.on('error',()=>{});
 try {
  await redis.connect();databasePolicy(await redis.dbsize()===0,'SHARED_RESTORE_CACHE');
  const checked=await verifyCandidateData(db,{dataKey:env.DATA_ENCRYPTION_KEY!,authSecret});
  await revokeAllAccountSessions(db,redis);
  // A fresh candidate can discard every recovered ephemeral verification,
  // including obsolete/unknown challenge formats from historical releases.
  await db.verification.deleteMany({});
  databasePolicy(await db.session.count()===0&&await db.verification.count()===0&&await redis.dbsize()===0,'SHARED_RESTORE_REVOCATION');
  return {automatedOfflineVerified:true,...checked,sessionsRemaining:0,verificationsRemaining:0};
 }finally{redis.disconnect();}
}
