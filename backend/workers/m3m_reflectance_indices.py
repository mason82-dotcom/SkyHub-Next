#!/usr/bin/env python3
"""Offline-only M3M experimental index raster worker.

Accepts four pre-aligned float reflectance-fraction GeoTIFFs. Does NOT calibrate
DJI DNs, establish Mavic 3M provenance, or produce agronomic prescriptions.
Never imported by the SkyHub web backend and never contacts S3/MQTT/DB.
"""
from __future__ import annotations

import argparse
from contextlib import ExitStack
import json
import math
import os
from pathlib import Path
import shutil
import sys
import tempfile

EPSILON = 1e-6
NODATA = -9999.0
BANDS = ('red', 'green', 'red_edge', 'nir')
INDICES = ('ndvi', 'ndre', 'gndvi', 'osavi')
MAX_PIXELS = 2_000_000_000


class InvalidRaster(ValueError):
    """Reject an untrustworthy index input instead of deriving false results."""


def _dependencies():
    try:
        import numpy as np
        import rasterio
        from rasterio.windows import Window
    except ImportError as exc:
        raise RuntimeError('This optional offline worker needs numpy and rasterio') from exc
    return np, rasterio, Window


def _check_sources(datasets):
    reference = datasets['red']
    if reference.count != 1 or reference.width < 1 or reference.height < 1:
        raise InvalidRaster('Expected single-band, non-empty GeoTIFFs')
    if reference.width * reference.height > MAX_PIXELS:
        raise InvalidRaster('Raster exceeds bounded pixel count')
    if reference.crs is None or not all(math.isfinite(x) for x in tuple(reference.transform)):
        raise InvalidRaster('Missing or invalid georeferencing')
    if abs(reference.transform.a * reference.transform.e -
           reference.transform.b * reference.transform.d) < 1e-15:
        raise InvalidRaster('Singular geotransform')
    for band, ds in datasets.items():
        if ds.driver != 'GTiff' or ds.count != 1 or ds.dtypes[0] not in ('float32', 'float64'):
            raise InvalidRaster(f'{band}: only single-band floating-point GeoTIFF is supported')
        if (ds.width != reference.width or ds.height != reference.height or
                ds.crs != reference.crs or ds.transform != reference.transform):
            raise InvalidRaster(f'{band}: CRS, dimensions or pixel grid differ')
    return reference


def _index_window(np, arrays):
    """Return per-index (values, validity) and a common four-band source mask."""
    source_valid = np.ones(arrays['red'].shape, dtype=bool)
    values = {}
    for band in BANDS:
        arr = np.ma.asarray(arrays[band], dtype=np.float64)
        raw = np.asarray(arr.filled(np.nan), dtype=np.float64)
        finite = np.isfinite(raw)
        if np.any(finite & ((raw < 0.0) | (raw > 1.0))):
            raise InvalidRaster(f'{band}: reflectance fraction outside [0, 1]')
        source_valid &= finite & ~np.ma.getmaskarray(arr)
        values[band] = raw

    n, r, g, re = (values[k] for k in ('nir', 'red', 'green', 'red_edge'))
    formulas = {
        'ndvi': (n - r, n + r),
        'ndre': (n - re, n + re),
        'gndvi': (n - g, n + g),
        'osavi': (1.16 * (n - r), n + r + 0.16),
    }
    result = {}
    for name, (numerator, denominator) in formulas.items():
        valid = source_valid & np.isfinite(denominator) & (denominator > EPSILON)
        out = np.full(n.shape, NODATA, dtype=np.float32)
        np.divide(numerator, denominator, out=out, where=valid, casting='unsafe')
        result[name] = (out, valid)
    return result, source_valid


def produce(red: Path, green: Path, red_edge: Path, nir: Path, output_dir: Path) -> dict:
    """Write experimental index GeoTIFFs atomically into a new local directory."""
    np, rasterio, Window = _dependencies()
    paths = dict(zip(BANDS, (red, green, red_edge, nir)))
    paths = {k: Path(v).expanduser().resolve(strict=True) for k, v in paths.items()}
    for name, path in paths.items():
        if not path.is_file():
            raise InvalidRaster(f'{name}: input is not a regular local file')
    if len(set(paths.values())) != len(BANDS):
        raise InvalidRaster('Every spectral band must refer to a distinct source file')
    destination = Path(output_dir).expanduser().absolute()
    if os.path.lexists(destination):
        raise FileExistsError('Output directory already exists; existing products are never overwritten')
    if not destination.parent.is_dir():
        raise InvalidRaster('Output parent directory must already exist')

    with ExitStack() as stack:
        sources = {k: stack.enter_context(rasterio.open(v, 'r')) for k, v in paths.items()}
        reference = _check_sources(sources)
        stage = Path(tempfile.mkdtemp(prefix='.skyhub-m3m-indices-', dir=destination.parent))
        try:
            profile = reference.profile.copy()
            profile.update(driver='GTiff', dtype='float32', count=1,
                           nodata=NODATA, tiled=True, blockxsize=256, blockysize=256,
                           compress='deflate', predictor=3)
            with ExitStack() as writers_stack:
                writers = {
                    name: writers_stack.enter_context(rasterio.open(stage / f'{name}.tif', 'w', **profile))
                    for name in INDICES
                }
                count = {name: 0 for name in INDICES}
                sums = {name: 0.0 for name in INDICES}
                minimum = {name: None for name in INDICES}
                maximum = {name: None for name in INDICES}
                common_valid_count = 0
                # Bounded RAM even for very large input mosaics.
                for row in range(0, reference.height, 256):
                    for col in range(0, reference.width, 256):
                        window = Window(col, row, min(256, reference.width - col),
                                        min(256, reference.height - row))
                        arrays = {band: ds.read(1, window=window, masked=True)
                                  for band, ds in sources.items()}
                        results, common_valid = _index_window(np, arrays)
                        common_valid_count += int(np.count_nonzero(common_valid))
                        for name, (values, valid) in results.items():
                            writers[name].write(values, 1, window=window)
                            qty = int(np.count_nonzero(valid))
                            count[name] += qty
                            if qty:
                                actual = values[valid]
                                sums[name] += float(np.sum(actual, dtype=np.float64))
                                lo, hi = float(np.min(actual)), float(np.max(actual))
                                minimum[name] = lo if minimum[name] is None else min(minimum[name], lo)
                                maximum[name] = hi if maximum[name] is None else max(maximum[name], hi)
                manifest = {
                    'schema': 'skyhub-m3m-experimental-index-raster-v1',
                    'classification': 'operator-supplied-prealigned-float-reflectance-unverified',
                    'operationalUseAllowed': False,
                    'calibrationVerified': False,
                    'bandCoregistrationVerified': False,
                    'reflectanceReady': False,
                    'ndviReady': False,
                    'ndreReady': False,
                    'pixelGridAlignmentChecked': True,
                    'pixelCount': int(reference.width * reference.height),
                    'fourBandValidPixels': common_valid_count,
                    'epsilon': EPSILON,
                    'nodata': NODATA,
                    'outputs': {
                        name: {
                            'filename': f'{name}.tif',
                            'validPixels': count[name],
                            'mean': (sums[name] / count[name]) if count[name] else None,
                            'min': minimum[name], 'max': maximum[name],
                        }
                        for name in INDICES
                    },
                    'warning': 'Not radiometrically verified; do not use for prescriptions or automated agronomic decisions.',
                }
                (stage / 'report.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
            if os.path.lexists(destination):
                raise FileExistsError('Output directory appeared during processing')
            os.rename(stage, destination)
        except BaseException:
            shutil.rmtree(stage, ignore_errors=True)
            raise
    return manifest


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    for band in BANDS:
        parser.add_argument('--' + band.replace('_', '-'), required=True, type=Path)
    parser.add_argument('--output-dir', required=True, type=Path)
    args = parser.parse_args(argv)
    try:
        report = produce(args.red, args.green, args.red_edge, args.nir, args.output_dir)
    except (InvalidRaster, RuntimeError, OSError, ValueError) as exc:
        # Never echo private input paths, raster metadata or capture identifiers.
        print(f'M3M raster analysis failed: {type(exc).__name__}', file=sys.stderr)
        return 2
    print(json.dumps(report, sort_keys=True))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
