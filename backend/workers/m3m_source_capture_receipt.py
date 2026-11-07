#!/usr/bin/env python3
"""P1: offline, read-only Mavic-3M TIFF capture receipt; never attests calibration.

Runs only when explicitly called. No network, database, DJI control, writes,
or public filenames, UUIDs, coordinates or EXIF in output.
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

BANDS = ('G', 'R', 'RE', 'NIR')
SHA_BUFFER = 1024 * 1024
MAX_RGB_BYTES = 64 * 1024 * 1024
HEX64 = re.compile(r'[a-f0-9]{64}\Z')


class CaptureError(ValueError):
    """A local capture cannot be represented as a coherent, safe candidate."""


def _audit_module():
    location = Path(__file__).resolve().with_name('m3m_raw_tiff_audit.py')
    spec = importlib.util.spec_from_file_location('_m3m_readonly_source_audit', location)
    if spec is None or spec.loader is None:
        raise CaptureError('Offline TIFF decoder is unavailable')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _hash_ordinary(path: Path, maximum: int) -> dict:
    if path.is_symlink():
        raise CaptureError('Symlink input forbidden')
    flags = os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0)
    fd = os.open(path, flags)
    try:
        before = os.fstat(fd)
        if (not stat.S_ISREG(before.st_mode) or before.st_nlink != 1
                or not 16 <= before.st_size <= maximum):
            raise CaptureError('Input must be a bounded independent ordinary file')
        sha = hashlib.sha256()
        with os.fdopen(os.dup(fd), 'rb', closefd=True) as stream:
            total = 0
            while True:
                chunk = stream.read(SHA_BUFFER)
                if not chunk:
                    break
                total += len(chunk)
                if total > maximum:
                    raise CaptureError('Input grew past size limit')
                sha.update(chunk)
        after = os.fstat(fd)
        if (total != before.st_size or
                (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns,
                 before.st_ctime_ns) !=
                (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns,
                 after.st_ctime_ns)):
            raise CaptureError('Input mutated during digest computation')
        return {'bytes': total, 'sha256': sha.hexdigest()}
    finally:
        os.close(fd)


def _rgb_header(path: Path) -> None:
    if path.suffix.lower() not in ('.jpg', '.jpeg'):
        raise CaptureError('Optional RGB must be JPEG')
    with path.open('rb') as stream:
        if stream.read(3) != b'\xff\xd8\xff':
            raise CaptureError('Optional RGB JPEG signature invalid')


def create_receipt(tiffs, rgb=None) -> dict:
    paths = [Path(p).expanduser().absolute() for p in tiffs]
    if len(paths) != 4:
        raise CaptureError('Exactly four explicit spectral TIFFs are required')
    decoder = _audit_module()
    report = decoder.audit(paths)
    if (report.get('fullFourBandHint') is not True
            or report.get('captureGroupHint') is not True
            or report.get('xmpStatusCounts', {}).get('ok') != 4):
        raise CaptureError('No coherent four-band, same-capture XMP candidate')
    _, _, tifffile, element_tree, _ = decoder._libraries()
    files = {}
    capture_values = set()
    for path in paths:
        if path.is_symlink():
            raise CaptureError('Symlink TIFF is forbidden')
        metadata = decoder._extract_xmp(path, tifffile, element_tree)
        band, capture = metadata['band'], metadata['captureUuid']
        if band not in BANDS or not capture or band in files or metadata['xmpStatus'] != 'ok':
            raise CaptureError('Unambiguous private band/capture identity required')
        capture_values.add(capture)
        files[band] = _hash_ordinary(path, decoder.MAX_FILE_BYTES)
    if set(files) != set(BANDS) or len(capture_values) != 1:
        raise CaptureError('Incomplete or conflicting multispectral capture')
    # A single read-only receipt proves coherence of local bytes and XMP claims,
    # not DJI authenticity, scientific reflectance or RGB/spectral co-registration.
    output = {
        'schema': 'skyhub-m3m-source-candidate-receipt-v1',
        'classification': 'locally-decoded-xmp-capture-hints-not-dji-provenance',
        'bands': {band: files[band] for band in BANDS},
        'spectralSourceCount': 4,
        'decodedPixelCount': report['totalDecodedPixels'],
        'saturatedSampleCount': report['totalSaturatedPixels'],
        'allSpectralDimensionsEqual': report['sameImageDimensions'],
        'captureUuidMatchedPrivately': True,
        'sha256OriginalBytes': True,
        'rgbCandidate': None,
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
    if rgb is not None:
        jpg = Path(rgb).expanduser().absolute()
        if jpg.is_symlink():
            raise CaptureError('Symlink JPEG is forbidden')
        _rgb_header(jpg)
        output['rgbCandidate'] = {
            **_hash_ordinary(jpg, MAX_RGB_BYTES),
            'jpegMarkerChecked': True,
            'jpegPayloadDecoded': False,
            'captureLinkVerified': False,
        }
    if any(not HEX64.fullmatch(v['sha256']) for v in files.values()):
        raise CaptureError('Invalid source digest')
    return output


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--tiff', action='append', type=Path, required=True)
    parser.add_argument('--rgb', type=Path)
    args = parser.parse_args(argv)
    try:
        result = create_receipt(args.tiff, args.rgb)
    except Exception as exc:
        # Never reveal EXIF, original filenames, UUID, device or filesystem path.
        print('M3M P1 capture receipt refused: ' + type(exc).__name__, file=sys.stderr)
        return 2
    print(json.dumps(result, sort_keys=True, allow_nan=False))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
