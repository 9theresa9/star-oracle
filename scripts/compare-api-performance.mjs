import assert from 'node:assert/strict';
import { cp,mkdir,readFile,writeFile,rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const root=process.cwd(),baseline=resolve(process.env.PERFORMANCE_BASELINE_DIR??'');
const database=new URL(process.env.DATABASE_URL??'mysql://invalid');
if(process.env.CI!=='true'||process.env.NODE_ENV!=='test'||database.pathname!=='/star_oracle'||!['localhost','127.0.0.1','[::1]'].includes(database.hostname)||baseline===root)throw new Error('This comparison is only for an independent baseline and isolated CI database.');
const reportDir=resolve(root,'performance-results');await mkdir(reportDir,{recursive:true});
const fixture=resolve(process.env.RUNNER_TEMP??root,'oracle-performance-fixture.json');
const counters=['sqlQueries','decryptions','payloadSelects','interpretationSelects','inputSnapshotSelects'];
const sources=[];
for(const repository of [baseline,root]){
 const destination=resolve(repository,'apps/api/.performance-src');
 await cp(resolve(repository,'apps/api/src'),destination,{recursive:true});sources.push(destination);
 const file=resolve(destination,'infrastructure.ts'),original=await readFile(file,'utf8');
 const marker='export const db = new PrismaClient({log:[]});';
 assert.ok(original.includes(marker),'Expected a logger-free production client');
 assert.ok(original.includes("export function open(value:string,context=''):string {"),'Expected decrypt helper');
 const declaration='export const performanceCounters={'+counters.map(key=>key+':0').join(',')+'};\n';
 const instrumented=original.replace(marker,declaration+
  "export const db = new PrismaClient({log:[{emit:'event',level:'query'}]});\n"+
  "db.$on('query',event=>{performanceCounters.sqlQueries++;if(/^SELECT/i.test(event.query.trim())){if(event.query.includes('payload'))performanceCounters.payloadSelects++;if(event.query.includes('interpretation'))performanceCounters.interpretationSelects++;if(event.query.includes('inputCipher'))performanceCounters.inputSnapshotSelects++;}});")
  .replace("export function open(value:string,context=''):string {","export function open(value:string,context=''):string {\n performanceCounters.decryptions++;");
 await writeFile(file,instrumented);
}
function child(repository,source,mode,file){
 const output=execFileSync(process.execPath,['--import',resolve(repository,'node_modules/tsx/dist/loader.mjs'),resolve(root,'scripts/benchmark-api.ts'),mode],{
  cwd:repository,encoding:'utf8',stdio:['ignore','pipe','pipe'],
  env:{...process.env,PERF_API_SOURCE:source,PERF_FIXTURE_FILE:fixture,PERF_RESULT_FILE:file}
 });
 if(output.trim())console.log(output.trim());
}
let seeded=false;
try{
 child(root,sources[1],'seed');seeded=true;
 for(const [index,variant] of ['before','after'].entries())child(index===0?baseline:root,sources[index],variant,resolve(reportDir,'api-'+variant+'.json'));
 const before=JSON.parse(await readFile(resolve(reportDir,'api-before.json'),'utf8'));
 const after=JSON.parse(await readFile(resolve(reportDir,'api-after.json'),'utf8'));
 assert.equal(before.fixtureRows,after.fixtureRows);
 const comparison=[];
 for(const current of after.results){
  const old=before.results.find(value=>value.name===current.name);assert.ok(old);
  assert.equal(current.digest,old.digest,'Same response under identical fixture: '+current.name);
  comparison.push({name:current.name,before:Object.fromEntries([...counters,'medianMs'].map(key=>[key,old[key]])),after:Object.fromEntries([...counters,'medianMs'].map(key=>[key,current[key]]))});
 }
 const find=name=>comparison.find(item=>item.name===name);
 assert.equal(find('personal-insights').before.sqlQueries,5);assert.equal(find('personal-insights').after.sqlQueries,3);
 assert.equal(find('admin-statistics').before.sqlQueries,6);assert.equal(find('admin-statistics').after.sqlQueries,5);
 assert.equal(find('readings-list').before.sqlQueries,find('readings-list').after.sqlQueries,'Ordinary listing does not add SQL');
 assert.ok(find('search-sparse-first-page').after.sqlQueries<find('search-sparse-first-page').before.sqlQueries);
 assert.ok(find('search-sparse-first-page').after.decryptions<find('search-sparse-first-page').before.decryptions);
 assert.equal(find('search-sparse-first-page').after.payloadSelects,0);
 assert.equal(find('search-sparse-first-page').after.interpretationSelects,0);
 assert.equal(find('reports-list').after.inputSnapshotSelects,0);
 assert.ok(find('reading-metadata').after.sqlQueries<find('reading-metadata').before.sqlQueries);
 const report={baseline:'a639057e9884efb53fb712d7a41b0d16e8cbf0c3',fixtureRows:before.fixtureRows,sameSchemaForBothVariants:true,
  latencyNote:'Medians are local CI observations, not production speed guarantees or a measured isolated index effect.',comparison};
 await writeFile(resolve(reportDir,'api-comparison.json'),JSON.stringify(report,null,2));
 console.log('API_PERFORMANCE_COMPARISON '+JSON.stringify(report));
}finally{
 if(seeded)child(root,sources[1],'cleanup');
 for(const source of sources)await rm(source,{recursive:true,force:true});
 await rm(fixture,{force:true});
}
