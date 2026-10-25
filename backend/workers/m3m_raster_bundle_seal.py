#!/usr/bin/env python3
"""Offline cryptographic integrity receipt for an experimental M3M raster bundle.

The seal is NOT a signature, calibration attestation, or proof of DJI origin.
Its SHA256 must be pinned independently outside the bundle and seal file.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import sys

SCHEMA = 'skyhub-m3m-raster-bundle-integrity-seal-v1'
SHA = re.compile(r'[a-fA-F0-9]{64}\Z')
MAX_FILE_BYTES = 100 * 1024 * 1024 * 1024
MAX_SEAL_BYTES = 16 * 1024
FILES = (
    'bundle-report.json',
    'reflectance/report.json',
    *(f'reflectance/{name}.tif' for name in ('red', 'green', 'red_edge', 'nir')),
    'indices/report.json',
    *(f'indices/{name}.tif' for name in ('ndvi', 'ndre', 'gndvi', 'osavi')),
)


class SealError(ValueError):
    """Integrity seal cannot be created or validated."""


def _hash_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _safe_file(path: Path, limit: int):
    if path.is_symlink():
        raise SealError('Symlinks are forbidden')
    try:
        info = path.stat()
    except OSError as exc:
        raise SealError('Expected file is unavailable') from exc
    if not stat.S_ISREG(info.st_mode) or not 1 <= info.st_size <= limit:
        raise SealError('Missing, empty or oversized file')
    return info


def _fingerprint(path: Path, limit: int) -> dict:
    before = _safe_file(path, limit)
    digest = hashlib.sha256()
    total = 0
    with path.open('rb') as source:
        while chunk := source.read(1024 * 1024):
            total += len(chunk)
            if total > limit:
                raise SealError('File grew beyond configured limit')
            digest.update(chunk)
    after = _safe_file(path, limit)
    if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) != (
        after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns
    ) or total != before.st_size:
        raise SealError('File changed during integrity check')
    return {'bytes': total, 'sha256': digest.hexdigest()}


def _bundle_root(bundle: Path) -> Path:
    root = Path(bundle).expanduser().absolute()
    if root.is_symlink() or not root.is_dir():
        raise SealError('Input must be an ordinary local bundle directory')
    for part in ('reflectance', 'indices'):
        folder = root / part
        if folder.is_symlink() or not folder.is_dir():
            raise SealError('Missing normal bundle stage directory')
    return root


def _snapshot(root: Path) -> dict:
    return {name: _fingerprint(root / name, MAX_FILE_BYTES if name.endswith('.tif') else MAX_SEAL_BYTES)
            for name in FILES}


def _verify_math(bundle: Path) -> dict:
    source = Path(__file__).resolve().with_name('m3m_raster_bundle_verify.py')
    spec = importlib.util.spec_from_file_location('_skyhub_m3m_raster_qa', source)
    if spec is None or spec.loader is None:
        raise SealError('Audited SkyHub bundle verifier unavailable')
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    qa = mod.verify_bundle(bundle)
    if (qa.get('pixelFormulaAndMaskChecksPassed') is not True or
        qa.get('allGridMetadataMatched') is not True or
        qa.get('stageStatisticsMatched') is not True or
        qa.get('operationalUseAllowed') is not False):
        raise SealError('Pixel-level raster QA did not pass')
    return qa


def _checked_snapshot(root: Path) -> dict:
    before = _snapshot(root)
    _verify_math(root)
    after = _snapshot(root)
    if before != after:
        raise SealError('Bundle content changed during QA')
    return after


def _canonical(data: dict) -> bytes:
    return (json.dumps(data, sort_keys=True, separators=(',', ':'), allow_nan=False) + '\n').encode('utf-8')


def _pairs(pairs):
    obj = {}
    for key, value in pairs:
        if key in obj:
            raise SealError('Duplicate JSON key')
        obj[key] = value
    return obj


def _bad_constant(_):
    raise SealError('Nonfinite JSON value')


def create_seal(bundle: Path, output: Path) -> dict:
    """Write a new 0600 receipt outside the bundle, never alter any raster."""
    root = _bundle_root(bundle)
    output = Path(output).expanduser().absolute()
    canonical_parent = output.parent.resolve(strict=True)
    canonical_root = root.resolve(strict=True)
    if (not output.parent.is_dir() or output.parent.is_symlink()
        or canonical_parent == canonical_root or canonical_root in canonical_parent.parents):
        raise SealError('Seal must be a new file outside the bundle')
    if os.path.lexists(output):
        raise FileExistsError('Seal already exists')
    record = {
        'schema': SCHEMA,
        'classification': 'sha256-bundle-integrity-not-calibration-or-authenticity',
        'files': [{'relativePath': name, **meta}
                  for name, meta in _checked_snapshot(root).items()],
        'captureProvenanceVerified': False,
        'radiometricCalibrationVerified': False,
        'bandCoregistrationVerified': False,
        'reflectanceReady': False,
        'ndviReady': False,
        'ndreReady': False,
        'operationalUseAllowed': False,
    }
    payload = _canonical(record)
    if len(payload) > MAX_SEAL_BYTES:
        raise SealError('Seal exceeds size limit')
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    if hasattr(os, 'O_NOFOLLOW'):
        flags |= os.O_NOFOLLOW
    fd = os.open(output, flags, 0o600)
    try:
        with os.fdopen(fd, 'wb') as handle:
            handle.write(payload)
    except BaseException:
        output.unlink(missing_ok=True)
        raise
    return _summary(seal_sha=_hash_bytes(payload))


def verify_seal(bundle: Path, seal: Path, expected_sha256: str) -> dict:
    """Verify independently pinned receipt *and* every bundle file and QA."""
    if not isinstance(expected_sha256, str) or SHA.fullmatch(expected_sha256) is None:
        raise SealError('Independent SHA256 pin is required')
    root = _bundle_root(bundle)
    seal = Path(seal).expanduser().absolute()
    _safe_file(seal, MAX_SEAL_BYTES)
    with seal.open('rb') as handle:
        payload = handle.read(MAX_SEAL_BYTES + 1)
    if len(payload) > MAX_SEAL_BYTES or _hash_bytes(payload) != expected_sha256.lower():
        raise SealError('Seal content differs from independent pin')
    data = json.loads(payload.decode('utf-8'), object_pairs_hook=_pairs, parse_constant=_bad_constant)
    if not isinstance(data, dict) or set(data) != {
        'schema', 'classification', 'files', 'captureProvenanceVerified',
        'radiometricCalibrationVerified', 'bandCoregistrationVerified',
        'reflectanceReady', 'ndviReady', 'ndreReady', 'operationalUseAllowed'
    } or data['schema'] != SCHEMA or data['classification'] != 'sha256-bundle-integrity-not-calibration-or-authenticity':
        raise SealError('Unexpected seal schema or fields')
    for name in ('captureProvenanceVerified', 'radiometricCalibrationVerified',
                 'bandCoregistrationVerified', 'reflectanceReady', 'ndviReady',
                 'ndreReady', 'operationalUseAllowed'):
        if data[name] is not False:
            raise SealError('Seal attempts to elevate readiness')
    entries = data['files']
    if not isinstance(entries, list) or len(entries) != len(FILES):
        raise SealError('Incomplete seal inventory')
    for i, name in enumerate(FILES):
        entry = entries[i]
        if (not isinstance(entry, dict) or set(entry) != {'relativePath', 'sha256', 'bytes'}
            or entry['relativePath'] != name or type(entry['bytes']) is not int
            or not 1 <= entry['bytes'] <= (MAX_FILE_BYTES if name.endswith('.tif') else MAX_SEAL_BYTES)
            or not isinstance(entry['sha256'], str) or SHA.fullmatch(entry['sha256']) is None):
            raise SealError('Unsafe or fabricated artifact record')
    observed = _checked_snapshot(root)
    for entry in entries:
        if observed[entry['relativePath']] != {
            'bytes': entry['bytes'], 'sha256': entry['sha256'].lower()
        }:
            raise SealError('Sealed artifact changed')
    return _summary(seal_sha=expected_sha256.lower())


def _summary(*, seal_sha: str) -> dict:
    return {
        'schema': 'skyhub-m3m-raster-bundle-integrity-summary-v1',
        'filesMatched': len(FILES),
        'pixelQaRechecked': True,
        'sha256OfSeal': seal_sha,
        'signedByTrustedAuthority': False,
        'calibrationVerified': False,
        'reflectanceReady': False,
        'operationalUseAllowed': False,
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='action', required=True)
    create = sub.add_parser('create')
    create.add_argument('--bundle', type=Path, required=True)
    create.add_argument('--seal', type=Path, required=True)
    verify = sub.add_parser('verify')
    verify.add_argument('--bundle', type=Path, required=True)
    verify.add_argument('--seal', type=Path, required=True)
    verify.add_argument('--seal-sha256', required=True)
    args = parser.parse_args(argv)
    try:
        if args.action == 'create':
            result = create_seal(args.bundle, args.seal)
        else:
            result = verify_seal(args.bundle, args.seal, args.seal_sha256)
    except Exception as exc:
        print('M3M integrity receipt rejected: ' + type(exc).__name__, file=sys.stderr)
        return 2
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
