"""P3 synthetic ROI/pixel tests. Never use DJI/MinIO/HTTP/flight services."""
from __future__ import annotations

import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest import mock

try:
    import numpy as np
    import rasterio
    from rasterio.transform import from_origin
except ImportError:
    np = None
    rasterio = None

FILE = Path(__file__).resolve().parents[1] / 'backend/workers/m3m_offline_roi.py'
spec = importlib.util.spec_from_file_location('skyhub_m3m_roi_test', FILE)
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


@unittest.skipUnless(np is not None and rasterio is not None, 'Optional raster packages required')
class OfflineRoiTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.bundle = self.root / 'bundle'
        (self.bundle / 'reflectance').mkdir(parents=True)
        (self.bundle / 'indices').mkdir()
        self.seal = self.root / 'seal.json'
        self.seal.write_text('{}\n')
        self.pin = 'a' * 64
        base = np.array([[0.2, -9999], [0.4, 0.6]], dtype='float32')
        for idx, name in enumerate(worker.LAYERS):
            arr = base.copy()
            arr[arr != -9999] += idx * 0.01
            folder = 'reflectance' if name in worker.BAND_LAYERS else 'indices'
            with rasterio.open(self.bundle / folder / (name + '.tif'), 'w',
                               driver='GTiff', width=2, height=2,
                               count=1, dtype='float32',
                               nodata=-9999, crs='EPSG:32632',
                               transform=from_origin(500000, 5400000, 0.25, 0.25)) as dst:
                dst.write(arr, 1)

    def fake_verifier(self):
        class Fake:
            def __init__(self, digest):
                self.digest = digest
                self.calls = 0

            def verify_seal(self, bundle, seal, expected_sha):
                self.calls += 1
                return {
                    'filesMatched': 11,
                    'pixelQaRechecked': True,
                    'sha256OfSeal': self.digest,
                    'calibrationVerified': False,
                    'operationalUseAllowed': False,
                }
        return Fake(self.pin)

    def inspect(self, rect=(0, 0, 2, 2), verifier=None):
        verifier = verifier or self.fake_verifier()
        with mock.patch.object(worker, '_seal_module', return_value=verifier):
            result = worker.inspect_roi(bundle=self.bundle, seal=self.seal,
                                        seal_sha256=self.pin, rect=rect)
        return result, verifier

    def test_roi_reads_numeric_not_colorized_raster(self):
        report, verifier = self.inspect()
        self.assertEqual(verifier.calls, 2)
        self.assertEqual(report['roiPixels'], 4)
        self.assertEqual(report['layers']['ndvi']['validPixels'], 3)
        self.assertEqual(report['layers']['ndvi']['maskedPixels'], 1)
        self.assertAlmostEqual(report['layers']['ndvi']['mean'],
                               (0.24 + 0.44 + 0.64) / 3, places=6)
        self.assertAlmostEqual(report['layers']['red']['median'], 0.4, places=6)
        self.assertTrue(report['integrityRecheckedAfterRead'])
        self.assertFalse(report['operationalUseAllowed'])
        self.assertFalse(report['radiometricCalibrationVerified'])
        self.assertFalse(report['prescriptionExportAllowed'])
        serialized = str(report)
        self.assertNotIn(str(self.bundle), serialized)
        self.assertNotIn('EPSG:32632', serialized)
        self.assertNotIn('geoTransform', serialized)
        self.assertNotIn('utmEasting', serialized)

    def test_one_pixel_and_masked_pixel(self):
        value, _ = self.inspect(rect=(0, 0, 1, 1))
        self.assertEqual(value['layers']['ndre']['validPixels'], 1)
        invalid, _ = self.inspect(rect=(0, 1, 1, 2))
        self.assertEqual(invalid['layers']['ndvi']['validPixels'], 0)
        self.assertIsNone(invalid['layers']['ndvi']['mean'])

    def test_refuse_invalid_windows_and_digests(self):
        for rect in ((0, 0, 3, 1), (0, 0, 0, 1), (-1, 0, 1, 1),
                     (0, 0, 1.2, 2), (0, 0, 0, 0), (0, 0, 2000, 2000)):
            with self.subTest(rect=rect), self.assertRaises(worker.InspectError):
                self.inspect(rect=rect)
        with self.assertRaises(worker.InspectError):
            worker.inspect_roi(bundle=self.bundle, seal=self.seal,
                               seal_sha256='notsha', rect=(0, 0, 1, 1))

    def test_refuse_verifier_that_elevates_calibration(self):
        verifier = self.fake_verifier()
        def invalid(*args):
            return {'filesMatched': 11, 'pixelQaRechecked': True,
                    'sha256OfSeal': self.pin, 'calibrationVerified': True,
                    'operationalUseAllowed': False}
        verifier.verify_seal = invalid
        with self.assertRaises(worker.InspectError):
            self.inspect(verifier=verifier)

    def test_refuse_late_integrity_failure(self):
        verifier = self.fake_verifier()
        normal = verifier.verify_seal
        def fail_second(*args):
            if verifier.calls >= 1:
                raise worker.InspectError('Changed after reading')
            return normal(*args)
        verifier.verify_seal = fail_second
        with self.assertRaises(worker.InspectError):
            self.inspect(verifier=verifier)


if __name__ == '__main__':
    unittest.main()
