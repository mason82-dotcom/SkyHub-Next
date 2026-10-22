#!/usr/bin/env python3
"""ExecStopPost recovery for this backup job only; never create a container."""
import fcntl
import json
import os
from pathlib import Path
import stat
import subprocess
import sys

SOURCE = '/mnt/hc4backup/skyhub-next/minio'
UUID = 'ad583d3f-9bfe-4792-829c-1cc2b6738358'
IMAGE = 'sha256:117cf7edd050e6acd4a2d06be79b15eaecd5af76ad73e8927a4bf67528f19d10'


def checked_directory(path):
    path = Path(path)
    if path.parent != Path('/run') or not path.name.startswith('skyhub-backup-job-'):
        raise ValueError('Invalid job directory')
    s = path.lstat()
    if not stat.S_ISDIR(s.st_mode) or s.st_uid != 0 or stat.S_IMODE(s.st_mode) != 0o700:
        raise ValueError('Unsafe job directory')
    return path


def validate_identity(obj, marker):
    if obj.get('Id') != marker.get('container_id') or obj.get('Name') != '/skyhub-next-minio-1':
        raise ValueError('Container identity changed')
    if obj.get('Image') != IMAGE:
        raise ValueError('Image changed')
    mounts = [m for m in obj.get('Mounts', []) if m.get('Destination') == '/data']
    if len(mounts) != 1 or mounts[0].get('Type') != 'bind' or mounts[0].get('Source') != SOURCE:
        raise ValueError('Data mount changed')


def output(*args):
    return subprocess.check_output(list(args), text=True,
                                   stderr=subprocess.DEVNULL, timeout=30).strip()


def recover(path):
    path = checked_directory(path)
    (path/'passphrase').unlink(missing_ok=True)
    marker_file = path/'restart-needed.json'
    if not marker_file.exists():
        print('Recovery: no restart marker; no container action.')
        return
    if marker_file.is_symlink():
        raise ValueError('Unsafe marker')
    marker = json.loads(marker_file.read_text())
    if output('findmnt', '-nr', '--mountpoint', '/mnt/hc4backup', '-o', 'UUID') != UUID:
        raise ValueError('Source mount UUID not available')
    if output('findmnt', '-nr', '-T', SOURCE, '-o', 'TARGET') != '/mnt/hc4backup':
        raise ValueError('Source resolves to unexpected filesystem')
    if Path(SOURCE).is_symlink() or not (Path(SOURCE)/'.minio.sys').is_dir():
        raise ValueError('Source metadata missing')
    obj = json.loads(output('docker', 'inspect', 'skyhub-next-minio-1'))[0]
    validate_identity(obj, marker)
    # Refuse a concurrent storage server or overlapping writer before restart.
    ids = output('docker', 'ps', '-q').split()
    running = json.loads(output('docker', 'inspect', *ids)) if ids else []
    source = Path(SOURCE)
    for other in running:
        if other.get('Id') == obj['Id']:
            continue
        description = (other.get('Name', '')+' '+other.get('Config', {}).get('Image', '')).lower()
        if ('minio' in description or 'aistor' in description) and 'minio-init' not in description:
            raise ValueError('Another MinIO-like server is running')
        for mount in other.get('Mounts', []):
            if mount.get('Type') == 'bind' and mount.get('RW'):
                p = Path(mount['Source']).resolve()
                if p == source or p in source.parents or source in p.parents:
                    raise ValueError('Overlapping writer is running')
    if obj.get('State', {}).get('Paused') or obj.get('State', {}).get('Restarting'):
        raise ValueError('Container state unsafe for recovery')
    if not obj['State']['Running']:
        subprocess.run(['docker', 'start', obj['Id']], check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=60)
    current = json.loads(output('docker', 'inspect', 'skyhub-next-minio-1'))[0]
    validate_identity(current, marker)
    if not current.get('State', {}).get('Running'):
        raise ValueError('Recovery did not reach running state')
    marker_file.unlink()
    print('Recovery: same existing MinIO is running; readiness still needs checking.')


if __name__ == '__main__':
    try:
        if os.geteuid() != 0:
            raise ValueError('Root required')
        with open('/run/lock/skyhub-minio-backup.lock', 'a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            recover(sys.argv[1])
    except Exception:
        print('CRITICAL: guarded recovery not completed; inspect service and source mount manually.',
              file=sys.stderr)
        sys.exit(1)
