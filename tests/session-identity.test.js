import test from 'node:test';
import assert from 'node:assert/strict';
// These state-machine tests exercise the same boundary used by the real API client.
const {createIdentityBoundary}=await import('../apps/web/src/lib/session-identity.ts');
test('identity change aborts pending private requests and rejects late owner data',()=>{
 const boundary=createIdentityBoundary();
 boundary.verify({id:'account-A',sessionBinding:'session-A'});
 const first=boundary.capture(),controller=new AbortController();
 boundary.track(first,controller);
 boundary.revoke();
 assert.equal(controller.signal.aborted,true);
 assert.throws(()=>boundary.assert(first),/账户/);
 boundary.verify({id:'account-B',sessionBinding:'session-B'});
 assert.throws(()=>boundary.assert(first),/账户/);
 assert.equal(boundary.capture().id,'account-B');
});
test('same account with a new session never revives an old generation',()=>{
 const boundary=createIdentityBoundary();boundary.verify({id:'A',sessionBinding:'old'});
 const old=boundary.capture();boundary.verify({id:'A',sessionBinding:'new'});
 assert.throws(()=>boundary.assert(old),/账户/);
 const fresh=boundary.capture();boundary.verify({id:'A',sessionBinding:'new'});
 assert.doesNotThrow(()=>boundary.assert(fresh));
});
test('unknown and guest identities cannot send private requests',()=>{
 const boundary=createIdentityBoundary();assert.throws(()=>boundary.capture(),/账户/);
 boundary.verify(null);assert.throws(()=>boundary.capture(),/账户/);
});
test('revocation notifies subscribers before any new verified identity',()=>{
 const boundary=createIdentityBoundary(),seen=[];boundary.subscribe(()=>seen.push(boundary.snapshot()));
 boundary.verify({id:'A',sessionBinding:'one'});boundary.revoke();boundary.verify({id:'B',sessionBinding:'two'});
 assert.deepEqual(seen.map(x=>x.identity?.id??null),['A',null,'B']);
 assert.ok(seen[1].generation>seen[0].generation);
});
test('late security enrollment cannot return secrets into a changed account',async()=>{
 const boundary=createIdentityBoundary();boundary.verify({id:'A',sessionBinding:'one'});const owner=boundary.capture(),controller=new AbortController();boundary.track(owner,controller);
 let finish;const pending=new Promise(resolve=>{finish=resolve;}).then(value=>{boundary.assert(owner);return value;});
 boundary.verify({id:'B',sessionBinding:'two'});finish({totpURI:'synthetic-old-account',backupCodes:['synthetic-only']});
 await assert.rejects(pending,/账户/);assert.equal(controller.signal.aborted,true);
});
test('first session confirmation keeps the neutral initial generation, later switches revoke it',()=>{
 const boundary=createIdentityBoundary(),initial=boundary.snapshot().generation;
 boundary.verify({id:'initial-owner',sessionBinding:'first'});assert.equal(boundary.snapshot().generation,initial);
 const owner=boundary.capture();boundary.verify({id:'other-owner',sessionBinding:'second'});assert.throws(()=>boundary.assert(owner),/账户/);
});
test('verified guest to account and same account new session each revoke previous generations',()=>{
 const boundary=createIdentityBoundary();boundary.verify(null);const guest=boundary.snapshot().generation;boundary.verify({id:'A',sessionBinding:'one'});assert.ok(boundary.snapshot().generation>guest);const signed=boundary.capture();boundary.verify({id:'A',sessionBinding:'one'});assert.doesNotThrow(()=>boundary.assert(signed));boundary.verify({id:'A',sessionBinding:'two'});assert.throws(()=>boundary.assert(signed),/账户/);
});
