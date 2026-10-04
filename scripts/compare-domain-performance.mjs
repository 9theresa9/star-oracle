import assert from 'node:assert/strict';
import { readFile,writeFile,unlink,mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

assert.equal(process.env.CI,'true','Domain comparison runs in CI');
const baseline=resolve(process.env.PERFORMANCE_BASELINE_DIR??'');
assert.notEqual(baseline,process.cwd(),'Use an independent baseline');
const temporary=[],results=[],originalFormatter=Intl.DateTimeFormat;
try{
 for(const [index,repository] of [baseline,process.cwd()].entries()){
  const folder=resolve(repository,'packages/domain'),file=resolve(folder,'.performance-engine.mjs');
  const source=await readFile(resolve(folder,'engine.js'),'utf8');
  const marker='export function analyseLines(lines) {';
  assert.ok(source.includes(marker),'Expected public line analysis');
  await writeFile(file,'export let analysisPerformanceCalls=0;\n'+source.replace(marker,marker+'\n analysisPerformanceCalls++;'));temporary.push(file);
  const engine=await import(pathToFileURL(file).href);
  const outputs=[];
  for(let mask=0;mask<64;mask++)for(const mode of ['stable','first-moving','all-moving']){
   const lines=Array.from({length:6},(_,line)=>{
    const yang=(mask>>line)&1,moving=mode==='all-moving'||(mode==='first-moving'&&line===0);
    return yang?(moving?9:7):(moving?6:8);
   });
   outputs.push(engine.basicInterpretation({version:1,id:'domain-perf-'+mask,createdAt:'2026-01-01T00:00:00Z',question:'如何整理目前的处境？',kind:'iching',method:'coins',lines}));
  }
  const analysisCalls=engine.analysisPerformanceCalls;
  let formatterCalls=0;
  Intl.DateTimeFormat=class extends originalFormatter{constructor(...options){super(...options);formatterCalls++;}};
  const casts=[],zones=['Asia/Shanghai','UTC','America/New_York','Europe/London','Asia/Tokyo'];
  for(let call=0;call<60;call++)casts.push(engine.castTimeLines(call%2?'2026-02-28T23:30:00Z':'2026-06-01T03:15:00Z',zones[call%zones.length]));
  Intl.DateTimeFormat=originalFormatter;
  results.push({variant:index?'after':'before',readings:outputs.length,analysisCalls,formatterCalls,
   interpretationDigest:createHash('sha256').update(JSON.stringify(outputs)).digest('hex'),
   timeCastingDigest:createHash('sha256').update(JSON.stringify(casts)).digest('hex')});
 }
 const [before,after]=results;
 assert.equal(before.interpretationDigest,after.interpretationDigest,'All 64 hexagrams and moving patterns return the same interpretation');
 assert.equal(before.timeCastingDigest,after.timeCastingDigest,'Repeated timestamps and time zones remain independent');
 assert.equal(before.analysisCalls,before.readings*4);assert.equal(after.analysisCalls,after.readings);
 assert.equal(before.formatterCalls,60);assert.equal(after.formatterCalls,5);
 const report={baseline:'a639057e9884efb53fb712d7a41b0d16e8cbf0c3',before,after};
 await mkdir('performance-results',{recursive:true});
 await writeFile('performance-results/domain-comparison.json',JSON.stringify(report,null,2));
 console.log('DOMAIN_PERFORMANCE_COMPARISON '+JSON.stringify(report));
}finally{
 Intl.DateTimeFormat=originalFormatter;
 for(const file of temporary)await unlink(file).catch(()=>{});
}
