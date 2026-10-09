#!/usr/bin/env bash
set -euo pipefail
umask 077
# This script must never acquire or stop an existing operator deployment.
if [ -f .env.production ]; then echo 'Refusing an existing .env.production; run smoke in a fresh isolated checkout.' >&2; exit 1; fi
export COMPOSE_PROJECT_NAME="star-oracle-smoke-$(date +%s)-$$"
cleanup() {
  smoke_status=$?
  if [ "$smoke_status" -ne 0 ] && [ -f .env.production ]; then
    node --input-type=module - <<'JS'
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const env=readFileSync('.env.production','utf8');
const secrets=env.split('\n').filter(line=>/^(?:MYSQL_.*PASSWORD|REDIS_PASSWORD|AUTH_SECRET|DATA_ENCRYPTION_KEY|SMTP_PASSWORD|AI_API_KEY)=/.test(line)).map(line=>line.slice(line.indexOf('=')+1)).filter(Boolean);
const result=spawnSync('docker',['compose','--env-file','.env.production','logs','--no-color','--tail','60','mysql','migrate','api','web'],{encoding:'utf8',timeout:15000});
let logs=(result.stdout||'')+(result.stderr||'');
for(const secret of secrets)logs=logs.split(secret).join('[redacted]');
console.log(logs);
JS
  fi
  if [ -n "${restore_dir:-}" ] && [ -f "$restore_dir/project-name" ]; then
    docker compose --project-name "$(cat "$restore_dir/project-name")" --env-file .env.production -f compose.yml -f "$restore_dir/compose.restore.yml" stop api mysql redis >/dev/null 2>&1 || true
  fi
  docker compose --env-file .env.production stop api web mysql redis >/dev/null 2>&1 || true
  exit "$smoke_status"
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
# Synthetic reset/verification tokens and Referer values must never enter logs.
docker compose --env-file .env.production exec -T web wget -q -O /dev/null --header='Referer: https://oracle.test/account?token=ORACLE_LOG_SENTINEL' 'http://127.0.0.1:8080/account?token=ORACLE_LOG_SENTINEL'
docker compose --env-file .env.production exec -T web wget -q -O /dev/null --header='Referer: https://oracle.test/account?token=ORACLE_LOG_SENTINEL' 'http://127.0.0.1:8080/favicon.svg?token=ORACLE_LOG_SENTINEL'
if docker compose --env-file .env.production logs --no-color web | grep -q ORACLE_LOG_SENTINEL; then echo 'Sensitive URL reached container logs' >&2; exit 1; fi
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
# Make the backup one additive migration older, exclusively in this disposable
# synthetic CI project. This proves restore imports old history into a clean DB.
docker compose --env-file .env.production exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_MIGRATION_PASSWORD" exec mysql -uoracle_migrator star_oracle -e "ALTER TABLE reading_conversation DROP COLUMN inputCipher; DELETE FROM _prisma_migrations WHERE migration_name = '\''202610090001_follow_up_recovery'\'';"'
bash scripts/backup.sh
docker compose --env-file .env.production run --rm --no-deps migrate
docker compose --env-file .env.production exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_MIGRATION_PASSWORD" exec mysql -uoracle_migrator star_oracle -e "CREATE TABLE post_backup_only (id INT PRIMARY KEY); INSERT INTO post_backup_only VALUES (1);"'
docker compose --env-file .env.production exec -T api node --input-type=module - <<'JS'
const {PrismaClient}=await import('@prisma/client');const db=new PrismaClient();
try{await db.user.delete({where:{id:'restore-test-user'}});}finally{await db.$disconnect();}
JS
export AGE_IDENTITY_FILE=/tmp/star-oracle-age-identity
export CONFIRM_RESTORE=prepare-isolated-restore
backup_file="$(find backups -name '*.age' -type f | head -n 1)"
# A truncated archive must fail before even creating a candidate project.
head -c 100 "$backup_file" > /tmp/oracle-corrupt-backup.age
if bash scripts/restore.sh /tmp/oracle-corrupt-backup.age; then echo 'Corrupt backup unexpectedly accepted' >&2; exit 1; fi
bash scripts/restore.sh "$backup_file"
restore_dir="$(find backups/restores -name VERIFIED -type f -printf '%h\n' | head -n 1)"
test -n "$restore_dir"
restore_project="$(cat "$restore_dir/project-name")"
docker compose --project-name "$restore_project" --env-file .env.production -f compose.yml -f "$restore_dir/compose.restore.yml" exec -T api node --input-type=module - <<'JS'
const {db,open,redis}=await import('./apps/api/dist/infrastructure.js');
try{
 const id='54d9fd62-8acf-4351-9f27-57da593202e0';
 const row=await db.reading.findUniqueOrThrow({where:{id}});
 if(open(row.question,'question:'+row.userId+':'+id)!=='恢复演练的私人问题')throw new Error('Private restore round trip failed');
 const leftovers=await db.$queryRawUnsafe("SELECT COUNT(*) AS total FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='post_backup_only'");if(Number(leftovers[0].total)!==0)throw new Error('Restore retained a post-backup table');
 const migrated=await db.$queryRawUnsafe("SELECT COUNT(*) AS total FROM _prisma_migrations WHERE migration_name='202610090001_follow_up_recovery' AND finished_at IS NOT NULL");if(Number(migrated[0].total)!==1)throw new Error('Old backup was not migrated cleanly');
 const sessions=await db.session.count();if(sessions!==0)throw new Error('Restored sessions must be revoked');
}finally{await db.$disconnect();redis.disconnect();}
JS
# The original intentionally deleted fixture remains deleted: restore never touched it.
docker compose --env-file .env.production exec -T api node --input-type=module - <<'JS'
const {PrismaClient}=await import('@prisma/client');const db=new PrismaClient();
try{if(await db.user.count({where:{id:'restore-test-user'}}))throw new Error('Restore changed the original database');}finally{await db.$disconnect();}
JS
echo "Separate API/Web images, sanitized logs, database privileges, corruption rejection and isolated encrypted restore passed."
