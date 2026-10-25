"""Offline synthetic examples of DEDAL-scale ODM orthophoto handoff."""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

try:
    import numpy as np
    import rasterio
    from rasterio.transform import from_origin
except ImportError:
    np = None
    rasterio = None

SCRIPT = Path(__file__).resolve().parents[1] / 'backend/workers/m3m_dedal_ortho_handoff.py'
spec = importlib.util.spec_from_file_location('m3m_dedal_ortho_handoff', SCRIPT)
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


@unittest.skipUnless(np is not None and rasterio is not None,
                     'Install optional numpy+rasterio dependencies')
class HandoffTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.root = Path(self.folder.name)
        self.source = self.root / 'orthophoto.tif'
        self.pixels = np.zeros((5, 2, 3), dtype=np.uint16)
        self.pixels[0] = 6554  # red approx 0.20
        self.pixels[1] = 9830  # green approx 0.30
        self.pixels[2] = 19661  # NIR approx 0.60
        self.pixels[3] = 13107  # red edge approx 0.40
        self.pixels[4] = 65535 # alpha
        self.pixels[4, 0, 1] = 0
        self._write()

    def _write(self, *, crs='EPSG:32632', transform=None, dtype='uint16'):
        data = self.pixels.astype(dtype)
        with rasterio.open(self.source, 'w', driver='GTiff', count=data.shape[0],
                           height=2, width=3, dtype=dtype, crs=crs,
                           transform=transform or from_origin(450000, 5400000, .05, .05)) as dst:
            dst.write(data)

    def _run(self, *, status='accepted', flagged=False, out='derived'):
        return worker.convert_orthophoto(self.source, self.root / out,
                                         calibration_status=status, allow_flagged=flagged)

    def test_four_bands_and_alpha_preserve_grid_and_fraction(self):
        report = self._run()
        self.assertEqual(report['sourceScaleDivisor'], 32768)
        self.assertEqual(report['invalidAlphaPixels'], 1)
        self.assertEqual(report['outputs']['red_edge']['validPixels'], 5)
        self.assertFalse(report['reflectanceReady'])
        self.assertFalse(report['operationalUseAllowed'])
        self.assertFalse(report['radiometricCalibrationVerified'])
        with rasterio.open(self.root / 'derived/red.tif') as red:
            arr = red.read(1)
            self.assertEqual(red.count, 1)
            self.assertEqual(red.crs.to_epsg(), 32632)
            self.assertAlmostEqual(float(arr[0,0]), 6554 / 32768, places=6)
            self.assertEqual(float(arr[0,1]), -9999)
        with rasterio.open(self.root / 'derived/nir.tif') as nir:
            self.assertAlmostEqual(float(nir.read(1)[0,0]), 19661 / 32768, places=6)
        report2=json.loads((self.root/'derived/report.json').read_text())
        self.assertEqual(report2['schema'], report['schema'])
        self.assertNotIn(str(self.source), json.dumps(report))

    def test_reject_undocumented_not_calibrated_status(self):
        with self.assertRaises(worker.HandoffError):
            self._run(status='not_calibrated')
        self.assertFalse((self.root/'derived').exists())

    def test_flagged_requires_explicit_opt_in(self):
        with self.assertRaises(worker.HandoffError):
            self._run(status='flagged')
        r=self._run(status='flagged', flagged=True)
        self.assertTrue(r['flaggedInputExplicitlyAllowed'])
        self.assertFalse(r['operationalUseAllowed'])

    def test_reject_wrong_band_count(self):
        self.pixels = self.pixels[:4]
        self._write()
        with self.assertRaises(worker.HandoffError):
            self._run()

    def test_reject_wrong_dtype(self):
        self._write(dtype='float32')
        with self.assertRaises(worker.HandoffError):
            self._run()

    def test_reject_missing_crs(self):
        self._write(crs=None)
        with self.assertRaises(worker.HandoffError):
            self._run()

    def test_reject_above_scale_valid_pixel_and_cleanup(self):
        self.pixels[0,0,0] = 32769
        self._write()
        with self.assertRaises(worker.HandoffError):
            self._run()
        self.assertFalse((self.root/'derived').exists())

    def test_masked_pixels_cannot_trigger_scale_error(self):
        self.pixels[0,0,1] = 50000
        self._write()
        report = self._run()
        self.assertEqual(report['invalidAlphaPixels'], 1)

    def test_refuse_existing_target(self):
        self._run()
        with self.assertRaises(FileExistsError):
            self._run()

    def test_refuse_symlink_input(self):
        alias=self.root/'alias.tif'
        alias.symlink_to(self.source)
        with self.assertRaises(worker.HandoffError):
            worker.convert_orthophoto(alias,self.root/'derived',calibration_status='accepted')

    def test_all_transparent_pixels_emitted_as_nodata(self):
        self.pixels[4] = 0
        self._write()
        report = self._run()
        self.assertEqual(report['outputs']['green']['validPixels'], 0)
        self.assertIsNone(report['outputs']['green']['mean'])
        with rasterio.open(self.root/'derived/green.tif') as green:
            self.assertTrue(np.all(green.read(1) == -9999))


if __name__ == '__main__':
    unittest.main()
