#!/usr/bin/env node
/** Offline shared-MySQL release: exactly the tested API, Web, Redis and client. */
import {copyFileSync,readFileSync,mkdirSync,writeFileSync,existsSync,createWriteStream,createReadStream,lstatSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn,spawnSync} from 'node:child_process';
import {pipeline} from 'node:stream/promises';
import {createGzip,createGunzip} from 'node:zlib';
import {createHash} from 'node:crypto';
import {commandRunner,dockerEnvironment,fileSha256,validateEngine} from './ssh-deploy.mjs';

export const RELEASE_IMAGES=['star-oracle-api:local','star-oracle-web:local','redis:7.4','star-oracle-mysql-client:local'];
export const RELEASE_FILES=['compose.ssh-shared.yml','infra/nginx-ssh.conf','scripts/ssh-deploy.mjs','scripts/ssh-shared-policy.mjs','scripts/ssh-shared-deploy.mjs','scripts/ssh-shared-db.mjs','scripts/ssh-shared-backup.mjs','scripts/ssh-shared-restore.mjs','scripts/ssh-shared-release.mjs','apps/api/src/maintenance/shared-db-policy.ts','docs/SSH_SHARED_DEPLOYMENT.md','.env.ssh-shared.example','docs/examples/ssh-shared-input.example.json','docs/ACCOUNTS.md'];
export const REQUIRED_CHECKS=['external-lifecycle-records-unchanged','exact-role-identities-grants','cross-schema-denied','actual-loopback-ipv4-ipv6','edge-peer-private-isolation','authority-origin-forwarding','standing-memory-832mib','owned-volume-drift-rejected','exclusive-offline-maintenance','shared-stack-browser-sessions','encrypted-backup-candidate-restore','corrupt-backup-no-db-contact'];
const docker=['--host','unix:///var/run/docker.sock'];
const ensure=(condition,message)=>{if(!condition)throw new Error('Shared release: '+message);};
const sameImages=(a,b)=>Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&new Set(a.map(i=>i.tag)).size===a.length&&a.every(i=>b.some(j=>i.tag===j.tag&&i.id===j.id&&i.platform===j.platform));
function validateImages(images){
 ensure(Array.isArray(images)&&images.length===4&&new Set(images.map(i=>i.tag)).size===4&&images.every(i=>RELEASE_IMAGES.includes(i.tag)&&/^sha256:[a-f0-9]{64}$/.test(i.id)&&/^linux\/(amd64|arm64)$/.test(i.platform)),'invalid four-image inventory');
 ensure(new Set(images.map(i=>i.platform)).size===1,'images must use one native platform');
}
function validateProof(proof,{images,commit,sourceTree}){
 ensure(proof?.format===1&&proof.profile==='ssh-shared'&&proof.status==='passed'&&proof.commit===commit&&proof.sourceTree===sourceTree&&sameImages(proof.images,images),'successful proof must bind exact source and images');
 try{validateEngine(proof.engineVersion);}catch{throw new Error('Shared release: proof requires an actual stable Docker Engine >=28');}
 ensure(/^v?\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(proof.composeVersion??''),'proof requires actual Compose version');
 ensure(Array.isArray(proof.checks)&&REQUIRED_CHECKS.every(check=>proof.checks.includes(check)),'proof is missing a required executed check');
}
function regular(root,file){
 let path=root;ensure(lstatSync(root).isDirectory()&&!lstatSync(root).isSymbolicLink(),'release root must be a real directory');
 const segments=file.split('/');for(let i=0;i<segments.length;i++){path=join(path,segments[i]);const stat=lstatSync(path);ensure(!stat.isSymbolicLink()&&(i===segments.length-1?stat.isFile():stat.isDirectory()),'release paths must be regular and not symlinks');}
}
export function makeSharedManifest({root,images,commit,sourceTree,verification,workflow=null}){
 ensure(/^[a-f0-9]{40}$/.test(commit??'')&&/^[a-f0-9]{40}$/.test(sourceTree??''),'exact commit and source tree are required');validateImages(images);validateProof(verification,{images,commit,sourceTree});
 const files=Object.fromEntries([...RELEASE_FILES,'images.tar.gz'].map(file=>{regular(root,file);return [file,fileSha256(join(root,file))];}));
 return {format:1,profile:'ssh-shared',commit,sourceTree,platform:images[0].platform,createdAt:new Date().toISOString(),images,verification,workflow,files};
}
export function readSharedManifest(root){
 regular(root,'ssh-shared-manifest.json');let m;try{m=JSON.parse(readFileSync(join(root,'ssh-shared-manifest.json'),'utf8'));}catch{throw new Error('Shared release: unreadable manifest');}
 ensure(m?.format===1&&m.profile==='ssh-shared'&&/^[a-f0-9]{40}$/.test(m.commit??'')&&/^[a-f0-9]{40}$/.test(m.sourceTree??''),'invalid source manifest');validateImages(m.images);ensure(m.platform===m.images[0].platform,'manifest platform differs');validateProof(m.verification,m);
 const required=[...RELEASE_FILES,'images.tar.gz'];ensure(m.files&&Object.keys(m.files).length===required.length&&required.every(f=>Object.hasOwn(m.files,f)),'manifest must cover exactly every release file');
 for(const [file,digest] of Object.entries(m.files)){ensure(required.includes(file)&&/^[a-f0-9]{64}$/.test(digest),'invalid file inventory');regular(root,file);ensure(fileSha256(join(root,file))===digest,`checksum mismatch: ${file}`);}
 return m;
}
export function inspectSharedImages(run=commandRunner()){
 const inspected=JSON.parse(run([...docker,'image','inspect',...RELEASE_IMAGES]));
 const images=RELEASE_IMAGES.map(tag=>{const image=inspected.find(i=>i.RepoTags?.includes(tag));ensure(image,'missing release image');return {tag,id:image.Id,platform:`${image.Os}/${image.Architecture}`,repoDigests:image.RepoDigests??[]};});validateImages(images);return images;
}

/** Inspect Docker's tar stream without extracting untrusted paths or loading images. */
export async function validateImageArchive(path,images){
 validateImages(images);
 const expectedConfigNames=new Set(images.flatMap(i=>[i.id.slice(7)+'.json','blobs/sha256/'+i.id.slice(7)]));
 const files=new Set(),captured=new Map();let buffer=Buffer.alloc(0),remaining=0,padding=0,current=null,contents=[],size=0,ended=false,zeros=0,capturedBytes=0;
 const source=createReadStream(path),stream=source.pipe(createGunzip());source.on('error',error=>stream.destroy(error));
 try{
  for await(const chunk of stream){buffer=Buffer.concat([buffer,chunk]);while(buffer.length){
   if(remaining){const count=Math.min(remaining,buffer.length);if(current)contents.push(buffer.subarray(0,count));buffer=buffer.subarray(count);remaining-=count;if(remaining===0&&current){capturedBytes+=size;ensure(capturedBytes<=64*1024**2,'too much image metadata');captured.set(current,Buffer.concat(contents));contents=[];}continue;}
   if(padding){const count=Math.min(padding,buffer.length);buffer=buffer.subarray(count);padding-=count;continue;}
   if(buffer.length<512)break;
   const header=buffer.subarray(0,512);buffer=buffer.subarray(512);
   if(header.every(b=>b===0)){zeros++;ended=true;continue;}
   ensure(!ended,'archive has entries after its end marker');
   const field=(offset,length)=>header.subarray(offset,offset+length).toString('utf8').replace(/\0.*$/s,'');
   const prefix=field(345,155);let name=(prefix?prefix+'/':'')+field(0,100);name=name.replace(/\/$/,'');
   ensure(name&&name.length<1024&&!name.startsWith('/')&&!name.includes('\\')&&!name.split('/').some(p=>!p||p==='.'||p==='..')&&!files.has(name),'unsafe or duplicate archive path');
   const type=String.fromCharCode(header[156]);ensure(type==='0'||type==='\0'||type==='5','archive links and extensions are not accepted');
   const numeric=field(124,12).trim();ensure(/^[0-7]+$/.test(numeric),'invalid archive size');size=parseInt(numeric,8);ensure(Number.isSafeInteger(size)&&size<=16*1024**3,'oversized archive member');
   const checksum=parseInt(field(148,8).trim(),8),calculated=[...header].reduce((a,b,i)=>a+(i>=148&&i<156?32:b),0);ensure(checksum===calculated,'archive header checksum mismatch');
   files.add(name);ensure(files.size<=20000,'too many archive entries');remaining=size;padding=(512-size%512)%512;
   current=name==='manifest.json'||name==='index.json'||name==='oci-layout'||expectedConfigNames.has(name)||(name.startsWith('blobs/sha256/')&&size<=128*1024)?name:null;
   if(current){ensure(size<=16*1024**2,'oversized image metadata');if(size===0)captured.set(current,Buffer.alloc(0));}
  }}
  ensure(remaining===0&&padding===0&&buffer.length===0&&zeros>=2,'truncated archive');
  const manifest=JSON.parse(captured.get('manifest.json')?.toString('utf8')??'null');ensure(Array.isArray(manifest)&&manifest.length===images.length,'archive image inventory differs');
  const tags=[];
  for(const record of manifest){ensure(Array.isArray(record.RepoTags)&&record.RepoTags.length===1,'archive must contain one exact tag per image');const tag=record.RepoTags[0];tags.push(tag);const expected=images.find(i=>i.tag===tag);ensure(expected&&Array.isArray(record.Layers),'archive contains an unapproved image');ensure(expectedConfigNames.has(record.Config),'archive config path is not approved');const config=captured.get(record.Config);ensure(config&&'sha256:'+createHash('sha256').update(config).digest('hex')===expected.id,'archive image config digest differs');const parsed=JSON.parse(config);ensure(`${parsed.os}/${parsed.architecture}`===expected.platform,'archive image platform differs');ensure(record.Layers.every(layer=>typeof layer==='string'&&files.has(layer)),'archive layer is missing');}
  ensure(new Set(tags).size===images.length&&images.every(i=>tags.includes(i.tag)),'archive tags differ');
  // Docker save may include an OCI index. It may only name these exact tags.
  if(captured.has('index.json')){
   const index=JSON.parse(captured.get('index.json'));ensure(index.schemaVersion===2&&Array.isArray(index.manifests)&&index.manifests.length===images.length,'OCI image inventory differs');const indexedTags=new Set();
   for(const item of index.manifests){
    const tag=item.annotations?.['io.containerd.image.name']??item.annotations?.['org.opencontainers.image.ref.name'];const expected=images.find(i=>tag===i.tag||tag==='docker.io/library/'+i.tag);
    ensure(expected&&!indexedTags.has(expected.tag),'OCI index contains an unapproved or duplicate image');indexedTags.add(expected.tag);
    ensure(['application/vnd.oci.image.manifest.v1+json','application/vnd.docker.distribution.manifest.v2+json'].includes(item.mediaType)&&/^sha256:[a-f0-9]{64}$/.test(item.digest),'OCI descriptor is not an image manifest');
    const bytes=captured.get('blobs/sha256/'+item.digest.slice(7));ensure(bytes&&bytes.length===item.size&&'sha256:'+createHash('sha256').update(bytes).digest('hex')===item.digest,'OCI manifest digest differs');
    const entry=JSON.parse(bytes);ensure(entry.schemaVersion===2&&entry.config?.digest===expected.id&&Array.isArray(entry.layers),'OCI config differs from the tested image');
    const dockerRecord=manifest.find(r=>r.RepoTags[0]===expected.tag);ensure(entry.layers.length===dockerRecord.Layers.length&&entry.layers.every((layer,i)=>/^sha256:[a-f0-9]{64}$/.test(layer.digest)&&dockerRecord.Layers[i]==='blobs/sha256/'+layer.digest.slice(7)),'OCI layers differ from the tested Docker inventory');
   }
  }
 }catch(error){throw new Error('Shared release: invalid image archive'+(String(error.message).startsWith('Shared release:')?' ('+error.message.slice(16)+')':''));}finally{source.destroy();stream.destroy();}
}
function childExit(child){return new Promise((ok,reject)=>{child.once('error',()=>reject(new Error('Shared release: archive process failed')));child.once('exit',code=>code===0?ok():reject(new Error('Shared release: archive process failed')));});}
function git(source,args){const p=spawnSync('git',args,{cwd:source,encoding:'utf8'});ensure(p.status===0,'source revision cannot be verified');return p.stdout.trim();}
export async function packSharedRelease(output,source=resolve(import.meta.dirname,'..'),proofPath){
 ensure(!existsSync(output),'output must be a new directory');ensure(proofPath,'successful verification proof required');const run=commandRunner();validateEngine(run([...docker,'version','--format','{{.Server.Version}}']));
 const images=inspectSharedImages(run),commit=git(source,['rev-parse','HEAD']),sourceTree=git(source,['rev-parse','HEAD^{tree}']);ensure(git(source,['status','--porcelain','--untracked-files=all'])==='','release source must be the clean exact checked-out commit');
 const verification=JSON.parse(readFileSync(proofPath,'utf8'));validateProof(verification,{images,commit,sourceTree});
 mkdirSync(output,{recursive:true,mode:0o700});
 for(const file of RELEASE_FILES){regular(source,file);mkdirSync(dirname(join(output,file)),{recursive:true});copyFileSync(join(source,file),join(output,file));}
 const exporter=spawn('docker',[...docker,'image','save',...RELEASE_IMAGES],{env:dockerEnvironment(),stdio:['ignore','pipe','ignore']});
 await Promise.all([pipeline(exporter.stdout,createGzip({level:6}),createWriteStream(join(output,'images.tar.gz'),{mode:0o600,flags:'wx'})),childExit(exporter)]);
 ensure(sameImages(images,inspectSharedImages(run)),'image tags changed during export');await validateImageArchive(join(output,'images.tar.gz'),images);
 const workflow={repository:process.env.GITHUB_REPOSITORY??null,runId:process.env.GITHUB_RUN_ID??null,runAttempt:process.env.GITHUB_RUN_ATTEMPT??null,event:process.env.GITHUB_EVENT_NAME??null};
 const manifest=makeSharedManifest({root:output,images,commit,sourceTree,verification,workflow});writeFileSync(join(output,'ssh-shared-manifest.json'),JSON.stringify(manifest,null,2)+'\n',{mode:0o600});
 const checksums={...manifest.files,'ssh-shared-manifest.json':fileSha256(join(output,'ssh-shared-manifest.json'))};writeFileSync(join(output,'SHA256SUMS'),Object.entries(checksums).map(([file,sha])=>`${sha}  ${file}`).join('\n')+'\n',{mode:0o600});readSharedManifest(output);
 console.log(`Shared release packed for ${commit} (${manifest.platform}); no MySQL server image included.`);
}
export async function loadSharedRelease(root,{run=commandRunner(),spawn:start=spawn}={}){
 const manifest=readSharedManifest(root);validateEngine(run([...docker,'version','--format','{{.Server.Version}}']));const host=run([...docker,'info','--format','{{.OSType}}/{{.Architecture}}']).trim().replace('/x86_64','/amd64').replace('/aarch64','/arm64');ensure(host===manifest.platform,'host platform differs from tested images');
 await validateImageArchive(join(root,'images.tar.gz'),manifest.images);
 const loader=start('docker',[...docker,'image','load'],{env:dockerEnvironment(),stdio:['pipe','ignore','ignore']});await Promise.all([pipeline(createReadStream(join(root,'images.tar.gz')),createGunzip(),loader.stdin),childExit(loader)]);
 ensure(sameImages(manifest.images,inspectSharedImages(run)),'loaded IDs or platforms differ from verified images');console.log(`Verified and loaded all four shared-profile images for ${manifest.commit}.`);
}
async function main(){const [action,path,...extra]=process.argv.slice(2);ensure(['pack','load','verify'].includes(action)&&path?.startsWith('/')&&(action==='pack'?extra.length===2&&extra[0]==='--proof'&&extra[1].startsWith('/'):extra.length===0),'usage: pack /new/release --proof /verified.json; load|verify /release');if(action==='pack')await packSharedRelease(path,resolve(import.meta.dirname,'..'),extra[1]);if(action==='load')await loadSharedRelease(path);if(action==='verify'){const manifest=readSharedManifest(path);await validateImageArchive(join(path,'images.tar.gz'),manifest.images);console.log('Shared release checksums and image archive verified.');}}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{console.error(error.message);process.exitCode=1;});
