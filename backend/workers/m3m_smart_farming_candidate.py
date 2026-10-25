#!/usr/bin/env python3
"""Offline, private import *candidate* for a sealed experimental M3M raster bundle.

No database, HTTP endpoint, tile server, or field operation is enabled.
A candidate is not a trusted raster import: readers must reverify the seal.
"""
from __future__ import annotations

import argparse
import ctypes
import errno
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import re
import shutil
import stat
import sys
import tempfile

SCHEMA = 'skyhub-m3m-smart-farming-candidate-v1'
SHA = re.compile(r'[0-9a-fA-F]{64}\Z')
INDICES = ('ndvi', 'ndre', 'gndvi', 'osavi')
NAMES = {'ndvi': 'NDVI', 'ndre': 'NDRE', 'gndvi': 'GNDVI', 'osavi': 'OSAVI'}
MAX_REPORT_BYTES = 128 * 1024
FALSE_FLAGS = ('operationalUseAllowed', 'reflectanceReady', 'ndviReady', 'ndreReady')


class CandidateError(ValueError):
    """Refuse a candidate if its integrity or scope cannot be demonstrated."""


def _seal_module():
    path = Path(__file__).resolve().with_name('m3m_raster_bundle_seal.py')
    spec = importlib.util.spec_from_file_location('_skyhub_m3m_seal_for_candidate', path)
    if spec is None or spec.loader is None:
        raise CandidateError('Bundled read-only seal verifier is missing')
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _pairs(items):
    result = {}
    for key, value in items:
        if key in result:
            raise CandidateError('Duplicate JSON key')
        result[key] = value
    return result


def _reject_constant(_value):
    raise CandidateError('Nonfinite JSON constant')


def _read_json_bounded(path: Path, size: int) -> tuple[dict, bytes]:
    if path.is_symlink():
        raise CandidateError('Symlink JSON is prohibited')
    before = path.stat()
    if not stat.S_ISREG(before.st_mode) or not 1 <= before.st_size <= size:
        raise CandidateError('Invalid or oversized JSON')
    with path.open('rb') as stream:
        content = stream.read(size + 1)
    after = path.stat()
    if (len(content) != before.st_size or
        (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) !=
        (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns)):
        raise CandidateError('JSON changed while reading')
    if len(content) > size:
        raise CandidateError('JSON exceeds limit')
    data = json.loads(content.decode('utf-8'), object_pairs_hook=_pairs,
                      parse_constant=_reject_constant)
    if not isinstance(data, dict):
        raise CandidateError('Expected a JSON object')
    return data, content


def _read_sealed_index_report(bundle: Path, seal: Path, trusted_sha: str) -> dict:
    receipt, raw_receipt = _read_json_bounded(seal, 16 * 1024)
    if hashlib.sha256(raw_receipt).hexdigest() != trusted_sha:
        raise CandidateError('Seal changed since independent pin verification')
    records = receipt.get('files')
    if not isinstance(records, list):
        raise CandidateError('Seal has no inventory')
    matches = [entry for entry in records if isinstance(entry, dict)
               and entry.get('relativePath') == 'indices/report.json']
    if len(matches) != 1 or not isinstance(matches[0].get('sha256'), str):
        raise CandidateError('Seal cannot identify index report uniquely')
    report, raw_report = _read_json_bounded(bundle / 'indices' / 'report.json', MAX_REPORT_BYTES)
    if hashlib.sha256(raw_report).hexdigest() != matches[0]['sha256'].lower():
        raise CandidateError('Index report changed after seal verification')
    return report


def _validated_indices(report: dict) -> list[dict]:
    if report.get('schema') != 'skyhub-m3m-experimental-index-raster-v1':
        raise CandidateError('Unsupported index report')
    for name in (*FALSE_FLAGS, 'calibrationVerified', 'bandCoregistrationVerified'):
        if report.get(name) is not False:
            raise CandidateError('Index report attempts to claim operational readiness')
    outputs = report.get('outputs')
    if not isinstance(outputs, dict) or set(outputs) != set(INDICES):
        raise CandidateError('Incomplete index family')
    pixels = report.get('pixelCount')
    if type(pixels) is not int or pixels < 1 or pixels > 2_000_000_000:
        raise CandidateError('Invalid raster dimensions')
    cards = []
    for name in INDICES:
        row = outputs[name]
        if not isinstance(row, dict) or row.get('filename') != name + '.tif':
            raise CandidateError('Unsafe index raster reference')
        valid = row.get('validPixels')
        if type(valid) is not int or valid <= 0 or valid > pixels:
            raise CandidateError('Invalid index valid pixel count')
        stat = {}
        for key in ('mean', 'min', 'max'):
            v = row.get(key)
            if type(v) not in (int, float) or not math.isfinite(v) or not -2 <= v <= 2:
                raise CandidateError('Invalid index summary statistic')
            stat[key] = float(v)
        if not stat['min'] - 1e-6 <= stat['mean'] <= stat['max'] + 1e-6:
            raise CandidateError('Contradictory index statistics')
        cards.append({'index': name, 'title': NAMES[name], 'validPixels': valid,
                      'mean': stat['mean'], 'min': stat['min'], 'max': stat['max'],
                      'unit': 'dimensionless', 'mapTilesAvailable': False})
    return cards


def _safe_output(bundle: Path, destination: Path):
    if os.path.lexists(destination):
        raise FileExistsError('Candidate destination already exists')
    parent = destination.parent
    if not parent.is_dir() or parent.is_symlink():
        raise CandidateError('Output parent must be a normal existing directory')
    actual_parent = parent.resolve(strict=True)
    actual_bundle = bundle.resolve(strict=True)
    if actual_parent == actual_bundle or actual_bundle in actual_parent.parents:
        raise CandidateError('Candidate must be stored outside the bundle')


def _publish_no_replace(stage: Path, destination: Path) -> None:
    """Atomically publish a directory, refusing even an EMPTY existing target.

    POSIX os.rename() may replace an empty destination directory: a preceding
    lexists() check cannot close that race. Use Linux renameat2(RENAME_NOREPLACE)
    without any unsafe fallback. The Pi/CI platforms are Linux; refuse an
    unsupported platform/filesystem instead of silently weakening the contract.
    """
    if not sys.platform.startswith('linux'):
        raise CandidateError('Atomic no-replace publication requires Linux')
    try:
        libc = ctypes.CDLL(None, use_errno=True)
        renameat2 = libc.renameat2
    except (AttributeError, OSError) as exc:
        raise CandidateError('Atomic no-replace publication is unavailable') from exc
    renameat2.argtypes = (ctypes.c_int, ctypes.c_char_p,
                          ctypes.c_int, ctypes.c_char_p, ctypes.c_uint)
    renameat2.restype = ctypes.c_int
    # -100 is AT_FDCWD on Linux; 1 is RENAME_NOREPLACE.
    if renameat2(-100, os.fsencode(stage), -100, os.fsencode(destination), 1) != 0:
        code = ctypes.get_errno()
        if code in (errno.EEXIST, errno.ENOTEMPTY):
            raise FileExistsError(errno.EEXIST, 'Candidate destination already exists')
        raise OSError(code, 'Atomic candidate publication failed')


def create_candidate(*, bundle: Path, seal: Path, trusted_seal_sha256: str,
                     output_dir: Path) -> dict:
    """Create a nonoperational, path-redacted candidate after full seal + raster QA."""
    if not isinstance(trusted_seal_sha256, str) or not SHA.fullmatch(trusted_seal_sha256):
        raise CandidateError('An independently recorded seal SHA256 is required')
    trusted_sha = trusted_seal_sha256.lower()
    bundle = Path(bundle).expanduser().absolute()
    seal = Path(seal).expanduser().absolute()
    output_dir = Path(output_dir).expanduser().absolute()
    if bundle.is_symlink() or not bundle.is_dir() or seal.is_symlink():
        raise CandidateError('Only direct local bundle and seal paths are supported')
    _safe_output(bundle, output_dir)
    seal_check = _seal_module().verify_seal(bundle, seal, trusted_sha)
    if (seal_check.get('pixelQaRechecked') is not True or
        seal_check.get('filesMatched') != 11 or
        seal_check.get('sha256OfSeal') != trusted_sha or
        seal_check.get('operationalUseAllowed') is not False or
        seal_check.get('signedByTrustedAuthority') is not False):
        raise CandidateError('Required independent seal and raster QA not confirmed')
    report = _read_sealed_index_report(bundle, seal, trusted_sha)
    cards = _validated_indices(report)
    # An identifier derived from the pinned receipt, not a camera ID or GPS.
    record = {
        'schema': SCHEMA,
        'candidateId': 'm3m-exp-' + hashlib.sha256(bytes.fromhex(trusted_sha)).hexdigest()[:24],
        'state': 'experimental_candidate',
        'classification': 'locally-verified-integrity-not-radiometric-validity',
        'integrity': {'receiptSha256': trusted_sha, 'rasterQaPassedAtRegistration': True,
                      'sealedArtifactsMatched': 11},
        'indexLayers': cards,
        'indexCount': len(cards),
        'geolocationPublished': False,
        'tileUrlsPublished': False,
        'cameraProvenanceVerified': False,
        'radiometricCalibrationVerified': False,
        'bandCoregistrationVerified': False,
        'reflectanceReady': False,
        'ndviReady': False,
        'ndreReady': False,
        'operationalUseAllowed': False,
        'prescriptionExportAllowed': False,
        'flightMissionAllowed': False,
        'warning': 'Experimental raster candidate only; sealed index arithmetic is not radiometric calibration or agronomic approval.',
    }
    _safe_output(bundle, output_dir)
    stage = Path(tempfile.mkdtemp(dir=output_dir.parent, prefix='.skyhub-m3m-candidate-'))
    try:
        payload = (json.dumps(record, sort_keys=True, indent=2, allow_nan=False) + '\n').encode('utf-8')
        fd = os.open(stage / 'candidate.json', os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'wb') as stream:
            stream.write(payload)
        if os.path.lexists(output_dir):
            raise FileExistsError('Candidate destination appeared during creation')
        _publish_no_replace(stage, output_dir)
    except BaseException:
        shutil.rmtree(stage, ignore_errors=True)
        raise
    return record


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bundle', type=Path, required=True)
    parser.add_argument('--seal', type=Path, required=True)
    parser.add_argument('--trusted-seal-sha256', required=True)
    parser.add_argument('--output-dir', type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        result = create_candidate(bundle=args.bundle, seal=args.seal,
                                  trusted_seal_sha256=args.trusted_seal_sha256,
                                  output_dir=args.output_dir)
    except Exception as exc:
        # Do not reveal image identities or georeferencing in CLI diagnostics.
        print('M3M Smart Farming candidate refused: ' + type(exc).__name__, file=sys.stderr)
        return 2
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
