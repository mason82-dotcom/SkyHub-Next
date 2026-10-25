#!/usr/bin/env python3
"""Explicitly approved launcher; worker belongs to systemd, not the SSH session."""
import argparse
import getpass
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

FILES = ('backup.sh', 'legacy_guard.py', 'manifest.py', 'recover_backup.py')


def unit_command(run):
    return [
        'systemd-run', '--unit=skyhub-minio-backup',
        '--description=SkyHub guarded offline MinIO backup',
        '--property=Type=exec', '--property=Restart=no',
        '--property=KillMode=control-group', '--property=TimeoutStopSec=180',
        '--property=UMask=0077', '--property=StandardInput=null',
        '--property=StandardOutput=journal', '--property=StandardError=journal',
        '--property=Nice=10',
        '--property=LoadCredential=archive-passphrase:'+str(run/'passphrase'),
        '--property=ExecStopPost=/usr/bin/python3 '+str(run/'recover_backup.py')+' '+str(run),
        '--setenv=SKYHUB_BACKUP_RUN_DIR='+str(run),
        '--', '/usr/bin/flock', '-n', '/run/lock/skyhub-minio-backup.lock',
        '/usr/bin/bash', str(run/'backup.sh'), '--systemd-worker'
    ]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--execute-backup', action='store_true')
    args = parser.parse_args()
    if not args.execute_backup:
        print('NOT EXECUTED. Separate approval required; then use --execute-backup.')
        return 2
    if os.geteuid() != 0:
        raise RuntimeError('Root required')
    for name in ('systemd-run', 'systemctl', 'flock', 'docker', 'gpg', 'tar', 'zstd'):
        if not shutil.which(name):
            raise RuntimeError('Required tool missing')
    fs = subprocess.check_output(['findmnt', '-nr', '-T', '/run', '-o', 'FSTYPE'], text=True).strip()
    if fs != 'tmpfs':
        raise RuntimeError('/run must be tmpfs')
    result = subprocess.run(['systemctl', 'show', 'skyhub-minio-backup.service',
                             '-p', 'LoadState', '--value'], capture_output=True, text=True)
    if result.returncode != 0 or result.stdout.strip() != 'not-found':
        raise RuntimeError('Existing/unknown backup unit; inspect before retry, do not reset blindly')
    if input('All S3 users accounted for; maintenance approved? Type BACKUP: ') != 'BACKUP':
        return 2
    password = getpass.getpass('New archive passphrase (store separately): ')
    if not password or '\n' in password or '\r' in password:
        raise RuntimeError('Empty or multiline passphrase refused')
    if password != getpass.getpass('Repeat passphrase: '):
        raise RuntimeError('Passphrases differ')
    os.umask(0o077)
    run = Path(tempfile.mkdtemp(prefix='skyhub-backup-job-', dir='/run'))
    for name in FILES:
        shutil.copyfile(Path(__file__).resolve().parent/name, run/name)
    secret = run/'passphrase'
    secret.write_text(password+'\n')
    del password
    # From handoff until systemd confirms Type=exec startup, ignore connection
    # signals: deleting the credential before systemd has copied it is unsafe.
    import signal
    for sig in (signal.SIGHUP, signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, signal.SIG_IGN)
    result = subprocess.run(unit_command(run), capture_output=True, text=True, timeout=60)
    if result.returncode:
        # No blind cleanup: first establish whether systemd accepted the job.
        print('ERROR: handoff status uncertain; inspect skyhub-minio-backup.service.')
        print('Private job directory:', run)
        return 1
    secret.unlink(missing_ok=True)  # systemd has copied the credential before exec.
    print('Backup handed to systemd: skyhub-minio-backup.service')
    print('Private job directory:', run)
    print('SSH may disconnect; monitor with systemctl/journalctl. Do not launch twice.')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception:
        print('ERROR: launcher did not confirm startup; inspect unit before retrying. No raw details printed.',
              file=sys.stderr)
        sys.exit(1)
