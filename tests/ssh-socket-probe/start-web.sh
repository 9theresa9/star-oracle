#!/bin/sh
set -eu
socket_dir=${PROBE_SOCKET_DIR:-/run/probe-web}
socket="$socket_dir/web.sock"
# Only the separately owned child is mounted. The host's SSH-user-owned 0700
# ancestor is the access boundary; Nginx itself makes pathname sockets 0666.
[ -d "$socket_dir" ] && [ ! -L "$socket_dir" ]
[ "$(stat -c %u "$socket_dir")" = "$(id -u)" ]
[ "$(stat -c %a "$socket_dir")" = 755 ]
# Never unlink a substituted path or an old socket of uncertain provenance.
if [ -e "$socket" ] || [ -L "$socket" ]; then
  echo 'Socket path already exists; verified stopped-container cleanup required.' >&2
  exit 73
fi
umask 000
exec nginx -c /etc/nginx/probe.conf -g 'daemon off;'
