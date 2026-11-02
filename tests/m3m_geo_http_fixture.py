#!/usr/bin/env python3
"""Produce an independent synthetic sealed GeoTIFF fixture for Node HTTP tests.

Never imports DJI bytes, opens network connections, or controls the Pi.
"""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import shutil
import sys

from rasterio.warp import transform

ROOT = Path(__file__).resolve().parents[1]


def load(file, name):
    spec = importlib.util.spec_from_file_location(name, ROOT / file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main():
    if len(sys.argv) != 2:
        raise SystemExit(2)
    out = Path(sys.argv[1]).expanduser().resolve(strict=True)
    source_dir, seal_dir = out / 'sources', out / 'seals'
    if source_dir.exists() or seal_dir.exists():
        raise SystemExit(2)
    source_dir.mkdir(mode=0o700)
    seal_dir.mkdir(mode=0o700)
    fixture_source = load('tests/test_m3m_raster_bundle_verify.py', 'gis_http_test_fixture')
    fixture = fixture_source.TestM3mRasterBundleQa(
        methodName='test_valid_bundle_and_no_writes')
    fixture.setUp()
    try:
        dst = source_dir / 'raster-one'
        shutil.copytree(fixture.root, dst)
    finally:
        fixture.doCleanups()
    receipt_file = seal_dir / 'receipt.json'
    seal = load('backend/workers/m3m_raster_bundle_seal.py', 'gis_http_seal')
    report = seal.create_seal(dst, receipt_file)
    lon, lat = transform('EPSG:32632', 'EPSG:4326',
                         [450000 + 0.05 * 0.5], [5400000 - 0.05 * 0.5])
    corners = [(449999.99, 5400000.01), (450000.16, 5400000.01),
               (450000.16, 5399999.89), (449999.99, 5399999.89),
               (449999.99, 5400000.01)]
    px, py = transform('EPSG:32632', 'EPSG:4326',
                       [p[0] for p in corners], [p[1] for p in corners])
    print(json.dumps({
        'bundleDir': str(dst),
        'sealFile': str(receipt_file),
        'sealSha256': report['sha256OfSeal'],
        'point': [lon[0], lat[0]],
        'polygon': {'type': 'Polygon',
                    'coordinates': [[list(point) for point in zip(px, py)]]}
    }, sort_keys=True))


if __name__ == '__main__':
    main()
