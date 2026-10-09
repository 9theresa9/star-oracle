"""Regression tests for the bounded protocol fixture, with real system SSH."""
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import unittest


SCRIPT = Path(__file__).with_name('run-windows.py')


class WindowsProtocolProbeTests(unittest.TestCase):
    def run_probe(self, *args):
        with tempfile.TemporaryDirectory(prefix='ssh-probe-report-') as folder:
            report = Path(folder) / 'report.json'
            result = subprocess.run(
                [sys.executable, str(SCRIPT), '--output', str(report), *args],
                capture_output=True, text=True, timeout=75,
            )
            self.assertTrue(report.exists(), {'stdout': result.stdout, 'stderr': result.stderr})
            return result, json.loads(report.read_text())

    def test_real_ssh_http_and_exact_streamlocal_destination(self):
        args = [] if os.name == 'nt' else ['--allow-non-windows']
        result, report = self.run_probe(*args)
        self.assertEqual(result.returncode, 0, {'report': report, 'stderr': result.stderr})
        self.assertEqual(report['status'], 'passed')
        expected_commit = subprocess.check_output(
            ['git', 'rev-parse', 'HEAD'], cwd=SCRIPT.resolve().parents[2], text=True, timeout=5,
        ).strip()
        self.assertEqual(report['commit'], expected_commit)
        self.assertEqual(report['windowsNativeTest'], os.name == 'nt')
        self.assertEqual(report['http']['status'], 200)
        self.assertEqual(report['http']['body'], 'synthetic-streamlocal-ok\n')
        self.assertEqual(report['channels'], [{
            'type': 'direct-streamlocal@openssh.com',
            'destination': '/run/star-oracle-probe/web.sock',
        }])
        self.assertEqual(report['http']['requestLine'], 'GET /protocol-probe HTTP/1.1')
        self.assertTrue(report['cleanup']['sshExited'])
        self.assertTrue(report['cleanup']['listenerClosed'])
        self.assertTrue(report['cleanup']['temporaryFilesRemoved'])
        self.assertIn('mock SSH server', report['scope'])
        if os.name == 'nt':
            expected = Path(os.environ['WINDIR']) / 'System32' / 'OpenSSH' / 'ssh.exe'
            self.assertEqual(Path(report['sshExecutable']), expected.resolve())

    @unittest.skipIf(os.name == 'nt', 'Non-Windows safeguard')
    def test_default_does_not_claim_windows_on_linux(self):
        result, report = self.run_probe()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('requires Windows', report['error'])
        self.assertFalse(report['windowsNativeTest'])

    @unittest.skipIf(os.name == 'nt', 'POSIX fixture self-check repeatability')
    def test_repeated_selfchecks_do_not_treat_time_wait_as_listener(self):
        for _ in range(2):
            result, report = self.run_probe('--allow-non-windows')
            self.assertEqual(result.returncode, 0, report)

    def test_existing_forward_port_is_not_touched(self):
        with socket.socket() as listener:
            if os.name == 'nt':
                listener.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
            else:
                listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            listener.bind(('127.0.0.1', 17777))
            listener.listen(1)
            args = [] if os.name == 'nt' else ['--allow-non-windows']
            result, report = self.run_probe(*args)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('17777', report['error'])
            self.assertEqual(listener.getsockname(), ('127.0.0.1', 17777))
            self.assertNotIn('channels', report)


if __name__ == '__main__':
    unittest.main()
