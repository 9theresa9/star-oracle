#!/usr/bin/env node
// SQL goes only to stdout for backup.sh's encryption pipeline. Never log it.
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {loadSettings,dockerEnvironment,dockerArguments,commandRunner,validateConfig} from './ssh-deploy.mjs';
try {
  const [path,...extra]=process.argv.slice(2);
  if(!path?.startsWith('/')||extra.length)throw new Error('SSH backup requires an absolute private environment file.');
  const root=resolve(import.meta.dirname,'..'),settings=loadSettings(path),run=commandRunner(settings),compose=dockerArguments(root);
  validateConfig(JSON.parse(run([...compose,'config','--format','json'])),root);
  const result=spawnSync('docker',[...compose,'exec','-T','mysql','sh','-c','MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysqldump -uroot --single-transaction --no-tablespaces --set-gtid-purged=OFF star_oracle'],{env:{...dockerEnvironment(),...settings},stdio:['ignore','inherit','ignore']});
  if(result.status!==0)throw new Error('SSH database export failed; raw diagnostics withheld to protect credentials.');
}catch(error){console.error(error.message);process.exitCode=1;}
