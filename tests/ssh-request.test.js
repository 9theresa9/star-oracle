import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'tsx/esm/api';
register();
const {sshRequestAllowed}=await import('../apps/api/src/ssh-transport.ts');
const transport=await import('../apps/api/src/ssh-transport.ts');
const request=(overrides={})=>({headers:{host:'localhost:17777'},rawHeaders:['Host','localhost:17777'],socket:{remoteAddress:'127.0.0.1'},url:'/api/v1/config',method:'GET',...overrides});
test('native SSH API admits only actual IPv4 loopback peers with the exact host',()=>{
 assert.equal(sshRequestAllowed(request(),false),true);
 for(const remoteAddress of ['192.168.1.2','172.30.77.3','::1','::ffff:127.0.0.1','127.0.0.2',undefined])assert.equal(sshRequestAllowed(request({socket:{remoteAddress}}),false),false);
 for(const host of ['LOCALHOST:17777','localhost.:17777','127.0.0.1:17777','[::1]:17777','localhost','localhost:17778','localhost:17777,evil.test','evil.test'])assert.equal(sshRequestAllowed(request({headers:{host},rawHeaders:['Host',host]}),false),false);
});
test('SSH API rejects duplicate host, absolute-form targets and even empty proxy headers',()=>{
 assert.equal(sshRequestAllowed(request({rawHeaders:['Host','localhost:17777','hOsT','localhost:17777']}),false),false);
 for(const name of ['Forwarded','X-Forwarded-For','X-Forwarded-Host','X-Forwarded-Proto','X-Forwarded-Port','X-Forwarded-Weird','X-Real-IP'])assert.equal(sshRequestAllowed(request({headers:{host:'localhost:17777',[name.toLowerCase()]:''},rawHeaders:['Host','localhost:17777',name,'']}),false),false,name);
 for(const url of ['http://localhost:17777/api/v1/config','//evil.test/api','*',undefined])assert.equal(sshRequestAllowed(request({url}),false),false);
});
test('container SSH API admits the dedicated web peer and only its own exact health probe',()=>{
 assert.equal(sshRequestAllowed(request({socket:{remoteAddress:'172.30.77.3'}}),true),true);
 assert.equal(sshRequestAllowed(request(),true),false);
 for(const method of ['GET','HEAD'])assert.equal(sshRequestAllowed(request({url:'/api/v1/health',method}),true),true);
 for(const url of ['/api/v1/health?x=1','/api/v1/health/','/api/auth/get-session'])assert.equal(sshRequestAllowed(request({url}),true),false);
 assert.equal(sshRequestAllowed(request({url:'/api/v1/health',method:'POST'}),true),false);
 for(const remoteAddress of ['172.30.77.1','172.30.77.4','172.30.0.3','::ffff:172.30.77.3','10.0.0.1'])assert.equal(sshRequestAllowed(request({socket:{remoteAddress}}),true),false);
});
test('container listener requires actual container interfaces before binding all addresses',()=>{
 assert.equal(typeof transport.assertSshContainerBoundary,'function','startup must verify the actual network before honoring the container option');
 const interfaces={lo:[{address:'127.0.0.1',family:'IPv4',internal:true}],eth0:[{address:'172.30.77.2',family:'IPv4',internal:false}],eth1:[{address:'172.30.78.2',family:'IPv4',internal:false}]};
 assert.doesNotThrow(()=>transport.assertSshContainerBoundary(true,interfaces));
 assert.throws(()=>transport.assertSshContainerBoundary(false,interfaces));
 for(const changed of [{lo:interfaces.lo},{...interfaces,eth1:[]},{...interfaces,eth2:[{address:'192.168.1.2',family:'IPv4',internal:false}]},{...interfaces,eth2:[{address:'::ffff:172.30.77.2',family:'IPv6',internal:false}]}])assert.throws(()=>transport.assertSshContainerBoundary(true,changed));
});
