import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createAppServer } from '../server/index.js';
import { createAPIHandler, aiConfig, buildAIMessages, interpretWithAI } from '../server/api.js';
import { basicInterpretation } from '../shared/engine.js';
const reading = { version:1, id:'fixed-reading-123', createdAt:'2026-10-02T00:00:00Z',
  question:'面对新机会，我需要留意什么？', kind:'tarot', spread:'single', cards:[{id:'major-star',reversed:false}] };
const env = { AI_API_KEY:'test-key-not-a-real-secret', AI_MODEL:'test-model', AI_BASE_URL:'https://model.example/v1' };
const req = (body = {reading}, headers = {}, method = 'POST') => new Request('https://oracle.example/api/interpret', {
  method, headers:{'content-type':'application/json',...headers}, ...(method === 'POST' ? {body:JSON.stringify(body)} : {}) });
const goodFetch = async () => new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(basicInterpretation(reading))}}]}));
test('AI accepts only a server-configured HTTPS endpoint', () => {
  assert.equal(aiConfig({}).enabled,false); assert.equal(aiConfig(env).enabled,true);
  assert.equal(aiConfig({...env,AI_BASE_URL:'http://localhost:3000'}).enabled,false);
  assert.equal(aiConfig({...env,AI_BASE_URL:'https://user:pass@model.example'}).enabled,false);
});
test('a follow-up keeps exactly the same evidence and question', () => {
  const before=structuredClone(reading), messages=buildAIMessages({reading,followUp:'我该从哪里开始？'});
  const facts=JSON.parse(messages[1].content);
  assert.equal(facts.fixedEvidence[0].reference,'major-star');
  assert.equal(facts.latestFollowUp,'我该从哪里开始？'); assert.deepEqual(reading,before);
});
test('unconfigured AI never calls a provider', async () => {
  let called=false; const api=createAPIHandler({fetchImpl:async()=>{called=true;}});
  const response=await api(req(),{}); assert.equal(response.status,503);
  assert.equal((await response.json()).code,'AI_NOT_CONFIGURED'); assert.equal(called,false);
});
test('valid output retains the original reading ID', async () => {
  const response=await createAPIHandler({fetchImpl:goodFetch})(req(),env,'client'), data=await response.json();
  assert.equal(response.status,200); assert.equal(data.readingId,reading.id); assert.equal(data.source,'ai');
});
test('invalid output, provider failures and timeouts have explicit errors', async () => {
  for (const [fetchImpl,code,status] of [
    [async()=>new Response('bad'),'AI_INVALID_RESPONSE',502],
    [async()=>new Response('denied',{status:401}),'AI_UNAVAILABLE',502],
    [async()=>{throw new DOMException('timeout','TimeoutError');},'AI_TIMEOUT',504]]) {
    const response=await createAPIHandler({fetchImpl})(req(),env);
    assert.equal(response.status,status); assert.equal((await response.json()).code,code);
  }
  const bogus=basicInterpretation(reading); bogus.insights[0].reference='major-devil';
  await assert.rejects(()=>interpretWithAI({reading},aiConfig(env),async()=>new Response(JSON.stringify({
    choices:[{message:{content:JSON.stringify(bogus)}}]}))),/未通过检查/);
});
test('invalid bodies, cross-origin requests and methods are rejected', async () => {
  const api=createAPIHandler({fetchImpl:goodFetch});
  assert.equal((await api(req({reading:{...reading,cards:[{id:'fake',reversed:false}]}}),env)).status,400);
  assert.equal((await api(req({reading},{origin:'https://other.example'}),env)).status,403);
  assert.equal((await api(req({reading},{'content-type':'text/plain'}),env)).status,415);
  assert.equal((await api(req({text:'x'.repeat(25000)}),env)).status,413);
  assert.equal((await api(req(undefined,{},'GET'),env)).status,405);
});
test('per-client rate limits reject the seventh request and reset after one minute', async () => {
  let clock=0; const api=createAPIHandler({fetchImpl:goodFetch,now:()=>clock});
  for(let i=0;i<6;i++) assert.equal((await api(req(),env,'one')).status,200);
  assert.equal((await api(req(),env,'one')).status,429); assert.equal((await api(req(),env,'two')).status,200);
  clock=60001; assert.equal((await api(req(),env,'one')).status,200);
});
test('Node serves app modules, hides secrets and reports AI availability', async t => {
  const server=createAppServer({env:{}}); server.listen(0,'127.0.0.1'); await once(server,'listening');
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base='http://127.0.0.1:'+server.address().port;
  const page=await fetch(base); assert.equal(page.status,200); assert.match(await page.text(),/照见/);
  assert.match(page.headers.get('content-security-policy'),/script-src 'self'/);
  for(const path of ['/shared/engine.js','/styles.css']) assert.equal((await fetch(base+path)).status,200);
  for(const path of ['/.env','/server/api.js','/%2e%2e%2f.env']) assert.equal((await fetch(base+path)).status,404);
  assert.deepEqual(await (await fetch(base+'/api/config')).json(),{aiEnabled:false});
  const response=await fetch(base+'/api/interpret',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({reading})});
  assert.equal(response.status,503);
});
