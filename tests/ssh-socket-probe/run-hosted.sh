#!/usr/bin/env bash
# Intentionally refuses non-hosted/non-ephemeral environments.
set -euo pipefail
[[ ${GITHUB_ACTIONS:-} == true && ${RUNNER_ENVIRONMENT:-} == github-hosted && $EUID == 0 ]]
[[ $(systemd-detect-virt --container || true) == none ]]
[[ -n ${RUNNER_TEMP:-} && -n ${SSH_PROBE_USER:-} ]]
work=$(mktemp -d "$RUNNER_TEMP/ssh-socket-engine.XXXXXXXX")
output="$RUNNER_TEMP/ssh-socket-proof"
mkdir -p "$output"
pidfile="$work/docker.pid"
cleanup() {
  if [[ -f $pidfile ]]; then
    daemon_pid=$(cat "$pidfile")
    if [[ $(readlink "/proc/$daemon_pid/exe" || true) == "$work/docker/dockerd" ]]; then
      kill -TERM "$daemon_pid" || true
      for _ in {1..200}; do
        kill -0 "$daemon_pid" 2>/dev/null || break
        sleep .1
      done
    fi
  fi
  cp "$work/dockerd.log" "$output/dockerd.log" 2>/dev/null || true
  # No private keys are in this directory; the Python harness removes its own.
}
trap cleanup EXIT
# This job starts from a separate VM from the fixture builder. Refuse to stop
# Docker if any pre-existing container (even stopped) belongs to other work.
[[ -z $(docker ps -aq) ]]
systemctl stop docker.service docker.socket containerd.service
iptables-save > "$output/firewall-before-ipv4.txt"
ip6tables-save > "$output/firewall-before-ipv6.txt"
# Remove only old Docker-owned chains/references on this disposable VM, so a
# newer preinstalled Docker firewall cannot make the 20.10 experiment pass.
python3 - <<'PY'
import subprocess
for family in ['iptables', 'ip6tables']:
    for table in ['filter', 'nat', 'mangle', 'raw']:
        result = subprocess.run([family, '-t', table, '-S'], text=True, capture_output=True)
        if result.returncode:
            continue
        lines = [line.split() for line in result.stdout.splitlines()]
        chains = [line[1] for line in lines if line[0] == '-N' and line[1].startswith('DOCKER')]
        for line in lines:
            if line[0] == '-A' and line[1] not in chains and any(name in line for name in chains):
                subprocess.run([family, '-t', table, '-D', *line[1:]], check=True)
        for chain in chains:
            subprocess.run([family, '-t', table, '-F', chain], check=True)
        for chain in chains:
            subprocess.run([family, '-t', table, '-X', chain], check=True)
    result = subprocess.run([family + '-save'], text=True, capture_output=True, check=True)
    assert 'DOCKER' not in result.stdout, result.stdout
    raw = subprocess.run([family, '-t', 'raw', '-S'], text=True, capture_output=True, check=True)
    assert not any(line.startswith('-A ') for line in raw.stdout.splitlines()), 'Unexplained raw-table rules could mask this experiment: ' + raw.stdout
PY
iptables-save > "$output/firewall-clean-before-docker20-ipv4.txt"
ip6tables-save > "$output/firewall-clean-before-docker20-ipv6.txt"
ip link delete docker0 2>/dev/null || true
# Leave any stock SSH service alone; this probe creates only its own separate
# loopback sshd and records its exact listener.
# Hosted Ubuntu currently supplies sshd; fail rather than installing a service
# that could create a public listener as an incidental package side effect.
[[ -x /usr/sbin/sshd ]]
install -d -m 0755 /run/sshd
curl --fail --show-error --silent --location --proto '=https' --tlsv1.2 \
  https://download.docker.com/linux/static/stable/x86_64/docker-20.10.24.tgz -o "$work/docker.tgz"
sha256sum "$work/docker.tgz" > "$output/docker-upstream-archive.sha256"
tar -xzf "$work/docker.tgz" -C "$work"
export PATH="$work/docker:$PATH"
export DOCKER_HOST="unix://$work/docker.sock"
[[ $(docker --version) == 'Docker version 20.10.24,'* ]]
printf '{}\n' > "$work/daemon.json"
dockerd --config-file "$work/daemon.json" --host "$DOCKER_HOST" \
  --data-root "$work/data" --exec-root "$work/run" --pidfile "$pidfile" \
  --bip 172.31.240.1/24 --storage-driver overlay2 \
  --userland-proxy=false > "$work/dockerd.log" 2>&1 &
for _ in {1..100}; do
  docker info >/dev/null 2>&1 && break
  sleep .2
done
[[ $(docker version --format '{{.Server.Version}}') == 20.10.24 ]]
docker load --input "$RUNNER_TEMP/ssh-socket-input/fixtures.tar"
export SSH_PROBE_OUTPUT="$output" SSH_PROBE_DOCKER_PID="$pidfile"
export SSH_PROBE_ARCHIVE="$RUNNER_TEMP/ssh-socket-input/fixtures.tar"
export SSH_PROBE_MANIFEST="$RUNNER_TEMP/ssh-socket-input/fixtures.json"
python3 tests/ssh-socket-probe/run-linux.py
