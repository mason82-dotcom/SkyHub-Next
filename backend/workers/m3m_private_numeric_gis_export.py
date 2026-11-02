#!/usr/bin/env python3
"""P3.3 experimental *private* numeric GeoTIFF/CSV polygon export.

Reads independently pinned synthetic/labor M3M bundle. Does NOT create COGs,
publish URLs, enable prescriptions, or validate radiometry. TIFF output carries
sensitive georeferencing and must never be placed in a public web directory.
"""
from __future__ import annotations

import argparse
import csv
from contextlib import ExitStack
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import stat
import sys

BANDS = ('red', 'green', 'red_edge', 'nir')
INDICES = ('ndvi', 'ndre', 'gndvi', 'osavi')
LAYERS = (*BANDS, *INDICES)
NODATA = -9999.0
MANIFEST_NAME = 'export-manifest.json'


class ExportError(ValueError):
    """An offline private numeric export cannot be safely committed."""


def _module(name, alias):
    source = Path(__file__).resolve().with_name(name)
    spec = importlib.util.spec_from_file_location(alias, source)
    if spec is None or spec.loader is None:
        raise ExportError('Offline GIS helper not available')
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _checksum_file(file: Path):
    sha = hashlib.sha256()
    with file.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            sha.update(block)
    return {'sha256': sha.hexdigest(), 'bytes': file.stat().st_size}


def _write_private(target, data: bytes):
    fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL |
                 getattr(os, 'O_NOFOLLOW', 0), 0o600)
    try:
        with os.fdopen(fd, 'wb') as out:
            out.write(data)
            out.flush()
            os.fsync(out.fileno())
    except BaseException:
        target.unlink(missing_ok=True)
        raise


def _private_destination(target: Path, root: Path, receipt: Path, geometry: Path):
    if (target == root or root in target.parents
            or target == receipt or target == receipt.parent
            or target == geometry or target == geometry.parent
            or target.is_symlink() or os.path.lexists(target)
            or not target.parent.is_dir() or target.parent.is_symlink()):
        raise ExportError('Export must be in a new independent private directory')
    if target.parent.stat().st_mode & 0o077:
        raise ExportError('Export parent must be private (mode 0700)')


def _verify_pinned(verifier, bundle, seal, digest):
    status = verifier.verify_seal(bundle, seal, digest)
    if (status.get('filesMatched') != 11
            or status.get('pixelQaRechecked') is not True
            or status.get('sha256OfSeal') != digest.lower()
            or status.get('calibrationVerified') is not False
            or status.get('operationalUseAllowed') is not False):
        raise ExportError('Original GeoTIFF bundle failed full pinned integrity check')


def _csv_bytes(statistics):
    fields = ('layer', 'validPixels', 'maskedOrNoDataPixels', 'min', 'max',
              'mean', 'median', 'p10', 'p90', 'stddev')
    buf = io.StringIO(newline='')
    writer = csv.writer(buf, lineterminator='\n')
    writer.writerow(fields)
    for name in LAYERS:
        row = statistics[name]
        writer.writerow([name] + [
            '' if row.get(key) is None else
            (format(row[key], '.17g') if isinstance(row[key], float)
             else str(row[key]))
            for key in fields[1:]
        ])
    return buf.getvalue().encode('utf-8')


def export(*, bundle: Path, seal: Path, seal_sha256: str,
           geometry_file: Path, output_dir: Path,
           private_output_ok=False) -> dict:
    if private_output_ok is not True:
        raise ExportError('Explicit consent for private georeferenced export required')
    if not (isinstance(seal_sha256, str) and len(seal_sha256) == 64
            and all(c in '0123456789abcdefABCDEF' for c in seal_sha256)):
        raise ExportError('Independently pinned SHA-256 of seal required')
    root = Path(bundle).expanduser().absolute()
    receipt = Path(seal).expanduser().absolute()
    geometry_path = Path(geometry_file).expanduser().absolute()
    target = Path(output_dir).expanduser().absolute()
    if (root.is_symlink() or not root.is_dir() or receipt.is_symlink()
            or geometry_path == receipt or geometry_path == root
            or root in geometry_path.parents):
        raise ExportError('Source geometry or raster paths not trusted')
    # Reject nested symlink/alias components for every trusted file path,
    # including a target parent that might alias the sealed source tree.
    # This guard is offline hardening, not a complete openat/race-proof sandbox.
    for candidate in (root, receipt, geometry_path, target.parent):
        if candidate.resolve(strict=True) != candidate:
            raise ExportError('Noncanonical or symlinked private path')
    _private_destination(target, root, receipt, geometry_path)
    gis = _module('m3m_private_gis_query.py', '_skyhub_export_gis')
    verifier = _module('m3m_raster_bundle_seal.py', '_skyhub_export_seal')
    geometry, original_hash = gis._read_private_geometry(geometry_path)
    if geometry['type'] != 'Polygon':
        raise ExportError('Only an explicit private WGS84 Polygon may be exported')
    _verify_pinned(verifier, root, receipt, seal_sha256)

    try:
        import numpy as np
        import rasterio
        from rasterio.windows import transform as window_transform
    except ImportError as exc:
        raise ExportError('Offline NumPy/Rasterio binaries required') from exc

    os.mkdir(target, 0o700)
    try:
        exported = []
        statistics = {}
        with rasterio.Env(GDAL_PAM_ENABLED='NO', GDAL_DISABLE_READDIR_ON_OPEN='YES',
                          PROJ_NETWORK='OFF'):
            with ExitStack() as stack:
                layers = {}
                for name in LAYERS:
                    stage = 'reflectance' if name in BANDS else 'indices'
                    source = root / stage / (name + '.tif')
                    if source.is_symlink() or not source.is_file():
                        raise ExportError('Raster file is not a direct expected TIFF')
                    layers[name] = stack.enter_context(rasterio.open(source))
                base = layers['red']
                if base.driver != 'GTiff' or base.crs is None:
                    raise ExportError('Georeferenced numeric baseline missing')
                window, inside, covered = gis._window_for_geometry(
                    rasterio, base, geometry)
                if inside is None or covered < 1:
                    raise ExportError('Only nonempty masked polygon export is allowed')
                width = int(window.width)
                height = int(window.height)
                dst_transform = window_transform(window, base.transform)
                for name, ds in layers.items():
                    if (ds.driver != 'GTiff' or ds.count != 1
                            or ds.dtypes[0] != 'float32' or ds.nodata != NODATA
                            or ds.crs != base.crs or ds.transform != base.transform
                            or ds.width != base.width or ds.height != base.height):
                        raise ExportError('Mismatched source raster grid or metadata')
                    matrix = ds.read(1, window=window, masked=True)
                    raw = np.asarray(matrix.data, dtype=np.float32)
                    good = inside & ~np.ma.getmaskarray(matrix) & np.isfinite(raw)
                    values = raw[good]
                    if name in BANDS and np.any((values < 0) | (values > 1)):
                        raise ExportError('Reflectance fraction outside plausible bounds')
                    if name in INDICES and np.any((values < -2) | (values > 2)):
                        raise ExportError('Vegetation index outside plausible bounds')
                    result = gis._stats(np, values)
                    result['maskedOrNoDataPixels'] = covered - result['validPixels']
                    statistics[name] = result
                    crop = np.full((height, width), NODATA, dtype=np.float32)
                    crop[good] = raw[good]
                    filename = name + '.tif'
                    dst_file = target / filename
                    # TIFFs carry actual georeferencing, never put them in public/.
                    with rasterio.open(
                        dst_file, 'w', driver='GTiff', width=width, height=height,
                        count=1, dtype='float32', nodata=NODATA,
                        crs=base.crs, transform=dst_transform, compress='DEFLATE',
                        predictor=3, tiled=True, blockxsize=256, blockysize=256,
                        BIGTIFF='IF_SAFER'
                    ) as out:
                        out.write(crop, 1)
                    os.chmod(dst_file, 0o600)
                    with rasterio.open(dst_file) as check:
                        if (check.crs != ds.crs or check.transform != dst_transform
                                or check.nodata != NODATA
                                or not np.array_equal(check.read(1), crop)):
                            raise ExportError('Exported numeric TIFF failed independent readback')
                    fd = os.open(dst_file, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
                    try:
                        os.fsync(fd)
                    finally:
                        os.close(fd)
                    exported.append({'layer': name, 'filename': filename,
                                     **_checksum_file(dst_file),
                                     'validPixels': result['validPixels']})
        # Geometry and source file set must still be unchanged after export.
        if gis._read_private_geometry(geometry_path)[1] != original_hash:
            raise ExportError('Private polygon changed while exporting')
        _verify_pinned(verifier, root, receipt, seal_sha256)

        csv_data = _csv_bytes(statistics)
        _write_private(target / 'statistics.csv', csv_data)
        manifest = {
            'schema': 'skyhub-m3m-private-numeric-gis-export-v1',
            'classification': 'private-georeferenced-float32-tiff-not-scientifically-calibrated',
            'sourceSealSha256': seal_sha256.lower(),
            'geometrySha256': original_hash,
            'rasterCount': len(exported),
            'layers': exported,
            'statisticsCsvSha256': hashlib.sha256(csv_data).hexdigest(),
            'statisticsCsvBytes': len(csv_data),
            'pixelDimensions': [width, height],
            'polygonSamplePixels': covered,
            'crs': str(base.crs),
            'containsSensitiveGeolocation': True,
            'numericalValuesNotFromPng': True,
            'cloudOptimizedGeoTiff': False,
            'sourceRasterIntegrityRechecked': True,
            'radiometricCalibrationVerified': False,
            'bandCoregistrationVerified': False,
            'reflectanceReady': False,
            'ndviReady': False, 'ndreReady': False,
            'operationalUseAllowed': False,
            'prescriptionExportAllowed': False,
            'flightMissionAllowed': False
        }
        payload = (json.dumps(manifest, separators=(',', ':'), sort_keys=True,
                              allow_nan=False) + '\n').encode('utf-8')
        # Last committed marker: incomplete work without this file is invalid.
        _write_private(target / MANIFEST_NAME, payload)
        directory = os.open(target, os.O_RDONLY | getattr(os, 'O_DIRECTORY', 0))
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    except BaseException:
        shutil.rmtree(target)
        raise
    return {
        'schema': 'skyhub-m3m-private-numeric-gis-export-summary-v1',
        'exportedRasters': len(LAYERS),
        'polygonSamplePixels': covered,
        'manifestSha256': hashlib.sha256(payload).hexdigest(),
        'containsSensitiveGeolocation': True,
        'cloudOptimizedGeoTiff': False,
        'radiometricCalibrationVerified': False,
        'operationalUseAllowed': False,
        'prescriptionExportAllowed': False,
        'flightMissionAllowed': False
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bundle', type=Path, required=True)
    parser.add_argument('--seal', type=Path, required=True)
    parser.add_argument('--seal-sha256', required=True)
    parser.add_argument('--geometry-file', type=Path, required=True)
    parser.add_argument('--output-dir', type=Path, required=True)
    parser.add_argument('--private-output-ok', action='store_true')
    args = parser.parse_args(argv)
    try:
        print(json.dumps(export(bundle=args.bundle, seal=args.seal,
                                seal_sha256=args.seal_sha256,
                                geometry_file=args.geometry_file,
                                output_dir=args.output_dir,
                                private_output_ok=args.private_output_ok),
                         sort_keys=True, allow_nan=False))
    except Exception as exc:
        print('Private M3M GIS numeric export refused: ' +
              type(exc).__name__, file=sys.stderr)
        return 2
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
