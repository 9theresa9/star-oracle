# Bounded SSH Unix-socket compatibility experiment

This is a synthetic CI experiment, not a deployment profile. It leaves the
application, the green SSH Compose file, and deployment/release scripts alone.
No real server, database, account, credential, or user data is used.

The Linux job answers one question: can the saved Node 24 and Nginx 1.28 fixture
images run with upstream Docker 20.10.24 and serve HTTP through a real OpenSSH
local TCP-to-remote Unix-socket forward while the Web container has no published
ports or website/health TCP listener?

## Architecture and evidence

A build job saves both fixture images once and records their image IDs and the
archive SHA-256. A separate GitHub-hosted Ubuntu 22.04 VM stops its unused stock
Docker daemon, removes only leftover Docker firewall chains, and launches the
upstream 20.10.24 static binaries directly on the VM with an isolated data root
and Unix control socket. It is not Docker-in-Docker. The harness verifies the
client and Engine versions, the exact loaded image IDs, daemon executable and
control socket, and host/daemon network-namespace identity.

The Node fixture imports the real application's `sshRequestAllowed` guard. It
repeats the current Origin check but has no authentication, storage, or model
calls. It listens only at 172.30.77.2:3001. Actual Nginx traffic must arrive with
peer 172.30.77.3. A same-bridge unrelated fixture at .4 and the host gateway at
.1 receive actual HTTP 403 responses; forged proxy headers do not change that.

Nginx listens only on `/run/probe-web/web.sock`. Docker's embedded resolver may
have its own 127.0.0.11 TCP socket in the namespace; it is explicitly recorded
and excluded from the claim about Web listeners. The harness rejects all other
TCP listeners and checks actual Web IP ports 80, 443, 8080 and 17777 from both
host and same-bridge unrelated container. The API response is the positive
network-path control, so an inaccessible network cannot silently count as a
passing application-policy check.

A generated, private host directory is owned by the existing runner SSH user
with mode 0700. A separate child is owned by Nginx's measured non-root UID/GID,
with mode 0755, and only that child is bind-mounted into Web. Nginx's pathname
socket is deliberately mode 0666. The 0700 host ancestor is therefore essential:
a different host UID must receive EACCES while that same UID can connect to a
separate 0666 control socket. Root, Docker administrators and the authorized SSH
user are outside this DAC boundary.

A separate sshd binds an ephemeral 127.0.0.1 port. It uses the existing runner
account, generated CI-only keys, a dedicated authorized_keys file, public-key
only authentication, `AllowStreamLocalForwarding local`, and no TCP forwarding.
The actual client uses strict host-key checking and the generated pinned known
host, then opens `-L 127.0.0.1:17777:<private>/web/web.sock`. HTTP through that
forward must reach Nginx and return the fixture API's actual peer and Node
version. The Linux job also verifies Host, Origin, duplicate Host, absolute-form
request target, and populated/empty proxy-header rejection through the tunnel.
`PermitOpen` is not treated as a Unix-path authorization mechanism.

Graceful stop/start must remove and recreate the socket. After SIGKILL, startup
must refuse the stale path. Only the harness, after verifying the container is
stopped and the inode is an owned socket, removes that fixture inode. Regular
files and symlinks at the socket path are also refused. The existing SSH tunnel
must recover after verified cleanup and restart.

## Windows client protocol check

A separate Windows Server 2022 job calls the exact stock client at
`%WINDIR%\System32\OpenSSH\ssh.exe` and records its actual version. A pinned
AsyncSSH fixture on that same VM accepts only generated-key authentication and
the exact `direct-streamlocal@openssh.com` destination, then returns a synthetic
HTTP response. The client uses strict pinned host-key checking and a loopback
local TCP listener. No public tunnel joins CI runners.

This is a Windows client protocol check against a mock SSH server. It does not
prove Windows-to-Linux end-to-end behavior, Nginx behavior on Windows, or a
minimum supported Windows release. The Linux job supplies the separate real
sshd/Nginx/Unix-socket chain. Missing stock Windows OpenSSH is reported as a
blocker; a Git-bundled or replacement client is not substituted.

## Running and scope

Run the `Synthetic SSH socket compatibility` workflow manually, or change these
probe paths in a pull request. The hosted setup script intentionally refuses
non-GitHub-hosted or nested-container execution. Do not run it on a real server.
For a local test of the synthetic API and actual policy import:

```
node --test tests/ssh-socket-probe/fixture.test.mjs
```

Linux evidence is uploaded as `ssh-socket-linux-proof`: a concise proof JSON,
Engine archive hash and sanitized process logs. Private keys and authorized_keys
are never uploaded. The separate Windows proof JSON is uploaded as
`ssh-socket-windows-protocol-proof`. Fixture-image archives expire after three days.

A passing result proves only the versions and assertions actually recorded. It
does not establish compatibility with the unknown Debian 20.10.24+dfsg package
revision, full application behavior, untested Windows clients, backend network isolation,
a shared-MySQL production profile, or any real server. Those require separate
checks before a deployment change is proposed.

Upstream references:
- https://download.docker.com/linux/static/stable/x86_64/
- https://nginx.org/en/docs/http/ngx_http_core_module.html#listen
- https://man.openbsd.org/sshd_config#AllowStreamLocalForwarding
