"""P3.4 COG creation from actual synthetic, pinned P3.3 numeric GIS exports."""
from __future__ import annotations

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
    import tifffile
except ImportError:
    np = rasterio = tifffile = None

ROOT = Path(__file__).resolve().parents[1]


def load(relative, name):
    spec = importlib.util.spec_from_file_location(name, ROOT / relative)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


cog = load('backend/workers/m3m_private_cog_export.py', 'm3m_lab_cog')
prior = load('tests/test_m3m_private_numeric_gis_export.py', 'm3m_cog_numeric_fixture')


@unittest.skipUnless(np is not None and rasterio is not None and tifffile is not None,
                     'Needs GDAL COG driver, tifffile, NumPy')
class PrivateCogTests(unittest.TestCase):
    def setUp(self):
        self.fixture = prior.PrivateNumericGisExportTests(
            methodName='test_eight_numerical_gtiffs_and_csv_preserve_crs_and_masks')
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.source = self.fixture.target
        self.summary = self.fixture.produce()
        self.pin = self.summary['manifestSha256']
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.output = Path(temp.name) / 'cogs'

    def produce(self, **updates):
        kw = dict(input_dir=self.source, source_manifest_sha256=self.pin,
                  output_dir=self.output, private_output_ok=True)
        kw.update(updates)
        return cog.create_cogs(**kw)

    def test_eight_verified_cogs_roundtrip_exact_float32_and_crs(self):
        result = self.produce()
        self.assertEqual(result['cogCount'], 8)
        self.assertTrue(result['cloudOptimizedGeoTiff'])
        self.assertFalse(result['operationalUseAllowed'])
        self.assertFalse(result['radiometricCalibrationVerified'])
        self.assertTrue(result['structuralAndPixelChecksPassed'])
        self.assertEqual(self.output.stat().st_mode & 0o777, 0o700)
        raw = (self.output / 'cog-manifest.json').read_bytes()
        self.assertEqual(result['manifestSha256'], hashlib.sha256(raw).hexdigest())
        manifest = json.loads(raw)
        self.assertEqual(manifest['schema'], 'skyhub-m3m-private-cog-export-v1')
        self.assertEqual(manifest['sourceExportManifestSha256'], self.pin)
        self.assertEqual(manifest['sourceSealSha256'], self.fixture.sha)
        self.assertTrue(manifest['containsSensitiveGeolocation'])
        self.assertFalse(manifest['prescriptionExportAllowed'])
        self.assertEqual([x['layer'] for x in manifest['cogs']], list(cog.LAYERS))
        self.assertEqual(set(x.name for x in self.output.iterdir()),
                         set(layer+'.cog.tif' for layer in cog.LAYERS) |
                         {'cog-manifest.json'})
        for layer in cog.LAYERS:
            dest = self.output / (layer + '.cog.tif')
            src = self.source / (layer + '.tif')
            record = next(x for x in manifest['cogs'] if x['layer'] == layer)
            self.assertEqual(record['sha256'], hashlib.sha256(dest.read_bytes()).hexdigest())
            self.assertTrue(record['pixelValuesIdentical'])
            self.assertTrue(record['independentTiffReimportVerified'])
            self.assertEqual(dest.stat().st_mode & 0o777, 0o600)
            with rasterio.open(src) as left, rasterio.open(dest) as right:
                self.assertEqual(right.tags(ns='IMAGE_STRUCTURE')['LAYOUT'], 'COG')
                self.assertTrue(right.is_tiled)
                self.assertEqual(right.block_shapes, [(256, 256)])
                self.assertEqual(left.crs, right.crs)
                self.assertEqual(left.transform, right.transform)
                self.assertEqual(left.nodata, right.nodata)
                self.assertTrue(np.array_equal(left.read(1), right.read(1)))
            with tifffile.TiffFile(dest) as decoder:
                self.assertTrue(decoder.pages[0].is_tiled)
                self.assertEqual(decoder.pages[0].sampleformat, 3)
        self.assertNotIn(str(self.output), str(manifest))
        self.assertNotIn(str(self.source), str(manifest))

    def test_no_consent_no_output_and_existing_folder_preserved(self):
        with self.assertRaises(cog.CogError):
            self.produce(private_output_ok=False)
        self.assertFalse(self.output.exists())
        self.output.mkdir()
        sentinel = self.output / 'important'
        sentinel.write_text('retain')
        with self.assertRaises(cog.CogError):
            self.produce()
        self.assertEqual(sentinel.read_text(), 'retain')

    def test_invalid_pins_and_modified_numeric_pixels_fail_closed(self):
        with self.assertRaises(Exception):
            self.produce(source_manifest_sha256='0'*64)
        self.assertFalse(self.output.exists())
        with (self.source / 'ndvi.tif').open('ab') as f:
            f.write(b'tampered')
        with self.assertRaises(Exception):
            self.produce()
        self.assertFalse(self.output.exists())

    def test_refuse_malicious_unknown_export_files_and_symlinks(self):
        (self.source / 'private.txt').write_text('data')
        with self.assertRaises(cog.CogError):
            self.produce()
        (self.source / 'private.txt').unlink()
        (self.source / 'gndvi.tif').rename(self.source / 'gndvi-renamed.tif')
        (self.source / 'gndvi.tif').symlink_to(self.source / 'gndvi-renamed.tif')
        with self.assertRaises(cog.CogError):
            self.produce()

    def test_mutation_after_conversion_before_manifest_rolls_back(self):
        actual = cog.convert_and_check
        triggered = False
        def sabotage(*args, **kwargs):
            nonlocal triggered
            result = actual(*args, **kwargs)
            if not triggered:
                triggered = True
                with (self.source / 'ndre.tif').open('ab') as stream:
                    stream.write(b'race')
            return result
        with mock.patch.object(cog,'convert_and_check',side_effect=sabotage):
            with self.assertRaises(Exception):
                self.produce()
        self.assertTrue(triggered)
        self.assertFalse(self.output.exists())

    def test_reject_forged_readiness_in_independently_pinned_manifest(self):
        record = json.loads((self.source / 'export-manifest.json').read_text())
        record['operationalUseAllowed'] = True
        raw = (json.dumps(record, separators=(',', ':'), sort_keys=True) + '\n').encode()
        (self.source / 'export-manifest.json').write_bytes(raw)
        updated_pin = hashlib.sha256(raw).hexdigest()
        with self.assertRaises(cog.CogError):
            self.produce(source_manifest_sha256=updated_pin)
        self.assertFalse(self.output.exists())

    def test_larger_raster_has_real_pyramid_not_just_tiled_tiff(self):
        # This test exercises the conversion subroutine with a large synthetic
        # TIFF; it does not bypass the pinned manifest gate in create_cogs().
        from rasterio.transform import from_origin
        with tempfile.TemporaryDirectory() as tmp:
            source, target = Path(tmp)/'reference.tif', Path(tmp)/'large.cog.tif'
            matrix = np.full((768, 768), .3, dtype='float32')
            matrix[0, 1] = cog.NODATA
            with rasterio.open(source, 'w', driver='GTiff', count=1,
                               width=768, height=768, dtype='float32',
                               nodata=cog.NODATA, crs='EPSG:32632',
                               transform=from_origin(450000, 5400000, .05, .05)) as ds:
                ds.write(matrix, 1)
            report = cog.convert_and_check(
                source, target, expected_crs='EPSG:32632',
                expected_dims=[768,768], expected_valid=768*768-1)
            self.assertGreaterEqual(report['overviewCount'],1)
            with rasterio.open(target) as ds:
                self.assertTrue(ds.overviews(1))
                self.assertEqual(ds.tags(ns='IMAGE_STRUCTURE')['LAYOUT'],'COG')


if __name__ == '__main__':
    unittest.main()
