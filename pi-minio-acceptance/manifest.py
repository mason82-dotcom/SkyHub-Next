#!/usr/bin/env python3
"""Private file manifest; never print filenames or contents on verification failure."""
import hashlib
import json
import os
from pathlib import Path
import stat
import sys


def digest(path):
    h = hashlib.sha256()
    with open(path, 'rb') as stream:
        for chunk in iter(lambda: stream.read(4 * 1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def records(root):
    root = Path(root)
    if not root.is_dir() or root.is_symlink():
        raise RuntimeError('Missing or unsafe manifest root')
    device = root.stat().st_dev
    def fail(_):
        raise RuntimeError('Directory traversal failed')
    for current, dirs, files in os.walk(root, followlinks=False, onerror=fail):
        dirs.sort()
        files.sort()
        for name in ['.'] + files:
            path = Path(current) if name == '.' else Path(current) / name
            s = path.lstat()
            if s.st_dev != device:
                raise RuntimeError('Nested filesystem found; manual review required')
            if not (stat.S_ISREG(s.st_mode) or stat.S_ISDIR(s.st_mode)):
                raise RuntimeError('Unsupported file type; manual review required')
            if stat.S_ISREG(s.st_mode) and s.st_nlink != 1:
                raise RuntimeError('Hard links found; manual review required')
            attrs = {key: hashlib.sha256(os.getxattr(path, key)).hexdigest()
                     for key in sorted(os.listxattr(path))}
            row = dict(path=path.relative_to(root).as_posix(),
                       kind='file' if stat.S_ISREG(s.st_mode) else 'directory',
                       mode=stat.S_IMODE(s.st_mode), uid=s.st_uid, gid=s.st_gid,
                       xattrs=attrs)
            if row['kind'] == 'file':
                row.update(size=s.st_size, sha256=digest(path))
            yield row
        # os.walk would silently skip symlinked directories; reject them explicitly.
        if any((Path(current) / name).is_symlink() for name in dirs):
            raise RuntimeError('Directory symlinks found; manual review required')


def main():
    mode, root, manifest = sys.argv[1:]
    if mode == 'create':
        with open(manifest, 'x', encoding='utf-8') as out:
            for row in records(root):
                out.write(json.dumps(row, sort_keys=True) + '\n')
        print('Private manifest created.')
    elif mode == 'verify':
        with open(manifest, encoding='utf-8') as source:
            expected = {}
            for line in source:
                row = json.loads(line)
                if row['path'] in expected:
                    raise RuntimeError('Duplicate manifest entry')
                expected[row['path']] = row
        actual = {row['path']: row for row in records(root)}
        if actual != expected:
            raise RuntimeError('Manifest mismatch: contents, metadata or file set differ')
        print('PASS: complete file set, SHA256, sizes, owners, modes and xattrs match.')
        print('Entries:', len(actual))
    else:
        raise RuntimeError('Unknown mode')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Exceptions can contain private paths. Do not echo exception details.
        print('ERROR: manifest check failed; no private details printed.', file=sys.stderr)
        sys.exit(1)
