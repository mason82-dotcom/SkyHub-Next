"""Synthetic actual-GeoTIFF bundle QA tests, no DJI images or DEDAL execution."""
from __future__ import annotations

import hashlib
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
    np = rasterio = None

MODULE = Path(__file__).resolve().parents[1] / 'backend/workers/m3m_raster_bundle_verify.py'
spec = importlib.util.spec_from_file_location('m3m_raster_bundle_verify', MODULE)
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


@unittest.skipUnless(np is not None and rasterio is not None, 'Requires optional numpy and rasterio')
class TestM3mRasterBundleQa(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name) / 'bundle'
        self.fractions = self.root / 'reflectance'
        self.indices = self.root / 'indices'
        self.fractions.mkdir(parents=True)
        self.indices.mkdir()
        self.grids = {}
        for name, value in (('red', .2), ('green', .3), ('red_edge', .4), ('nir', .6)):
            arr = np.full((2, 3), value, dtype='float32')
            arr[0, 1] = -9999
            self.grids[name] = arr
            self._write(self.fractions / (name + '.tif'), arr)
        n, r, g, re = [self.grids[k] for k in ('nir', 'red', 'green', 'red_edge')]
        with np.errstate(invalid='ignore'):
            for name, (a, b) in {
                'ndvi':(n-r,n+r), 'ndre':(n-re,n+re),
                'gndvi':(n-g,n+g), 'osavi':(1.16*(n-r),n+r+.16)
            }.items():
                arr = (a/b).astype('float32')
                arr[0,1] = -9999
                self.grids[name] = arr
                self._write(self.indices / (name+'.tif'), arr)
        false = dict(operationalUseAllowed=False, reflectanceReady=False,
                     ndviReady=False, ndreReady=False)
        self.first = dict(schema='skyhub-m3m-dedal-ortho-handoff-v1',
                          radiometricCalibrationVerified=False,bandCoregistrationVerified=False,
                          sourceProvenanceVerified=False,pixelCount=6, **false,
                          outputs={name:dict(filename=name+'.tif',validPixels=5,
                                             mean=float(np.mean(self.grids[name][self.grids[name]!=-9999])))
                                   for name in worker.BANDS})
        self.second = dict(schema='skyhub-m3m-experimental-index-raster-v1',
                           calibrationVerified=False,bandCoregistrationVerified=False,
                           pixelCount=6,fourBandValidPixels=5, **false,
                           outputs={name:dict(filename=name+'.tif',validPixels=5,
                                              mean=float(np.mean(self.grids[name][self.grids[name]!=-9999])),
                                              min=float(np.min(self.grids[name][self.grids[name]!=-9999])),
                                              max=float(np.max(self.grids[name][self.grids[name]!=-9999])))
                                    for name in worker.INDICES})
        self.top = dict(schema='skyhub-m3m-offline-orthomosaic-index-bundle-v1',
                        stageSchemas=[self.first['schema'],self.second['schema']],
                        sourceSha256MatchesOperatorPin=True,sourceRetainedDuringRun=True,
                        externalCalibrationStatusClaim='accepted',
                        radiometricCalibrationVerified=False,bandCoregistrationVerified=False,
                        captureAndPanelProvenanceVerified=False,dedalExecutedBySkyHub=False,
                        reflectanceValidPixels={b:5 for b in worker.BANDS},
                        indicesValidPixels={i:5 for i in worker.INDICES}, **false)
        self._save()

    def _write(self,path,data,**kwargs):
        with rasterio.open(path,'w',driver='GTiff',count=1,width=3,height=2,dtype='float32',
                           nodata=kwargs.get('nodata',-9999.0),
                           crs='EPSG:32632', transform=kwargs.get('transform',from_origin(450000,5400000,.05,.05))) as ds:
            ds.write(data.astype('float32'),1)

    def _save(self):
        for data,path in ((self.top,self.root/'bundle-report.json'),
                          (self.first,self.fractions/'report.json'),
                          (self.second,self.indices/'report.json')):
            path.write_text(json.dumps(data)+'\n',encoding='utf-8')

    def test_valid_bundle_and_no_writes(self):
        original={str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in self.root.rglob('*') if p.is_file()}
        result=worker.verify_bundle(self.root)
        self.assertTrue(result['pixelFormulaAndMaskChecksPassed'])
        self.assertEqual(result['filesFullyDecoded'],8)
        self.assertEqual(result['validIndices']['ndvi'],5)
        self.assertFalse(result['operationalUseAllowed'])
        self.assertNotIn(str(self.root),str(result))
        self.assertEqual(original,{str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in self.root.rglob('*') if p.is_file()})

    def test_detect_tampered_ndvi_pixel(self):
        x=self.grids['ndvi'].copy()
        x[0,0]+=.02
        self._write(self.indices/'ndvi.tif',x)
        with self.assertRaises(worker.BundleError):worker.verify_bundle(self.root)

    def test_detect_wrong_index_nodata_mask(self):
        x=self.grids['ndre'].copy()
        x[0,1]=0
        self._write(self.indices/'ndre.tif',x)
        with self.assertRaises(worker.BundleError):worker.verify_bundle(self.root)

    def test_detect_invalid_reflectance_fraction(self):
        x=self.grids['red'].copy()
        x[0,0]=1.7
        self._write(self.fractions/'red.tif',x)
        with self.assertRaises(worker.BundleError):worker.verify_bundle(self.root)

    def test_detect_geotransform_drift(self):
        self._write(self.indices/'ndvi.tif',self.grids['ndvi'],transform=from_origin(450000.02,5400000,.05,.05))
        with self.assertRaises(worker.BundleError):worker.verify_bundle(self.root)

    def test_detect_wrong_nodata_metadata(self):
        self._write(self.indices/'ndre.tif',self.grids['ndre'],nodata=-1)
        with self.assertRaises(worker.BundleError):worker.verify_bundle(self.root)

    def test_detect_wrong_stage_pixel_count(self):
        self.second['outputs']['ndvi']['validPixels']=6
        self._save()
        with self.assertRaises(worker.BundleError):worker.verify_bundle(self.root)

    def test_detect_wrong_stage_mean(self):
        self.first['outputs']['green']['mean']=.95
        self._save()
        with self.assertRaises(worker.BundleError):worker.verify_bundle(self.root)

    def test_detect_lie_in_bundle_summary(self):
        self.top['indicesValidPixels']['ndvi']=4
        self._save()
        with self.assertRaises(worker.BundleError):worker.verify_bundle(self.root)

    def test_detect_fabricated_readiness(self):
        self.top['operationalUseAllowed']=True
        self._save()
        with self.assertRaises(worker.BundleError):worker.verify_bundle(self.root)

    def test_detect_missing_tiff(self):
        (self.indices/'osavi.tif').unlink()
        with self.assertRaises(worker.BundleError):worker.verify_bundle(self.root)

    def test_detect_unexpected_extra_file(self):
        (self.root/'metadata.txt').write_text('unexpected')
        with self.assertRaises(worker.BundleError):worker.verify_bundle(self.root)

    def test_reject_double_json_keys(self):
        (self.root/'bundle-report.json').write_text('{"schema":"first","schema":"second"}')
        with self.assertRaises(worker.BundleError):worker.verify_bundle(self.root)

    def test_reject_symlink_geotiff(self):
        src=self.fractions/'red.tif'
        backup=self.fractions/'replacement'
        src.rename(backup)
        src.symlink_to(backup)
        with self.assertRaises(worker.BundleError):worker.verify_bundle(self.root)

    def test_detect_silent_change_in_index_extrema(self):
        self.second['outputs']['osavi']['max']=42
        self._save()
        with self.assertRaises(worker.BundleError):worker.verify_bundle(self.root)


if __name__=='__main__':unittest.main()
