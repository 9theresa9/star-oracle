#!/usr/bin/env bash
set -euo pipefail
umask 077
: "${AGE_RECIPIENT:?Set the age public recipient before backup}"
command -v age >/dev/null
mkdir -p backups
target="backups/star-oracle-$(date -u +%Y%m%dT%H%M%SZ).sql.gz.age"
docker compose --env-file .env.production exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysqldump -uroot --single-transaction --no-tablespaces --set-gtid-purged=OFF star_oracle' | gzip | age -r "$AGE_RECIPIENT" -o "$target"
test -s "$target"
printf 'Encrypted backup created: %s\n' "$target"
