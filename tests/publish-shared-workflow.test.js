import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';

const workflowPath=new URL('../.github/workflows/publish-shared-5028f27.yml',import.meta.url);
const workflow=()=>existsSync(workflowPath)?JSON.parse(readFileSync(workflowPath,'utf8')):null;
const archive='star-oracle-shared-linux-amd64-5028f27.zip';
const staged='${{ runner.temp }}/star-oracle-publish-5028f27/';
const context="github.repository == '9theresa9/star-oracle' && github.event_name == 'push' && github.ref == 'refs/heads/feat/luminous-oracle-experience'";

test('fixed release workflow accepts only a scoped trusted branch push with no inputs',()=>{
 const w=workflow();assert.ok(w,'fixed publisher workflow must exist');
 assert.deepEqual(w.on,{push:{branches:['feat/luminous-oracle-experience'],paths:['.github/workflows/publish-shared-5028f27.yml','scripts/publish-shared-5028f27.mjs','tests/publish-shared-5028f27.test.js','tests/publish-shared-workflow.test.js']}});
 assert.deepEqual(w.permissions,{});
 assert.deepEqual(w.concurrency,{group:'publish-shared-5028f27','cancel-in-progress':false});
 assert.deepEqual(Object.keys(w.jobs),['verify','publish']);
 for(const job of Object.values(w.jobs)){assert.equal(job.if,context);assert.equal(job['runs-on'],'ubuntu-24.04');assert.equal(job['timeout-minutes'],15);}
});

test('write permission exists only after a successful read-only verification job',()=>{
 const w=workflow();assert.ok(w);
 assert.deepEqual(w.jobs.verify.permissions,{contents:'read',actions:'read'});
 assert.deepEqual(w.jobs.publish.permissions,{contents:'write',actions:'read'});
 assert.equal(w.jobs.publish.needs,'verify');
 for(const [name,job] of Object.entries(w.jobs)){
  const commands=job.steps.filter(s=>s.run);
  assert.ok(commands.every(s=>!s.run.includes('npm')&&!s.run.includes('docker')));
  const publisher=commands.find(s=>s.run==='node scripts/publish-shared-5028f27.mjs '+name);
  assert.ok(publisher);assert.deepEqual(publisher.env,{GH_TOKEN:'${{ github.token }}'});
  assert.ok(job.steps.every(s=>!s.env||s===publisher),'token must be scoped to the fixed publisher step');
  assert.ok(job.steps.every(s=>!s.uses||/^[a-z-]+\/[a-z-]+@[a-f0-9]{40}$/.test(s.uses)));
  const checkout=job.steps.find(s=>s.uses?.startsWith('actions/checkout@'));
  assert.equal(checkout.with.ref,'${{ github.sha }}');assert.equal(checkout.with['persist-credentials'],false);
 }
});

test('cross-job transfer names exactly two inspected files and never uploads workspace globs',()=>{
 const w=workflow();assert.ok(w);
 const upload=w.jobs.verify.steps.find(s=>s.uses?.startsWith('actions/upload-artifact@'));
 assert.deepEqual(upload.with,{name:'approved-shared-5028f27',path:staged+archive+'\n'+staged+archive+'.sha256','compression-level':0,'retention-days':1,'if-no-files-found':'error'});
 const download=w.jobs.publish.steps.find(s=>s.uses?.startsWith('actions/download-artifact@'));
 assert.deepEqual(download.with,{name:'approved-shared-5028f27',path:staged.slice(0,-1),'digest-mismatch':'error'});
 const steps=w.jobs.publish.steps;
 assert.ok(steps.indexOf(download)<steps.findIndex(s=>s.run==='node scripts/publish-shared-5028f27.mjs publish'));
 assert.ok(!JSON.stringify(w).includes('secrets.'));
});
