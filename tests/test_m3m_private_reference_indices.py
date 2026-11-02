"""P3.5b: real synthetic TIFF cross-pipeline vegetation-index agreement."""
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
except ImportError:
    np = rasterio = None

ROOT = Path(__file__).resolve().parents[1]


def module(relative, name):
    spec = importlib.util.spec_from_file_location(name, ROOT / relative)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


index = module('backend/workers/m3m_private_reference_indices.py', 'skyhub_reference_indices')
fixture = module('tests/test_m3m_private_reference_agreement.py', 'skyhub_reference_indices_fixture')


@unittest.skipUnless(np is not None and rasterio is not None, 'Real binary Rasterio and NumPy needed')
class ReferenceIndexAgreementTests(unittest.TestCase):
    def setUp(self):
        f = fixture.M3mReferenceAgreementTests(
            methodName='test_small_reference_offsets_yield_metrics_but_no_scientific_readiness')
        f.setUp()
        self.addCleanup(f.doCleanups)
        self.fixture = f
        self.source = f.bundle
        self.seal = f.seal
        self.source_pin = f.pin
        self.ref_dir = f.reference_dir
        self.ref_pin = f.reference_pin

    def compare(self, **changes):
        options = {'bundle':self.source, 'seal':self.seal,
                   'seal_sha256':self.source_pin,
                   'reference_dir':self.ref_dir,
                   'reference_manifest_sha256':self.ref_pin}
        options.update(changes)
        return index.audit(**options)

    def test_all_four_indices_agree_with_recomputed_reference_to_exploratory_precision(self):
        result=self.compare()
        self.assertEqual(result['schema'],'skyhub-m3m-private-reference-index-agreement-v1')
        self.assertEqual(list(result['indices']),list(index.INDICES))
        self.assertTrue(result['sourceFourBandAgreementWithinExploratoryLimits'])
        self.assertTrue(result['allIndicesWithinExploratoryLimits'])
        self.assertTrue(result['sourceAndReferencePinsRecheckedAfterRead'])
        for name,item in result['indices'].items():
            self.assertEqual(item['sharedValidPixels'],5)
            self.assertEqual(item['sourceIndexValidPixels'],5)
            self.assertEqual(item['referenceDerivedValidPixels'],5)
            self.assertEqual(item['sourceOnlyValidPixels'],0)
            self.assertEqual(item['referenceOnlyValidPixels'],0)
            self.assertEqual(item['maskIntersectionOverUnion'],1)
            self.assertTrue(item['withinExploratoryLimits'])
            self.assertGreaterEqual(item['meanAbsoluteError'],0)
            self.assertGreaterEqual(item['rmse'],0)
            self.assertLess(item['p95AbsoluteError'],.03)
        self.assertAlmostEqual(result['indices']['ndvi']['meanSignedError'],.012195,places=4)
        for flag in ('referenceProvenanceIndependentlyVerified','sourceProvenanceVerified',
                     'radiometricCalibrationVerified','bandCoregistrationVerified',
                     'reflectanceReady','ndviReady','ndreReady',
                     'operationalUseAllowed','prescriptionExportAllowed','flightMissionAllowed'):
            self.assertIs(result[flag],False)
        report=json.dumps(result)
        self.assertNotIn(str(self.source),report)
        self.assertNotIn(str(self.ref_dir),report)
        self.assertNotIn(self.source_pin,report)
        self.assertNotIn(self.ref_pin,report)

    def test_large_offset_exposes_index_disagreement_without_elevating_readiness(self):
        self.fixture.make_reference({name:.2 for name in index.BANDS})
        self.ref_pin = self.fixture.reference_pin
        result = self.compare()
        self.assertFalse(result['sourceFourBandAgreementWithinExploratoryLimits'])
        self.assertFalse(result['allIndicesWithinExploratoryLimits'])
        self.assertGreater(result['indices']['ndvi']['rmse'],.1)
        self.assertFalse(result['indices']['ndvi']['withinExploratoryLimits'])
        self.assertFalse(result['radiometricCalibrationVerified'])

    def test_reference_nodata_drift_appears_in_index_mask_intersection(self):
        path = self.ref_dir/'green.tif'
        with rasterio.open(path) as ds:
            matrix=ds.read(1);profile=ds.profile
        matrix[1,1]=-9999.0
        with rasterio.open(path,'w',**profile) as ds:
            ds.write(matrix,1)
        self.fixture.save_manifest()
        self.ref_pin = self.fixture.reference_pin
        result = self.compare()
        self.assertEqual(result['indices']['ndvi']['sharedValidPixels'],4)
        self.assertEqual(result['indices']['ndvi']['sourceOnlyValidPixels'],1)
        self.assertEqual(result['indices']['ndvi']['referenceOnlyValidPixels'],0)
        self.assertEqual(result['indices']['ndvi']['maskIntersectionOverUnion'],.8)
        self.assertFalse(result['allIndicesWithinExploratoryLimits'])
        self.assertFalse(result['reflectanceReady'])

    def test_zero_denominator_invalidates_reference_index_not_source(self):
        for band in index.BANDS:
            file = self.ref_dir/(band+'.tif')
            with rasterio.open(file) as ds:
                values=ds.read(1); profile=ds.profile
            values[0,0]=0.0
            with rasterio.open(file,'w',**profile) as ds:
                ds.write(values,1)
        self.fixture.save_manifest()
        self.ref_pin=self.fixture.reference_pin
        result=self.compare()
        for item in result['indices'].values():
            self.assertEqual(item['sharedValidPixels'],4)
            self.assertEqual(item['sourceOnlyValidPixels'],1)
            self.assertEqual(item['referenceOnlyValidPixels'],0)
            self.assertEqual(item['maskIntersectionOverUnion'],.8)
        self.assertFalse(result['allIndicesWithinExploratoryLimits'])
        self.assertFalse(result['radiometricCalibrationVerified'])

    def test_bad_source_pin_or_reference_pin_denied(self):
        with self.assertRaises(Exception):
            self.compare(seal_sha256='0'*64)
        with self.assertRaises(Exception):
            self.compare(reference_manifest_sha256='0'*64)

    def test_source_index_tamper_caught_before_comparison(self):
        file=self.source/'indices/ndre.tif'
        with file.open('ab') as out:out.write(b'corrupted')
        with self.assertRaises(Exception):self.compare()

    def test_reference_spectral_band_edit_caught_by_pin(self):
        file=self.ref_dir/'red_edge.tif'
        with file.open('ab') as out:out.write(b'corrupted')
        with self.assertRaises(Exception):self.compare()

    def test_wgs84_geometry_grid_drift_denied(self):
        path=self.ref_dir/'nir.tif'
        with rasterio.open(path) as ds:
            matrix=ds.read(1);profile=ds.profile
        from rasterio.transform import from_origin
        profile.update(transform=from_origin(450000.02,5400000,.05,.05))
        with rasterio.open(path,'w',**profile) as ds:ds.write(matrix,1)
        self.fixture.save_manifest()
        self.ref_pin = self.fixture.reference_pin
        with self.assertRaises(Exception):self.compare()

    def test_byte_cloned_reference_is_not_independent(self):
        self.fixture.make_reference({name:0 for name in index.BANDS})
        self.ref_pin = self.fixture.reference_pin
        with self.assertRaises(Exception):self.compare()

    def test_mutation_before_final_recheck_fails_closed(self):
        verify=index._verify_inputs
        checks=0
        def sabotage(*args):
            nonlocal checks
            checks+=1
            if checks==2:
                with (self.ref_dir/'nir.tif').open('ab') as out:
                    out.write(b'late mutation')
            return verify(*args)
        with mock.patch.object(index,'_verify_inputs',side_effect=sabotage):
            with self.assertRaises(Exception):self.compare()
        self.assertEqual(checks,2)


if __name__ == '__main__':
    unittest.main()
