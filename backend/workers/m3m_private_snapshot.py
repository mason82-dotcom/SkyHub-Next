#!/usr/bin/env python3
"""P1: opt-in private local copy of a four-band M3M capture candidate.

No S3/DB/HTTP/DJI side effects. Writes a completion manifest *last*;
an interrupted directory without manifest is NOT a committed import.
Hashes and XMP are evidence of local bytes, NOT M3M origin/calibration.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import stat
import sys

BANDS = ('G', 'R', 'RE', 'NIR')
MAX_COPY_BYTES = 128 * 1024 * 1024
CHUNK = 1024 * 1024


class SnapshotError(ValueError):
    """Refuse inconsistent or potentially destructive local import."""


def _module(name: str):
    source = Path(__file__).resolve().with_name(name + '.py')
    spec = importlib.util.spec_from_file_location('_skyhub_snapshot_' + name, source)
    if spec is None or spec.loader is None:
        raise SnapshotError('Required offline auditor unavailable')
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _input_band_map(tiffs) -> dict:
    decoder = _module('m3m_raw_tiff_audit')
    _, _, tifffile, element_tree, _ = decoder._libraries()
    mapping = {}
    for path in tiffs:
        p = Path(path).expanduser().absolute()
        if p.is_symlink() or not p.is_file():
            raise SnapshotError('Spectral source is not an ordinary direct file')
        hint = decoder._extract_xmp(p, tifffile, element_tree)
        band = hint.get('band')
        if hint.get('xmpStatus') != 'ok' or band not in BANDS or band in mapping:
            raise SnapshotError('Duplicate or invalid private band hint')
        mapping[band] = p
    if set(mapping) != set(BANDS):
        raise SnapshotError('Missing spectral input')
    return mapping


def _copy_one(source: Path, target: Path, expected: dict) -> None:
    flags = os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0)
    inp = os.open(source, flags)
    try:
        before = os.fstat(inp)
        if (not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or
                not 16 <= before.st_size <= MAX_COPY_BYTES):
            raise SnapshotError('Invalid bounded input file')
        out = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL |
                      getattr(os, 'O_NOFOLLOW', 0), 0o600)
        try:
            sha = hashlib.sha256()
            copied = 0
            while True:
                chunk = os.read(inp, CHUNK)
                if not chunk:
                    break
                copied += len(chunk)
                if copied > MAX_COPY_BYTES:
                    raise SnapshotError('Source exceeds copy limit')
                sha.update(chunk)
                while chunk:
                    count = os.write(out, chunk)
                    if count < 1:
                        raise SnapshotError('Snapshot write interrupted')
                    chunk = chunk[count:]
            os.fsync(out)
        finally:
            os.close(out)
        after = os.fstat(inp)
        fingerprint = (after.st_dev, after.st_ino, after.st_size,
                       after.st_mtime_ns, after.st_ctime_ns)
        expected_fingerprint = (before.st_dev, before.st_ino, before.st_size,
                                before.st_mtime_ns, before.st_ctime_ns)
        if (fingerprint != expected_fingerprint or copied != before.st_size or
                sha.hexdigest() != expected['sha256'] or
                copied != expected['bytes']):
            raise SnapshotError('Source changed or receipt digest mismatch')
        # Verify destination bytes independently of streaming write.
        actual = hashlib.sha256()
        with target.open('rb') as handle:
            for block in iter(lambda: handle.read(CHUNK), b''):
                actual.update(block)
        if actual.hexdigest() != expected['sha256'] or target.stat().st_size != copied:
            raise SnapshotError('Copied content differs from original')
    finally:
        os.close(inp)


def _commit_manifest(folder: Path, manifest: dict):
    # A reader must require manifest.json to classify a dataset as complete.
    tmp = folder / '.manifest-tmp'
    payload = (json.dumps(manifest, sort_keys=True, separators=(',', ':'),
                          allow_nan=False) + '\n').encode('utf-8')
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, 'wb') as f:
            f.write(payload)
            f.flush()
            os.fsync(f.fileno())
        os.link(tmp, folder / 'manifest.json')
    finally:
        tmp.unlink(missing_ok=True)
    dfd = os.open(folder, os.O_RDONLY | getattr(os, 'O_DIRECTORY', 0))
    try:
        os.fsync(dfd)
    finally:
        os.close(dfd)


def snapshot(tiffs, output_dir: Path, rgb=None) -> dict:
    source_receipt = _module('m3m_source_capture_receipt')
    paths = [Path(p).expanduser().absolute() for p in tiffs]
    receipt = source_receipt.create_receipt(paths, rgb)
    by_band = _input_band_map(paths)
    output = Path(output_dir).expanduser().absolute()
    if (output.parent.is_symlink() or not output.parent.is_dir() or
            os.path.lexists(output)):
        raise SnapshotError('Existing or invalid snapshot destination')
    if any(p == output or output in p.parents for p in paths):
        raise SnapshotError('Input must not be contained in destination')
    os.mkdir(output, 0o700)  # Exclusive reservation, never overwrite existing.
    try:
        for band in BANDS:
            _copy_one(by_band[band], output / (band + '.tif'),
                      receipt['bands'][band])
        if rgb is not None:
            _copy_one(Path(rgb).expanduser().absolute(), output / 'RGB.jpg',
                      receipt['rgbCandidate'])
        # Repeat the source content audit to fail if source changed after copy.
        latest = source_receipt.create_receipt(paths, rgb)
        if latest != receipt:
            raise SnapshotError('Source changed after copy')
        # No names, paths, CaptureUUID, GPS or raw XMP leave private storage.
        identifier = hashlib.sha256(''.join(
            receipt['bands'][b]['sha256'] for b in BANDS).encode('ascii')).hexdigest()[:24]
        manifest = {
            'schema': 'skyhub-m3m-private-capture-snapshot-v1',
            'captureCandidateId': 'local-' + identifier,
            'classification': 'private-bytes-snapshotted-not-calibrated',
            'files': {b + '.tif': receipt['bands'][b] for b in BANDS},
            'rgbCandidate': receipt['rgbCandidate'],
            'completed': True,
            'sourceVerified': False,
            'radiometricCalibrationVerified': False,
            'bandCoregistrationVerified': False,
            'reflectanceReady': False,
            'ndviReady': False,
            'ndreReady': False,
            'operationalUseAllowed': False,
            'prescriptionExportAllowed': False,
            'flightMissionAllowed': False,
        }
        _commit_manifest(output, manifest)
    except BaseException:
        shutil.rmtree(output)
        raise
    return {'schema': manifest['schema'], 'captureCandidateId': manifest['captureCandidateId'],
            'filesCopied': 4 + int(rgb is not None),
            'completed': True, 'sourceVerified': False, 'reflectanceReady': False,
            'operationalUseAllowed': False, 'prescriptionExportAllowed': False,
            'flightMissionAllowed': False}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--tiff', required=True, action='append', type=Path)
    parser.add_argument('--rgb', type=Path)
    parser.add_argument('--output-dir', required=True, type=Path)
    args = parser.parse_args(argv)
    try:
        print(json.dumps(snapshot(args.tiff, args.output_dir, args.rgb),
                         sort_keys=True, allow_nan=False))
    except Exception as exc:
        # Do not log names, paths, capture UUIDs, coordinates or raw pixels.
        print('Private M3M snapshot refused: ' + type(exc).__name__, file=sys.stderr)
        return 2
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
