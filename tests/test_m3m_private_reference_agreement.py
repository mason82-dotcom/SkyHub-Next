"""P3.5a: true synthetic Rasterio reference-agreement acceptance; never hardware claims."""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
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
    obj = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(obj)
    return obj


ref = module('backend/workers/m3m_private_reference_agreement.py', 'm3m_ref_agreement')
sealmod = module('backend/workers/m3m_raster_bundle_seal.py', 'm3m_ref_agreement_seal')
fixture = module('tests/test_m3m_raster_bundle_verify.py', 'm3m_ref_agreement_fixture')


@unittest.skipUnless(np is not None and rasterio is not None, 'Requires binary NumPy/Rasterio')
class M3mReferenceAgreementTests(unittest.TestCase):
    def setUp(self):
        f = fixture.TestM3mRasterBundleQa(methodName='test_valid_bundle_and_no_writes')
        f.setUp()
        self.addCleanup(f.doCleanups)
        self.fixture = f
        self.bundle = f.root
        self.seal = self.bundle.parent / 'reference-test-seal.json'
        self.pin = sealmod.create_seal(self.bundle, self.seal)['sha256OfSeal']
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.reference_dir = self.root / 'reference'
        self.reference_dir.mkdir(mode=0o700)
        self.make_reference()

    def manifest_payload(self):
        record = {
            'schema': ref.SCHEMA,
            'classification': 'operator-provided-reference-unverified-independence',
            'bands': [
                {
                    'band': name, 'filename': name + '.tif',
                    'sha256': hashlib.sha256((self.reference_dir/(name+'.tif')).read_bytes()).hexdigest(),
                    'bytes': (self.reference_dir/(name+'.tif')).stat().st_size
                }
                for name in ref.BANDS
            ],
            'externallyCalibratedClaim': False,
            'provenanceIndependentlyVerified': False,
            'radiometricCalibrationVerified': False,
            'operationalUseAllowed': False
        }
        return (json.dumps(record, sort_keys=True, separators=(',', ':')) + '\n').encode()

    def save_manifest(self):
        data=self.manifest_payload()
        (self.reference_dir/'reference-manifest.json').write_bytes(data)
        self.reference_pin = hashlib.sha256(data).hexdigest()

    def make_reference(self, offsets=None):
        offsets = offsets or {name:.01 for name in ref.BANDS}
        for name in ref.BANDS:
            source_file=self.bundle/'reflectance'/(name+'.tif')
            dest_file=self.reference_dir/(name+'.tif')
            with rasterio.open(source_file) as source:
                arr=source.read(1)
                good=arr!=-9999.0
                arr[good]+=offsets[name]
                with rasterio.open(dest_file,'w',**source.profile) as target:
                    target.write(arr,1)
        self.save_manifest()

    def inspect(self, **override):
        args={'bundle':self.bundle,'seal':self.seal,
              'seal_sha256':self.pin,'reference_dir':self.reference_dir,
              'reference_manifest_sha256':self.reference_pin}
        args.update(override)
        return ref.audit(**args)

    def test_small_reference_offsets_yield_metrics_but_no_scientific_readiness(self):
        outcome=self.inspect()
        self.assertEqual(outcome['pixelCount'],6)
        self.assertTrue(outcome['allBandsWithinExploratoryLimits'])
        self.assertTrue(outcome['sourceIntegrityRecheckedBeforeAndAfter'])
        for name,item in outcome['bands'].items():
            self.assertEqual(item['comparedPixels'],5)
            self.assertEqual(item['sourceValidPixels'],5)
            self.assertEqual(item['referenceValidPixels'],5)
            self.assertEqual(item['sourceOnlyPixels'],0)
            self.assertEqual(item['referenceOnlyPixels'],0)
            self.assertAlmostEqual(item['meanSignedError'],-.01,places=5)
            self.assertAlmostEqual(item['meanAbsoluteError'],.01,places=5)
            self.assertAlmostEqual(item['rmse'],.01,places=5)
            self.assertAlmostEqual(item['p95AbsoluteError'],.01,places=5)
            self.assertEqual(item['maskIntersectionOverUnion'],1)
        for flag in ('sourceProvenanceVerified','referenceProvenanceIndependentlyVerified',
                     'radiometricCalibrationVerified','bandCoregistrationVerified',
                     'reflectanceReady','ndviReady','ndreReady',
                     'operationalUseAllowed','prescriptionExportAllowed','flightMissionAllowed'):
            self.assertIs(outcome[flag],False)
        safe=json.dumps(outcome)
        self.assertNotIn(str(self.root),safe)
        self.assertNotIn(str(self.bundle),safe)
        self.assertNotIn(self.pin,safe)

    def test_far_reference_does_not_claim_scientific_failure_or_success(self):
        self.make_reference({name:.20 for name in ref.BANDS})
        data=self.inspect()
        self.assertFalse(data['allBandsWithinExploratoryLimits'])
        for item in data['bands'].values():
            self.assertGreater(item['rmse'],.1)
            self.assertFalse(item['withinExploratoryLimits'])
        self.assertFalse(data['radiometricCalibrationVerified'])

    def test_reference_mask_mismatch_does_not_get_ignored(self):
        file=self.reference_dir/'red.tif'
        with rasterio.open(file) as ds:
            a=ds.read(1);profile=ds.profile
        a[1,1]=-9999
        with rasterio.open(file,'w',**profile) as ds:ds.write(a,1)
        self.save_manifest()
        record=self.inspect()
        self.assertEqual(record['bands']['red']['comparedPixels'],4)
        self.assertEqual(record['bands']['red']['sourceOnlyPixels'],1)
        self.assertEqual(record['bands']['red']['referenceOnlyPixels'],0)
        self.assertLess(record['bands']['red']['maskIntersectionOverUnion'],.95)
        self.assertFalse(record['allBandsWithinExploratoryLimits'])

    def test_invalid_pin_and_corrupt_file_fail_closed(self):
        with self.assertRaises(Exception):
            self.inspect(reference_manifest_sha256='0'*64)
        with (self.reference_dir/'nir.tif').open('ab') as out:out.write(b'tamper')
        with self.assertRaises(Exception):
            self.inspect()
        self.assertFalse(any(p.name.startswith('audit-') for p in self.root.iterdir()))

    def test_wrong_grid_or_dtype_is_refused(self):
        file=self.reference_dir/'green.tif'
        with rasterio.open(file) as ds:
            a=ds.read(1);profile=ds.profile
        from rasterio.transform import from_origin
        profile.update(transform=from_origin(450000.01,5400000,.05,.05))
        with rasterio.open(file,'w',**profile) as ds:ds.write(a,1)
        self.save_manifest()
        with self.assertRaises(ref.ReferenceError):
            self.inspect()

    def test_identical_reference_cannot_pass_as_independent(self):
        self.make_reference({name:0 for name in ref.BANDS})
        with self.assertRaises(ref.ReferenceError):
            self.inspect()

    def test_symlink_and_unexpected_files_rejected(self):
        file=self.reference_dir/'nir.tif'
        other=self.root/'nir-moved.tif'
        file.rename(other)
        file.symlink_to(other)
        with self.assertRaises(Exception):
            self.inspect()
        file.unlink()
        other.rename(file)
        (self.reference_dir/'unexpected.txt').write_text('data')
        with self.assertRaises(ref.ReferenceError):
            self.inspect()

    def test_fake_radiometric_or_provenance_claim_rejected_even_if_rehashed(self):
        path=self.reference_dir/'reference-manifest.json'
        raw=json.loads(path.read_text())
        for field in ('radiometricCalibrationVerified','provenanceIndependentlyVerified'):
            copy=dict(raw)
            copy[field]=True
            payload=(json.dumps(copy, sort_keys=True, separators=(',', ':'))+'\n').encode()
            path.write_bytes(payload)
            with self.assertRaises(ref.ReferenceError):
                self.inspect(reference_manifest_sha256=hashlib.sha256(payload).hexdigest())

    def test_mutation_after_sampling_detected_before_result(self):
        original=ref._check_reference
        calls=0
        def sabotage(*args):
            nonlocal calls
            calls+=1
            if calls==2:
                with (self.reference_dir/'nir.tif').open('ab') as out:
                    out.write(b'late corruption')
            return original(*args)
        with mock.patch.object(ref,'_check_reference',side_effect=sabotage):
            with self.assertRaises(Exception):
                self.inspect()
        self.assertEqual(calls,2)


if __name__ == '__main__':
    unittest.main()
