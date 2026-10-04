import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID,createHash } from 'node:crypto';
import { readFile,writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setImmediate } from 'node:timers/promises';

const database=new URL(process.env.DATABASE_URL??'mysql://invalid');
if(process.env.CI!=='true'||process.env.NODE_ENV!=='test'||database.pathname!=='/star_oracle'||!['localhost','127.0.0.1','[::1]'].includes(database.hostname))throw new Error('Performance fixtures require the isolated CI test database.');
const redisURL=new URL(process.env.REDIS_URL??'redis://invalid');
if(!['localhost','127.0.0.1','[::1]'].includes(redisURL.hostname))throw new Error('Performance fixtures require isolated Redis.');
const source=resolve(process.env.PERF_API_SOURCE!);
const infra=await import(pathToFileURL(resolve(source,'infrastructure.ts')).href);
const {db,redis,connectRedis,seal,chinaDate,performanceCounters}=infra;
await connectRedis();
const fixtureFile=resolve(process.env.PERF_FIXTURE_FILE!);
const mode=process.argv[2];
try {
 if(mode==='seed'){
  const owner=randomUUID(),other=randomUUID(),date=chinaDate(),createdAt=new Date(date+'T12:00:00+08:00');
  const domain=await import('@star-oracle/domain');
  await db.user.createMany({data:[owner,other].map(id=>({id,name:'Performance fixture',email:id+'@performance.invalid',emailVerified:true,createdAt}))});
  const rows=[];
  for(let index=0;index<651;index++){
   const id=randomUUID(),at=new Date(createdAt.getTime()-index*60000),question=index===650?'perf-sparse-target':'A controlled performance question';
   const common={version:1 as const,id,createdAt:at.toISOString(),question,scenario:'general' as const};
   const reading=index%2===0?{...common,kind:'tarot' as const,spread:'single' as const,cards:[{id:domain.TAROT_DECK[0].id,reversed:false}]}:{...common,kind:'iching' as const,method:'coins' as const,lines:[7,8,7,8,7,8]};
   const interpretation=domain.basicInterpretation(reading);
   rows.push({id,userId:owner,kind:reading.kind,question:seal(question,'question:'+owner+':'+id),payload:{...reading,question:''},
    interpretation:seal(JSON.stringify(interpretation),'interpretation:'+owner+':'+id),ai:true,
    tagsCipher:seal('["benchmark"]','reading-tags:'+owner+':'+id),annotation:seal('A controlled annotation','reading-note:'+owner+':'+id),
    requestId:randomUUID(),createdAt:at});
  }
  for(let index=0;index<rows.length;index+=100)await db.reading.createMany({data:rows.slice(index,index+100)});
  const month=date.slice(0,7),last=new Date(month+'-01T00:00:00Z');last.setUTCMonth(last.getUTCMonth()+1);last.setUTCDate(0);
  const daily=Array.from({length:last.getUTCDate()},(_,index)=>{
   const id=randomUUID(),day=month+'-'+String(index+1).padStart(2,'0');
   return {id,userId:owner,date:day,payload:{date:day,cardId:domain.TAROT_DECK[0].id},note:seal('Controlled diary fixture','journal:'+owner+':'+id),mood:index%3?domain.DAILY_MOODS[0].id:null};
  });
  await db.dailyEntry.createMany({data:daily});
  await db.actionPlan.createMany({data:Array.from({length:10},(_,index)=>{
   const id=randomUUID();return {id,userId:owner,titleCipher:seal('Controlled action','action-title:'+owner+':'+id),completedAt:index%2?createdAt:null};
  })});
  await db.reviewReport.createMany({data:Array.from({length:5},()=>{
   const id=randomUUID();return {id,userId:owner,period:'month',startDate:month+'-01',endDate:month+'-'+String(last.getUTCDate()),
    includeJournal:false,requestId:randomUUID(),status:'failed',inputCipher:seal('x'.repeat(12000),'review-input:'+owner+':'+id)};
  })});
  await writeFile(fixtureFile,JSON.stringify({owner,other,date,month,firstId:rows[0].id,rows:rows.length}));
  console.log('PERFORMANCE_FIXTURE_READY rows='+rows.length);
 } else {
  const fixture=JSON.parse(await readFile(fixtureFile,'utf8'));
  if(mode==='cleanup'){
   await db.auditLog.deleteMany({where:{actorId:{in:[fixture.owner,fixture.other]}}});
   await db.user.deleteMany({where:{id:{in:[fixture.owner,fixture.other]}}});
   console.log('PERFORMANCE_FIXTURE_REMOVED');
  }else{
   const [{OracleService},{PersonalService},{AdminService}]=await Promise.all(['oracle.service.ts','personal.service.ts','admin.service.ts'].map(file=>import(pathToFileURL(resolve(source,file)).href)));
   const oracle=new OracleService(),personal=new PersonalService(),admin=new AdminService();
   const sparse=await oracle.list(fixture.owner,{limit:20,q:'perf-sparse-target'});
   assert.equal(sparse.items.length,0);assert.ok(sparse.nextCursor);
   const canonical=(value:any):any=>{
    if(Array.isArray(value))return value.map(canonical);
    if(value&&typeof value==='object'){
     return Object.fromEntries(Object.keys(value).sort().map(key=>[key,key==='readingKinds'?[...value[key]].sort((a,b)=>a.kind.localeCompare(b.kind)).map(canonical):canonical(value[key])]));
    }return value;
   };
   const resetRow=()=>db.reading.update({where:{id:fixture.firstId},data:{shared:false,favorite:false,metadataVersion:0,
    tagsCipher:seal('["benchmark"]','reading-tags:'+fixture.owner+':'+fixture.firstId),annotation:seal('A controlled annotation','reading-note:'+fixture.owner+':'+fixture.firstId)}});
   await resetRow(); // Each variant starts from the same state after the previous mutation cases.
   const cases:{name:string;prepare?:()=>Promise<unknown>;run:()=>Promise<any>}[]=[
    {name:'personal-insights',run:()=>personal.insights(fixture.owner,'month',fixture.date)},
    {name:'personal-calendar',run:()=>personal.calendar(fixture.owner,fixture.month)},
    {name:'admin-statistics',run:()=>admin.statistics(30)},
    {name:'reports-list',run:()=>personal.reports(fixture.owner,{limit:20})},
    {name:'readings-list',run:()=>oracle.list(fixture.owner,{limit:20})},
    {name:'search-sparse-first-page',run:()=>oracle.list(fixture.owner,{limit:20,q:'perf-sparse-target'})},
    {name:'search-sparse-next-page',run:()=>oracle.list(fixture.owner,{limit:20,q:'perf-sparse-target',cursor:sparse.nextCursor})},
    {name:'reading-metadata',prepare:resetRow,run:()=>oracle.metadata(fixture.owner,fixture.firstId,{favorite:false,tags:['benchmark'],note:'A controlled annotation',version:0},randomUUID())},
    {name:'reading-share',prepare:resetRow,run:()=>oracle.share(fixture.owner,fixture.firstId,true,randomUUID())}
   ];
   const results=[];
   for(const benchmark of cases){
    const samples=[];
    for(let iteration=0;iteration<4;iteration++){
     if(benchmark.prepare)await benchmark.prepare();
     await setImmediate();
     for(const key of Object.keys(performanceCounters))performanceCounters[key]=0;
     const started=performance.now(),value=await benchmark.run(),durationMs=performance.now()-started;
     await setImmediate();
     if(benchmark.name==='search-sparse-next-page')assert.equal(value.items.length,1);
     if(iteration) samples.push({durationMs,...performanceCounters,digest:createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')});
    }
    assert.equal(new Set(samples.map(sample=>sample.digest)).size,1,'Stable fixture output: '+benchmark.name);
    const first=samples[0],latencies=samples.map(sample=>sample.durationMs).sort((a,b)=>a-b);
    for(const sample of samples)for(const key of Object.keys(performanceCounters))assert.equal(sample[key],first[key],'Stable measured count: '+benchmark.name+'/'+key);
    results.push({name:benchmark.name,...Object.fromEntries(Object.keys(performanceCounters).map(key=>[key,first[key]])),medianMs:Number(latencies[1].toFixed(3)),digest:first.digest});
   }
   await writeFile(process.env.PERF_RESULT_FILE!,JSON.stringify({variant:mode,fixtureRows:fixture.rows,sharedSchema:true,results},null,2));
   console.log('API_PERFORMANCE_COMPLETE '+mode+' cases='+results.length);
  }
 }
}finally{await db.$disconnect();redis.disconnect();}
