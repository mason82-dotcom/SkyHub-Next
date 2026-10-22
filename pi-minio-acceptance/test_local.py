#!/usr/bin/env python3
"""Tests use only temporary fixture data; never call Docker, mount or cryptsetup."""
import importlib.util
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('manifest_helper', HERE/'manifest.py')
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)
legacy_spec = importlib.util.spec_from_file_location('legacy_guard', HERE/'legacy_guard.py')
legacy = importlib.util.module_from_spec(legacy_spec)
legacy_spec.loader.exec_module(legacy)
def load_module(name):
    spec = importlib.util.spec_from_file_location(name, HERE/(name+'.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
recovery = load_module('recover_backup')
launcher = load_module('launch_backup')


class AcceptancePreparationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)/'source'
        self.root.mkdir()
        (self.root/'file').write_bytes(b'fixture contents')

    def tearDown(self):
        self.temp.cleanup()

    def rows(self):
        return {r['path']: r for r in helper.records(self.root)}

    def test_identical_copy_matches(self):
        copy = Path(self.temp.name)/'restore'
        shutil.copytree(self.root, copy, copy_function=shutil.copy2)
        self.assertEqual(self.rows(), {r['path']: r for r in helper.records(copy)})

    def test_content_tampering_detected(self):
        before = self.rows()
        (self.root/'file').write_bytes(b'fixture contentX')
        self.assertNotEqual(before, self.rows())

    def test_extra_file_detected(self):
        before = self.rows()
        (self.root/'extra').write_bytes(b'')
        self.assertNotEqual(before, self.rows())

    def test_owner_mode_metadata_captured(self):
        before = self.rows()
        (self.root/'file').chmod(0o600)
        self.assertNotEqual(before['file']['mode'], self.rows()['file']['mode'])

    def test_symlink_refused(self):
        (self.root/'link').symlink_to('file')
        with self.assertRaises(RuntimeError): list(helper.records(self.root))

    def test_missing_root_refused(self):
        with self.assertRaises(RuntimeError):
            list(helper.records(self.root/'absent'))

    def test_no_argument_write_guards(self):
        for script in ('backup.sh', 'restore.sh'):
            result = subprocess.run(['bash', str(HERE/script)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 2)
            self.assertIn('NOT EXECUTED', result.stdout)

    def test_all_shell_syntax(self):
        for script in ('preflight.sh', 'backup.sh', 'restore.sh'):
            self.assertEqual(subprocess.run(['bash', '-n', str(HERE/script)]).returncode, 0)

    def test_removed_legacy_containers_allowed(self):
        self.assertEqual(legacy.check_legacy([]), (2, 0))

    def test_stopped_legacy_containers_allowed(self):
        rows = [{'Name': name, 'State': {'Running': False}} for name in legacy.LEGACY]
        self.assertEqual(legacy.check_legacy(rows), (0, 2))

    def test_one_absent_one_stopped_allowed(self):
        row = {'Name': sorted(legacy.LEGACY)[0], 'State': {'Running': False}}
        self.assertEqual(legacy.check_legacy([row]), (1, 1))

    def test_running_legacy_container_rejected(self):
        row = {'Name': sorted(legacy.LEGACY)[0], 'State': {'Running': True}}
        with self.assertRaises(ValueError): legacy.check_legacy([row])

    def test_unknown_legacy_state_rejected(self):
        row = {'Name': sorted(legacy.LEGACY)[0], 'State': {}}
        with self.assertRaises(ValueError): legacy.check_legacy([row])

    def test_docker_inventory_failure_not_treated_as_absence(self):
        from unittest.mock import patch
        with patch.object(legacy.subprocess, 'check_output',
                          side_effect=subprocess.CalledProcessError(1, 'docker')):
            with self.assertRaises(subprocess.CalledProcessError): legacy.main()

    def test_old_direct_backup_invocation_refused(self):
        r = subprocess.run(['bash', str(HERE/'backup.sh'), '--execute-backup'],
                           capture_output=True, text=True)
        self.assertEqual(r.returncode, 2)
        self.assertIn('NOT EXECUTED', r.stdout)

    def test_worker_without_systemd_credentials_refused(self):
        import os
        env = os.environ.copy()
        env.pop('INVOCATION_ID', None)
        env.pop('CREDENTIALS_DIRECTORY', None)
        r = subprocess.run(['bash', str(HERE/'backup.sh'), '--systemd-worker'],
                           env=env, capture_output=True, text=True)
        self.assertEqual(r.returncode, 2)

    def test_launcher_is_detached_with_credential_and_poststop_recovery(self):
        args = launcher.unit_command(Path('/run/skyhub-backup-job-fixture'))
        self.assertIn('--property=Type=exec', args)
        self.assertIn('--property=KillMode=control-group', args)
        self.assertIn('--property=StandardInput=null', args)
        self.assertTrue(any(x.startswith('--property=LoadCredential=') for x in args))
        self.assertTrue(any(x.startswith('--property=ExecStopPost=') for x in args))
        for forbidden in ('--pty', '--pipe', '--scope', '--wait', '--user'):
            self.assertNotIn(forbidden, args)
        self.assertIn('/usr/bin/flock', args)

    def test_launcher_without_execute_argument_does_not_start_job(self):
        import sys
        r = subprocess.run([sys.executable, str(HERE/'launch_backup.py')],
                           capture_output=True, text=True)
        self.assertEqual(r.returncode, 2)
        self.assertIn('NOT EXECUTED', r.stdout)

    def recovery_fixture(self, running=False, uuid=None, changed=False, writer=False):
        import json
        run = Path(self.temp.name)/'job'
        run.mkdir()
        (run/'restart-needed.json').write_text(json.dumps({'container_id': 'original-id'}))
        obj = {'Id': 'changed-id' if changed else 'original-id',
               'Name': '/skyhub-next-minio-1', 'Image': recovery.IMAGE,
               'Mounts': [{'Type': 'bind', 'Destination': '/data', 'Source': recovery.SOURCE}],
               'State': {'Running': running}}
        inspections = 0
        def output(*args):
            nonlocal inspections
            if args[0] == 'findmnt':
                return (uuid if uuid is not None else recovery.UUID) if args[-1] == 'UUID' else '/mnt/hc4backup'
            if args == ('docker', 'ps', '-q'):
                return 'other-id' if writer else ''
            if args == ('docker', 'inspect', 'other-id'):
                return json.dumps([{'Id': 'other-id', 'Name': '/other-minio', 'Config': {'Image': 'minio'}, 'Mounts': []}])
            if args == ('docker', 'inspect', 'skyhub-next-minio-1'):
                inspections += 1
                value = dict(obj)
                value['State'] = {'Running': running or inspections > 1}
                return json.dumps([value])
            raise AssertionError('Unexpected read')
        return run, output

    def perform_mock_recovery(self, run, output):
        from unittest.mock import patch
        with patch.object(recovery, 'checked_directory', return_value=run), \
             patch.object(recovery, 'output', side_effect=output), \
             patch.object(recovery.Path, 'is_dir', return_value=True), \
             patch.object(recovery.Path, 'is_symlink', return_value=False), \
             patch.object(recovery.subprocess, 'run') as start:
            recovery.recover(run)
            return start

    def test_recovery_starts_only_original_container(self):
        run, output = self.recovery_fixture()
        start = self.perform_mock_recovery(run, output)
        self.assertEqual(start.call_args.args[0], ['docker', 'start', 'original-id'])
        self.assertFalse((run/'restart-needed.json').exists())

    def test_recovery_does_not_restart_running_container(self):
        run, output = self.recovery_fixture(running=True)
        start = self.perform_mock_recovery(run, output)
        start.assert_not_called()

    def test_recovery_refuses_wrong_uuid(self):
        run, output = self.recovery_fixture(uuid='wrong')
        with self.assertRaises(ValueError): self.perform_mock_recovery(run, output)
        self.assertTrue((run/'restart-needed.json').exists())

    def test_recovery_refuses_replaced_container(self):
        run, output = self.recovery_fixture(changed=True)
        with self.assertRaises(ValueError): self.perform_mock_recovery(run, output)
        self.assertTrue((run/'restart-needed.json').exists())

    def test_recovery_refuses_competing_minio(self):
        run, output = self.recovery_fixture(writer=True)
        with self.assertRaises(ValueError): self.perform_mock_recovery(run, output)

    def test_recovery_without_marker_does_not_read_docker(self):
        from unittest.mock import patch
        run = Path(self.temp.name)/'job'
        run.mkdir()
        with patch.object(recovery, 'checked_directory', return_value=run), \
             patch.object(recovery, 'output') as read:
            recovery.recover(run)
            read.assert_not_called()


if __name__ == '__main__':
    unittest.main()
