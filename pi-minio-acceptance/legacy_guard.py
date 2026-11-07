#!/usr/bin/env python3
"""Read-only guard: removed legacy containers are allowed; running ones are not."""
import json
import subprocess
import sys

LEGACY = {'/aeronexusadvanced-cloud-minio-1', '/aeronexus-edge-minio-1'}


def check_legacy(containers):
    if not isinstance(containers, list):
        raise ValueError('Invalid snapshot')
    stopped = 0
    seen = set()
    for obj in containers:
        if not isinstance(obj, dict) or not isinstance(obj.get('Name'), str):
            raise ValueError('Invalid container metadata')
        name = obj['Name']
        if name not in LEGACY:
            continue
        if name in seen:
            raise ValueError('Duplicate legacy identity')
        seen.add(name)
        state = obj.get('State')
        if not isinstance(state, dict) or not isinstance(state.get('Running'), bool):
            raise ValueError('Invalid legacy state')
        if state['Running']:
            raise ValueError('Legacy MinIO still running')
        if state.get('Restarting') or state.get('Paused'):
            raise ValueError('Legacy MinIO not safely stopped')
        stopped += 1
    return len(LEGACY) - stopped, stopped


def main():
    ids = subprocess.check_output(['docker', 'ps', '-aq'], text=True,
                                  stderr=subprocess.DEVNULL, timeout=15).split()
    containers = json.loads(subprocess.check_output(
        ['docker', 'inspect', *ids], text=True,
        stderr=subprocess.DEVNULL, timeout=20)) if ids else []
    absent, stopped = check_legacy(containers)
    print(f'Legacy MinIO: absent={absent}, present and stopped={stopped}.')


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('ERROR: legacy state unsafe or Docker inventory unavailable; abort.',
              file=sys.stderr)
        sys.exit(1)
