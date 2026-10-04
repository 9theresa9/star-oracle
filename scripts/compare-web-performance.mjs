import assert from 'node:assert/strict';
import { mkdir,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const baseline=process.env.PERFORMANCE_BASELINE_DIR;
const optimized=process.env.PERFORMANCE_WEB_DIST;
assert.ok(process.env.CI==='true'&&baseline&&optimized,'Use the isolated CI production builds');
const meter=resolve('scripts/measure-web-bundle.mjs');
function measure(directory){
 return JSON.parse(execFileSync(process.execPath,[meter,directory],{encoding:'utf8'}));
}
const before=measure(resolve(baseline,'apps/web/dist'));
const after=measure(resolve(optimized));
assert.ok(before.initial.js.gzipBytes>0,'Non-empty baseline static import closure');
assert.ok(after.initial.js.gzipBytes>0,'Non-empty optimized static import closure');
assert.ok(after.initial.js.gzipBytes<before.initial.js.gzipBytes,'Initial JS gzip must improve under the same production build');
const report={baseline:'a639057e9884efb53fb712d7a41b0d16e8cbf0c3',mode:'production',
 scope:'Homepage entry plus recursively reachable static imports; dynamic route chunks remain in totals.',
 before,after,initialJsGzipReductionPercent:Number(((1-after.initial.js.gzipBytes/before.initial.js.gzipBytes)*100).toFixed(2)),
 note:'Byte totals compare emitted assets. They are not network, rendering or AI response latency measurements.'};
await mkdir('performance-results',{recursive:true});
await writeFile('performance-results/web-comparison.json',JSON.stringify(report,null,2));
console.log('WEB_PERFORMANCE_COMPARISON '+JSON.stringify(report));
