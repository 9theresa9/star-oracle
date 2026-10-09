#!/usr/bin/env python3
"""Native Windows TCP-to-remote-UNIX protocol probe against a loopback mock.

No Windows account, real server, Linux socket, application, or credentials are
used. The separate Linux job tests real sshd -> Nginx -> Node. A non-Windows
run requires explicit opt-in and is only a fixture self-check.
"""
import argparse
import asyncio
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile

import asyncssh


LOCAL_HOST, LOCAL_PORT = '127.0.0.1', 17777
REMOTE_PATH = '/run/star-oracle-probe/web.sock'
USERNAME = 'synthetic-probe'
BODY = b'synthetic-streamlocal-ok\n'
REQUEST = b'GET /protocol-probe HTTP/1.1\r\nHost: localhost:17777\r\nConnection: close\r\n\r\n'
RESPONSE = (b'HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: '
            + str(len(BODY)).encode() + b'\r\nConnection: close\r\n\r\n' + BODY)


def ssh_executable(allow_non_windows):
    if os.name == 'nt':
        # Never consult PATH: Git for Windows ships a different SSH client.
        path = Path(os.environ['WINDIR']) / 'System32' / 'OpenSSH' / 'ssh.exe'
    elif allow_non_windows:
        found = shutil.which('ssh')
        if not found:
            raise RuntimeError('No system ssh for the explicit non-Windows fixture self-check')
        path = Path(found)
    else:
        raise RuntimeError('Native compatibility test requires Windows; use --allow-non-windows only for a fixture self-check')
    if not path.is_file():
        raise RuntimeError(f'Required SSH executable is missing: {path}')
    return path.resolve()


def protect_private_key(path):
    if os.name != 'nt':
        path.chmod(0o600)
        return 'POSIX 0600 (non-Windows fixture self-check)'
    # Apply a fresh protected DACL to this one temporary CI key, retaining only
    # the current CI user's SID. No inherited Users/Authenticated Users ACEs.
    powershell = Path(os.environ['WINDIR']) / 'System32' / 'WindowsPowerShell' / 'v1.0' / 'powershell.exe'
    script = r'''
$ErrorActionPreference = 'Stop'
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$acl = New-Object System.Security.AccessControl.FileSecurity
$acl.SetOwner($sid)
$acl.SetAccessRuleProtection($true, $false)
$rule = New-Object System.Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'Allow')
$acl.AddAccessRule($rule)
Set-Acl -LiteralPath $env:SSH_PROBE_KEY_FILE -AclObject $acl
$actual = Get-Acl -LiteralPath $env:SSH_PROBE_KEY_FILE
if (-not $actual.AreAccessRulesProtected -or $actual.GetOwner([System.Security.Principal.SecurityIdentifier]) -ne $sid) { throw 'Unexpected key owner or inherited ACL' }
$rules = @($actual.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]))
if ($rules.Count -ne 1 -or $rules[0].IdentityReference -ne $sid -or $rules[0].AccessControlType -ne 'Allow') { throw 'Private key ACL is not limited to the CI user' }
'''
    result = subprocess.run(
        [str(powershell), '-NoProfile', '-NonInteractive', '-Command', script],
        env={**os.environ, 'SSH_PROBE_KEY_FILE': str(path)},
        text=True, capture_output=True, timeout=10,
    )
    if result.returncode:
        raise RuntimeError(f'Temporary key ACL setup failed: {result.stderr.strip()}')
    return 'Protected DACL verified: current CI user only'


async def probe(executable, proof):
    reservation = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    if os.name == 'nt':
        reservation.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
    else:
        # Allow a repeat self-check after our old TCP connection reaches
        # TIME_WAIT. A live listening socket still makes this bind fail.
        reservation.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        reservation.bind((LOCAL_HOST, LOCAL_PORT))
    except OSError as error:
        reservation.close()
        raise RuntimeError(f'Refusing occupied/unavailable loopback port {LOCAL_PORT}: {error}') from error

    private = tempfile.TemporaryDirectory(prefix='ssh-streamlocal-probe-')
    folder = Path(private.name)
    server = process = communication = None
    connections = []
    proof['channels'] = []
    proof['cleanup'] = {}

    class SyntheticHTTP(asyncssh.SSHUNIXSession):
        def connection_made(self, channel):
            self.channel = channel
            self.buffer = b''
            self.responded = False

        def data_received(self, data, datatype):
            if self.responded:
                return
            self.buffer += data
            if len(self.buffer) > 4096:
                self.channel.abort()
            elif b'\r\n\r\n' in self.buffer:
                self.responded = True
                proof['requestLine'] = self.buffer.split(b'\r\n', 1)[0].decode('ascii')
                if self.buffer != REQUEST:
                    self.channel.abort()
                    return
                self.channel.write(RESPONSE)
                self.channel.close()

    class MockSSHServer(asyncssh.SSHServer):
        def connection_made(self, connection):
            connections.append(connection)

        def begin_auth(self, username):
            return True

        def public_key_auth_supported(self):
            return True

        def validate_public_key(self, username, key):
            return username == USERNAME and key == client_key.convert_to_public()

        def auth_completed(self):
            proof['publicKeyAuthentication'] = True

        def unix_connection_requested(self, destination):
            # AsyncSSH dispatches only direct-streamlocal@openssh.com channel
            # opens to this callback. A TCP channel takes the rejecting method
            # below instead. The fake path is checked, never opened locally.
            proof['channels'].append({'type': 'direct-streamlocal@openssh.com', 'destination': destination})
            if destination != REMOTE_PATH:
                return False
            return SyntheticHTTP()

        def connection_requested(self, destination, port, originator, originator_port):
            proof['channels'].append({'type': 'direct-tcpip', 'destination': destination, 'port': port})
            return False

    try:
        host_key = asyncssh.generate_private_key('ssh-ed25519')
        client_key = asyncssh.generate_private_key('ssh-ed25519')
        key_path = folder / 'client_key'
        key_path.touch(mode=0o600)
        proof['privateKeyProtection'] = protect_private_key(key_path)
        key_path.write_bytes(client_key.export_private_key('openssh'))
        empty_config = folder / 'empty_config'
        empty_config.write_text('')
        server = await asyncssh.create_server(
            MockSSHServer, LOCAL_HOST, 0, family=socket.AF_INET,
            server_host_keys=[host_key], encoding=None,
            public_key_auth=True, password_auth=False, kbdint_auth=False,
            login_timeout=10,
        )
        ssh_port = server.get_port()
        proof['mockListener'] = f'{LOCAL_HOST}:{ssh_port}'
        known_hosts = folder / 'known_hosts'
        known_hosts.write_bytes(f'[{LOCAL_HOST}]:{ssh_port} '.encode() + host_key.export_public_key('openssh'))
        proof['hostKeyFingerprint'] = host_key.get_fingerprint()
        proof['hostKeyVerification'] = 'StrictHostKeyChecking=yes; known_hosts from this generated host public key'
        command = [str(executable), '-F', str(empty_config), '-N', '-T',
                   '-p', str(ssh_port), '-l', USERNAME, '-i', str(key_path)]
        for option in [
            'BatchMode=yes', 'IdentitiesOnly=yes', 'IdentityAgent=none',
            'PreferredAuthentications=publickey', 'PasswordAuthentication=no',
            'KbdInteractiveAuthentication=no', 'StrictHostKeyChecking=yes',
            f'UserKnownHostsFile="{known_hosts.as_posix()}"',
            f'GlobalKnownHostsFile="{empty_config.as_posix()}"',
            'VerifyHostKeyDNS=no', 'UpdateHostKeys=no', 'ForwardAgent=no',
            'ExitOnForwardFailure=yes', 'ConnectTimeout=5',
            'ConnectionAttempts=1', 'LogLevel=ERROR',
        ]:
            command.extend(['-o', option])
        command.extend(['-L', f'{LOCAL_HOST}:{LOCAL_PORT}:{REMOTE_PATH}', LOCAL_HOST])
        # Reserve until launch to catch pre-existing listeners, then rely on
        # ExitOnForwardFailure for the unavoidable release/bind race.
        reservation.close()
        process = await asyncio.create_subprocess_exec(
            *command, stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )
        communication = asyncio.create_task(process.communicate())
        while True:
            if process.returncode is not None:
                _, stderr = await communication
                raise RuntimeError(f'SSH exited before HTTP ({process.returncode}): {stderr.decode(errors="replace").strip()}')
            try:
                reader, writer = await asyncio.open_connection(LOCAL_HOST, LOCAL_PORT)
                break
            except (ConnectionRefusedError, OSError):
                await asyncio.sleep(0.1)
        try:
            writer.write(REQUEST)
            await writer.drain()
            response = b''
            while len(response) <= 4096:
                chunk = await asyncio.wait_for(reader.read(4096), timeout=5)
                if not chunk:
                    break
                response += chunk
        finally:
            writer.close()
            await asyncio.wait_for(writer.wait_closed(), timeout=5)
        if response != RESPONSE:
            raise AssertionError(f'Unexpected synthetic HTTP response: {response!r}')
        expected = [{'type': 'direct-streamlocal@openssh.com', 'destination': REMOTE_PATH}]
        if proof['channels'] != expected or not proof.get('publicKeyAuthentication'):
            raise AssertionError(f'Expected one authenticated streamlocal channel: {proof["channels"]!r}')
        if process.returncode is not None:
            raise AssertionError('SSH stopped unexpectedly during HTTP exchange')
        proof['localListener'] = f'{LOCAL_HOST}:{LOCAL_PORT}'
        proof['http'] = {'status': 200, 'body': BODY.decode(), 'requestLine': proof.pop('requestLine')}
    finally:
        reservation.close()
        try:
            if process is not None:
                if process.returncode is None:
                    try:
                        process.terminate()
                    except ProcessLookupError:
                        pass
                try:
                    await asyncio.wait_for(process.wait(), timeout=5)
                except asyncio.TimeoutError:
                    process.kill()
                    await asyncio.wait_for(process.wait(), timeout=5)
                proof['cleanup']['sshExited'] = process.returncode is not None
                if communication is not None:
                    _, stderr = await asyncio.wait_for(communication, timeout=5)
                    if stderr:
                        proof['sshDiagnostic'] = stderr.decode(errors='replace').strip()
        finally:
            try:
                if server is not None:
                    server.close()
                    for connection in connections:
                        connection.abort()
                    await asyncio.wait_for(server.wait_closed(), timeout=5)
                    await asyncio.wait_for(asyncio.gather(*(connection.wait_closed() for connection in connections)), timeout=5)
                    proof['cleanup']['listenerClosed'] = True
            finally:
                private.cleanup()
                proof['cleanup']['temporaryFilesRemoved'] = not folder.exists()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=Path('artifacts/ssh-socket-windows.json'))
    parser.add_argument('--allow-non-windows', action='store_true', help='Explicit fixture self-check; never Windows compatibility evidence')
    args = parser.parse_args()
    proof = {
        'status': 'failed', 'windowsNativeTest': os.name == 'nt',
        'scope': 'Native Windows SSH protocol against mock SSH server' if os.name == 'nt' else 'Non-Windows fixture self-check against mock SSH server',
        'platform': sys.platform, 'python': sys.version.split()[0], 'asyncssh': asyncssh.__version__,
        'commit': None,
        'notProven': ['Real Linux SSH server or Unix socket', 'Windows-to-real-Linux/Nginx/Node end-to-end or full application',
                      'Other Windows SSH versions', 'Production server or user accounts'],
    }
    try:
        # PR event GITHUB_SHA can name a merge commit while checkout tests the
        # PR head. Resolve provenance from the checkout containing this script.
        proof['commit'] = subprocess.check_output(
            ['git', 'rev-parse', '--verify', 'HEAD'], cwd=Path(__file__).resolve().parents[2],
            text=True, stderr=subprocess.DEVNULL, timeout=5,
        ).strip()
    except (OSError, subprocess.SubprocessError):
        pass
    try:
        executable = ssh_executable(args.allow_non_windows)
        proof['sshExecutable'] = str(executable)
        version = subprocess.run([str(executable), '-V'], text=True, capture_output=True, timeout=5, check=True)
        proof['sshVersion'] = (version.stdout + version.stderr).strip()
        if os.name == 'nt' and 'OpenSSH_for_Windows' not in proof['sshVersion']:
            raise RuntimeError('The required native executable did not identify as OpenSSH_for_Windows')
        asyncio.run(asyncio.wait_for(probe(executable, proof), timeout=30))
        proof['status'] = 'passed'
    except (Exception, KeyboardInterrupt) as error:
        proof['error'] = f'{type(error).__name__}: {error}'
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(proof, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(proof, indent=2), flush=True)
    return 0 if proof['status'] == 'passed' else 1


if __name__ == '__main__':
    sys.exit(main())
