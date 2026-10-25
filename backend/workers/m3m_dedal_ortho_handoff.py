#!/usr/bin/env python3
"""Offline DEDAL/ODM five-band orthophoto -> four reflectance-fraction rasters.

NOT a radiometric calibrator, DJI provenance validator or agronomic workflow.
The calibration status is an unverified operator claim; readiness stays false.
"""
from __future__ import annotations

import argparse
from contextlib import ExitStack
import json
import math
import os
from pathlib import Path
import shutil
import stat
import sys
import tempfile

SCALE = 32768.0
NODATA = -9999.0
TILE = 256
MAX_PIXELS = 2_000_000_000
MAX_BYTES = 100 * 1024 * 1024 * 1024
SOURCE_BANDS = {'red': 1, 'green': 2, 'nir': 3, 'red_edge': 4}


class HandoffError(ValueError):
    """An external orthophoto fails SkyHub's restrictive import contract."""


def _require_libraries():
    try:
        import numpy as np
        import rasterio
        from rasterio.windows import Window
    except ImportError as exc:
        raise RuntimeError('Optional numpy and rasterio packages are required') from exc
    return np, rasterio, Window


def _checked_orthophoto(src):
    if src.driver != 'GTiff' or src.count != 5 or any(t != 'uint16' for t in src.dtypes):
        raise HandoffError('Expected exactly five uint16 GeoTIFF bands')
    if src.width < 1 or src.height < 1 or src.width * src.height > MAX_PIXELS:
        raise HandoffError('Invalid or oversized orthophoto dimensions')
    if src.crs is None or not all(math.isfinite(v) for v in tuple(src.transform)):
        raise HandoffError('Orthophoto requires a finite affine transform and CRS')
    t = src.transform
    if abs(t.a * t.e - t.b * t.d) < 1e-15:
        raise HandoffError('Orthophoto has a singular affine transform')
    return src.profile.copy()


def convert_orthophoto(source: Path, output_dir: Path, *,
                       calibration_status: str, allow_flagged: bool = False) -> dict:
    """Perform an offline, non-overwriting conversion; no live SkyHub writes.

    The operator-provided calibration status is neither verified nor elevated
    to a SkyHub readiness flag. A 'not_calibrated' input is always refused.
    """
    if calibration_status not in ('accepted', 'flagged', 'not_calibrated'):
        raise HandoffError('Unknown external calibration status')
    if calibration_status == 'not_calibrated':
        raise HandoffError('Externally uncalibrated data must not be treated as reflectance')
    if calibration_status == 'flagged' and not allow_flagged:
        raise HandoffError('Flagged calibration requires an explicit opt-in')
    if not isinstance(allow_flagged, bool):
        raise HandoffError('Invalid allow_flagged flag')

    src_path = Path(source).expanduser().absolute()
    if src_path.is_symlink() or src_path.suffix.lower() not in ('.tif', '.tiff'):
        raise HandoffError('Only direct local TIFF files are accepted')
    info = src_path.stat()
    if not stat.S_ISREG(info.st_mode) or info.st_size < 16 or info.st_size > MAX_BYTES:
        raise HandoffError('Not a bounded regular TIFF')
    destination = Path(output_dir).expanduser().absolute()
    if os.path.lexists(destination):
        raise FileExistsError('Output directory already exists')
    if not destination.parent.is_dir():
        raise HandoffError('Output parent directory does not exist')
    # A symlink parent is permitted only if the caller's isolated storage
    # permissions already authorize it; no writing to arbitrary file names.
    np, rasterio, Window = _require_libraries()
    with rasterio.Env(GDAL_PAM_ENABLED='NO', GDAL_DISABLE_READDIR_ON_OPEN='YES'):
        with rasterio.open(src_path, 'r') as ds:
            source_profile = _checked_orthophoto(ds)
            stage = Path(tempfile.mkdtemp(prefix='.skyhub-dedal-handoff-', dir=destination.parent))
            try:
                target_profile = source_profile.copy()
                target_profile.update(driver='GTiff', count=1, dtype='float32',
                                      nodata=NODATA, compress='deflate', predictor=3,
                                      tiled=True, blockxsize=TILE, blockysize=TILE,
                                      interleave='band')
                counts = {band: {'validPixels': 0, 'sumReflectance': 0.0}
                          for band in SOURCE_BANDS}
                invalid_alpha = 0
                with ExitStack() as stack:
                    outputs = {
                        band: stack.enter_context(rasterio.open(stage / (band + '.tif'),
                                                                  'w', **target_profile))
                        for band in SOURCE_BANDS
                    }
                    for row in range(0, ds.height, TILE):
                        for col in range(0, ds.width, TILE):
                            win = Window(col, row, min(TILE, ds.width-col),
                                         min(TILE, ds.height-row))
                            alpha = ds.read(5, window=win)
                            alpha_valid = alpha > 0
                            invalid_alpha += int(np.count_nonzero(~alpha_valid))
                            for band, number in SOURCE_BANDS.items():
                                raw = ds.read(number, window=win)
                                mask = ds.read_masks(number, window=win) > 0
                                valid = alpha_valid & mask
                                if np.any(raw[valid] > SCALE):
                                    raise HandoffError('Scaled source pixel exceeds reflectance of one')
                                output = np.full(raw.shape, NODATA, dtype=np.float32)
                                output[valid] = raw[valid].astype(np.float32) / SCALE
                                outputs[band].write(output, 1, window=win)
                                counts[band]['validPixels'] += int(np.count_nonzero(valid))
                                counts[band]['sumReflectance'] += float(
                                    np.sum(output[valid], dtype=np.float64))
                report = {
                    'schema': 'skyhub-m3m-dedal-ortho-handoff-v1',
                    'classification': 'external-dedal-claimed-calibration-unverified',
                    'externalCalibrationStatusClaim': calibration_status,
                    'flaggedInputExplicitlyAllowed': calibration_status == 'flagged' and allow_flagged,
                    'pixelCount': int(ds.width * ds.height),
                    'invalidAlphaPixels': invalid_alpha,
                    'sourceBandOrder': ['Red', 'Green', 'NIR', 'RedEdge', 'Alpha'],
                    'sourceScaleDivisor': int(SCALE),
                    'floatNodata': NODATA,
                    'outputs': {
                        band: {
                            'filename': band + '.tif',
                            'validPixels': counts[band]['validPixels'],
                            'mean': (counts[band]['sumReflectance'] / counts[band]['validPixels']
                                     if counts[band]['validPixels'] else None),
                        } for band in SOURCE_BANDS
                    },
                    'sourceProvenanceVerified': False,
                    'radiometricCalibrationVerified': False,
                    'bandCoregistrationVerified': False,
                    'reflectanceReady': False,
                    'ndviReady': False,
                    'ndreReady': False,
                    'operationalUseAllowed': False,
                    'warning': 'External calibration result is operator-claimed only; output is experimental and not approved for agronomic decisions.',
                }
                (stage / 'report.json').write_text(
                    json.dumps(report, indent=2, allow_nan=False) + '\n', encoding='utf-8')
                # Do not overwrite a concurrently created output directory.
                if os.path.lexists(destination):
                    raise FileExistsError('Output directory appeared while converting')
                os.rename(stage, destination)
            except BaseException:
                shutil.rmtree(stage, ignore_errors=True)
                raise
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--orthophoto', required=True, type=Path)
    parser.add_argument('--output-dir', required=True, type=Path)
    parser.add_argument('--calibration-status', required=True,
                        choices=('accepted', 'flagged', 'not_calibrated'))
    parser.add_argument('--allow-flagged', action='store_true')
    args = parser.parse_args(argv)
    try:
        result = convert_orthophoto(args.orthophoto, args.output_dir,
                                    calibration_status=args.calibration_status,
                                    allow_flagged=args.allow_flagged)
    except (HandoffError, RuntimeError, OSError, ValueError) as exc:
        print('M3M orthophoto handoff refused input: ' + type(exc).__name__,
              file=sys.stderr)
        return 2
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
