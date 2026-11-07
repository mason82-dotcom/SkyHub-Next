"""Offline regression tests: no network, S3, drone, PostGIS or running backend."""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

MODULE = Path(__file__).resolve().parents[1] / 'backend/workers/m3m_reflectance_indices.py'
spec = importlib.util.spec_from_file_location('m3m_reflectance_indices', MODULE)
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)

try:
    import numpy as np
    import rasterio
    from rasterio.transform import from_origin
except ImportError:
    np = None
    rasterio = None


@unittest.skipUnless(np is not None and rasterio is not None, 'Install numpy + rasterio for raster integration tests')
class M3mRasterTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.arrays = {
            'red': np.array([[0.2, 0, -9999], [0.0, 0.2, 0.2]], dtype='float32'),
            'green': np.array([[0.3, 0, -9999], [0.0, 0.3, 0.3]], dtype='float32'),
            'red_edge': np.array([[0.4, 0, -9999], [0.0, 0.4, 0.4]], dtype='float32'),
            'nir': np.array([[0.6, 0, -9999], [0.0, 0.6, 0.6]], dtype='float32'),
        }
        self.paths = {}
        for band, arr in self.arrays.items():
            self.paths[band] = self._write(band, arr)

    def _write(self, band, data, **kwargs):
        path = self.root / (band + '.tif')
        with rasterio.open(path, 'w', driver='GTiff', height=2, width=3,
                           count=1, dtype=kwargs.get('dtype', 'float32'),
                           crs=kwargs.get('crs', 'EPSG:32632'),
                           transform=kwargs.get('transform', from_origin(430000, 5420000, 0.1, 0.1)),
                           nodata=kwargs.get('nodata', -9999.0)) as dst:
            dst.write(data.astype(kwargs.get('dtype', 'float32')), 1)
        return path

    def _run(self, output='indices'):
        return worker.produce(*(self.paths[k] for k in worker.BANDS), self.root / output)

    def test_indices_and_mask_produce_actual_float_geotiff(self):
        report = self._run()
        self.assertFalse(report['operationalUseAllowed'])
        self.assertFalse(report['calibrationVerified'])
        self.assertFalse(report['ndviReady'])
        self.assertEqual(report['fourBandValidPixels'], 5)
        self.assertEqual(report['outputs']['ndvi']['validPixels'], 3)
        self.assertEqual(report['outputs']['ndre']['validPixels'], 3)
        with rasterio.open(self.root / 'indices/ndvi.tif') as ds:
            self.assertEqual(ds.crs.to_epsg(), 32632)
            self.assertEqual(ds.dtypes[0], 'float32')
            self.assertAlmostEqual(float(ds.read(1)[0, 0]), 0.5, places=5)
            self.assertEqual(float(ds.read(1)[0, 1]), -9999.0)
            self.assertEqual(float(ds.read(1)[0, 2]), -9999.0)
        with rasterio.open(self.root / 'indices/osavi.tif') as ds:
            self.assertAlmostEqual(float(ds.read(1)[0, 0]), 1.16 * 0.4 / 0.96, places=5)
            self.assertEqual(float(ds.read(1)[0, 1]), 0.0)
        self.assertEqual(json.loads((self.root / 'indices/report.json').read_text())['schema'], report['schema'])

    def test_reject_raw_uint16_and_protect_output(self):
        self.paths['red'] = self._write('red', self.arrays['red'], dtype='uint16', nodata=None)
        with self.assertRaises(worker.InvalidRaster):
            self._run()
        self.assertFalse((self.root / 'indices').exists())

    def test_reject_out_of_range_pixel_without_partial_products(self):
        data = self.arrays['red'].copy()
        data[1, 0] = 100.0
        self.paths['red'] = self._write('red', data)
        with self.assertRaises(worker.InvalidRaster):
            self._run()
        self.assertFalse((self.root / 'indices').exists())

    def test_reject_grid_shift(self):
        self.paths['nir'] = self._write('nir', self.arrays['nir'], transform=from_origin(430000.01, 5420000, 0.1, 0.1))
        with self.assertRaises(worker.InvalidRaster):
            self._run()

    def test_reject_crs_mismatch(self):
        self.paths['nir'] = self._write('nir', self.arrays['nir'], crs='EPSG:4326')
        with self.assertRaises(worker.InvalidRaster):
            self._run()

    def test_never_overwrites_existing_results(self):
        self._run()
        with self.assertRaises(FileExistsError):
            self._run()

    def test_reject_duplicate_source(self):
        self.paths['nir'] = self.paths['red']
        with self.assertRaises(worker.InvalidRaster):
            self._run()


if __name__ == '__main__':
    unittest.main()
