#!/usr/bin/env python3
"""P3 private WGS84 Point/Polygon raster query on a pinned experimental M3M bundle.

This is an offline CLI, NOT an HTTP route, mission planner or calibrated
agronomic analyzer. Coordinates enter through a local private GeoJSON file
and are never included in the report or ordinary stderr.
"""
from __future__ import annotations

from contextlib import ExitStack
import argparse
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import stat
import sys

BANDS = ('red', 'green', 'red_edge', 'nir')
INDICES = ('ndvi', 'ndre', 'gndvi', 'osavi')
LAYERS = (*BANDS, *INDICES)
MAX_GEOJSON_BYTES = 64 * 1024
MAX_POLYGON_VERTICES = 256
MAX_WINDOW_PIXELS = 250_000
MAX_COORDINATE_SPAN_DEG = 0.25
NODATA = -9999.0


class GeoQueryError(ValueError):
    """Refuse unsafe, malformed or scientifically unverified GIS input."""


def _module(filename: str):
    location = Path(__file__).resolve().with_name(filename)
    spec = importlib.util.spec_from_file_location('_skyhub_private_gis_seal', location)
    if spec is None or spec.loader is None:
        raise GeoQueryError('Offline integrity verifier unavailable')
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _pairs(items):
    result = {}
    for name, value in items:
        if name in result:
            raise GeoQueryError('Duplicate JSON fields are prohibited')
        result[name] = value
    return result


def _bad_constant(_):
    raise GeoQueryError('Nonfinite JSON values prohibited')


def _read_private_geometry(path: Path) -> tuple[dict, str]:
    if path.is_symlink() or path.parent.is_symlink():
        raise GeoQueryError('Geometry must be a private direct regular file')
    fd = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
    try:
        before = os.fstat(fd)
        if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or not 2 <= before.st_size <= MAX_GEOJSON_BYTES:
            raise GeoQueryError('Geometry file size/type invalid')
        content = bytearray()
        while len(content) <= MAX_GEOJSON_BYTES:
            part = os.read(fd, MAX_GEOJSON_BYTES + 1 - len(content))
            if not part:
                break
            content.extend(part)
        after = os.fstat(fd)
        if (len(content) != before.st_size or
                (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns,
                 before.st_ctime_ns) !=
                (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns,
                 after.st_ctime_ns)):
            raise GeoQueryError('Geometry mutated during reading')
        digest = hashlib.sha256(content).hexdigest()
    finally:
        os.close(fd)
    try:
        geometry = json.loads(content.decode('utf-8'), object_pairs_hook=_pairs,
                              parse_constant=_bad_constant)
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise GeoQueryError('Geometry JSON is not valid') from exc
    return _validate_geometry(geometry), digest


def _coordinate(item):
    if (not isinstance(item, list) or len(item) != 2 or
            any(type(value) not in (int, float) or not math.isfinite(value) for value in item)):
        raise GeoQueryError('Expected finite WGS84 lon/lat pair')
    lon, lat = map(float, item)
    if not (-180 <= lon <= 180 and -90 <= lat <= 90):
        raise GeoQueryError('WGS84 coordinate outside valid range')
    return [lon, lat]


def _segments_intersect(a, b, c, d):
    # Self-intersection check in local lon/lat plane; this lab limits polygon
    # longitude and latitude spans, and excludes the antimeridian.
    def orientation(p, q, r):
        return (q[0]-p[0]) * (r[1]-p[1]) - (q[1]-p[1]) * (r[0]-p[0])
    o1, o2 = orientation(a, b, c), orientation(a, b, d)
    o3, o4 = orientation(c, d, a), orientation(c, d, b)
    if o1 * o2 < 0 and o3 * o4 < 0:
        return True
    def on_segment(p, q, r):
        return (min(p[0],r[0]) <= q[0] <= max(p[0],r[0]) and
                min(p[1],r[1]) <= q[1] <= max(p[1],r[1]))
    return ((o1 == 0 and on_segment(a, c, b)) or
            (o2 == 0 and on_segment(a, d, b)) or
            (o3 == 0 and on_segment(c, a, d)) or
            (o4 == 0 and on_segment(c, b, d)))


def _validate_geometry(obj):
    if not isinstance(obj, dict) or set(obj) != {'type', 'coordinates'}:
        raise GeoQueryError('Only direct Point or Polygon GeoJSON geometry accepted')
    kind = obj['type']
    if kind == 'Point':
        return {'type': 'Point', 'coordinates': _coordinate(obj['coordinates'])}
    if kind != 'Polygon':
        raise GeoQueryError('Only a simple single-ring Polygon is supported')
    polygons = obj['coordinates']
    if not isinstance(polygons, list) or len(polygons) != 1 or not isinstance(polygons[0], list):
        raise GeoQueryError('Polygon holes or multiple rings are not supported')
    ring = [_coordinate(x) for x in polygons[0]]
    if not (4 <= len(ring) <= MAX_POLYGON_VERTICES and ring[0] == ring[-1]):
        raise GeoQueryError('Polygon must be bounded and closed')
    if any(ring[i] == ring[i+1] for i in range(len(ring) - 1)):
        raise GeoQueryError('Polygon contains a collapsed edge')
    lons, lats = [x[0] for x in ring], [x[1] for x in ring]
    if (max(lons) - min(lons) > MAX_COORDINATE_SPAN_DEG or
            max(lats) - min(lats) > MAX_COORDINATE_SPAN_DEG):
        raise GeoQueryError('Polygon footprint exceeds small-field laboratory limits')
    area2 = sum(ring[i][0] * ring[i+1][1] - ring[i+1][0] * ring[i][1]
                for i in range(len(ring) - 1))
    if not math.isfinite(area2) or abs(area2) < 1e-15:
        raise GeoQueryError('Degenerate polygon area')
    edges = len(ring) - 1
    for i in range(edges):
        for j in range(i+1, edges):
            if j == i+1 or (i == 0 and j == edges-1):
                continue
            if _segments_intersect(ring[i], ring[i+1], ring[j], ring[j+1]):
                raise GeoQueryError('Self-intersecting polygon is forbidden')
    return {'type': 'Polygon', 'coordinates': [ring]}


def _stats(np, vals):
    data = np.asarray(vals, dtype=np.float64)
    if not data.size:
        return {'validPixels': 0, 'mean': None, 'min': None, 'max': None,
                'median': None, 'p10': None, 'p90': None, 'stddev': None}
    if not np.isfinite(data).all():
        raise GeoQueryError('Nonfinite numeric data')
    return {'validPixels': int(data.size), 'mean': float(np.mean(data)),
            'min': float(np.min(data)), 'max': float(np.max(data)),
            'median': float(np.median(data)),
            'p10': float(np.percentile(data, 10)),
            'p90': float(np.percentile(data, 90)),
            'stddev': float(np.std(data))}


def _window_for_geometry(rasterio, ds, geometry):
    from rasterio.warp import transform
    from rasterio.windows import Window
    from rasterio.features import geometry_mask
    from rasterio.transform import rowcol

    is_point = geometry['type'] == 'Point'
    ring = ([geometry['coordinates']] if is_point else geometry['coordinates'][0])
    lons, lats = [p[0] for p in ring], [p[1] for p in ring]
    eastings, northings = transform('EPSG:4326', ds.crs, lons, lats)
    if not all(math.isfinite(x) for x in (*eastings, *northings)):
        raise GeoQueryError('Projected point is not finite')
    if is_point:
        row, col = rowcol(ds.transform, eastings[0], northings[0])
        if not (0 <= row < ds.height and 0 <= col < ds.width):
            raise GeoQueryError('Point lies outside the orthomosaic')
        return Window(col, row, 1, 1), None, 1
    fractional = [(~ds.transform) * (x, y) for x, y in zip(eastings, northings)]
    col0 = max(0, math.floor(min(x for x, _ in fractional)))
    col1 = min(ds.width, math.ceil(max(x for x, _ in fractional)))
    row0 = max(0, math.floor(min(y for _, y in fractional)))
    row1 = min(ds.height, math.ceil(max(y for _, y in fractional)))
    if col0 >= col1 or row0 >= row1:
        raise GeoQueryError('Polygon outside mosaic or contains no pixels')
    width, height = col1-col0, row1-row0
    if width * height > MAX_WINDOW_PIXELS:
        raise GeoQueryError('Polygon query exceeds the bounded pixel window')
    window = Window(col0, row0, width, height)
    projected_ring = list(zip(eastings, northings))
    mask = geometry_mask([{'type': 'Polygon', 'coordinates': [projected_ring]}],
                         out_shape=(height, width), invert=True,
                         all_touched=False, transform=ds.window_transform(window))
    covered = int(mask.sum())
    if not covered:
        raise GeoQueryError('Polygon contains no raster pixel centers')
    return window, mask, covered


def query(*, bundle: Path, seal: Path, seal_sha256: str, geometry_file: Path) -> dict:
    if not isinstance(seal_sha256, str) or len(seal_sha256) != 64 or any(
            c not in '0123456789abcdefABCDEF' for c in seal_sha256):
        raise GeoQueryError('Independent SHA-256 seal pin required')
    bundle, seal = Path(bundle).expanduser().absolute(), Path(seal).expanduser().absolute()
    geometry_file = Path(geometry_file).expanduser().absolute()
    if (bundle.is_symlink() or not bundle.is_dir() or seal.is_symlink() or
            geometry_file == seal or geometry_file in bundle.parents or
            bundle == geometry_file.parent or bundle in geometry_file.parents):
        raise GeoQueryError('Untrusted bundle or geometry path')
    geometry, digest = _read_private_geometry(geometry_file)
    verifier = _module('m3m_raster_bundle_seal.py')
    def check():
        status = verifier.verify_seal(bundle, seal, seal_sha256)
        if (status.get('pixelQaRechecked') is not True or
                status.get('filesMatched') != 11 or
                status.get('sha256OfSeal') != seal_sha256.lower() or
                status.get('operationalUseAllowed') is not False or
                status.get('calibrationVerified') is not False):
            raise GeoQueryError('Required independent full raster QA not confirmed')
    check()
    try:
        import numpy as np
        import rasterio
    except ImportError as exc:
        raise GeoQueryError('NumPy and rasterio are required offline') from exc
    with rasterio.Env(GDAL_PAM_ENABLED='NO', GDAL_DISABLE_READDIR_ON_OPEN='YES'):
        with ExitStack() as stack:
            layers = {}
            for name in LAYERS:
                stage = 'reflectance' if name in BANDS else 'indices'
                source = bundle / stage / (name + '.tif')
                if source.is_symlink() or not source.is_file():
                    raise GeoQueryError('Expected direct TIFF layer is missing')
                layers[name] = stack.enter_context(rasterio.open(source))
            base = layers['red']
            if base.crs is None or base.driver != 'GTiff':
                raise GeoQueryError('Expected georeferenced raster')
            window, inside, covered = _window_for_geometry(rasterio, base, geometry)
            if inside is None:
                inside = np.ones((1, 1), dtype=bool)
            report = {}
            for name, ds in layers.items():
                if (ds.driver != 'GTiff' or ds.count != 1 or ds.dtypes[0] != 'float32'
                        or ds.nodata != NODATA or ds.crs != base.crs
                        or ds.transform != base.transform
                        or ds.width != base.width or ds.height != base.height):
                    raise GeoQueryError('Unaligned or nonnumerical TIFF layer')
                data = ds.read(1, window=window, masked=True)
                values = np.asarray(data.data, dtype=np.float64)
                valid = inside & ~np.ma.getmaskarray(data) & np.isfinite(values)
                filtered = values[valid]
                if name in BANDS and np.any((filtered < 0) | (filtered > 1)):
                    raise GeoQueryError('Band fractions outside the claimed range')
                if name in INDICES and np.any((filtered < -2) | (filtered > 2)):
                    raise GeoQueryError('Index pixels outside valid sanity range')
                result = _stats(np, filtered)
                result['maskedOrNoDataPixels'] = covered - result['validPixels']
                report[name] = result
    # Catch changes in both private request and the sealed raster set.
    if _read_private_geometry(geometry_file)[1] != digest:
        raise GeoQueryError('GeoJSON changed during analysis')
    check()
    return {
        'schema': 'skyhub-m3m-private-geospatial-query-v1',
        'classification': 'offline-unverified-quantitative-raster-geometry-sampling',
        'geometryType': geometry['type'], 'inputCrs': 'WGS84', 'queryPixels': covered,
        'statistics': report, 'numericalValuesNotFromPng': True,
        'fullBundleIntegrityRecheckedAfterRead': True,
        'coordinatesPublished': False, 'rasterTilesPublished': False,
        'radiometricCalibrationVerified': False,
        'bandCoregistrationVerified': False, 'reflectanceReady': False,
        'ndviReady': False, 'ndreReady': False,
        'operationalUseAllowed': False, 'prescriptionExportAllowed': False,
        'flightMissionAllowed': False,
    }


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bundle', type=Path, required=True)
    parser.add_argument('--seal', type=Path, required=True)
    parser.add_argument('--seal-sha256', required=True)
    parser.add_argument('--geometry-file', type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        result = query(bundle=args.bundle, seal=args.seal,
                       seal_sha256=args.seal_sha256, geometry_file=args.geometry_file)
    except Exception as exc:
        print('M3M private GIS query refused: ' + type(exc).__name__, file=sys.stderr)
        return 2
    print(json.dumps(result, sort_keys=True, allow_nan=False))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
