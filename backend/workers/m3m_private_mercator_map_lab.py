#!/usr/bin/env python3
"""P3.2: strictly private OFFLINE EPSG:3857 image/viewport laboratory package.

Use only numerical data from independently pinned, fully QA-checked M3M bundle.
The resulting PNGs are VISUAL ONLY. The separately stored viewport manifest
contains sensitive field location data. Neither is served over HTTP.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import shutil
import stat
import sys

INDICES = ('ndvi', 'ndre', 'gndvi', 'osavi')
SIDE = 512
NODATA = -9999.0
WEBMERCATOR_MAX = 20037508.342789244
MANIFEST = 'viewport.json'


class MapLabError(ValueError):
    """Private preview/map geometry is not safe to publish."""


def _module(filename, alias):
    source = Path(__file__).resolve().with_name(filename)
    spec = importlib.util.spec_from_file_location(alias, source)
    if spec is None or spec.loader is None:
        raise MapLabError('Required offline integrity or preview helper unavailable')
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _sha256(payload):
    return hashlib.sha256(payload).hexdigest()


def _private_parent(target):
    parent = target.parent
    if parent.is_symlink() or not parent.is_dir():
        raise MapLabError('Output parent must be an ordinary local directory')
    info = parent.stat()
    if not stat.S_ISDIR(info.st_mode) or info.st_mode & 0o077:
        raise MapLabError('Output parent must be access-restricted (0700)')
    if os.path.lexists(target):
        raise MapLabError('Output dataset must not already exist')


def _write_private_new(target, payload):
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, 'O_NOFOLLOW', 0)
    fd = os.open(target, flags, 0o600)
    try:
        with os.fdopen(fd, 'wb') as out:
            out.write(payload)
            out.flush()
            os.fsync(out.fileno())
    except BaseException:
        target.unlink(missing_ok=True)
        raise


def _verify_bundle(seal_mod, root, receipt, pin):
    r = seal_mod.verify_seal(root, receipt, pin)
    if (r.get('filesMatched') != 11 or r.get('pixelQaRechecked') is not True
            or r.get('sha256OfSeal') != pin.lower()
            or r.get('calibrationVerified') is not False
            or r.get('operationalUseAllowed') is not False):
        raise MapLabError('Independent raster and artifact integrity required')


def generate(*, bundle: Path, seal: Path, seal_sha256: str,
             output_dir: Path, private_output_ok=False):
    if private_output_ok is not True:
        raise MapLabError('Explicit acknowledgment of sensitive geolocation required')
    if (not isinstance(seal_sha256, str) or len(seal_sha256) != 64 or
            any(c not in '0123456789abcdefABCDEF' for c in seal_sha256)):
        raise MapLabError('Independent seal pin is required')
    root = Path(bundle).expanduser().absolute()
    receipt = Path(seal).expanduser().absolute()
    target = Path(output_dir).expanduser().absolute()
    if (root.is_symlink() or not root.is_dir() or receipt.is_symlink()
            or receipt == target or root == target or root in target.parents
            or target == receipt.parent or receipt in target.parents):
        raise MapLabError('Private map output must be separate from source or seal')
    # Reject symlinked path components, including ancestors that could alias a
    # trusted source or seal directory despite a direct non-symlink leaf.
    if (root.resolve(strict=True) != root or
            receipt.resolve(strict=True) != receipt or
            target.parent.resolve(strict=True) != target.parent):
        raise MapLabError('Symlinked or noncanonical private paths are forbidden')
    _private_parent(target)

    seal_mod = _module('m3m_raster_bundle_seal.py', '_skyhub_map_lab_seal')
    preview_mod = _module('m3m_private_index_preview.py', '_skyhub_map_lab_colors')
    _verify_bundle(seal_mod, root, receipt, seal_sha256)
    try:
        import numpy as np
        import rasterio
        from rasterio.warp import calculate_default_transform, reproject
        from rasterio.enums import Resampling
        from rasterio.transform import from_bounds
    except ImportError as exc:
        raise MapLabError('Optional rasterio and NumPy wheels are required') from exc

    encoded = {}
    bounds_m = None
    dimensions = None
    with rasterio.Env(GDAL_PAM_ENABLED='NO', GDAL_DISABLE_READDIR_ON_OPEN='YES',
                      PROJ_NETWORK='OFF'):
        for name in INDICES:
            source = root / 'indices' / (name + '.tif')
            if source.is_symlink() or not source.is_file():
                raise MapLabError('Only expected numerical TIFF inputs are accepted')
            with rasterio.open(source) as raster:
                if (raster.driver != 'GTiff' or raster.count != 1
                        or raster.dtypes[0] != 'float32' or raster.nodata != NODATA
                        or raster.crs is None or raster.width <= 0 or raster.height <= 0):
                    raise MapLabError('Expected georeferenced Float32 index raster')
                transform, native_w, native_h = calculate_default_transform(
                    raster.crs, 'EPSG:3857', raster.width, raster.height,
                    *raster.bounds)
                x0, y1 = transform * (0, 0)
                x1, y0 = transform * (native_w, native_h)
                if not (all(math.isfinite(x) for x in (x0, y0, x1, y1))
                        and -WEBMERCATOR_MAX < x0 < x1 < WEBMERCATOR_MAX
                        and -WEBMERCATOR_MAX < y0 < y1 < WEBMERCATOR_MAX):
                    raise MapLabError('Georeference outside finite Web Mercator bounds')
                # Prefer original pixel resolution; downsample to bounded image
                # dimensions without ever treating interpolated RGB as measurements.
                fraction = min(1.0, SIDE / max(native_w, native_h))
                width = max(1, min(SIDE, math.ceil(native_w * fraction)))
                height = max(1, min(SIDE, math.ceil(native_h * fraction)))
                grid = (float(x0), float(y0), float(x1), float(y1))
                if bounds_m is None:
                    bounds_m, dimensions = grid, (width, height)
                elif (grid != bounds_m or dimensions != (width, height)):
                    raise MapLabError('Index grids differ after reprojection')
                dest = np.full((height, width), NODATA, dtype=np.float32)
                reproject(
                    source=rasterio.band(raster, 1), destination=dest,
                    src_transform=raster.transform, src_crs=raster.crs,
                    src_nodata=NODATA, dst_transform=from_bounds(*grid, width, height),
                    dst_crs='EPSG:3857', dst_nodata=NODATA,
                    resampling=Resampling.nearest, num_threads=1,
                    init_dest_nodata=True)
                valid = (dest != NODATA) & np.isfinite(dest)
                if np.any(valid & ((dest < -2) | (dest > 2))):
                    raise MapLabError('Resampled index range invalid')
                encoded[name + '.png'] = preview_mod._png_rgba(
                    dest, valid, width, height)

    # Check ALL numeric raster files and the externally pinned seal again.
    _verify_bundle(seal_mod, root, receipt, seal_sha256)
    manifest = {
        'schema': 'skyhub-m3m-private-mercator-map-lab-v1',
        'classification': 'private-local-georeferenced-visualization-not-calibrated',
        'projection': 'EPSG:3857',
        'boundsMeters': list(bounds_m),
        'width': dimensions[0], 'height': dimensions[1],
        'images': [
            {'index': index, 'filename': index + '.png',
             'sha256': _sha256(encoded[index + '.png'])}
            for index in INDICES
        ],
        'sourceSealSha256': seal_sha256.lower(),
        'imagePixelsAreMeasurements': False,
        'sourceRasterIntegrityRechecked': True,
        'geolocationIsSensitive': True,
        'mapTilesAvailable': False,
        'radiometricCalibrationVerified': False,
        'reflectanceReady': False,
        'operationalUseAllowed': False,
        'prescriptionExportAllowed': False,
        'flightMissionAllowed': False
    }
    payload = (json.dumps(manifest, separators=(',', ':'), sort_keys=True,
                          allow_nan=False) + '\n').encode('utf-8')
    # Every output is staged in a new 0700 directory. viewport.json is the
    # final commit marker. Failed attempts cannot modify the sealed source.
    os.mkdir(target, 0o700)
    try:
        for filename, data in encoded.items():
            _write_private_new(target / filename, data)
        _write_private_new(target / MANIFEST, payload)
        fd = os.open(target, os.O_RDONLY | getattr(os, 'O_DIRECTORY', 0))
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    except BaseException:
        shutil.rmtree(target)
        raise
    return {
        'schema': 'skyhub-m3m-private-map-lab-summary-v1',
        'images': 4,
        'width': dimensions[0], 'height': dimensions[1],
        'manifestSha256': _sha256(payload),
        'containsSensitiveGeolocation': True,
        'radiometricCalibrationVerified': False,
        'operationalUseAllowed': False
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bundle', required=True, type=Path)
    parser.add_argument('--seal', required=True, type=Path)
    parser.add_argument('--seal-sha256', required=True)
    parser.add_argument('--output-dir', required=True, type=Path)
    parser.add_argument('--private-output-ok', action='store_true')
    args = parser.parse_args(argv)
    try:
        record = generate(bundle=args.bundle, seal=args.seal,
                          seal_sha256=args.seal_sha256,
                          output_dir=args.output_dir,
                          private_output_ok=args.private_output_ok)
    except Exception as exc:
        print('Private M3M geographic map laboratory refused: ' +
              type(exc).__name__, file=sys.stderr)
        return 2
    print(json.dumps(record, sort_keys=True, allow_nan=False))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
