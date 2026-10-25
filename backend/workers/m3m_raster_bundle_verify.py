#!/usr/bin/env python3
"""Read-only, pixel-wise QA of an EXPERIMENTAL SkyHub M3M raster bundle.

Checks already-created outputs, never validates DJI radiometry or DEDAL identity.
Does not execute DEDAL, control drones or access the network.
"""
from __future__ import annotations

import argparse
import json
import math
from contextlib import ExitStack
from pathlib import Path
import stat
import sys

BANDS = ('red', 'green', 'red_edge', 'nir')
INDICES = ('ndvi', 'ndre', 'gndvi', 'osavi')
NODATA = -9999.0
EPSILON = 1e-6
TOLERANCE = 5e-5
MAX_PIXELS = 2_000_000_000
MAX_FILE_BYTES = 100 * 1024 * 1024 * 1024
MAX_REPORT_BYTES = 128 * 1024
FALSE_FLAGS = ('operationalUseAllowed', 'reflectanceReady', 'ndviReady', 'ndreReady')


class BundleError(ValueError):
    """Bundle is incomplete, inconsistent or appears modified."""


def _pairs(items):
    result = {}
    for key, value in items:
        if key in result:
            raise BundleError('Repeated JSON key')
        result[key] = value
    return result


def _reject_constant(_value):
    raise BundleError('Nonfinite JSON number')


def _regular(path: Path, maximum: int):
    if path.is_symlink():
        raise BundleError('Symlink files not permitted')
    s = path.stat()
    if not stat.S_ISREG(s.st_mode) or not 1 <= s.st_size <= maximum:
        raise BundleError('Missing or oversized bundle file')


def _load_json(path: Path):
    _regular(path, MAX_REPORT_BYTES)
    with path.open('r', encoding='utf-8') as source:
        obj = json.load(source, object_pairs_hook=_pairs, parse_constant=_reject_constant)
    if not isinstance(obj, dict):
        raise BundleError('Report must be an object')
    return obj


def _directory(path: Path, expected: set[str]):
    if path.is_symlink() or not path.is_dir():
        raise BundleError('Expected ordinary bundle directory')
    if {p.name for p in path.iterdir()} != expected:
        raise BundleError('Missing or unexpected bundle entries')


def _flags(report, extra=()):
    for name in (*FALSE_FLAGS, *extra):
        if report.get(name) is not False:
            raise BundleError('Invalid readiness flag')


def _counts(report, keys, max_pixels):
    outputs = report.get('outputs')
    if not isinstance(outputs, dict) or set(outputs) != set(keys):
        raise BundleError('Incorrect stage outputs')
    for name in keys:
        row = outputs[name]
        if not isinstance(row, dict) or row.get('filename') != name + '.tif':
            raise BundleError('Wrong stage output file mapping')
        number = row.get('validPixels')
        if type(number) is not int or not 0 <= number <= max_pixels:
            raise BundleError('Invalid stage pixel count')
    return outputs


def _expect_mean(count, total, claimed):
    if count == 0:
        if claimed is not None:
            raise BundleError('Mean must be null for empty raster')
    elif (type(claimed) not in (int, float) or not math.isfinite(claimed)
          or abs(total / count - claimed) > TOLERANCE):
        raise BundleError('Reported mean does not match raster data')


def verify_bundle(bundle: Path) -> dict:
    """Read all eight pixels streams and independently recompute index formulas."""
    try:
        import numpy as np
        import rasterio
        from rasterio.windows import Window
    except ImportError as exc:
        raise RuntimeError('Optional numpy and rasterio dependencies required') from exc

    root = Path(bundle).expanduser().absolute()
    _directory(root, {'reflectance', 'indices', 'bundle-report.json'})
    fractions, indices = root / 'reflectance', root / 'indices'
    _directory(fractions, {*(b + '.tif' for b in BANDS), 'report.json'})
    _directory(indices, {*(i + '.tif' for i in INDICES), 'report.json'})
    top = _load_json(root / 'bundle-report.json')
    band_report = _load_json(fractions / 'report.json')
    index_report = _load_json(indices / 'report.json')
    if (top.get('schema') != 'skyhub-m3m-offline-orthomosaic-index-bundle-v1'
        or band_report.get('schema') != 'skyhub-m3m-dedal-ortho-handoff-v1'
        or index_report.get('schema') != 'skyhub-m3m-experimental-index-raster-v1'
        or top.get('stageSchemas') != [band_report['schema'], index_report['schema']]):
        raise BundleError('Unexpected or inconsistent report schema')
    _flags(top, ('radiometricCalibrationVerified', 'bandCoregistrationVerified',
                 'captureAndPanelProvenanceVerified', 'dedalExecutedBySkyHub'))
    _flags(band_report, ('radiometricCalibrationVerified', 'bandCoregistrationVerified',
                         'sourceProvenanceVerified'))
    _flags(index_report, ('calibrationVerified', 'bandCoregistrationVerified'))
    if (top.get('sourceSha256MatchesOperatorPin') is not True or
        top.get('sourceRetainedDuringRun') is not True or
        top.get('externalCalibrationStatusClaim') not in ('accepted', 'flagged')):
        raise BundleError('Unexpected external-source claim')

    with rasterio.Env(GDAL_PAM_ENABLED='NO', GDAL_DISABLE_READDIR_ON_OPEN='YES'):
        with ExitStack() as stack:
            datasets = {}
            for name, directory in [(b, fractions) for b in BANDS] + [(i, indices) for i in INDICES]:
                # Explicit fixed filenames; no user report controls filesystem paths.
                path = directory / (name + '.tif')
                _regular(path, MAX_FILE_BYTES)
                datasets[name] = stack.enter_context(rasterio.open(path, 'r'))
            base = datasets['red']
            pixel_count = base.width * base.height
            transform = base.transform
            if (base.width < 1 or base.height < 1 or pixel_count > MAX_PIXELS or base.crs is None
                or not all(math.isfinite(float(x)) for x in tuple(transform))
                or abs(transform.a * transform.e - transform.b * transform.d) < 1e-15):
                raise BundleError('Invalid pixel grid')
            for ds in datasets.values():
                if (ds.driver != 'GTiff' or ds.count != 1 or ds.dtypes[0] != 'float32'
                    or ds.nodata != NODATA or ds.width != base.width or ds.height != base.height
                    or ds.crs != base.crs or ds.transform != transform):
                    raise BundleError('GeoTIFF metadata mismatch')
            if band_report.get('pixelCount') != pixel_count or index_report.get('pixelCount') != pixel_count:
                raise BundleError('Incorrect report dimensions')
            band_outputs = _counts(band_report, BANDS, pixel_count)
            index_outputs = _counts(index_report, INDICES, pixel_count)
            for report_key, expected_keys, outputs in (
                ('reflectanceValidPixels', BANDS, band_outputs),
                ('indicesValidPixels', INDICES, index_outputs),
            ):
                values = top.get(report_key)
                if not isinstance(values, dict) or set(values) != set(expected_keys):
                    raise BundleError('Invalid bundle counts')
                if any(values[k] != outputs[k]['validPixels'] for k in expected_keys):
                    raise BundleError('Bundle stage count mismatch')

            stats = {k: {'valid': 0, 'sum': 0.0, 'min': None, 'max': None}
                     for k in (*BANDS, *INDICES)}
            common_count = 0
            for row in range(0, base.height, 256):
                for col in range(0, base.width, 256):
                    win = Window(col, row, min(256, base.width-col), min(256, base.height-row))
                    band_values = {}
                    band_masks = {}
                    common = None
                    for name in BANDS:
                        raw = datasets[name].read(1, window=win)
                        if not np.isfinite(raw).all():
                            raise BundleError('Nonfinite reflectance raster values')
                        valid = raw != NODATA
                        if np.any((raw[valid] < 0) | (raw[valid] > 1)):
                            raise BundleError('Reflectance fraction outside [0,1]')
                        band_values[name] = raw.astype(np.float64)
                        band_masks[name] = valid
                        common = valid.copy() if common is None else common & valid
                        _accumulate(np, stats[name], raw, valid)
                    common_count += int(np.count_nonzero(common))
                    n, r, g, re = (band_values[k] for k in ('nir', 'red', 'green', 'red_edge'))
                    formulas = {
                        'ndvi': (n-r, n+r),
                        'ndre': (n-re, n+re),
                        'gndvi': (n-g, n+g),
                        'osavi': (1.16*(n-r), n+r+0.16),
                    }
                    for name, (numerator, denominator) in formulas.items():
                        observed = datasets[name].read(1, window=win)
                        valid = common & np.isfinite(denominator) & (denominator > EPSILON)
                        if not np.isfinite(observed).all():
                            raise BundleError('Nonfinite index raster values')
                        if np.any(observed[~valid] != NODATA):
                            raise BundleError('Invalid index nodata mask')
                        if np.any(observed[valid] == NODATA):
                            raise BundleError('Unexpected index nodata')
                        if np.any(valid):
                            expected = numerator[valid] / denominator[valid]
                            if np.any(np.abs(observed[valid].astype(np.float64) - expected) > TOLERANCE):
                                raise BundleError('Vegetation index differs from input reflectance')
                        _accumulate(np, stats[name], observed, valid)
            if index_report.get('fourBandValidPixels') != common_count:
                raise BundleError('Four-band common pixel count differs')
            for name in (*BANDS, *INDICES):
                result = stats[name]
                metadata = (band_outputs if name in BANDS else index_outputs)[name]
                if result['valid'] != metadata['validPixels']:
                    raise BundleError('Reported valid-pixel count differs')
                _expect_mean(result['valid'], result['sum'], metadata.get('mean'))
                if name in INDICES:
                    for field in ('min', 'max'):
                        claim = metadata.get(field)
                        actual = result[field]
                        if actual is None:
                            if claim is not None:
                                raise BundleError('Index extrema must be null')
                        elif type(claim) not in (int, float) or abs(claim - actual) > TOLERANCE:
                            raise BundleError('Index extrema do not match')
    return {
        'schema': 'skyhub-m3m-raster-bundle-qa-v1',
        'classification': 'independent-geotiff-pixel-math-verification-not-calibration',
        'filesFullyDecoded': 8,
        'pixelsPerRaster': pixel_count,
        'validIndices': {key: stats[key]['valid'] for key in INDICES},
        'allGridMetadataMatched': True,
        'pixelFormulaAndMaskChecksPassed': True,
        'stageStatisticsMatched': True,
        'captureProvenanceVerified': False,
        'radiometricCalibrationVerified': False,
        'bandCoregistrationVerified': False,
        'reflectanceReady': False,
        'ndviReady': False,
        'ndreReady': False,
        'operationalUseAllowed': False,
    }


def _accumulate(np, dst, arr, mask):
    values = arr[mask]
    if values.size:
        dst['valid'] += int(values.size)
        dst['sum'] += float(np.sum(values, dtype=np.float64))
        lo, hi = float(np.min(values)), float(np.max(values))
        dst['min'] = lo if dst['min'] is None else min(dst['min'], lo)
        dst['max'] = hi if dst['max'] is None else max(dst['max'], hi)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bundle', type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        report = verify_bundle(args.bundle)
    except Exception as exc:
        print('M3M raster bundle QA refused: ' + type(exc).__name__, file=sys.stderr)
        return 2
    print(json.dumps(report, sort_keys=True))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
