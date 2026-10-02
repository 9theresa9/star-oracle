#!/usr/bin/env bash
# MySQL sources this file; keep shell options isolated. Its official SQL helper
# reads optional positional arguments and must run without Bash nounset.
(
set -eo pipefail
if [[ ! "${MYSQL_MIGRATION_PASSWORD:-}" =~ ^[a-fA-F0-9]{48,}$ ]]; then
  echo "MYSQL_MIGRATION_PASSWORD must be at least 48 hexadecimal characters" >&2
  exit 1
fi
docker_process_sql <<SQL
CREATE USER 'oracle_migrator'@'%' IDENTIFIED BY '${MYSQL_MIGRATION_PASSWORD}';
GRANT ALL PRIVILEGES ON star_oracle.* TO 'oracle_migrator'@'%';
REVOKE ALL PRIVILEGES, GRANT OPTION FROM 'oracle'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON star_oracle.* TO 'oracle'@'%';
SQL
)
