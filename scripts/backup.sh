#!/usr/bin/env bash
set -euo pipefail
umask 077
: "${AGE_RECIPIENT:?Set the age public recipient before backup}"
command -v age >/dev/null
command -v docker >/dev/null
repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
case "${BACKUP_DEPLOYMENT_MODE:-https}" in
  https)
    env_file="${ENV_FILE:-$repo_dir/.env.production}"
    compose=(docker compose --env-file "$env_file" -f "$repo_dir/compose.yml")
    ;;
  ssh-only)
    env_file="${ENV_FILE:-$repo_dir/.env.ssh}"
    # A backup is read-only against this fixed project. Never inherit another
    # stack/context or merge in the public gateway configuration.
    compose=(node "$repo_dir/scripts/ssh-dump.mjs" "$env_file")
    ;;
  *) printf 'Unknown backup deployment mode\n' >&2; exit 1 ;;
esac
backup_dir="${BACKUP_DIR:-$repo_dir/backups}"
mkdir -p -- "$backup_dir"
# Keep incomplete ciphertext private and unpublished. A failed dump can still
# produce valid gzip/age output, so only publish after pipefail confirms ALL stages.
partial="$(mktemp "$backup_dir/.star-oracle-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX.partial")"
trap 'rm -f -- "$partial"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
if [[ "${BACKUP_DEPLOYMENT_MODE:-https}" == https ]]; then
  compose+=(exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysqldump -uroot --single-transaction --no-tablespaces --set-gtid-purged=OFF star_oracle')
fi
"${compose[@]}" \
  | gzip -n | age -r "$AGE_RECIPIENT" > "$partial"
test -s "$partial"
filename="${partial##*/}"
target="$backup_dir/${filename#.}"
target="${target%.partial}.sql.gz.age"
# Same-filesystem hard link publishes atomically and refuses to replace a file.
ln -- "$partial" "$target"
printf 'Encrypted backup created: %s\n' "$target"
