#!/usr/bin/env bash
set -euo pipefail
umask 077
: "${AGE_IDENTITY_FILE:?Set the path to the private age identity file}"
backup_file="${1:?Provide the encrypted backup path}"
if [ "${CONFIRM_RESTORE:-}" != "prepare-isolated-restore" ]; then
  echo "This prepares a NEW isolated restore project; it never replaces the running database." >&2
  echo "Set CONFIRM_RESTORE=prepare-isolated-restore after checking the backup, identity and available disk space." >&2
  exit 1
fi
for tool in age gzip docker; do command -v "$tool" >/dev/null; done
test -r "$backup_file"
test -r "$AGE_IDENTITY_FILE"
repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="${ENV_FILE:-$repo_dir/.env.production}"
test -r "$env_file"
# Use an encrypted filesystem (or sufficiently sized tmpfs) for TMPDIR. Unlinking
# plaintext is cleanup, not guaranteed secure erasure on SSD/COW filesystems.
plaintext_dir="$(mktemp -d "${TMPDIR:-/tmp}/star-oracle-restore.XXXXXX")"
candidate_started=false
completed=false
cleanup() {
  status=$?
  trap - EXIT
  rm -rf -- "$plaintext_dir" || echo "Warning: clean up private temporary files in $plaintext_dir manually." >&2
  if [ "$candidate_started" = true ] && [ "$completed" != true ]; then
    # Only the unique candidate is stopped. Preserve its volumes for diagnosis;
    # never delete/flush the old project's data or try an in-place rollback.
    if ! "${compose[@]}" stop api mysql redis >/dev/null 2>&1; then
      echo "Warning: could not stop candidate $restore_project; inspect it manually." >&2
    fi
    echo "Restore failed. Original project unchanged. Candidate details: $restore_dir" >&2
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# age can emit plaintext before the final authentication check. DO NOT pipe its
# output to mysql. Complete both authentication and gzip integrity checks first.
age -d -i "$AGE_IDENTITY_FILE" "$backup_file" > "$plaintext_dir/backup.sql.gz"
gzip -t -- "$plaintext_dir/backup.sql.gz"
gzip -dc -- "$plaintext_dir/backup.sql.gz" > "$plaintext_dir/backup.sql"
test -s "$plaintext_dir/backup.sql"

restore_root="${RESTORE_WORK_DIR:-$repo_dir/backups/restores}"
mkdir -p -- "$restore_root"
restore_dir="$(mktemp -d "$restore_root/star-oracle-restore-$(date -u +%Y%m%d%H%M%S)-XXXXXX")"
# Compose project names are lowercase. mktemp already made this attempt unique.
restore_project="$(basename -- "$restore_dir" | tr '[:upper:]' '[:lower:]')"
mysql_volume="${restore_project}-mysql"
redis_volume="${restore_project}-redis"
for volume in "$mysql_volume" "$redis_volume"; do
  if docker volume inspect "$volume" >/dev/null 2>&1; then
    echo "Refusing to reuse existing restore volume: $volume" >&2
    exit 1
  fi
done
cat > "$restore_dir/compose.restore.yml" <<YAML
# Isolated recovery only. Keep with the exact source revision and image digests.
# No gateway/web is started by restore.sh; all networks are private to this project.
networks:
  edge:
    internal: true
volumes:
  mysql-data:
    name: $mysql_volume
  redis-data:
    name: $redis_volume
YAML
printf '%s\n' "$restore_project" > "$restore_dir/project-name"
compose=(docker compose --project-name "$restore_project" --env-file "$env_file" -f "$repo_dir/compose.yml" -f "$restore_dir/compose.restore.yml")
"${compose[@]}" config --quiet
candidate_started=true
"${compose[@]}" up -d --wait mysql redis
# A fresh volume must expose an empty application schema. Never run migrations
# before the historical dump: their new tables would conflict with that dump.
table_count="$("${compose[@]}" exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_MIGRATION_PASSWORD" exec mysql -uoracle_migrator --batch --skip-column-names star_oracle -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE();"')"
if [ "$table_count" != "0" ]; then
  echo "Refusing to import into a nonempty candidate schema." >&2
  exit 1
fi
# Restricted schema-scoped account, not root. Binary mode disables client shell
# commands embedded in a dump; malformed SQL can only damage this new candidate.
"${compose[@]}" exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_MIGRATION_PASSWORD" exec mysql --binary-mode=1 -uoracle_migrator star_oracle' < "$plaintext_dir/backup.sql"
rm -f -- "$plaintext_dir/backup.sql" "$plaintext_dir/backup.sql.gz"
"${compose[@]}" run --rm --no-deps migrate
"${compose[@]}" run --rm --no-deps migrate node node_modules/prisma/build/index.js migrate status --schema apps/api/prisma/schema.prisma
# History alone can look current after an incomplete historical dump. Compare
# actual tables/columns/indexes with the current model before declaring success.
"${compose[@]}" run --rm --no-deps migrate node node_modules/prisma/build/index.js migrate diff --from-schema-datasource apps/api/prisma/schema.prisma --to-schema-datamodel apps/api/prisma/schema.prisma --exit-code
# Revoke only recovered sessions. Candidate Redis is new/empty, so FLUSHDB is
# unnecessary and the original Redis (and its active sessions) is never touched.
"${compose[@]}" exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_MIGRATION_PASSWORD" exec mysql -uoracle_migrator star_oracle -e "DELETE FROM session; DELETE FROM verification;"'
session_count="$("${compose[@]}" exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_MIGRATION_PASSWORD" exec mysql -uoracle_migrator --batch --skip-column-names star_oracle -e "SELECT COUNT(*) FROM session;"')"
if [ "$session_count" != "0" ]; then
  echo "Candidate session revocation could not be verified." >&2
  exit 1
fi
"${compose[@]}" up -d --wait --no-deps api
cat > "$restore_dir/VERIFIED" <<'CHECKS'
Automated checks passed: authenticated archive, empty target schema, SQL import,
committed migrations, migration status and schema comparison, recovered session
revocation, API health.
Still required before manual cutover: decrypt samples with the original data key,
verify ownership/business flows and operator approval. No production traffic switched.
CHECKS
completed=true
printf 'Isolated candidate prepared: %s\n' "$restore_project"
printf 'Original project unchanged. Manual cutover requires the checks in docs/OPERATIONS.md.\n'
printf 'Candidate metadata (no plaintext backup): %s\n' "$restore_dir"
printf 'Inspect candidate: '
printf '%q ' "${compose[@]}" ps
printf '\n'
