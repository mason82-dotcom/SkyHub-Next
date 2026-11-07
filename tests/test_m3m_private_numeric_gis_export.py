"""P3.3: real synthetic numerical GeoTIFF/CSV private polygon export acceptance."""
from __future__ import annotations

import csv
import hashlib
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


def load(relative, alias):
    spec = importlib.util.spec_from_file_location(alias, ROOT / relative)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


exporter = load('backend/workers/m3m_private_numeric_gis_export.py', 'm3m_private_numeric_export')
sealer = load('backend/workers/m3m_raster_bundle_seal.py', 'm3m_numeric_export_sealer')
fixture = load('tests/test_m3m_raster_bundle_verify.py', 'm3m_numeric_export_fixture')


@unittest.skipUnless(np is not None and rasterio is not None, 'Requires optional rasterio/NumPy')
class PrivateNumericGisExportTests(unittest.TestCase):
    def setUp(self):
        self.fixture = fixture.TestM3mRasterBundleQa(
            methodName='test_valid_bundle_and_no_writes')
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.bundle = self.fixture.root
        self.seal = self.bundle.parent / 'export-seal.json'
        self.sha = sealer.create_seal(self.bundle, self.seal)['sha256OfSeal']
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.target = self.root / 'private-geotiff'
        self.geometry = self.root / 'private-polygon.json'
        self.geometry.write_text(json.dumps(self.full_polygon()))

    def poly(self, pts):
        xs, ys = transform('EPSG:32632', 'EPSG:4326',
                           [p[0] for p in pts], [p[1] for p in pts])
        return {'type': 'Polygon',
                'coordinates': [[list(p) for p in zip(xs, ys)]]}

    def full_polygon(self):
        return self.poly([
            (449999.99, 5400000.01),
            (450000.16, 5400000.01),
            (450000.16, 5399999.89),
            (449999.99, 5399999.89),
            (449999.99, 5400000.01),
        ])

    def produce(self, **changed):
        cfg = {'bundle': self.bundle, 'seal': self.seal,
               'seal_sha256': self.sha, 'geometry_file': self.geometry,
               'output_dir': self.target, 'private_output_ok': True}
        cfg.update(changed)
        return exporter.export(**cfg)

    def test_eight_numerical_gtiffs_and_csv_preserve_crs_and_masks(self):
        result = self.produce()
        self.assertEqual(result['exportedRasters'], 8)
        self.assertEqual(result['polygonSamplePixels'], 6)
        self.assertTrue(result['containsSensitiveGeolocation'])
        self.assertFalse(result['cloudOptimizedGeoTiff'])
        self.assertFalse(result['radiometricCalibrationVerified'])
        self.assertFalse(result['operationalUseAllowed'])
        self.assertEqual(self.target.stat().st_mode & 0o777, 0o700)
        files = {p.name for p in self.target.iterdir()}
        self.assertEqual(files, set(n+'.tif' for n in exporter.LAYERS) |
                         {'export-manifest.json', 'statistics.csv'})
        raw = (self.target / 'export-manifest.json').read_bytes()
        self.assertEqual(hashlib.sha256(raw).hexdigest(), result['manifestSha256'])
        manifest = json.loads(raw)
        self.assertEqual(manifest['schema'], 'skyhub-m3m-private-numeric-gis-export-v1')
        self.assertEqual(manifest['rasterCount'], 8)
        self.assertFalse(manifest['cloudOptimizedGeoTiff'])
        self.assertTrue(manifest['numericalValuesNotFromPng'])
        self.assertFalse(manifest['prescriptionExportAllowed'])
        self.assertTrue(manifest['containsSensitiveGeolocation'])
        self.assertEqual(manifest['pixelDimensions'], [3, 2])
        self.assertEqual(manifest['polygonSamplePixels'], 6)
        self.assertEqual(manifest['sourceSealSha256'], self.sha)
        self.assertNotIn(str(self.root), str(manifest))
        self.assertNotIn(str(self.bundle), str(manifest))
        for record in manifest['layers']:
            path = self.target / record['filename']
            self.assertEqual(record['sha256'], hashlib.sha256(path.read_bytes()).hexdigest())
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            with rasterio.open(path) as out:
                self.assertEqual(out.driver, 'GTiff')
                self.assertEqual(out.crs.to_epsg(), 32632)
                self.assertEqual(out.dtypes, ('float32',))
                self.assertEqual(out.nodata, -9999.0)
                self.assertEqual((out.width, out.height), (3, 2))
                self.assertEqual(float(out.read(1)[0, 1]), -9999.0)
        with rasterio.open(self.target / 'ndvi.tif') as out:
            self.assertAlmostEqual(float(out.read(1)[0, 0]), .5, places=5)
        csv_file = self.target / 'statistics.csv'
        self.assertEqual(manifest['statisticsCsvSha256'],
                         hashlib.sha256(csv_file.read_bytes()).hexdigest())
        with csv_file.open(newline='') as stream:
            rows = list(csv.DictReader(stream))
        self.assertEqual(len(rows), 8)
        ndvi = next(x for x in rows if x['layer'] == 'ndvi')
        self.assertEqual(ndvi['validPixels'], '5')
        self.assertEqual(ndvi['maskedOrNoDataPixels'], '1')
        self.assertAlmostEqual(float(ndvi['mean']), .5, places=5)

    def test_polygon_crops_to_one_valid_raster_pixel(self):
        region = self.poly([
            (450000.005, 5399999.995),
            (450000.045, 5399999.995),
            (450000.045, 5399999.955),
            (450000.005, 5399999.955),
            (450000.005, 5399999.995),
        ])
        self.geometry.write_text(json.dumps(region))
        result = self.produce()
        self.assertEqual(result['polygonSamplePixels'], 1)
        with rasterio.open(self.target / 'ndvi.tif') as tif:
            self.assertEqual((tif.width, tif.height), (1, 1))
            self.assertAlmostEqual(float(tif.read(1)[0, 0]), .5, places=5)

    def test_consent_required_and_existing_folder_never_overwritten(self):
        with self.assertRaises(exporter.ExportError):
            self.produce(private_output_ok=False)
        self.assertFalse(self.target.exists())
        self.target.mkdir()
        important = self.target / 'sentinel'
        important.write_text('keep')
        with self.assertRaises(exporter.ExportError):
            self.produce()
        self.assertEqual(important.read_text(), 'keep')

    def test_wrong_seal_or_tampered_index_leaves_no_partial_dataset(self):
        with self.assertRaises(Exception):
            self.produce(seal_sha256='0' * 64)
        self.assertFalse(self.target.exists())
        with (self.bundle / 'indices' / 'ndre.tif').open('ab') as output:
            output.write(b'modified')
        with self.assertRaises(Exception):
            self.produce()
        self.assertFalse(self.target.exists())

    def test_reject_nested_symlink_parent_to_source_tree(self):
        private = self.bundle / 'private-export-parent'
        private.mkdir(mode=0o700)
        nested = private / 'nested'
        nested.mkdir(mode=0o700)
        alias = self.root / 'alias-to-bundle'
        alias.symlink_to(private, target_is_directory=True)
        destination = alias / 'nested' / 'dataset'
        with self.assertRaises(exporter.ExportError):
            self.produce(output_dir=destination)
        self.assertFalse((nested / 'dataset').exists())

    def test_reject_nested_symlink_source_alias(self):
        alias = self.root / 'bundle-alias'
        alias.symlink_to(self.bundle, target_is_directory=True)
        with self.assertRaises(exporter.ExportError):
            self.produce(bundle=alias)
        self.assertFalse(self.target.exists())

    def test_geometry_symlink_and_point_input_fail_closed(self):
        other = self.root / 'alias.json'
        other.symlink_to(self.geometry)
        with self.assertRaises(Exception):
            self.produce(geometry_file=other)
        self.geometry.write_text(json.dumps({'type': 'Point', 'coordinates': [9, 49]}))
        with self.assertRaises(exporter.ExportError):
            self.produce()
        self.assertFalse(self.target.exists())

    def test_detect_changed_input_after_crop_before_manifest_and_cleanup(self):
        checksum = exporter._checksum_file
        tampered = False
        def sabotage(path):
            nonlocal tampered
            record = checksum(path)
            if not tampered:
                tampered = True
                with (self.bundle / 'indices' / 'gndvi.tif').open('ab') as out:
                    out.write(b'late mutation')
            return record
        with mock.patch.object(exporter, '_checksum_file', side_effect=sabotage):
            with self.assertRaises(Exception):
                self.produce()
        self.assertTrue(tampered)
        self.assertFalse(self.target.exists())


if __name__ == '__main__':
    unittest.main()
