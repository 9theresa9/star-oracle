import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
const identityURL=pathToFileURL(process.cwd()+'/apps/web/src/lib/session-identity.ts').href;
const {identityBoundary}=await import(identityURL);
// Compile the production client with only its build-time origin substituted.
// Every fetch below is in-process, so no browser, cookies or outside service is used.
const originalWindow=globalThis.window;
globalThis.window={location:{origin:'https://synthetic.invalid'},dispatchEvent(){}};
const source=readFileSync('apps/web/src/lib/api.ts','utf8').replace("'./session-identity'",JSON.stringify(identityURL)).replace('import.meta.env.VITE_API_ORIGIN','undefined');
const compiled=ts.transpile(source,{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext});
const {api}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
const headers={'X-Actor-Id':'A','X-Session-Binding':'session-A','Content-Type':'application/json'};
function owner(){identityBoundary.revoke();identityBoundary.verify({id:'A',sessionBinding:'session-A'});}
test.after(()=>{globalThis.window=originalWindow;});
test('truncated HTTP 200 stays an unknown outcome instead of clearing an AI draft',async(t)=>{
 owner();t.mock.method(globalThis,'fetch',async()=>new Response('{"id":',{status:200,headers}));
 await assert.rejects(api('/readings/fixture/conversation',{method:'POST',body:'{}'}),e=>e.code==='UNKNOWN_OUTCOME');
});
test('private request binds actor and session and only returns valid matching JSON',async(t)=>{
 owner();t.mock.method(globalThis,'fetch',async(_url,options)=>{assert.equal(options.headers.get('X-Expected-Actor'),'A');assert.equal(options.headers.get('X-Expected-Session'),'session-A');return new Response('{"ok":true}',{headers});});
 assert.deepEqual(await api('/readings'),{ok:true});
});
test('a malformed 401 still revokes the verified identity',async(t)=>{
 owner();t.mock.method(globalThis,'fetch',async()=>new Response('truncated',{status:401}));await assert.rejects(api('/readings'),/账户/);assert.equal(identityBoundary.snapshot().verified,false);
});
test('an actor conflict without intact JSON cannot leave the old identity active',async(t)=>{
 owner();t.mock.method(globalThis,'fetch',async()=>new Response('{',{status:409}));await assert.rejects(api('/readings'),/账户/);assert.equal(identityBoundary.snapshot().verified,false);
});
test('a late private response cannot enter a new identity generation',async(t)=>{
 owner();let finish;const result=new Promise(resolve=>{finish=resolve;});let signal;
 t.mock.method(globalThis,'fetch',async(_url,options)=>{signal=options.signal;return result;});const pending=api('/readings');identityBoundary.verify({id:'B',sessionBinding:'session-B'});finish(new Response('{"private":"old"}',{headers}));await assert.rejects(pending,/账户/);assert.equal(signal.aborted,true);
});
