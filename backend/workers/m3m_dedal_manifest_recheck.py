#!/usr/bin/env python3
"""Verify a private DEDAL preflight manifest and rehash every referenced file.

Purely offline and read-only. The manifest SHA-256 must be pinned separately.
No DEDAL/ODM code is ever imported, executed or installed here.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys

MAX_MANIFEST = 2 * 1024 * 1024
MAX_GROUPS = 625
MAX_IMAGE_BYTES = 128 * 1024 * 1024
MAX_ARCHIVE_BYTES = 20 * 1024 * 1024
MAX_PANEL_BYTES = 64 * 1024
PUBLISHED_MD5 = '8d59d0be195d361bca076411b1c6da6e'
SHA256 = re.compile(r'[a-fA-F0-9]{64}\Z')
CAPTURE = re.compile(r'DJI_\d{14}_\d{4}\Z', re.I)
BANDS = ('G', 'R', 'RE', 'NIR')


class RecheckError(ValueError):
    """A private preflight job is stale, inconsistent, or unsafe."""


def _json_pairs(pairs):
    result = {}
    for k, v in pairs:
        if k in result:
            raise RecheckError('Duplicate private manifest key')
        result[k] = v
    return result


def _invalid_json_constant(_):
    raise RecheckError('Non-finite JSON value')


def _regular(path: Path, limit: int):
    if path.is_symlink():
        raise RecheckError('Symlinks not allowed')
    s = path.stat()
    if not stat.S_ISREG(s.st_mode) or not 1 <= s.st_size <= limit:
        raise RecheckError('Invalid local file')
    return s


def _digest_file(path: Path, limit: int) -> tuple[str, str, int]:
    before = _regular(path, limit)
    sha = hashlib.sha256()
    md5 = hashlib.md5(usedforsecurity=False)
    count = 0
    with path.open('rb') as f:
        while data := f.read(1024 * 1024):
            count += len(data)
            if count > limit:
                raise RecheckError('Input exceeds size budget')
            sha.update(data)
            md5.update(data)
    after = _regular(path, limit)
    if (before.st_dev, before.st_ino, before.st_mtime_ns, before.st_size) != (
        after.st_dev, after.st_ino, after.st_mtime_ns, after.st_size
    ) or count != before.st_size:
        raise RecheckError('Source file changed during recheck')
    return sha.hexdigest(), md5.hexdigest(), count


def _expect_hash(v):
    if not isinstance(v, str) or not SHA256.fullmatch(v):
        raise RecheckError('Invalid SHA256')
    return v.lower()


def _file_record(item, limit: int, *, expected_name=None, identity=None):
    if not isinstance(item, dict):
        raise RecheckError('Missing file record')
    path = item.get('path')
    if not isinstance(path, str) or not path.startswith('/') or '\x00' in path:
        raise RecheckError('Path must be absolute')
    file = Path(path)
    if expected_name is not None and file.name != expected_name:
        raise RecheckError('File basename mismatch')
    expected = _expect_hash(item.get('sha256'))
    observed_sha, md5, size = _digest_file(file, limit)
    if observed_sha != expected or ('bytes' in item and item['bytes'] != size):
        raise RecheckError('File hash or size mismatch')
    if identity is not None:
        st = file.stat()
        pair = st.st_dev, st.st_ino
        if pair in identity:
            raise RecheckError('Hardlinked or repeated file')
        identity.add(pair)
    return md5, size


def recheck(manifest: Path, manifest_sha256: str) -> dict:
    """Return only a redacted audit; no source identifiers or filesystem writes."""
    expected_manifest = _expect_hash(manifest_sha256)
    manifest = Path(manifest).absolute()
    if manifest.name != 'private-preflight.json':
        raise RecheckError('Not a named private preflight manifest')
    actual_sha, _, _ = _digest_file(manifest, MAX_MANIFEST)
    if actual_sha != expected_manifest:
        raise RecheckError('Private manifest hash differs from independent pin')
    with manifest.open('r', encoding='utf-8') as source:
        data = json.load(source, object_pairs_hook=_json_pairs, parse_constant=_invalid_json_constant)
    if not isinstance(data, dict) or data.get('schema') != 'skyhub-m3m-dedal-preflight-private-v1':
        raise RecheckError('Unsupported private preflight schema')
    for field in ('runDEDAL', 'calibrationVerified', 'reflectanceReady', 'operationalUseAllowed'):
        if data.get(field) is not False:
            raise RecheckError('Manifest contains an invalid permission or readiness flag')

    archive = data.get('archive')
    if not isinstance(archive, dict) or not isinstance(archive.get('path'), str):
        raise RecheckError('Missing archive record')
    if Path(archive['path']).name != 'dedal-calibration-0.1.0.zip':
        raise RecheckError('Unexpected DEDAL archive name')
    observed_md5, _ = _file_record(archive, MAX_ARCHIVE_BYTES,
                                   expected_name='dedal-calibration-0.1.0.zip')
    if observed_md5 != PUBLISHED_MD5:
        raise RecheckError('Archive no longer agrees with published Zenodo MD5')

    panel = data.get('panel')
    _file_record(panel, MAX_PANEL_BYTES)
    if not isinstance(panel.get('bands'), dict) or set(panel['bands']) != set(BANDS):
        raise RecheckError('Malformed panel reflectance summary')
    for band in BANDS:
        v = panel['bands'][band]
        if type(v) not in (int, float) or not 0 < v <= 1:
            raise RecheckError('Invalid panel reflectance fraction')

    root = data.get('imagesRoot')
    if not isinstance(root, str) or not root.startswith('/'):
        raise RecheckError('Missing image root')
    directory = Path(root)
    if directory.is_symlink() or not directory.is_dir():
        raise RecheckError('Invalid image directory')
    groups = data.get('captures')
    if not isinstance(groups, list) or not 2 <= len(groups) <= MAX_GROUPS:
        raise RecheckError('Unacceptable number of capture groups')
    names, labels, identity = set(), set(), set()
    image_count = 0
    for group in groups:
        if not isinstance(group, dict) or not isinstance(group.get('capture'), str):
            raise RecheckError('Invalid capture group')
        label = group['capture']
        if not CAPTURE.fullmatch(label) or label in labels:
            raise RecheckError('Ambiguous capture label')
        labels.add(label)
        bands = group.get('bands')
        if not isinstance(bands, dict) or set(bands) != set(BANDS):
            raise RecheckError('Missing spectral bands')
        for band in BANDS:
            record = bands[band]
            if not isinstance(record, dict):
                raise RecheckError('Invalid spectral file record')
            name = record.get('name')
            if not isinstance(name, str) or name.upper() != f'{label.upper()}_MS_{band}.TIF':
                raise RecheckError('Spectral file label mismatch')
            if '/' in name or '\\' in name or name in names:
                raise RecheckError('Duplicated or unsafe image filename')
            names.add(name)
            file = directory / name
            sha = _expect_hash(record.get('sha256'))
            observed_sha, _, actual_size = _digest_file(file, MAX_IMAGE_BYTES)
            if observed_sha != sha or type(record.get('bytes')) is not int or record['bytes'] != actual_size:
                raise RecheckError('Changed image or size')
            st = file.stat()
            pair = st.st_dev, st.st_ino
            if pair in identity:
                raise RecheckError('Repeated file inode')
            identity.add(pair)
            image_count += 1

    panel_labels = data.get('panelCaptures')
    if (not isinstance(panel_labels, list) or not panel_labels or len(panel_labels) >= len(groups)
        or any(not isinstance(label, str) or label not in labels for label in panel_labels)
        or len(set(panel_labels)) != len(panel_labels)):
        raise RecheckError('Ambiguous panel captures')
    # A recheck is a consistency test against the pinned private manifest, not
    # a filesystem snapshot or a proof that the TIFFs came from a DJI camera.
    return {
        'schema': 'skyhub-m3m-dedal-private-manifest-recheck-v1',
        'classification': 'independently-pinned-private-manifest-and-local-file-hashes',
        'manifestMatchesOperatorSha256Pin': True,
        'archiveMatchesPublishedZenodoMd5': True,
        'spectralFilesRehashed': image_count,
        'captureGroupsRechecked': len(groups),
        'panelCaptureGroupsClaimed': len(panel_labels),
        'fileContentsValidatedAsM3M': False,
        'dedalExecuted': False,
        'calibrationVerified': False,
        'reflectanceReady': False,
        'operationalUseAllowed': False,
        'warning': 'File hash consistency does not prove source authenticity, image payload, panel identity, or calibration.',
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', required=True, type=Path)
    parser.add_argument('--manifest-sha256', required=True)
    args = parser.parse_args(argv)
    try:
        report = recheck(args.manifest, args.manifest_sha256)
    except (OSError, ValueError, UnicodeError) as exc:
        print('DEDAL manifest recheck refused: ' + type(exc).__name__, file=sys.stderr)
        return 2
    print(json.dumps(report, sort_keys=True))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
