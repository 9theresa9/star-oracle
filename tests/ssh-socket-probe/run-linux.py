#!/usr/bin/env python3
"""Ephemeral hosted-runner experiment, never a deployment or server checker."""
import errno
import hashlib
import http.client
import json
import os
from pathlib import Path
import pwd
import shutil
import socket
import stat
import subprocess
import tempfile
import time

API = 'ssh-socket-api:fixture'
WEB = 'ssh-socket-web:fixture'
NETWORK = 'ssh-socket-probe'
API_IP, WEB_IP = '172.30.77.2', '172.30.77.3'
CONTAINERS = ['ssh-socket-api', 'ssh-socket-web', 'ssh-socket-unrelated']


def run(*args, check=True):
    result = subprocess.run([str(arg) for arg in args], text=True, capture_output=True, timeout=60)
    if check and result.returncode:
        raise RuntimeError(f'{args[0]} failed ({result.returncode}): {result.stderr.strip()}')
    return result


def docker(*args, **kwargs):
    return run('docker', '--host', os.environ['DOCKER_HOST'], *args, **kwargs)


def eventually(check, seconds=20):
    until = time.monotonic() + seconds
    while True:
        try:
            value = check()
            if value:
                return value
        except (OSError, http.client.HTTPException):
            pass
        if time.monotonic() >= until:
            raise AssertionError('Timed out waiting for fixture readiness')
        time.sleep(.2)


def http_probe(host='127.0.0.1', port=17777, path='/api/fixture', headers=None):
    connection = http.client.HTTPConnection(host, port, timeout=3)
    try:
        connection.request('GET', path, headers={'Host': 'localhost:17777', **(headers or {})})
        response = connection.getresponse()
        return response.status, response.read().decode()
    finally:
        connection.close()


def raw_probe(lines):
    with socket.create_connection(('127.0.0.1', 17777), timeout=3) as connection:
        connection.sendall(('\r\n'.join(lines) + '\r\nConnection: close\r\n\r\n').encode())
        data = connection.recv(4096)
    return int(data.split(b' ', 2)[1])


def main():
    assert os.geteuid() == 0, 'Run through the workflow sudo command'
    assert os.environ.get('GITHUB_ACTIONS') == 'true'
    assert os.environ.get('RUNNER_ENVIRONMENT') == 'github-hosted'
    assert run('systemd-detect-virt', '--container', check=False).stdout.strip() == 'none', 'Nested containers invalidate this experiment'
    account = pwd.getpwnam(os.environ['SSH_PROBE_USER'])
    assert account.pw_uid != 0
    output = Path(os.environ['SSH_PROBE_OUTPUT'])
    output.mkdir(parents=True, exist_ok=True)
    proof = {'status': 'running', 'scope': 'upstream Docker 20.10.24 synthetic Linux SSH/Nginx/Node compatibility only',
             'notProven': ['Debian Docker 20.10.24+dfsg revision', 'full application', 'shared MySQL profile', 'backend network isolation', 'production server'],
             'tests': [], 'commit': run('runuser', '-u', account.pw_name, '--', 'git', 'rev-parse', 'HEAD').stdout.strip()}
    private = Path(tempfile.mkdtemp(prefix='ssh-socket-', dir=account.pw_dir))
    os.chown(private, account.pw_uid, account.pw_gid)
    os.chmod(private, 0o700)
    web_dir = private / 'web'
    web_dir.mkdir(mode=0o755)
    os.chmod(web_dir, 0o755)
    web_socket = web_dir / 'web.sock'
    processes = []
    logs = []
    created_containers = []
    created_network = False

    def passed(name, detail=None):
        proof['tests'].append({'name': name, 'status': 'passed', **({'detail': detail} if detail is not None else {})})
        print('PASS', name, flush=True)

    def as_user(*args, **kwargs):
        return run('runuser', '-u', account.pw_name, '--', *args, **kwargs)

    def web_ready():
        return web_socket.is_socket() and http_probe()[0] == 200

    def inspect(name):
        return json.loads(docker('inspect', name).stdout)[0]

    def assert_no_publication():
        for name in CONTAINERS:
            info = inspect(name)
            host = info['HostConfig']
            assert not host.get('PortBindings'), (name, host.get('PortBindings'))
            assert not host.get('PublishAllPorts')
            assert not any((info['NetworkSettings'].get('Ports') or {}).values())
            assert not host['Privileged']
            assert all('unconfined' not in option for option in host.get('SecurityOpt') or [])
            assert host['ReadonlyRootfs'] and 'ALL' in host['CapDrop']
            assert 'no-new-privileges:true' in host['SecurityOpt']
            process_status = dict(line.split(':', 1) for line in docker('exec', name, 'cat', '/proc/1/status').stdout.splitlines() if ':' in line)
            assert process_status['Seccomp'].strip() == '2'
            assert process_status['NoNewPrivs'].strip() == '1'
            assert int(process_status['CapEff'].strip(), 16) == 0
            assert int(process_status['Uid'].split()[0]) != 0
            proof.setdefault('containerBoundaries', {})[name] = {
                'portBindings': host.get('PortBindings'), 'publishedPorts': info['NetworkSettings']['Ports'],
                'uid': int(process_status['Uid'].split()[0]), 'seccomp': 2, 'noNewPrivileges': 1, 'effectiveCapabilities': 0}
        passed('all-container-port-bindings-empty-and-actual-seccomp-no-new-privileges-zero-capabilities')

    try:
        for name in CONTAINERS:
            assert docker('container', 'inspect', name, check=False).returncode != 0, f'Pre-existing container: {name}'
        assert docker('network', 'inspect', NETWORK, check=False).returncode != 0, 'Pre-existing network'
        version = json.loads(docker('version', '--format', '{{json .}}').stdout)
        assert version['Client']['Version'] == '20.10.24'
        assert version['Server']['Version'] == '20.10.24'
        proof['docker'] = version
        proof['kernel'] = run('uname', '-srmo').stdout.strip()
        proof['virtualization'] = run('systemd-detect-virt', check=False).stdout.strip()
        proof['hostNetworkNamespace'] = os.readlink('/proc/self/ns/net')
        daemon_pid = int(Path(os.environ['SSH_PROBE_DOCKER_PID']).read_text())
        assert os.readlink(f'/proc/{daemon_pid}/ns/net') == proof['hostNetworkNamespace']
        proof['daemonNetworkNamespace'] = os.readlink(f'/proc/{daemon_pid}/ns/net')
        proof['daemonExecutable'] = os.readlink(f'/proc/{daemon_pid}/exe')
        command = Path(f'/proc/{daemon_pid}/cmdline').read_bytes().decode().split('\0')
        assert command[command.index('--host') + 1] == os.environ['DOCKER_HOST']
        assert Path(shutil.which('docker')).parent == Path(proof['daemonExecutable']).parent
        proof['dockerSocket'] = os.environ['DOCKER_HOST']
        proof['archiveSha256'] = hashlib.sha256(Path(os.environ['SSH_PROBE_ARCHIVE']).read_bytes()).hexdigest()
        expected = json.loads(Path(os.environ['SSH_PROBE_MANIFEST']).read_text())
        assert proof['archiveSha256'] == expected['archiveSha256']
        for tag in [API, WEB]:
            actual = json.loads(docker('image', 'inspect', tag).stdout)[0]
            assert actual['Id'] == expected['images'][tag]
            assert actual['Architecture'] == 'amd64' and actual['Os'] == 'linux'
        proof['images'] = expected
        proof['node'] = docker('run', '--rm', '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', '--entrypoint', 'node', API, '--version').stdout.strip()
        assert proof['node'].startswith('v24.')
        proof['nginx'] = docker('run', '--rm', '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', '--entrypoint', 'nginx', WEB, '-v').stderr.strip()
        assert 'nginx/1.28.' in proof['nginx']
        web_uid = int(docker('run', '--rm', '--network', 'none', '--entrypoint', 'id', WEB, '-u').stdout)
        web_gid = int(docker('run', '--rm', '--network', 'none', '--entrypoint', 'id', WEB, '-g').stdout)
        assert web_uid != 0 and web_uid != account.pw_uid
        os.chown(web_dir, web_uid, web_gid)
        passed('exact-upstream-docker-20-and-same-loaded-image-ids', proof['node'])
        docker('network', 'create', '--subnet', '172.30.77.0/24', '--gateway', '172.30.77.1', NETWORK)
        created_network = True
        common = ['--read-only', '--tmpfs', '/tmp', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', '--pids-limit', '64', '--memory', '128m', '--network', NETWORK]
        def create(name, *args):
            docker('create', '--name', name, *common, *args)
            created_containers.append(name)
            docker('start', name)
        create(CONTAINERS[0], '--ip', API_IP, API)
        create(CONTAINERS[1], '--ip', WEB_IP, '--mount', f'type=bind,src={web_dir},dst=/run/probe-web', WEB)
        create(CONTAINERS[2], '--ip', '172.30.77.4', '--entrypoint', 'node', API, '-e', 'setInterval(()=>{},1000)')
        assert_no_publication()
        (output / 'firewall-docker20-ipv4.txt').write_text(run('iptables-save').stdout)
        (output / 'firewall-docker20-ipv6.txt').write_text(run('ip6tables-save').stdout)
        eventually(lambda: web_socket.is_socket())
        web_info = inspect(CONTAINERS[1])
        assert len(web_info['Mounts']) == 1 and web_info['Mounts'][0]['Source'] == str(web_dir)
        assert not inspect(CONTAINERS[2])['Mounts']
        permissions = {name: {'uid': p.stat().st_uid, 'gid': p.stat().st_gid, 'mode': oct(stat.S_IMODE(p.stat().st_mode))}
                       for name, p in [('privateParent', private), ('webChild', web_dir), ('socket', web_socket)]}
        assert permissions['privateParent']['uid'] == account.pw_uid and permissions['privateParent']['mode'] == '0o700'
        assert permissions['webChild']['uid'] == web_uid and permissions['webChild']['mode'] == '0o755'
        assert permissions['socket']['uid'] == web_uid and permissions['socket']['mode'] == '0o666'
        proof['permissions'] = permissions
        passed('actual-nginx-uid-child-only-mount-and-private-parent-dac', permissions)

        # Separate sshd uses the existing runner account; no OS account or system
        # sshd configuration is created or changed. All keys are CI-only.
        for name in ['host_key', 'client_key']:
            run('ssh-keygen', '-q', '-t', 'ed25519', '-N', '', '-f', private / name)
        authorized = private / 'authorized_keys'
        authorized.write_text((private / 'client_key.pub').read_text())
        for name in ['client_key', 'client_key.pub', 'authorized_keys']:
            os.chown(private / name, account.pw_uid, account.pw_gid)
            os.chmod(private / name, 0o600)
        with socket.socket() as port_picker:
            port_picker.bind(('127.0.0.1', 0))
            ssh_port = port_picker.getsockname()[1]
        config = private / 'sshd_config'
        config.write_text(f'''Port {ssh_port}
ListenAddress 127.0.0.1
HostKey {private}/host_key
PidFile {private}/sshd.pid
AuthorizedKeysFile {authorized}
AllowUsers {account.pw_name}
PubkeyAuthentication yes
AuthenticationMethods publickey
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
UsePAM yes
StrictModes yes
AllowTcpForwarding no
AllowStreamLocalForwarding local
DisableForwarding no
AllowAgentForwarding no
X11Forwarding no
PermitTTY no
PermitTunnel no
GatewayPorts no
MaxSessions 0
LogLevel ERROR
''')
        effective = run('/usr/sbin/sshd', '-T', '-f', config).stdout
        for expected_line in ['allowstreamlocalforwarding local', 'allowtcpforwarding no', 'disableforwarding no']:
            assert expected_line in effective
        proof['sshdPolicy'] = [line for line in effective.splitlines() if line.startswith(('allowstreamlocalforwarding ', 'allowtcpforwarding ', 'disableforwarding ', 'listenaddress ', 'authenticationmethods '))]
        known_hosts = private / 'known_hosts'
        host_public = ' '.join((private / 'host_key.pub').read_text().split()[:2])
        known_hosts.write_text(f'[127.0.0.1]:{ssh_port} {host_public}\n')
        os.chown(known_hosts, account.pw_uid, account.pw_gid)
        os.chmod(known_hosts, 0o600)
        sshd_log = open(private / 'sshd.log', 'w')
        logs.append(sshd_log)
        sshd = subprocess.Popen(['/usr/sbin/sshd', '-D', '-e', '-f', str(config)], stdout=sshd_log, stderr=sshd_log)
        processes.append(sshd)
        eventually(lambda: socket_ready(ssh_port))
        assert tcp_result('127.0.0.1', 17777) == errno.ECONNREFUSED, 'Local forward port already in use'
        ssh_log = open(private / 'ssh.log', 'w')
        logs.append(ssh_log)
        client = ['runuser', '-u', account.pw_name, '--', 'ssh', '-F', '/dev/null', '-N', '-T', '-p', str(ssh_port), '-i', str(private / 'client_key'),
                  '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=yes', '-o', f'UserKnownHostsFile={known_hosts}',
                  '-o', 'GlobalKnownHostsFile=/dev/null', '-o', 'ExitOnForwardFailure=yes', '-o', 'ConnectTimeout=5',
                  '-L', f'127.0.0.1:17777:{web_socket}', f'{account.pw_name}@127.0.0.1']
        ssh = subprocess.Popen(client, stdout=ssh_log, stderr=ssh_log)
        processes.append(ssh)
        eventually(web_ready)
        status, body = http_probe(headers={'Origin': 'http://localhost:17777'})
        data = json.loads(body)
        assert status == 200 and data['peer'] == WEB_IP and data['node'] == proof['node']
        assert ssh.poll() is None
        proof['sshClient'] = run('ssh', '-V', check=False).stderr.strip()
        passed('real-linux-ssh-to-nginx-unix-socket-to-node24', data)

        for host in ['evil.invalid', 'LOCALHOST:17777', '127.0.0.1:17777', 'localhost.:17777', '[::1]:17777']:
            assert http_probe(headers={'Host': host})[0] == 421, host
        assert http_probe(headers={'Origin': 'https://untrusted.invalid'})[0] == 403
        for header in ['Forwarded', 'X-Forwarded-For', 'X-Forwarded-Host', 'X-Forwarded-Proto', 'X-Real-IP', 'X-Forwarded-Unrecognized']:
            for value in ['', '172.30.77.3']:
                assert http_probe(headers={header: value})[0] == 403, (header, value)
        assert raw_probe(['GET /api/fixture HTTP/1.1', 'Host: localhost:17777', 'Host: localhost:17777']) == 400
        assert raw_probe(['GET http://localhost:17777/api/fixture HTTP/1.1', 'Host: localhost:17777']) == 400
        assert http_probe()[0] == 200
        passed('tunnel-host-origin-duplicate-host-absolute-target-and-empty-proxy-header-rejections')

        # A real HTTP 403 with observed gateway peer is the positive routing
        # control. Connection errors do not count as strict-peer rejection.
        status, body = http_probe(API_IP, 3001)
        assert status == 403 and json.loads(body)['peer'] == '172.30.77.1'
        for header in ['X-Forwarded-For', 'X-Real-IP', 'Forwarded']:
            status, body = http_probe(API_IP, 3001, headers={header: WEB_IP})
            assert status == 403 and json.loads(body)['peer'] == '172.30.77.1'
        passed('strict-api-rejects-real-gateway-and-forged-peer-headers')
        web_pid = web_info['State']['Pid']
        listeners = run('nsenter', '-t', web_pid, '-n', 'ss', '-H', '-lntp').stdout
        # Docker's embedded DNS can own a loopback TCP listener in this network
        # namespace. It is not Nginx or a website/health endpoint.
        assert all(line.split()[3].startswith('127.0.0.11:') and 'nginx' not in line for line in listeners.splitlines()), listeners
        proof['webNetworkTcpListeners'] = listeners.splitlines()
        proof['nginxTcpListeners'] = []
        for port in [80, 443, 8080, 17777]:
            assert tcp_result(WEB_IP, port) == errno.ECONNREFUSED
        passed('no-nginx-ipv4-or-ipv6-tcp-listener-and-real-ip-probes-refuse')

        # Same bridge means no cross-bridge firewall can accidentally make the
        # unrelated-container test pass. API 403 proves an actual network path.
        script = r'''const http=require('node:http'),net=require('node:net'),fs=require('node:fs');
const get=()=>new Promise((ok,no)=>{http.get({host:'172.30.77.2',port:3001,path:'/api/fixture',headers:{Host:'localhost:17777','X-Forwarded-For':'172.30.77.3'}},r=>{let b='';r.on('data',x=>b+=x);r.on('end',()=>ok({status:r.statusCode,body:JSON.parse(b)}));}).on('error',no);});
const connect=o=>new Promise((ok,no)=>{const s=net.connect(o);s.setTimeout(3000,()=>{s.destroy();no(Error('timeout is not evidence of refusal'));});s.once('connect',()=>{s.destroy();no(Error('unexpected connection'));});s.once('error',e=>ok(e.code));});
(async()=>{const control=await get();if(control.status!==403||control.body.peer!=='172.30.77.4')throw Error(JSON.stringify(control));
for(const port of [80,443,8080,17777])if(await connect({host:'172.30.77.3',port})!=='ECONNREFUSED')throw Error('wrong TCP failure');
for(const path of [process.argv[1],'/run/probe-web/web.sock'])if(await connect({path})!=='ENOENT')throw Error('unexpected socket path');
console.log(JSON.stringify({control,webTcp:'ECONNREFUSED',socket:'ENOENT',mountAbsent:!fs.existsSync('/run/probe-web')}));})();'''
        unrelated = json.loads(docker('exec', CONTAINERS[2], 'node', '-e', script, str(web_socket)).stdout)
        assert unrelated['mountAbsent']
        passed('unrelated-container-positive-route-control-and-denied-web-tcp-and-socket', unrelated)

        # Valid positive control under the SAME unauthorized UID, without
        # granting traversal to the protected parent even momentarily.
        with tempfile.TemporaryDirectory(prefix='ssh-socket-control-', dir='/tmp') as control_dir:
            os.chmod(control_dir, 0o755)
            control_path = str(Path(control_dir) / 'control.sock')
            with socket.socket(socket.AF_UNIX) as control:
                control.bind(control_path)
                control.listen(2)
                os.chmod(control_path, 0o666)
                uid_probe = 'import errno,socket,sys; s=socket.socket(socket.AF_UNIX); rc=s.connect_ex(sys.argv[1]); print(rc); sys.exit(0 if rc==int(sys.argv[2]) else 1)'
                run('setpriv', '--reuid=65534', '--regid=65534', '--clear-groups', 'python3', '-c', uid_probe, control_path, '0')
                connection, _ = control.accept()
                connection.close()
                run('setpriv', '--reuid=65534', '--regid=65534', '--clear-groups', 'python3', '-c', uid_probe, web_socket, str(errno.EACCES))
        direct = as_user('curl', '--silent', '--show-error', '--max-time', '3', '--unix-socket', web_socket, '-H', 'Host: localhost:17777', 'http://localhost/api/fixture')
        assert json.loads(direct.stdout)['peer'] == WEB_IP
        passed('unauthorized-host-uid-eacces-with-working-same-uid-socket-control')

        docker('stop', '-t', '5', CONTAINERS[1])
        assert not web_socket.exists(), 'Nginx graceful stop must unlink the socket'
        docker('start', CONTAINERS[1])
        eventually(web_ready)
        assert stat.S_IMODE(web_socket.stat().st_mode) == 0o666
        passed('graceful-restart-recreates-socket-and-existing-ssh-tunnel-recovers')
        docker('kill', '--signal', 'KILL', CONTAINERS[1])
        eventually(lambda: not inspect(CONTAINERS[1])['State']['Running'])
        assert web_socket.is_socket(), 'Crash should leave the stale pathname for the fail-closed test'
        docker('start', CONTAINERS[1])
        eventually(lambda: not inspect(CONTAINERS[1])['State']['Running'])
        assert inspect(CONTAINERS[1])['State']['ExitCode'] == 73
        try:
            status, _ = http_probe()
            assert status != 200
        except (OSError, http.client.HTTPException):
            pass
        # Only now, after the stopped process and inode type/owner are verified,
        # does this ephemeral harness remove its own stale socket.
        assert stat.S_ISSOCK(web_socket.lstat().st_mode) and web_socket.lstat().st_uid == web_uid
        web_socket.unlink()
        for kind in ['regular-file', 'symlink']:
            if kind == 'regular-file':
                web_socket.write_text('untrusted fixture')
            else:
                web_socket.symlink_to(private / 'missing-target')
            docker('start', CONTAINERS[1])
            eventually(lambda: not inspect(CONTAINERS[1])['State']['Running'])
            assert inspect(CONTAINERS[1])['State']['ExitCode'] == 73
            assert web_socket.is_symlink() if kind == 'symlink' else web_socket.is_file()
            web_socket.unlink()
        docker('start', CONTAINERS[1])
        eventually(web_ready)
        passed('crash-stale-file-and-symlink-fail-closed-then-owned-socket-recovery')
        assert_no_publication()
        proof['hostListeners'] = run('ss', '-H', '-lntp').stdout.splitlines()
        relevant = [line for line in proof['hostListeners'] if f':{ssh_port} ' in line or ':17777 ' in line]
        assert len(relevant) == 2 and all('127.0.0.1:' in line for line in relevant), relevant
        proof['probeListeners'] = relevant
        proof.pop('hostListeners')  # Unrelated runner process details are unnecessary.
        passed('ssh-server-and-client-forward-listeners-loopback-only')
        proof['status'] = 'passed'
    except BaseException as error:
        proof['status'] = 'failed'
        proof['error'] = f'{type(error).__name__}: {error}'
        raise
    finally:
        for process in reversed(processes):
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
        for handle in logs:
            handle.close()
        for name in created_containers:
            result = docker('logs', name, check=False)
            (output / f'{name}.log').write_text(result.stdout + result.stderr)
            docker('rm', '-f', name, check=False)
        for name in ['sshd.log', 'ssh.log']:
            if (private / name).exists():
                (output / name).write_text((private / name).read_text())
        if created_network:
            docker('network', 'rm', NETWORK, check=False)
        shutil.rmtree(private)
        (output / 'linux-proof.json').write_text(json.dumps(proof, indent=2) + '\n')


def socket_ready(port):
    with socket.create_connection(('127.0.0.1', port), timeout=.5):
        return True


def tcp_result(host, port):
    with socket.socket() as connection:
        connection.settimeout(3)
        return connection.connect_ex((host, port))


if __name__ == '__main__':
    main()
