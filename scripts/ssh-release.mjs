#!/usr/bin/env node
/** Export/load verified Docker images. No registry and no server-side build. */
import {copyFileSync, readFileSync, mkdirSync, writeFileSync, existsSync, createWriteStream, createReadStream} from 'node:fs';
import {join, resolve, dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn, spawnSync} from 'node:child_process';
import {pipeline} from 'node:stream/promises';
import {createGzip, createGunzip} from 'node:zlib';
import {IMAGES, commandRunner, dockerEnvironment, fileSha256, readManifest, validateEngine} from './ssh-deploy.mjs';
const docker=['--host','unix:///var/run/docker.sock'];
const releaseFiles=['compose.ssh.yml','.env.ssh.example','infra/mysql-init.sh','infra/nginx-ssh.conf','scripts/ssh-deploy.mjs','scripts/ssh-release.mjs','docs/SSH_DEPLOYMENT.md','docs/ACCOUNTS.md','docs/OPERATIONS.md','docs/SECURITY.md','scripts/backup.sh','scripts/ssh-dump.mjs'];
export function makeManifest({root,files,images,commit,sourceTree,verification,workflow}) {
  if(!/^[a-f0-9]{40}$/.test(commit))throw new Error('Release needs the exact 40-character verified commit.');
  const platforms=new Set(images.map(i=>i.platform));
  if(platforms.size!==1||!/^linux\/(amd64|arm64)$/.test(images[0]?.platform))throw new Error('All release images must have one supported Linux platform.');
  if(images.length!==IMAGES.length||new Set(images.map(i=>i.tag)).size!==IMAGES.length||!images.every(i=>IMAGES.includes(i.tag)&&/^sha256:[a-f0-9]{64}$/.test(i.id)))throw new Error('Release needs every exact verified image.');
  return {format:1,commit,sourceTree,verification,workflow,platform:images[0].platform,createdAt:new Date().toISOString(),images,files:Object.fromEntries(files.map(file=>[file,fileSha256(join(root,file))]))};
}
export function inspectImages(run=commandRunner()) {
  const inspected=JSON.parse(run([...docker,'image','inspect',...IMAGES]));
  return IMAGES.map(tag=>{
    const image=inspected.find(i=>i.RepoTags?.includes(tag));
    if(!image)throw new Error(`Missing release image ${tag}.`);
    return {tag,id:image.Id,platform:`${image.Os}/${image.Architecture}`,repoDigests:image.RepoDigests??[]};
  });
}
function childExit(child) {return new Promise((ok,reject)=>{child.once('error',reject);child.once('exit',code=>code===0?ok():reject(new Error(`Docker archive operation failed (${code}).`)));});}
export async function packRelease(output,source=resolve(import.meta.dirname,'..'),proofPath) {
  if(existsSync(output))throw new Error('Release output must be a new directory.');
  const run=commandRunner();validateEngine(run([...docker,'version','--format','{{.Server.Version}}']));
  const images=inspectImages(run);
  const revision=spawnSync('git',['rev-parse','HEAD'],{cwd:source,encoding:'utf8'});
  if(revision.status!==0)throw new Error('Cannot identify the checked-out commit.');
  const tree=spawnSync('git',['rev-parse','HEAD^{tree}'],{cwd:source,encoding:'utf8'});
  const dirty=spawnSync('git',['diff','--quiet','HEAD','--'],{cwd:source});
  if(tree.status!==0||dirty.status!==0)throw new Error('Release source must match the exact checked-out commit.');
  if(!proofPath)throw new Error('Release requires successful Docker verification proof from this CI run.');
  const verification=JSON.parse(readFileSync(proofPath,'utf8'));
  const sameImages=(a,b)=>a.length===b.length&&a.every(i=>b.some(j=>i.tag===j.tag&&i.id===j.id&&i.platform===j.platform));
  if(verification.format!==1||verification.status!=='passed'||verification.commit!==revision.stdout.trim()||verification.sourceTree!==tree.stdout.trim()||!sameImages(images,verification.images??[]))throw new Error('Release images/source differ from the successful Docker verification.');
  const workflow={repository:process.env.GITHUB_REPOSITORY??null,runId:process.env.GITHUB_RUN_ID??null,runAttempt:process.env.GITHUB_RUN_ATTEMPT??null,event:process.env.GITHUB_EVENT_NAME??null};

  mkdirSync(output,{recursive:true,mode:0o700});
  for(const file of releaseFiles){mkdirSync(dirname(join(output,file)),{recursive:true});copyFileSync(join(source,file),join(output,file));}
  const archive=spawn('docker',[...docker,'image','save',...IMAGES],{env:dockerEnvironment(),stdio:['ignore','pipe','ignore']});
  await Promise.all([pipeline(archive.stdout,createGzip({level:6}),createWriteStream(join(output,'images.tar.gz'),{mode:0o600})),childExit(archive)]);
  if(!sameImages(images,inspectImages(run)))throw new Error('Image tags changed while exporting the verified release.');
  const manifest=makeManifest({root:output,files:[...releaseFiles,'images.tar.gz'],images,commit:revision.stdout.trim(),sourceTree:tree.stdout.trim(),verification,workflow});
  writeFileSync(join(output,'ssh-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  const checksums={...manifest.files,'ssh-manifest.json':fileSha256(join(output,'ssh-manifest.json'))};
  writeFileSync(join(output,'SHA256SUMS'),Object.entries(checksums).map(([file,sha])=>`${sha}  ${file}`).join('\n')+'\n');
  readManifest(output);
  console.log(`Verified ${manifest.platform} release for ${manifest.commit}: ${output}`);
}
export async function loadRelease(root) {
  const manifest=readManifest(root),run=commandRunner();
  validateEngine(run([...docker,'version','--format','{{.Server.Version}}']));
  const host=run([...docker,'info','--format','{{.OSType}}/{{.Architecture}}']).replace('/x86_64','/amd64').replace('/aarch64','/arm64');
  if(host!==manifest.platform)throw new Error(`This artifact is ${manifest.platform}; the Docker server is ${host}. Use a matching CI build, not emulation.`);
  const loader=spawn('docker',[...docker,'image','load'],{env:dockerEnvironment(),stdio:['pipe','ignore','ignore']});
  await Promise.all([pipeline(createReadStream(join(root,'images.tar.gz')),createGunzip(),loader.stdin),childExit(loader)]);
  const loaded=inspectImages(run);
  for(const image of manifest.images)if(!loaded.some(i=>i.tag===image.tag&&i.id===image.id&&i.platform===image.platform))throw new Error('Loaded image does not match the verified release manifest.');
  console.log(`Loaded and verified all four ${manifest.platform} images for ${manifest.commit}. No images were built or pulled.`);
}
async function main(){
  const [action,path,...extra]=process.argv.slice(2);
  if(!['pack','load','verify'].includes(action)||!path||(action==='pack'?(extra.length!==2||extra[0]!=='--proof'):extra.length!==0))throw new Error('Usage: node scripts/ssh-release.mjs pack /absolute/release-directory --proof /absolute/verification.json; or load|verify /absolute/release-directory');
  const root=resolve(path);
  if(action==='pack')await packRelease(root,resolve(import.meta.dirname,'..'),extra[1]);
  if(action==='load')await loadRelease(root);
  if(action==='verify'){const manifest=readManifest(root);console.log(`Checksums verified for ${manifest.commit} (${manifest.platform}).`);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{console.error(error.message);process.exitCode=1;});
