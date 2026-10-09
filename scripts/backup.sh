#!/usr/bin/env bash
set -euo pipefail
umask 077
: "${AGE_RECIPIENT:?Set the age public recipient before backup}"
command -v age >/dev/null
command -v docker >/dev/null
repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="${ENV_FILE:-$repo_dir/.env.production}"
backup_dir="${BACKUP_DIR:-$repo_dir/backups}"
mkdir -p -- "$backup_dir"
# Keep incomplete ciphertext private and unpublished. A failed dump can still
# produce valid gzip/age output, so only publish after pipefail confirms ALL stages.
partial="$(mktemp "$backup_dir/.star-oracle-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX.partial")"
trap 'rm -f -- "$partial"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
docker compose --env-file "$env_file" -f "$repo_dir/compose.yml" exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysqldump -uroot --single-transaction --no-tablespaces --set-gtid-purged=OFF star_oracle' \
  | gzip -n | age -r "$AGE_RECIPIENT" > "$partial"
test -s "$partial"
filename="${partial##*/}"
target="$backup_dir/${filename#.}"
target="${target%.partial}.sql.gz.age"
# Same-filesystem hard link publishes atomically and refuses to replace a file.
ln -- "$partial" "$target"
printf 'Encrypted backup created: %s\n' "$target"
