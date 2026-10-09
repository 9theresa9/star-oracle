import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';

const modulePath=resolve('scripts/ssh-shared-release.mjs');
const implementation=()=>import(modulePath);
const imageTags=['star-oracle-api:local','star-oracle-web:local','redis:7.4','star-oracle-mysql-client:local'];
const images=imageTags.map((tag,i)=>({tag,id:'sha256:'+String(i+1).repeat(64),platform:'linux/amd64',repoDigests:[]}));
const commit='a'.repeat(40),sourceTree='b'.repeat(40);
function fixture(t,api){
 const root=mkdtempSync(join(tmpdir(),'shared-release-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 for(const file of api.RELEASE_FILES){mkdirSync(resolve(root,file,'..'),{recursive:true});writeFileSync(join(root,file),'Synthetic '+file);}
 writeFileSync(join(root,'images.tar.gz'),'synthetic archive');
 const proof={format:1,profile:'ssh-shared',status:'passed',commit,sourceTree,images,engineVersion:'28.5.2',composeVersion:'2.39.4',checks:[...api.REQUIRED_CHECKS]};
 return {root,proof,build:(changes={})=>api.makeSharedManifest({root,images,commit,sourceTree,verification:proof,...changes})};
}
function save(root,manifest){writeFileSync(join(root,'ssh-shared-manifest.json'),JSON.stringify(manifest));}

test('shared release has only the four tested images, exact source and Docker 28 proof',async t=>{
 const api=await implementation(),f=fixture(t,api),manifest=f.build();save(f.root,manifest);
 assert.deepEqual(manifest.images.map(i=>i.tag),imageTags);
 assert.equal(api.readSharedManifest(f.root).sourceTree,sourceTree);
 for(const change of [p=>p.engineVersion='20.10.24',p=>p.engineVersion='28.0.0-rc.1',p=>delete p.composeVersion,p=>p.profile='ssh-only',p=>p.commit='c'.repeat(40),p=>p.sourceTree='c'.repeat(40),p=>p.status='failed',p=>p.checks.pop(),p=>p.images[0].id='sha256:'+'e'.repeat(64)]){
  const proof=structuredClone(f.proof);change(proof);assert.throws(()=>f.build({verification:proof}),/Shared release/);
 }
 for(const altered of [[...images,{tag:'mysql:8.4',id:'sha256:'+'e'.repeat(64),platform:'linux/amd64'}],images.map((i,n)=>n===3?{...i,tag:'mysql:8.4'}:i),images.map((i,n)=>n===3?{...i,platform:'linux/arm64'}:i)])assert.throws(()=>f.build({images:altered}),/Shared release/);
});

test('shared release fails closed on omitted files, path escapes, symlinks and tampering',async t=>{
 const api=await implementation(),f=fixture(t,api),manifest=f.build();
 for(const mutate of [m=>delete m.files['scripts/ssh-shared-policy.mjs'],m=>m.files['../outside']='c'.repeat(64),m=>m.files['extra.env']='c'.repeat(64),m=>delete m.verification,m=>m.images[3].tag='mysql:8.4']){
  const changed=structuredClone(manifest);mutate(changed);save(f.root,changed);assert.throws(()=>api.readSharedManifest(f.root),/Shared release/);
 }
 save(f.root,manifest);writeFileSync(join(f.root,'compose.ssh-shared.yml'),'drift');assert.throws(()=>api.readSharedManifest(f.root),/checksum/);
 writeFileSync(join(f.root,'compose.ssh-shared.yml'),'Synthetic compose.ssh-shared.yml');
 const target=join(f.root,'scripts/ssh-shared-deploy.mjs');const content=readFileSync(target);rmSync(target);writeFileSync(join(f.root,'outside'),content);symlinkSync(join(f.root,'outside'),target);assert.throws(()=>api.readSharedManifest(f.root),/regular|symlink/);
});

function tar(entries){
 const parts=[];
 for(const [name,data] of entries){const value=Buffer.from(data),header=Buffer.alloc(512);header.write(name);header.write('0000600\0',100);header.write('0000000\0',108);header.write('0000000\0',116);header.write(value.length.toString(8).padStart(11,'0')+'\0',124);header.write('00000000000\0',136);header.fill(32,148,156);header[156]=48;header.write('ustar\0',257);header.write('00',263);header.write([...header].reduce((a,b)=>a+b,0).toString(8).padStart(6,'0')+'\0 ',148);parts.push(header,value,Buffer.alloc((512-value.length%512)%512));}
 return gzipSync(Buffer.concat([...parts,Buffer.alloc(1024)]));
}
function archiveFixture(t){
 const root=mkdtempSync(join(tmpdir(),'shared-tar-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const configs=imageTags.map((tag,n)=>Buffer.from(JSON.stringify({architecture:'amd64',os:'linux',config:{Labels:{fixture:String(n)}}})));
 const inventory=imageTags.map((tag,n)=>({tag,id:'sha256:'+createHash('sha256').update(configs[n]).digest('hex'),platform:'linux/amd64'}));
 const records=inventory.map(i=>({Config:i.id.slice(7)+'.json',RepoTags:[i.tag],Layers:[]}));
 const entries=records.map((r,n)=>[r.Config,configs[n]]);return {path:join(root,'images.tar.gz'),inventory,records,entries};
}
test('loader validates the archive inventory and config hashes before any Docker load',async t=>{
 const api=await implementation(),f=archiveFixture(t);
 writeFileSync(f.path,tar([...f.entries,['manifest.json',JSON.stringify(f.records)]]));
 await assert.doesNotReject(()=>api.validateImageArchive(f.path,f.inventory));
 for(const records of [[...f.records,{...f.records[0],RepoTags:['mysql:8.4']}],f.records.map((r,n)=>n===3?{...r,RepoTags:['mysql:8.4']}:r),f.records.map((r,n)=>n===0?{...r,Config:'../config.json'}:r)]){
  writeFileSync(f.path,tar([...f.entries,['manifest.json',JSON.stringify(records)]]));await assert.rejects(()=>api.validateImageArchive(f.path,f.inventory),/Shared release/);
 }
 writeFileSync(f.path,tar([...f.entries.map((e,n)=>n===0?[e[0],'tampered']:e),['manifest.json',JSON.stringify(f.records)]]));await assert.rejects(()=>api.validateImageArchive(f.path,f.inventory),/Shared release/);
 writeFileSync(f.path,Buffer.from('bad gzip'));await assert.rejects(()=>api.validateImageArchive(f.path,f.inventory),/Shared release/);
});

test('archive corruption or foreign host platform is rejected before a loader starts',async t=>{
 const api=await implementation(),f=fixture(t,api);save(f.root,f.build());let spawned=false;
 await assert.rejects(()=>api.loadSharedRelease(f.root,{run:args=>args.includes('version')?'28.5.2':'linux/arm64',spawn:()=>{spawned=true;throw new Error('should not spawn');}}),/platform/);assert.equal(spawned,false);
 await assert.rejects(()=>api.loadSharedRelease(f.root,{run:args=>args.includes('version')?'28.5.2':'linux/amd64',spawn:()=>{spawned=true;throw new Error('should not spawn');}}),/archive/);assert.equal(spawned,false);
});

test('synthetic smoke refuses external lifecycle and records original container state',async()=>{
 const {guardExternalLifecycle,externalFingerprint}=await import('../scripts/ssh-shared-smoke.mjs');
 const id='9'.repeat(64),name='star-oracle-shared-fixture-mysql';let calls=0;const run=guardExternalLifecycle(()=>{calls++;return '';},id,name);
 for(const args of [['stop',id],['start',name],['rm','-f',id],['network','connect','backend',id],['network','disconnect','backend',name],['container','update','--memory','1g',id],['restart',id]])assert.throws(()=>run(args),/external/);
 run(['inspect',id]);assert.equal(calls,1);
 const c={Id:id,Image:'sha256:fixture',State:{StartedAt:'fixed',Running:true},RestartCount:0,HostConfig:{Memory:123},Mounts:[{Source:'fixture',Destination:'/var/lib/mysql'}],NetworkSettings:{Networks:{original:{NetworkID:'network',IPAddress:'172.30.79.4'},'star-oracle-shared-backend':{IPAddress:'172.30.78.4'}}}};
 const before=externalFingerprint(c);assert.equal(before,externalFingerprint({...c,State:{...c.State,Health:{Status:'healthy'}}}));
 assert.notEqual(before,externalFingerprint({...c,RestartCount:1}));assert.notEqual(before,externalFingerprint({...c,State:{...c.State,StartedAt:'restarted'}}));
 assert.notEqual(before,externalFingerprint({...c,HostConfig:{Memory:321}}));
});

test('OCI sidecar cannot smuggle a second inventory behind a valid Docker manifest',async t=>{
 const api=await implementation(),f=archiveFixture(t);
 const index={schemaVersion:2,manifests:f.inventory.map(i=>({mediaType:'application/vnd.oci.image.manifest.v1+json',digest:'sha256:'+'e'.repeat(64),annotations:{'io.containerd.image.name':i.tag}}))};
 writeFileSync(f.path,tar([...f.entries,['manifest.json',JSON.stringify(f.records)],['index.json',JSON.stringify(index)]]));
 await assert.rejects(()=>api.validateImageArchive(f.path,f.inventory),/Shared release/);
});

test('the validated loader accepts Docker OCI image-save archives with matching descriptors',async t=>{
 const api=await implementation(),f=archiveFixture(t);
 const entries=f.entries.map(([name,body])=>['blobs/sha256/'+name.slice(0,-5),body]);
 const records=f.records.map(r=>({...r,Config:'blobs/sha256/'+r.Config.slice(0,-5)}));
 const descriptors=f.inventory.map(image=>{
  const body=Buffer.from(JSON.stringify({schemaVersion:2,mediaType:'application/vnd.oci.image.manifest.v1+json',config:{mediaType:'application/vnd.oci.image.config.v1+json',digest:image.id,size:entries.find(([name])=>name.endsWith(image.id.slice(7)))[1].length},layers:[]}));
  const digest='sha256:'+createHash('sha256').update(body).digest('hex');entries.push(['blobs/sha256/'+digest.slice(7),body]);return {mediaType:'application/vnd.oci.image.manifest.v1+json',digest,size:body.length,annotations:{'io.containerd.image.name':'docker.io/library/'+image.tag}};
 });
 writeFileSync(f.path,tar([...entries,['manifest.json',JSON.stringify(records)],['index.json',JSON.stringify({schemaVersion:2,manifests:descriptors})]]));
 await assert.doesNotReject(()=>api.validateImageArchive(f.path,f.inventory));
});
