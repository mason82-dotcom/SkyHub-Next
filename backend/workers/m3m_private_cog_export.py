#!/usr/bin/env python3
"""P3.4 private GDAL COG conversion of pinned P3.3 experimental numeric exports.

Offline only; not an HTTP router, QGIS service, sensor calibration or prescription.
All COG/manifest files contain sensitive georeferenced field information.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import shutil
import stat
import sys

BANDS = ('red', 'green', 'red_edge', 'nir')
INDICES = ('ndvi', 'ndre', 'gndvi', 'osavi')
LAYERS = (*BANDS, *INDICES)
NODATA = -9999.0
EXPECTED_FILES = frozenset([n + '.tif' for n in LAYERS] +
                           ['statistics.csv', 'export-manifest.json'])
MAX_MANIFEST = 65536
MAX_FILE = 100 * 1024 * 1024
MAX_PIXELS = 250000
OUT_MANIFEST = 'cog-manifest.json'
HEX = frozenset('0123456789abcdef')


class CogError(ValueError):
    """The independently pinned source or COG export failed closed."""


def require(condition, message):
    if not condition:
        raise CogError(message)


def sha_bytes(data):
    return hashlib.sha256(data).hexdigest()


def read_file(path, limit):
    require(not path.is_symlink(), 'Symlinked artifact refused')
    fd = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
    try:
        before = os.fstat(fd)
        require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and
                (before.st_mode & 0o077) == 0 and
                0 < before.st_size <= limit, 'Artifact type, rights or size rejected')
        content = bytearray()
        while len(content) < before.st_size:
            part = os.read(fd, min(1024 * 1024, before.st_size - len(content)))
            require(part, 'File truncated during pinned verification')
            content.extend(part)
        after = os.fstat(fd)
        require((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns,
                 before.st_ctime_ns) ==
                (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns,
                 after.st_ctime_ns), 'Pinned artifact changed during reading')
        return bytes(content)
    finally:
        os.close(fd)


def digest(file, bound=MAX_FILE):
    h = hashlib.sha256(read_file(file, bound)).hexdigest()
    return h


def no_duplicate_pairs(items):
    result = {}
    for name, value in items:
        require(name not in result, 'Ambiguous duplicate JSON field')
        result[name] = value
    return result


def parse_manifest(content):
    try:
        data = json.loads(content.decode('utf-8'), object_pairs_hook=no_duplicate_pairs,
                          parse_constant=lambda _: (_ for _ in ()).throw(CogError('Invalid JSON number')))
    except (UnicodeError, ValueError, TypeError) as exc:
        raise CogError('Invalid pinned export manifest') from exc
    require(isinstance(data, dict), 'Expected structured export manifest')
    # Canonical encoding is enforced; cannot smuggle duplicate or unknown fields.
    require((json.dumps(data, separators=(',', ':'), sort_keys=True,
                       allow_nan=False) + '\n').encode('utf-8') == content,
            'Manifest is not canonical JSON')
    required = {'schema', 'classification', 'sourceSealSha256', 'geometrySha256',
                'rasterCount', 'layers', 'statisticsCsvSha256',
                'statisticsCsvBytes', 'pixelDimensions', 'polygonSamplePixels',
                'crs', 'containsSensitiveGeolocation', 'numericalValuesNotFromPng',
                'cloudOptimizedGeoTiff', 'sourceRasterIntegrityRechecked',
                'radiometricCalibrationVerified', 'bandCoregistrationVerified',
                'reflectanceReady', 'ndviReady', 'ndreReady', 'operationalUseAllowed',
                'prescriptionExportAllowed', 'flightMissionAllowed'}
    require(set(data) == required and
            data['schema'] == 'skyhub-m3m-private-numeric-gis-export-v1' and
            data['classification'] == 'private-georeferenced-float32-tiff-not-scientifically-calibrated',
            'Incorrect pinned source export schema')
    for flag in ('cloudOptimizedGeoTiff', 'radiometricCalibrationVerified',
                 'bandCoregistrationVerified', 'reflectanceReady',
                 'ndviReady', 'ndreReady', 'operationalUseAllowed',
                 'prescriptionExportAllowed', 'flightMissionAllowed'):
        require(data[flag] is False, 'Source claims unsafe readiness')
    for flag in ('containsSensitiveGeolocation', 'numericalValuesNotFromPng',
                 'sourceRasterIntegrityRechecked'):
        require(data[flag] is True, 'Source verification is missing')
    for name in ('sourceSealSha256', 'geometrySha256', 'statisticsCsvSha256'):
        require(isinstance(data[name], str) and len(data[name]) == 64 and
                set(data[name]) <= HEX, 'Invalid source checksum')
    dims = data['pixelDimensions']
    require(isinstance(dims, list) and len(dims) == 2 and
            all(type(n) is int and n > 0 for n in dims) and
            dims[0] * dims[1] <= MAX_PIXELS,
            'Unbounded source raster dimensions')
    require(type(data['polygonSamplePixels']) is int and
            1 <= data['polygonSamplePixels'] <= dims[0] * dims[1] and
            data['rasterCount'] == 8 and
            isinstance(data['crs'], str) and 3 <= len(data['crs']) <= 100,
            'Invalid source ROI or raster description')
    require(type(data['statisticsCsvBytes']) is int and
            0 < data['statisticsCsvBytes'] <= MAX_MANIFEST, 'CSV size invalid')
    require(isinstance(data['layers'], list) and len(data['layers']) == 8,
            'Incomplete 8-layer source')
    for layer, name in zip(data['layers'], LAYERS):
        require(isinstance(layer, dict) and set(layer) ==
                {'layer', 'filename', 'sha256', 'bytes', 'validPixels'} and
                layer['layer'] == name and layer['filename'] == name + '.tif' and
                isinstance(layer['sha256'], str) and
                len(layer['sha256']) == 64 and set(layer['sha256']) <= HEX and
                type(layer['bytes']) is int and 0 < layer['bytes'] <= MAX_FILE and
                type(layer['validPixels']) is int and
                0 <= layer['validPixels'] <= data['polygonSamplePixels'],
                'Source raster entry invalid')
    return data


def require_private_dir(directory, purpose):
    require(not directory.is_symlink() and directory.is_dir(), purpose + ' must be an ordinary directory')
    info = directory.lstat()
    require(info.st_mode & 0o077 == 0, purpose + ' must be private (0700)')
    return directory


def verify_source(root, independent_sha):
    require(isinstance(independent_sha, str) and len(independent_sha) == 64
            and set(independent_sha) <= HEX, 'Independent manifest SHA-256 required')
    require_private_dir(root, 'Source root')
    require_private_dir(root.parent, 'Source parent')
    require({p.name for p in root.iterdir()} == EXPECTED_FILES,
            'Source export has missing or unexpected artifacts')
    raw = read_file(root / 'export-manifest.json', MAX_MANIFEST)
    require(sha_bytes(raw) == independent_sha, 'Independent source manifest pin mismatch')
    manifest = parse_manifest(raw)
    for entry in manifest['layers']:
        name = entry['filename']
        file = root / name
        require(file.stat().st_size == entry['bytes'] and
                digest(file) == entry['sha256'],
                'Source TIFF differs from pinned source manifest')
    csv_file = root / 'statistics.csv'
    require(csv_file.stat().st_size == manifest['statisticsCsvBytes'] and
            digest(csv_file, MAX_MANIFEST) == manifest['statisticsCsvSha256'],
            'Pinned CSV is not intact')
    return manifest


def convert_and_check(source, output, *, expected_crs, expected_dims,
                      expected_valid, overview_min_dim=256):
    try:
        import numpy as np
        import rasterio
        from rasterio.shutil import copy as driver_copy
        import tifffile
    except ImportError as exc:
        raise CogError('GDAL-backed rasterio, tifffile and NumPy are required') from exc

    with rasterio.Env(GDAL_PAM_ENABLED='NO', GDAL_DISABLE_READDIR_ON_OPEN='YES',
                      PROJ_NETWORK='OFF'):
        require(rasterio.Env().drivers().get('COG') is not None,
                'GDAL COG driver unavailable')
        with rasterio.open(source) as original:
            require(original.driver == 'GTiff' and original.count == 1 and
                    original.dtypes[0] == 'float32' and original.nodata == NODATA and
                    str(original.crs) == expected_crs and
                    [original.width, original.height] == expected_dims and
                    original.transform.is_rectilinear,
                    'Source TIFF has unexpected numeric grid')
            arr = original.read(1)
            require(np.isfinite(arr).all() and
                    int(np.count_nonzero(arr != NODATA)) == expected_valid,
                    'Source TIFF valid-pixel mask mismatch')
            grid = original.transform
        driver_copy(source, output, driver='COG',
                    compress='DEFLATE', blocksize=256,
                    overview_resampling='NEAREST', resampling='NEAREST',
                    predictor=1, bigtiff='IF_SAFER',
                    overviews='IGNORE_EXISTING')
        # Readback deliberately checks exact Float32 bits, not RGB images,
        # palette values or approximate index formulas.
        with rasterio.open(output) as generated:
            require(generated.driver == 'GTiff' and generated.count == 1 and
                    generated.dtypes[0] == 'float32' and generated.nodata == NODATA and
                    str(generated.crs) == expected_crs and
                    generated.width == expected_dims[0] and
                    generated.height == expected_dims[1] and
                    generated.transform == grid and
                    generated.tags(ns='IMAGE_STRUCTURE').get('LAYOUT') == 'COG' and
                    generated.is_tiled and
                    generated.block_shapes == [(256, 256)] and
                    np.array_equal(generated.read(1), arr),
                    'COG structural/GeoTIFF/numerical GDAL readback failed')
            levels = generated.overviews(1)
            if max(expected_dims) > overview_min_dim:
                require(bool(levels), 'Large COG needs an overview pyramid')
        # Independently parse the TIFF hierarchy and reconstruct source bits.
        with tifffile.TiffFile(output) as dataset:
            page = dataset.pages[0]
            require(page.is_tiled and 'TileOffsets' in page.tags and
                    'TileByteCounts' in page.tags and page.sampleformat == 3,
                    'Independent TIFF tile layout invalid')
            require(np.array_equal(page.asarray(), arr),
                    'Independent TIFF decoder pixel comparison failed')
        # Older COG drivers may reasonably have no overviews for tiny ROIs.
        return {'overviewCount': len(levels),
                'driverLayoutVerified': True,
                'independentTiffReimportVerified': True,
                'pixelValuesIdentical': True}


def _commit_file(file, payload):
    fd = os.open(file, os.O_WRONLY | os.O_CREAT | os.O_EXCL |
                 getattr(os, 'O_NOFOLLOW', 0), 0o600)
    try:
        with os.fdopen(fd, 'wb') as out:
            out.write(payload)
            out.flush()
            os.fsync(out.fileno())
    except BaseException:
        file.unlink(missing_ok=True)
        raise


def create_cogs(*, input_dir: Path, source_manifest_sha256: str,
                output_dir: Path, private_output_ok=False):
    if private_output_ok is not True:
        raise CogError('Explicit private geolocation consent required')
    root = Path(input_dir).expanduser().absolute()
    target = Path(output_dir).expanduser().absolute()
    require(root != target and root not in target.parents and
            target not in root.parents and
            not os.path.lexists(target),
            'COG target must be a new independent directory')
    require_private_dir(target.parent, 'Output parent')
    verified = verify_source(root, source_manifest_sha256)

    os.mkdir(target, 0o700)
    try:
        cogs = []
        for entry in verified['layers']:
            filename = entry['layer'] + '.cog.tif'
            destination = target / filename
            validation = convert_and_check(
                root / entry['filename'], destination,
                expected_crs=verified['crs'],
                expected_dims=verified['pixelDimensions'],
                expected_valid=entry['validPixels'])
            os.chmod(destination, 0o600)
            fd = os.open(destination, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
            try:
                os.fsync(fd)
            finally:
                os.close(fd)
            cogs.append({'layer': entry['layer'], 'filename': filename,
                         'sha256': digest(destination), 'bytes': destination.stat().st_size,
                         **validation})
        # Still the identical, pinned source artifact set after COG creation.
        verify_source(root, source_manifest_sha256)
        record = {
            'schema': 'skyhub-m3m-private-cog-export-v1',
            'classification': 'georeferenced-numeric-cog-not-radiometrically-validated',
            'sourceExportManifestSha256': source_manifest_sha256,
            'sourceSealSha256': verified['sourceSealSha256'],
            'sourceGeometrySha256': verified['geometrySha256'],
            'layerCount': 8,
            'pixelDimensions': verified['pixelDimensions'],
            'cogs': cogs,
            'containsSensitiveGeolocation': True,
            'cloudOptimizedGeoTiff': True,
            'structuralAndPixelChecksPassed': True,
            'radiometricCalibrationVerified': False,
            'reflectanceReady': False, 'ndviReady': False, 'ndreReady': False,
            'operationalUseAllowed': False,
            'prescriptionExportAllowed': False,
            'flightMissionAllowed': False
        }
        payload = (json.dumps(record, separators=(',', ':'), sort_keys=True,
                              allow_nan=False) + '\n').encode()
        _commit_file(target / OUT_MANIFEST, payload)
        directory = os.open(target, os.O_RDONLY | getattr(os, 'O_DIRECTORY', 0))
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    except BaseException:
        shutil.rmtree(target)
        raise
    return {'schema': 'skyhub-m3m-private-cog-summary-v1',
            'cogCount': 8, 'manifestSha256': sha_bytes(payload),
            'containsSensitiveGeolocation': True,
            'cloudOptimizedGeoTiff': True,
            'structuralAndPixelChecksPassed': True,
            'radiometricCalibrationVerified': False,
            'operationalUseAllowed': False,
            'prescriptionExportAllowed': False,
            'flightMissionAllowed': False}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input-dir', type=Path, required=True)
    parser.add_argument('--source-manifest-sha256', required=True)
    parser.add_argument('--output-dir', type=Path, required=True)
    parser.add_argument('--private-output-ok', action='store_true')
    args = parser.parse_args(argv)
    try:
        report = create_cogs(input_dir=args.input_dir,
                             source_manifest_sha256=args.source_manifest_sha256,
                             output_dir=args.output_dir,
                             private_output_ok=args.private_output_ok)
    except Exception as exc:
        print('Private M3M COG export refused: ' +
              type(exc).__name__, file=sys.stderr)
        return 2
    print(json.dumps(report, sort_keys=True, allow_nan=False))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
