import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve,isAbsolute } from 'node:path';
import { gzipSync } from 'node:zlib';

const directory=resolve(process.argv[2]??'apps/web/dist');
const manifest=JSON.parse(await readFile(resolve(directory,'.vite/manifest.json'),'utf8'));
const entries=Object.keys(manifest).filter(key=>manifest[key].isEntry);
assert.ok(entries.length>0,'Manifest must contain a build entry');
const visited=new Set(),initialFiles=new Set(),totalFiles=new Set();
function assets(record,set){
 if(record.file&&/\.(js|css)$/.test(record.file))set.add(record.file);
 for(const css of record.css??[])set.add(css);
}
function visit(key){
 if(visited.has(key))return;
 const record=manifest[key];assert.ok(record,'Missing static import: '+key);
 visited.add(key);assets(record,initialFiles);
 for(const dependency of record.imports??[])visit(dependency);
}
for(const key of entries)visit(key);
for(const record of Object.values(manifest))assets(record,totalFiles);
for(const file of initialFiles)assert.ok(totalFiles.has(file),'Every initial asset is in totals');
const chunks=[];
for(const file of [...totalFiles].sort()){
 assert.ok(!isAbsolute(file)&&!file.split('/').includes('..'),'Only assets within the build directory');
 const buffer=await readFile(resolve(directory,file));
 chunks.push({file,type:file.endsWith('.css')?'css':'js',bytes:buffer.length,gzipBytes:gzipSync(buffer).length,initial:initialFiles.has(file)});
}
function sum(items){
 return Object.fromEntries(['js','css'].map(type=>[type,items.filter(item=>item.type===type).reduce((value,item)=>({bytes:value.bytes+item.bytes,gzipBytes:value.gzipBytes+item.gzipBytes}),{bytes:0,gzipBytes:0})]));
}
console.log(JSON.stringify({initial:sum(chunks.filter(item=>item.initial)),total:sum(chunks),chunks}));
