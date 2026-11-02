"""P3 private PNG previews validated against REAL synthetic GeoTIFF/seal fixtures."""
from __future__ import annotations

import hashlib
import importlib.util
from pathlib import Path
import struct
import unittest
from unittest import mock

try:
    import numpy as np
    import rasterio
except ImportError:
    np = rasterio = None

ROOT = Path(__file__).resolve().parents[1]
def module(filename, label):
    path = ROOT / filename
    spec = importlib.util.spec_from_file_location(label, path)
    obj = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(obj)
    return obj

worker = module('backend/workers/m3m_private_index_preview.py', 'm3m_private_preview')
sealmod = module('backend/workers/m3m_raster_bundle_seal.py', 'm3m_private_preview_seal')
fixturemod = module('tests/test_m3m_raster_bundle_verify.py', 'm3m_private_preview_fixture')


@unittest.skipUnless(np is not None and rasterio is not None, 'Optional raster libraries required')
class PrivatePreviewTests(unittest.TestCase):
    def setUp(self):
        self.fixture = fixturemod.TestM3mRasterBundleQa(methodName='test_valid_bundle_and_no_writes')
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.bundle = self.fixture.root
        self.seal = self.bundle.parent / 'private-seal.json'
        self.sha = sealmod.create_seal(self.bundle, self.seal)['sha256OfSeal']
        self.output = self.bundle.parent / 'private-ndvi.png'

    def render(self, **kwargs):
        opts = dict(bundle=self.bundle, seal=self.seal, seal_sha256=self.sha,
                    index='ndvi', output_file=self.output, private_output_ok=True)
        opts.update(kwargs)
        return worker.create_preview(**opts)

    def test_png_is_private_lossy_visualization_only(self):
        report = self.render()
        payload = self.output.read_bytes()
        self.assertEqual(payload[:8], b'\x89PNG\r\n\x1a\n')
        self.assertEqual(struct.unpack('>II', payload[16:24]),
                         (report['width'], report['height']))
        self.assertEqual(payload[25], 6)  # RGBA, NoData can be transparent
        self.assertEqual(report['pngSha256'], hashlib.sha256(payload).hexdigest())
        self.assertLessEqual(report['width'], 512)
        self.assertLessEqual(report['height'], 512)
        self.assertEqual(self.output.stat().st_mode & 0o777, 0o600)
        self.assertFalse(report['operationalUseAllowed'])
        self.assertFalse(report['reflectanceReady'])
        self.assertFalse(report['radiometricCalibrationVerified'])
        self.assertFalse(report['metadataGeolocationIncluded'])
        self.assertNotIn(b'EPSG', payload)
        self.assertNotIn(str(self.bundle), str(report))
        self.assertNotIn(str(self.bundle), payload.decode('latin1'))

    def test_refuse_without_explicit_private_output_consent(self):
        with self.assertRaises(worker.PreviewError):
            self.render(private_output_ok=False)
        self.assertFalse(self.output.exists())

    def test_refuse_invalid_layer_or_bad_pin(self):
        with self.assertRaises(worker.PreviewError):
            self.render(index='rgb')
        with self.assertRaises(Exception):
            self.render(seal_sha256='0' * 64)
        self.assertFalse(self.output.exists())

    def test_preserve_existing_output_without_overwrite(self):
        self.output.write_bytes(b'important user contents')
        with self.assertRaises(worker.PreviewError):
            self.render()
        self.assertEqual(self.output.read_bytes(), b'important user contents')

    def test_refuse_output_inside_sealed_bundle(self):
        illegal = self.bundle / 'indices' / 'new-image.png'
        with self.assertRaises(worker.PreviewError):
            self.render(output_file=illegal)
        self.assertFalse(illegal.exists())

    def test_tamper_after_read_is_detected_before_file_publication(self):
        actual = worker._png_rgba
        def sabotage(*args):
            content = actual(*args)
            with (self.bundle / 'indices' / 'ndvi.tif').open('ab') as f:
                f.write(b'late mutation')
            return content
        with mock.patch.object(worker, '_png_rgba', side_effect=sabotage):
            with self.assertRaises(Exception):
                self.render()
        self.assertFalse(self.output.exists())

    def test_reject_swapped_index_raster_after_seal(self):
        with (self.bundle / 'indices' / 'ndvi.tif').open('ab') as f:
            f.write(b'corrupt')
        with self.assertRaises(Exception):
            self.render()
        self.assertFalse(self.output.exists())


if __name__ == '__main__':
    unittest.main()
