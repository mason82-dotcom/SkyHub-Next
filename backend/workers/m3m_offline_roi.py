#!/usr/bin/env python3
"""P3: offline local pixel/ROI statistics from an independently pinned M3M bundle.

Only operates on the experimental raster bundle produced by the draft pipeline.
Requires a SHA256 pin of the external seal. No maps/HTTP, coordinates, machine
prescriptions, side effects or operational readiness claims.
"""
from __future__ import annotations

import argparse
from contextlib import ExitStack
import importlib.util
import json
from pathlib import Path
import re
import sys

LAYERS = ('red', 'green', 'red_edge', 'nir', 'ndvi', 'ndre', 'gndvi', 'osavi')
BAND_LAYERS = frozenset(LAYERS[:4])
MAX_ROI_PIXELS = 250_000
SHA = re.compile(r'[0-9a-fA-F]{64}\Z')


class InspectError(ValueError):
    """The requested offline raster inspection is not trustworthy."""


def _seal_module():
    location = Path(__file__).resolve().with_name('m3m_raster_bundle_seal.py')
    spec = importlib.util.spec_from_file_location('_skyhub_m3m_roi_seal', location)
    if spec is None or spec.loader is None:
        raise InspectError('Pinned raster QA verifier unavailable')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _bounds(rect, width: int, height: int):
    if (not isinstance(rect, (tuple, list)) or len(rect) != 4
            or any(type(n) is not int for n in rect)):
        raise InspectError('Integer pixel rectangle required')
    row0, col0, row1, col1 = rect
    if not (0 <= row0 < row1 <= height and 0 <= col0 < col1 <= width):
        raise InspectError('Pixel rectangle outside image')
    pixels = (row1 - row0) * (col1 - col0)
    if pixels > MAX_ROI_PIXELS:
        raise InspectError('Pixel rectangle too large')
    return row0, col0, row1, col1, pixels


def _stats(np, pixels):
    arr = np.asarray(pixels, dtype=np.float64)
    if arr.size == 0:
        return {'validPixels': 0, 'min': None, 'max': None, 'mean': None,
                'median': None, 'p10': None, 'p90': None, 'stddev': None}
    if not np.isfinite(arr).all():
        raise InspectError('Nonfinite pixels rejected')
    return {
        'validPixels': int(arr.size),
        'min': float(np.min(arr)), 'max': float(np.max(arr)),
        'mean': float(np.mean(arr)), 'median': float(np.median(arr)),
        'p10': float(np.percentile(arr, 10)),
        'p90': float(np.percentile(arr, 90)),
        'stddev': float(np.std(arr)),
    }


def inspect_roi(*, bundle: Path, seal: Path, seal_sha256: str, rect) -> dict:
    """Read bounded ROI and recheck the full independently pinned bundle afterward."""
    if not isinstance(seal_sha256, str) or SHA.fullmatch(seal_sha256) is None:
        raise InspectError('Independent seal digest required')
    root = Path(bundle).expanduser().absolute()
    seal_path = Path(seal).expanduser().absolute()
    if root.is_symlink() or not root.is_dir() or seal_path.is_symlink():
        raise InspectError('Ordinary local source paths required')
    verifier = _seal_module()
    def check_pin():
        result = verifier.verify_seal(root, seal_path, seal_sha256)
        if (result.get('filesMatched') != 11
                or result.get('pixelQaRechecked') is not True
                or result.get('sha256OfSeal') != seal_sha256.lower()
                or result.get('calibrationVerified') is not False
                or result.get('operationalUseAllowed') is not False):
            raise InspectError('Full independent seal and pixel QA required')
    check_pin()
    try:
        import numpy as np
        import rasterio
        from rasterio.windows import Window
    except ImportError as exc:
        raise InspectError('Isolated numpy and rasterio dependencies required') from exc
    with rasterio.Env(GDAL_PAM_ENABLED='NO', GDAL_DISABLE_READDIR_ON_OPEN='YES'):
        with ExitStack() as stack:
            datasets = {}
            for layer in LAYERS:
                stage = 'reflectance' if layer in BAND_LAYERS else 'indices'
                source = root / stage / (layer + '.tif')
                if source.is_symlink() or not source.is_file():
                    raise InspectError('Only expected direct raster files are accepted')
                datasets[layer] = stack.enter_context(rasterio.open(source, 'r'))
            base = datasets['red']
            row0, col0, row1, col1, count = _bounds(rect, base.width, base.height)
            win = Window(col0, row0, col1 - col0, row1 - row0)
            statistics = {}
            for layer in LAYERS:
                ds = datasets[layer]
                # The signed bundle verifier already checked this grid; reassert
                # before use in case an input was swapped after the first QA.
                if (ds.driver != 'GTiff' or ds.count != 1 or ds.dtypes[0] != 'float32'
                        or ds.crs != base.crs or ds.transform != base.transform
                        or ds.width != base.width or ds.height != base.height):
                    raise InspectError('Raster grid unexpectedly differs')
                arr = ds.read(1, window=win, masked=True)
                valid = ~np.ma.getmaskarray(arr)
                raw = np.asarray(arr.data, dtype=np.float64)
                valid &= np.isfinite(raw)
                statistics[layer] = _stats(np, raw[valid])
                statistics[layer]['maskedPixels'] = count - statistics[layer]['validPixels']
    check_pin()
    return {
        'schema': 'skyhub-m3m-offline-roi-report-v1',
        'classification': 'sealed-experimental-pixel-statistics-not-calibrated-agronomy',
        'pixelWindowBasis': 'zero-based-row-col-exclusive-end',
        'roiPixels': count,
        'indicesUnit': 'dimensionless',
        'bandValueClass': 'operator-claimed-fraction-unverified',
        'layers': statistics,
        'integrityRecheckedAfterRead': True,
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


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bundle', required=True, type=Path)
    parser.add_argument('--seal', required=True, type=Path)
    parser.add_argument('--seal-sha256', required=True)
    parser.add_argument('--row0', required=True, type=int)
    parser.add_argument('--col0', required=True, type=int)
    parser.add_argument('--row1', required=True, type=int)
    parser.add_argument('--col1', required=True, type=int)
    args = parser.parse_args(argv)
    try:
        result = inspect_roi(
            bundle=args.bundle, seal=args.seal, seal_sha256=args.seal_sha256,
            rect=(args.row0, args.col0, args.row1, args.col1),
        )
    except Exception as exc:
        # No coordinate, raster path, EXIF, phone/device, or stack traces in CLI output.
        print('M3M P3 offline ROI refused: ' + type(exc).__name__, file=sys.stderr)
        return 2
    print(json.dumps(result, sort_keys=True, allow_nan=False))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
