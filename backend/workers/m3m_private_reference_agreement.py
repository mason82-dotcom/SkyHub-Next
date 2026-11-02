#!/usr/bin/env python3
"""P3.5a private read-only M3M raster/reference agreement audit.

A comparison to externally supplied TIFFs NEVER proves DJI authenticity,
radiometric calibration, scientific provenance, registration, or readiness.
No writes, network calls, HTTP endpoints, mission or agronomic control.
"""
from __future__ import annotations

import argparse
from contextlib import ExitStack
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import re
import stat
import sys

BANDS = ('red', 'green', 'red_edge', 'nir')
REF_FILES = tuple(name + '.tif' for name in BANDS)
SCHEMA = 'skyhub-m3m-private-reference-manifest-v1'
HEX = re.compile(r'[0-9a-f]{64}\Z')
MAX_MANIFEST = 16 * 1024
MAX_RASTER_BYTES = 128 * 1024 * 1024
MAX_PIXELS = 2_000_000
NODATA = -9999.0
WINDOW = 256
# Purely diagnostic exploratory acceptance bounds; NOT scientific tolerances.
LAB_MAE = 0.03
LAB_RMSE = 0.05
LAB_P95 = 0.10
LAB_MIN_MASK_OVERLAP = 0.95


class ReferenceError(ValueError):
    """Input or comparison violated the private experimental contract."""


def need(condition, message):
    if not condition:
        raise ReferenceError(message)


def _module():
    source = Path(__file__).resolve().with_name('m3m_raster_bundle_seal.py')
    spec = importlib.util.spec_from_file_location('_skyhub_ref_agreement_seal', source)
    need(spec is not None and spec.loader is not None, 'Raster seal verifier unavailable')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _pairs(items):
    result = {}
    for key, value in items:
        need(key not in result, 'Ambiguous repeated JSON field')
        result[key] = value
    return result


def _bad_constant(_):
    raise ReferenceError('Nonfinite manifest number')


def _fingerprint(file: Path, limit: int):
    need(not file.is_symlink(), 'Reference symlink forbidden')
    fd = os.open(file, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
    try:
        before = os.fstat(fd)
        need(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and
             0 < before.st_size <= limit, 'Reference must be a bounded regular file')
        sha = hashlib.sha256()
        count = 0
        while count < before.st_size:
            data = os.read(fd, min(1024 * 1024, before.st_size - count))
            need(bool(data), 'Reference file truncated')
            sha.update(data)
            count += len(data)
        after = os.fstat(fd)
        need((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns,
              before.st_ctime_ns) ==
             (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns,
              after.st_ctime_ns), 'Reference file changed while hashing')
        return {'sha256': sha.hexdigest(), 'bytes': count}
    finally:
        os.close(fd)


def _check_reference(root: Path, independent_manifest_pin: str):
    need(root.is_dir() and not root.is_symlink() and
         (root.lstat().st_mode & 0o077) == 0,
         'Private reference directory (0700) required')
    need({p.name for p in root.iterdir()} == set(REF_FILES) | {'reference-manifest.json'},
         'Reference directory contains unexpected or missing files')
    raw = (root / 'reference-manifest.json')
    payload = _fingerprint(raw, MAX_MANIFEST)
    need(payload['sha256'] == independent_manifest_pin,
         'Independent reference manifest pin mismatch')
    data = raw.read_bytes()
    need(len(data) == payload['bytes'] and hashlib.sha256(data).hexdigest() ==
         independent_manifest_pin, 'Reference manifest changed')
    try:
        record = json.loads(data.decode('utf-8'), object_pairs_hook=_pairs,
                            parse_constant=_bad_constant)
    except (UnicodeError, ValueError, TypeError) as exc:
        raise ReferenceError('Invalid reference manifest') from exc
    need(isinstance(record, dict) and set(record) ==
         {'schema', 'classification', 'bands', 'externallyCalibratedClaim',
          'provenanceIndependentlyVerified', 'radiometricCalibrationVerified',
          'operationalUseAllowed'} and
         record['schema'] == SCHEMA and
         record['classification'] == 'operator-provided-reference-unverified-independence' and
         record['externallyCalibratedClaim'] is False and
         record['provenanceIndependentlyVerified'] is False and
         record['radiometricCalibrationVerified'] is False and
         record['operationalUseAllowed'] is False,
         'Reference cannot contain readiness or authenticity claims')
    need(isinstance(record['bands'], list) and len(record['bands']) == 4,
         'Exactly four reference bands required')
    for band, item in zip(BANDS, record['bands']):
        need(isinstance(item, dict) and set(item) ==
             {'band', 'filename', 'sha256', 'bytes'} and
             item['band'] == band and item['filename'] == band + '.tif' and
             isinstance(item['sha256'], str) and HEX.fullmatch(item['sha256']) is not None and
             type(item['bytes']) is int and 1 <= item['bytes'] <= MAX_RASTER_BYTES,
             'Invalid reference band entry')
        observed = _fingerprint(root / item['filename'], MAX_RASTER_BYTES)
        need(observed == {'sha256': item['sha256'], 'bytes': item['bytes']},
             'Reference TIFF changed or does not match independent manifest')
    return record


def audit(*, bundle: Path, seal: Path, seal_sha256: str,
          reference_dir: Path, reference_manifest_sha256: str) -> dict:
    need(isinstance(seal_sha256, str) and HEX.fullmatch(seal_sha256) is not None and
         isinstance(reference_manifest_sha256, str) and
         HEX.fullmatch(reference_manifest_sha256) is not None,
         'Two independently recorded SHA256 pins are required')
    source = Path(bundle).expanduser().absolute()
    receipt = Path(seal).expanduser().absolute()
    reference = Path(reference_dir).expanduser().absolute()
    need(not source.is_symlink() and source.is_dir() and
         not receipt.is_symlink() and reference != source and
         not (reference in source.parents or source in reference.parents),
         'Reference and source must be separate non-symlink directories')

    sealmod = _module()
    def check_seal():
        status = sealmod.verify_seal(source, receipt, seal_sha256)
        need(status.get('filesMatched') == 11 and
             status.get('pixelQaRechecked') is True and
             status.get('sha256OfSeal') == seal_sha256 and
             status.get('calibrationVerified') is False and
             status.get('operationalUseAllowed') is False,
             'Source bundle integrity or readiness unsafe')
    check_seal()
    ref_record = _check_reference(reference, reference_manifest_sha256)
    try:
        import numpy as np
        import rasterio
        from rasterio.windows import Window
    except ImportError as exc:
        raise ReferenceError('NumPy and rasterio required in isolated environment') from exc

    results = {}
    same_across_every_band = True
    with rasterio.Env(GDAL_PAM_ENABLED='NO', GDAL_DISABLE_READDIR_ON_OPEN='YES',
                      PROJ_NETWORK='OFF'):
        with ExitStack() as opened:
            source_layers = {}
            reference_layers = {}
            for name in BANDS:
                src_file = source / 'reflectance' / (name + '.tif')
                ref_file = reference / (name + '.tif')
                need(not src_file.is_symlink() and not ref_file.is_symlink(),
                     'Direct GeoTIFF files required')
                source_layers[name] = opened.enter_context(rasterio.open(src_file))
                reference_layers[name] = opened.enter_context(rasterio.open(ref_file))
            base = source_layers['red']
            need(base.crs is not None and base.driver == 'GTiff' and
                 1 <= base.width * base.height <= MAX_PIXELS,
                 'Source raster exceeds bounded reference QA')
            for name in BANDS:
                src = source_layers[name]
                ref = reference_layers[name]
                for ds in (src, ref):
                    need(ds.driver == 'GTiff' and ds.count == 1 and
                         ds.dtypes[0] == 'float32' and ds.nodata == NODATA and
                         ds.crs == base.crs and ds.transform == base.transform and
                         ds.width == base.width and ds.height == base.height,
                         'Reference and source must have identical CRS, transform, dimensions')
                reference_errors = []
                valid_source = valid_reference = compared = 0
                sum_abs = sum_error = sum_square = 0.0
                exact_equal = True
                for y in range(0, base.height, WINDOW):
                    for x in range(0, base.width, WINDOW):
                        win = Window(x, y, min(WINDOW, base.width-x),
                                     min(WINDOW, base.height-y))
                        a = src.read(1, window=win)
                        b = ref.read(1, window=win)
                        need(np.isfinite(a).all() and np.isfinite(b).all(),
                             'Nonfinite comparison data')
                        am = a != NODATA
                        bm = b != NODATA
                        need(not np.any((b[bm] < 0) | (b[bm] > 1)),
                             'Reference fraction outside physical sanity range')
                        valid_source += int(am.sum())
                        valid_reference += int(bm.sum())
                        common = am & bm
                        compared += int(common.sum())
                        error = a[common].astype(np.float64) - b[common].astype(np.float64)
                        if error.size:
                            abs_error = np.abs(error)
                            reference_errors.append(abs_error)
                            sum_error += float(np.sum(error))
                            sum_abs += float(np.sum(abs_error))
                            sum_square += float(np.dot(error, error))
                        if not np.array_equal(a, b):
                            exact_equal = False
                need(compared > 0, 'Reference and source have no shared valid pixels')
                same_across_every_band &= exact_equal
                abs_values = np.concatenate(reference_errors)
                p95 = float(np.percentile(abs_values, 95))
                mae = sum_abs / compared
                rmse = math.sqrt(sum_square / compared)
                union = valid_source + valid_reference - compared
                overlap = compared / union if union else 0
                results[name] = {
                    'comparedPixels': compared,
                    'sourceValidPixels': valid_source,
                    'referenceValidPixels': valid_reference,
                    'sourceOnlyPixels': valid_source - compared,
                    'referenceOnlyPixels': valid_reference - compared,
                    'maskIntersectionOverUnion': overlap,
                    'meanSignedError': sum_error / compared,
                    'meanAbsoluteError': mae,
                    'rmse': rmse,
                    'p95AbsoluteError': p95,
                    'withinExploratoryLimits': bool(mae <= LAB_MAE and
                        rmse <= LAB_RMSE and p95 <= LAB_P95 and
                        overlap >= LAB_MIN_MASK_OVERLAP),
                }

    need(not same_across_every_band,
         'Bit-identical reference across all bands cannot demonstrate independent comparison')
    # Fail closed if any reference bytes changed while comparing.
    _check_reference(reference, reference_manifest_sha256)
    check_seal()
    return {
        'schema': 'skyhub-m3m-private-reference-agreement-v1',
        'classification': 'experimental-quantitative-reference-agreement-not-calibration',
        'pixelCount': base.width * base.height,
        'bands': results,
        'labThresholds': {'meanAbsoluteErrorMax': LAB_MAE, 'rmseMax': LAB_RMSE,
                          'p95AbsoluteErrorMax': LAB_P95,
                          'maskIntersectionOverUnionMin': LAB_MIN_MASK_OVERLAP},
        'allBandsWithinExploratoryLimits': all(
            item['withinExploratoryLimits'] for item in results.values()),
        'sourceIntegrityRecheckedBeforeAndAfter': True,
        'referenceIntegrityRecheckedBeforeAndAfter': True,
        'sourceProvenanceVerified': False,
        'referenceProvenanceIndependentlyVerified': False,
        'radiometricCalibrationVerified': False,
        'bandCoregistrationVerified': False,
        'reflectanceReady': False, 'ndviReady': False, 'ndreReady': False,
        'operationalUseAllowed': False, 'prescriptionExportAllowed': False,
        'flightMissionAllowed': False,
    }


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bundle', type=Path, required=True)
    parser.add_argument('--seal', type=Path, required=True)
    parser.add_argument('--seal-sha256', required=True)
    parser.add_argument('--reference-dir', type=Path, required=True)
    parser.add_argument('--reference-manifest-sha256', required=True)
    args = parser.parse_args(argv)
    try:
        print(json.dumps(audit(bundle=args.bundle, seal=args.seal,
                               seal_sha256=args.seal_sha256,
                               reference_dir=args.reference_dir,
                               reference_manifest_sha256=args.reference_manifest_sha256),
                         sort_keys=True, allow_nan=False))
    except Exception as exc:
        print('M3M P3.5 private reference comparison refused: ' +
              type(exc).__name__, file=sys.stderr)
        return 2
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
