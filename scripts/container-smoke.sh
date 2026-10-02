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
echo "Separate API/Web images and production MySQL/Redis stack passed."
