#!/usr/bin/env python3
"""Read-only S3/IAM checks against the isolated restored container only."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
from urllib.parse import quote


def main():
    mount, name, config = sys.argv[1:]
    runtime = json.loads((Path(mount)/'evidence/runtime.json').read_text())
    server = next(x for x in runtime if x['Name'] == '/skyhub-next-minio-1')
    backend = next(x for x in runtime if x['Name'] == '/skyhub-next-backend-1')
    def env_of(obj):
        return dict(x.split('=', 1) for x in obj['Config']['Env'] if '=' in x)
    root, app = env_of(server), env_of(backend)
    obj = json.loads(subprocess.check_output(['docker', 'inspect', name]))[0]
    networks = obj['NetworkSettings']['Networks']
    if len(networks) != 1 or obj['HostConfig'].get('PortBindings'):
        raise RuntimeError('Test isolation failed')
    ip = next(iter(networks.values()))['IPAddress']
    env = os.environ.copy()
    env.pop('MC_DEBUG', None)
    for alias, user, secret in (
        ('test', root['MINIO_ROOT_USER'], root['MINIO_ROOT_PASSWORD']),
        ('appread', app['SKYHUB_S3_ACCESS_KEY'], app['SKYHUB_S3_SECRET_KEY'])
    ):
        env['MC_HOST_'+alias] = f'http://{quote(user, safe="")}:{quote(secret, safe="")}@{ip}:9000'
    mc = ['/home/mason/.local/bin/mc', '--config-dir', config,
          '--disable-pager', '--json']
    def read(*args):
        r = subprocess.run(mc+list(args), env=env, capture_output=True,
                           text=True, timeout=120)
        if r.returncode:
            raise RuntimeError('S3/admin read failed; raw output suppressed')
        return r.stdout
    info = json.loads(read('admin', 'accesskey', 'info', 'test/',
                           app['SKYHUB_S3_ACCESS_KEY']))
    if info.get('status') != 'success' or info.get('accountStatus') != 'on':
        raise RuntimeError('Restored service account not confirmed active')
    if info.get('parentUser') != root['MINIO_ROOT_USER']:
        raise RuntimeError('Restored parent identity differs')
    policy = info.get('policy')
    if isinstance(policy, str):
        policy = json.loads(policy)
    buckets = ('basemaps', 'dji-cloud', 'farming', 'mapping-results', 'pv-inspections')
    statements = policy.get('Statement', [])
    expected = [
        {'Effect': 'Allow', 'Action': ['s3:ListBucket'],
         'Resource': ['arn:aws:s3:::'+b for b in buckets]},
        {'Effect': 'Allow', 'Action': ['s3:GetObject'],
         'Resource': ['arn:aws:s3:::'+b+'/*' for b in buckets]}
    ]
    def normalize(rows):
        normalized = []
        for row in rows:
            # Extra restrictions/permissions are not silently discarded.
            if set(row) - {'Sid', 'Effect', 'Action', 'Resource'}:
                raise RuntimeError('Unexpected policy fields; manual review required')
            actions, resources = row.get('Action'), row.get('Resource')
            if isinstance(actions, str): actions = [actions]
            if isinstance(resources, str): resources = [resources]
            normalized.append((row['Effect'], tuple(sorted(actions)), tuple(sorted(resources))))
        return sorted(normalized)
    if normalize(statements) != normalize(expected):
        raise RuntimeError('Restored policy differs from confirmed read-only policy')
    print('PASS: restored service account active, root parent, expected read-only policy.')
    gets = 0
    for number, bucket in enumerate(buckets, 1):
        rows = [json.loads(x) for x in read('ls', '--recursive', 'appread/'+bucket).splitlines()
                if x.strip()]
        if any(x.get('status') == 'error' for x in rows):
            raise RuntimeError('Bucket listing contains errors')
        files = [x for x in rows if x.get('type') == 'file']
        print(f'Bucket {number}: application LIST succeeded; file entries={len(files)}')
        candidate = next((x for x in files if 0 <= x.get('size', -1) <= 16*1024*1024), None)
        if candidate:
            # Capture bytes in memory only; limit chosen object size to 16 MiB.
            r = subprocess.run(mc+['cat', 'appread/'+bucket+'/'+candidate['key']],
                               env=env, capture_output=True, timeout=120)
            if r.returncode or len(r.stdout) != candidate['size']:
                raise RuntimeError('Application GET failed or size mismatch')
            hashlib.sha256(r.stdout).hexdigest()
            gets += 1
            print(f'Bucket {number}: sample application GET succeeded (no content printed).')
        else:
            print(f'Bucket {number}: sample GET skipped (no suitable object <=16 MiB).')
    print('Sample GET checks:', gets, '/ 5')
    print('No PUT/DELETE or negative write test performed. Skipped GETs remain open.')


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('ERROR: isolated S3/IAM check failed; raw details suppressed.', file=sys.stderr)
        sys.exit(1)
