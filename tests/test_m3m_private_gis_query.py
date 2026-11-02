"""P3 real raster I/O tests against synthetic, independently sealed M3M bundles."""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

try:
    import numpy as np
    import rasterio
    from rasterio.warp import transform
except ImportError:
    np = rasterio = None


ROOT = Path(__file__).resolve().parents[1]


def load(relative, name):
    spec = importlib.util.spec_from_file_location(name, ROOT / relative)
    item = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(item)
    return item


worker = load('backend/workers/m3m_private_gis_query.py', 'skyhub_gis_lab')
sealmod = load('backend/workers/m3m_raster_bundle_seal.py', 'skyhub_gis_seal')
qa_fixture = load('tests/test_m3m_raster_bundle_verify.py', 'skyhub_gis_qa_fixture')


@unittest.skipUnless(np is not None and rasterio is not None, 'Needs optional GIS raster dependencies')
class PrivateGisQueryTests(unittest.TestCase):
    def setUp(self):
        self.fixture = qa_fixture.TestM3mRasterBundleQa(methodName='test_valid_bundle_and_no_writes')
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.bundle = self.fixture.root
        self.seal = self.bundle.parent / 'offline-gis-seal.json'
        self.pin = sealmod.create_seal(self.bundle, self.seal)['sha256OfSeal']
        self.geometry = self.bundle.parent / 'private-geometry.json'

    def lonlat(self, x, y):
        lon, lat = transform('EPSG:32632', 'EPSG:4326', [x], [y])
        return [lon[0], lat[0]]

    def point(self, *, row=0, col=0):
        return {'type': 'Point',
                'coordinates': self.lonlat(450000 + .05 * (col + .5),
                                           5400000 - .05 * (row + .5))}

    def polygon(self):
        # Encloses the synthetic 3x2 raster (0.15 m x 0.10 m).
        return {'type': 'Polygon', 'coordinates': [[
            self.lonlat(449999.99, 5400000.01),
            self.lonlat(450000.16, 5400000.01),
            self.lonlat(450000.16, 5399999.89),
            self.lonlat(449999.99, 5399999.89),
            self.lonlat(449999.99, 5400000.01),
        ]]}

    def query(self, geometry, **kwargs):
        self.geometry.write_text(json.dumps(geometry, allow_nan=False))
        options = dict(bundle=self.bundle, seal=self.seal,
                       seal_sha256=self.pin, geometry_file=self.geometry)
        options.update(kwargs)
        return worker.query(**options)

    def test_georeferenced_point_returns_real_numeric_ndvi(self):
        report = self.query(self.point())
        self.assertEqual(report['schema'], 'skyhub-m3m-private-geospatial-query-v1')
        self.assertEqual(report['geometryType'], 'Point')
        self.assertEqual(report['queryPixels'], 1)
        self.assertAlmostEqual(report['statistics']['ndvi']['mean'], .5, places=6)
        self.assertAlmostEqual(report['statistics']['ndre']['mean'], .2, places=6)
        self.assertAlmostEqual(report['statistics']['red']['mean'], .2, places=6)
        self.assertEqual(report['statistics']['ndvi']['maskedOrNoDataPixels'], 0)
        self.assertTrue(report['fullBundleIntegrityRecheckedAfterRead'])
        self.assertTrue(report['numericalValuesNotFromPng'])
        for flag in ('radiometricCalibrationVerified', 'bandCoregistrationVerified',
                     'reflectanceReady', 'ndviReady', 'ndreReady',
                     'operationalUseAllowed', 'prescriptionExportAllowed',
                     'flightMissionAllowed', 'coordinatesPublished', 'rasterTilesPublished'):
            self.assertIs(report[flag], False)
        serialized = json.dumps(report)
        self.assertNotIn(str(self.bundle), serialized)
        self.assertNotIn(str(self.geometry), serialized)
        self.assertNotIn('EPSG:32632', serialized)
        self.assertNotIn('coordinates"', serialized)

    def test_point_over_nodata_does_not_fabricate_value(self):
        report = self.query(self.point(row=0, col=1))
        ndvi = report['statistics']['ndvi']
        self.assertEqual(ndvi['validPixels'], 0)
        self.assertEqual(ndvi['maskedOrNoDataPixels'], 1)
        self.assertIsNone(ndvi['mean'])

    def test_polygon_five_valid_pixels_six_covered(self):
        report = self.query(self.polygon())
        self.assertEqual(report['geometryType'], 'Polygon')
        self.assertEqual(report['queryPixels'], 6)
        self.assertEqual(report['statistics']['ndvi']['validPixels'], 5)
        self.assertEqual(report['statistics']['ndvi']['maskedOrNoDataPixels'], 1)
        self.assertAlmostEqual(report['statistics']['ndvi']['median'], .5, places=5)

    def test_polygon_window_limit_fail_closed(self):
        with mock.patch.object(worker, 'MAX_WINDOW_PIXELS', 2):
            with self.assertRaises(worker.GeoQueryError):
                self.query(self.polygon())

    def test_reject_outside_point_and_invalid_geometry(self):
        bad = [
            {'type': 'Point', 'coordinates': [0, 0]},
            {'type': 'Point', 'coordinates': [181, 48]},
            {'type': 'Point', 'coordinates': ['9', 48]},
            {'type': 'Feature', 'geometry': self.point(), 'properties': {}},
            {'type': 'Polygon', 'coordinates': [self.polygon()['coordinates'][0][:-1]]},
            {'type': 'MultiPolygon', 'coordinates': []},
        ]
        for geom in bad:
            with self.subTest(geom=geom['type']), self.assertRaises(Exception):
                self.query(geom)

    def test_reject_duplicate_json_fields_and_symlink(self):
        self.geometry.write_text('{"type":"Point","type":"Polygon","coordinates":[9,49]}')
        with self.assertRaises(worker.GeoQueryError):
            worker.query(bundle=self.bundle, seal=self.seal,
                         seal_sha256=self.pin, geometry_file=self.geometry)
        alias = self.bundle.parent / 'link-geojson.json'
        alias.symlink_to(self.geometry)
        with self.assertRaises(worker.GeoQueryError):
            worker.query(bundle=self.bundle, seal=self.seal,
                         seal_sha256=self.pin, geometry_file=alias)

    def test_reject_changed_seal_or_raster(self):
        with self.assertRaises(Exception):
            self.query(self.point(), seal_sha256='0' * 64)
        with (self.bundle / 'indices/ndvi.tif').open('ab') as output:
            output.write(b'tampered')
        with self.assertRaises(Exception):
            self.query(self.point())

    def test_detect_geometry_mutation_during_query(self):
        original = worker._stats
        triggered = False

        def mutate(np_lib, data):
            nonlocal triggered
            if not triggered:
                triggered = True
                self.geometry.write_text(json.dumps(self.point(row=1, col=0)))
            return original(np_lib, data)

        with mock.patch.object(worker, '_stats', side_effect=mutate):
            with self.assertRaises(worker.GeoQueryError):
                self.query(self.point())
        self.assertTrue(triggered)


if __name__ == '__main__':
    unittest.main()
