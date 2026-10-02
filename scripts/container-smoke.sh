#!/usr/bin/env bash
set -euo pipefail
umask 077
cleanup() {
  docker compose --env-file .env.production stop api web mysql redis >/dev/null 2>&1 || true
}
trap cleanup EXIT
# Fixture credentials exist only in this ephemeral CI job, never in review artifacts.
node --input-type=module - <<'JS'
import {readFileSync,writeFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
let env=readFileSync('.env.production.example','utf8')
 .replace('DOMAIN=oracle.example.com','DOMAIN=oracle.test')
 .replace('TLS_EMAIL=operator@example.com','TLS_EMAIL=ci@example.com');
for(const name of ['MYSQL_ROOT_PASSWORD','MYSQL_PASSWORD','MYSQL_MIGRATION_PASSWORD','REDIS_PASSWORD','AUTH_SECRET','DATA_ENCRYPTION_KEY'])
 env=env.replace(new RegExp('^'+name+'=.*$','m'),name+'='+randomBytes(32).toString('hex'));
writeFileSync('.env.production',env,{mode:0o600});
JS
docker compose --env-file .env.production config --quiet
docker compose --env-file .env.production build api web
docker run --rm -e DOMAIN=oracle.test -e TLS_EMAIL=ci@example.com -v "$PWD/infra/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:2.10-alpine caddy validate --config /etc/caddy/Caddyfile
docker compose --env-file .env.production up -d --wait mysql redis api web
docker compose --env-file .env.production exec -T api node --input-type=module - <<'JS'
const response=await fetch('http://127.0.0.1:3001/api/v1/health');
if(!response.ok||(await response.json()).status!=='ok')throw new Error('Container health check failed');
const denied=await fetch('http://127.0.0.1:3001/api/v1/me');
if(denied.status!==401)throw new Error('Container session guard failed');
const {PrismaClient}=await import('@prisma/client');const db=new PrismaClient();
try{
 let deniedDDL=false;
 try{await db.$executeRawUnsafe('CREATE TABLE must_not_exist (id INT)');}catch{deniedDDL=true;}
 if(!deniedDDL)throw new Error('Application database user must not have DDL privileges');
}finally{await db.$disconnect();}
JS
docker compose --env-file .env.production exec -T web wget -q -O /dev/null http://127.0.0.1:8080/
# Verify an encrypted backup can actually restore a private record.
docker compose --env-file .env.production exec -T api node --input-type=module - <<'JS'
const {db,seal,redis}=await import('./apps/api/dist/infrastructure.js');
const userId='restore-test-user',id='54d9fd62-8acf-4351-9f27-57da593202e0';
try{
 await db.user.create({data:{id:userId,name:'Restore fixture',email:'restore-fixture@example.com',emailVerified:true}});
 await db.reading.create({data:{id,userId,kind:'tarot',question:seal('恢复演练的私人问题','question:'+userId+':'+id),requestId:id,payload:{version:1,id,createdAt:new Date().toISOString(),kind:'tarot',spread:'single',question:'',cards:[{id:'major-star',reversed:false}]}}});
}finally{await db.$disconnect();redis.disconnect();}
JS
age-keygen -o /tmp/star-oracle-age-identity >/dev/null 2>&1
export AGE_RECIPIENT="$(age-keygen -y /tmp/star-oracle-age-identity)"
bash scripts/backup.sh
docker compose --env-file .env.production exec -T api node --input-type=module - <<'JS'
const {PrismaClient}=await import('@prisma/client');const db=new PrismaClient();
try{await db.user.delete({where:{id:'restore-test-user'}});}finally{await db.$disconnect();}
JS
export AGE_IDENTITY_FILE=/tmp/star-oracle-age-identity
export CONFIRM_RESTORE=replace-star-oracle-data
backup_file="$(find backups -name '*.age' -type f | head -n 1)"
bash scripts/restore.sh "$backup_file"
docker compose --env-file .env.production exec -T api node --input-type=module - <<'JS'
const {db,open,redis}=await import('./apps/api/dist/infrastructure.js');
try{
 const id='54d9fd62-8acf-4351-9f27-57da593202e0';
 const row=await db.reading.findUniqueOrThrow({where:{id}});
 if(open(row.question,'question:'+row.userId+':'+id)!=='恢复演练的私人问题')throw new Error('Private restore round trip failed');
 const sessions=await db.session.count();if(sessions!==0)throw new Error('Restored sessions must be revoked');
}finally{await db.$disconnect();redis.disconnect();}
JS
echo "Separate API/Web images, production MySQL/Redis privileges, and encrypted restore passed."
