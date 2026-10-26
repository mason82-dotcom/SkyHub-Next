#!/usr/bin/env python3
"""S3/IAM checks against the isolated restored container only: read-only checks with the application account,
then negative write attempts that must be denied (the restored copy is disposable, never production)."""
import hashlib
import json
import os
import secrets
from pathlib import Path
import subprocess
import sys
from urllib.parse import quote


def main():
    mount, name, config = sys.argv[1:]
    runtime = json.loads((Path(mount)/'evidence/runtime.json').read_text())
    server = next(x for x in runtime if x['Name'] == '/skyhub-shared-minio')
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
    files_by_bucket = {}
    for number, bucket in enumerate(buckets, 1):
        rows = [json.loads(x) for x in read('ls', '--recursive', 'appread/'+bucket).splitlines()
                if x.strip()]
        if any(x.get('status') == 'error' for x in rows):
            raise RuntimeError('Bucket listing contains errors')
        files = [x for x in rows if x.get('type') == 'file']
        print(f'Bucket {number}: application LIST succeeded; file entries={len(files)}')
        candidate = next((x for x in files if 0 <= x.get('size', -1) <= 16*1024*1024), None)
        if files:
            files_by_bucket[bucket] = files[0]['key']
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
    negative_writes(mc, env, buckets, files_by_bucket)
    print('Skipped GETs remain open.')


def denied(mc, env, *args, data=None):
    """True only for an explicit AccessDenied; any other failure or success raises (no false PASS)."""
    r = subprocess.run(mc+list(args), env=env, input=data, capture_output=True, timeout=120)
    text = (r.stdout+r.stderr).decode('utf-8', 'replace').lower().replace(' ', '')
    if r.returncode == 0:
        return False
    if 'accessdenied' in text:
        return True
    raise RuntimeError('Write attempt failed for a reason other than AccessDenied; raw output suppressed')


def negative_writes(mc, env, buckets, files_by_bucket):
    marker = '.skyhub-negative-write-test-'+secrets.token_hex(6)
    for number, bucket in enumerate(buckets, 1):
        if not denied(mc, env, 'pipe', 'appread/'+bucket+'/'+marker, data=b'must-not-be-stored'):
            raise RuntimeError(f'Bucket {number}: application PUT was NOT denied')
        absent = subprocess.run(mc+['stat', 'test/'+bucket+'/'+marker], env=env,
                                capture_output=True, timeout=120).returncode != 0
        if not absent:
            raise RuntimeError(f'Bucket {number}: test object exists after denied PUT')
        key = files_by_bucket.get(bucket)
        if key and not denied(mc, env, 'rm', 'appread/'+bucket+'/'+key):
            raise RuntimeError(f'Bucket {number}: application DELETE was NOT denied')
        if key and subprocess.run(mc+['stat', 'test/'+bucket+'/'+key], env=env,
                                  capture_output=True, timeout=120).returncode != 0:
            raise RuntimeError(f'Bucket {number}: object missing after denied DELETE')
        print(f'Bucket {number}: application PUT denied'+(', DELETE denied, object still present.' if key else
              ' (no object for a DELETE attempt).'))
    if not denied(mc, env, 'mb', 'appread/skyhub-negative-write-test-'+secrets.token_hex(4)):
        raise RuntimeError('Application bucket creation was NOT denied')
    print('Application bucket creation denied.')
    print('PASS: negative write tests (PUT, DELETE, make-bucket) denied; nothing stored, nothing removed.')


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('ERROR: isolated S3/IAM check failed; raw details suppressed.', file=sys.stderr)
        sys.exit(1)
