#!/usr/bin/env bash
set -euo pipefail
umask 077
: "${AGE_IDENTITY_FILE:?Set the path to the private age identity file}"
backup_file="${1:?Provide the encrypted backup path}"
if [ "${CONFIRM_RESTORE:-}" != "replace-star-oracle-data" ]; then
  echo "Restore replaces database contents. Stop api, take a backup, and set CONFIRM_RESTORE=replace-star-oracle-data." >&2
  exit 1
fi
docker compose --env-file .env.production stop api
age -d -i "$AGE_IDENTITY_FILE" "$backup_file" | gzip -d | docker compose --env-file .env.production exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot star_oracle'
# Revoke restored sessions; Redis must be dedicated to this application.
docker compose --env-file .env.production exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot star_oracle -e "DELETE FROM session;"'
docker compose --env-file .env.production exec -T redis sh -c 'REDISCLI_AUTH="$REDIS_PASSWORD" exec redis-cli FLUSHDB'
docker compose --env-file .env.production up -d --wait api
echo "Database restored and sessions revoked. Verify health and decrypt a test record before opening traffic."
