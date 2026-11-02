"""P3.6f: true synthetic four-TIFF paired-source evidence-binding tests."""
from __future__ import annotations

import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from contextlib import redirect_stderr
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]

def load(path, alias):
    spec = importlib.util.spec_from_file_location(alias, ROOT/path)
    item = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(item)
    return item

worker = load('backend/workers/m3m_private_paired_source_binding.py', 'p36f_binding')
dfixture = load('tests/test_m3m_private_firmware_cohort_matrix.py', 'p36f_dfixture')
efield = load('backend/workers/m3m_private_field_pairing_qa.py', 'p36f_efield')

try:
    import numpy
    import rasterio
    import tifffile
    import defusedxml
except ImportError:
    numpy = rasterio = tifffile = defusedxml = None


@unittest.skipUnless(numpy is not None and rasterio is not None and
                     tifffile is not None and defusedxml is not None,
                     'Requires TIFF/XMP test dependencies')
class M3mPrivatePairedSourceBindingTests(unittest.TestCase):
    def setUp(self):
        fixture = dfixture.M3mPrivateFirmwareCohortMatrixTests(
            methodName='test_two_independent_cohorts_aggregate_without_readiness')
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        self.f = fixture
        t = tempfile.TemporaryDirectory()
        self.addCleanup(t.cleanup)
        self.root = Path(t.name)
        self.plan_file = self.root/'private-field-pairing.json'
        self.pair = {'A':self._side(fixture.items[0]),
                     'B':self._side(fixture.items[1])}
        self.pair['B']['exposureUs'] = 1050
        self.pair['B']['irradianceMilli'] = 9000
        self.plan = {
            'schema': efield.SCHEMA,
            'tolerances':{
                'exposureUsPctMax':10,
                'sensorGainMilliPctMax':10,
                'irradianceMilliPctMax':10,
                'flightHeightCmPctMax':5,
                'captureTimeSecondsMax':120,
            },
            'pairs':[self.pair],
        }
        self.save()

    @staticmethod
    def _side(item):
        return {
            'sourceReceiptSha256': item['sourceReceiptSha256'],
            'firmwareEvidenceSha256': item['firmwareEvidenceSha256'],
            'dlsEvidenceSha256': None,
            'panelEvidenceSha256': None,
            'exposureUs':1000,
            'sensorGainMilli':1000,
            'irradianceMilli':10000,
            'flightHeightCm':10000,
            'captureTimeSeconds':1700000000,
        }

    def save(self):
        raw=efield._canonical(self.plan)
        self.plan_file.write_bytes(raw)
        self.plan_file.chmod(0o600)
        self.plan_pin=hashlib.sha256(raw).hexdigest()

    def inspect(self, **kwargs):
        return worker.bind(**{
            'cohort_manifest': self.f.manifest,
            'cohort_manifest_sha256':self.f.pin,
            'pairing_plan':self.plan_file,
            'pairing_plan_sha256':self.plan_pin,
            **kwargs,
        })

    def add_assets(self, index, *kinds):
        sample=self.f.samples[index]
        sample.f.add_evidence(*kinds)
        self.f.items[index]['evidenceManifestSha256']=sample.f.evidence_pin
        if 'sunlightSensor' in kinds:
            self.pair['AB'[index]]['dlsEvidenceSha256']=hashlib.sha256(
                (sample.f.evidence/'sunlight-sensor-evidence.bin').read_bytes()).hexdigest()
        if 'panelImage' in kinds:
            self.pair['AB'[index]]['panelEvidenceSha256']=hashlib.sha256(
                (sample.f.evidence/'panel-image-evidence.bin').read_bytes()).hexdigest()
        self.f.save()
        self.save()

    def test_two_original_capture_cohorts_replayed_without_science_claim(self):
        result=self.inspect()
        self.assertEqual(result['matchedAnonymizedPairedCaptures'],1)
        self.assertEqual(result['originalTiffsReplayed'],8)
        self.assertEqual(result['pairsWithPinnedSunlightSensorFileOnBothSides'],0)
        self.assertEqual(result['pairsWithPinnedPanelImageFileOnBothSides'],0)
        self.assertTrue(result['fullP36dAndP36eReplaysSucceeded'])
        self.assertTrue(result['sourceReceiptAndFirmwareEvidenceHashesCrossMatched'])
        self.assertTrue(result['dlsAndPanelEvidenceHashesMatchedRealPrivateFiles'])
        for flag in worker.FALSE_FLAGS:
            self.assertIs(result[flag],False)
        report=json.dumps(result)
        for secret in (self.f.pin,self.plan_pin,
                       self.pair['A']['sourceReceiptSha256'],
                       self.pair['B']['firmwareEvidenceSha256'],
                       str(self.root),str(self.f.root),
                       self.f.samples[0].f.fixture.capture,
                       '1700000000','10000'):
            self.assertNotIn(secret,report)

    def test_real_pinned_dls_and_panel_bytes_on_both_sides(self):
        self.add_assets(0,'sunlightSensor','panelImage')
        self.add_assets(1,'sunlightSensor','panelImage')
        out=self.inspect()
        self.assertEqual(out['pairsWithPinnedSunlightSensorFileOnBothSides'],1)
        self.assertEqual(out['pairsWithPinnedPanelImageFileOnBothSides'],1)
        self.assertFalse(out['sunlightSensorValuesValidated'])
        self.assertFalse(out['panelCalibrationVerified'])

    def test_one_sided_pinned_panel_and_dls_does_not_claim_full_pair(self):
        self.add_assets(0,'sunlightSensor','panelImage')
        out=self.inspect()
        self.assertEqual(out['pairsWithPinnedSunlightSensorFileOnBothSides'],0)
        self.assertEqual(out['pairsWithPinnedPanelImageFileOnBothSides'],0)

    def test_fake_dls_or_panel_sha_is_rejected(self):
        self.pair['A']['dlsEvidenceSha256']='1'*64
        self.save()
        with self.assertRaises(worker.BindingError):
            self.inspect()
        self.pair['A']['dlsEvidenceSha256']=None
        self.pair['A']['panelEvidenceSha256']='2'*64
        self.save()
        with self.assertRaises(worker.BindingError):
            self.inspect()

    def test_absent_operator_declaration_for_actual_panel_is_rejected(self):
        sample=self.f.samples[0]
        sample.f.add_evidence('panelImage')
        self.f.items[0]['evidenceManifestSha256']=sample.f.evidence_pin
        self.f.save()
        with self.assertRaises(worker.BindingError):
            self.inspect()

    def test_wrong_source_hash_even_when_both_upstream_inputs_are_individually_valid(self):
        self.pair['A']['sourceReceiptSha256']='a'*64
        self.save()
        with self.assertRaises(worker.BindingError):
            self.inspect()

    def test_swapping_paired_capture_cohorts_is_refused(self):
        self.plan['pairs'][0]={'A':self.pair['B'],'B':self.pair['A']}
        self.save()
        with self.assertRaises(worker.BindingError):
            self.inspect()

    def test_wrong_cohort_firmware_evidence_refused(self):
        self.pair['A']['firmwareEvidenceSha256']='0'*64
        self.save()
        with self.assertRaises(worker.BindingError):
            self.inspect()

    def test_extra_paired_trial_with_no_original_capture_refused(self):
        self.plan['pairs'].append(self.plan['pairs'][0])
        self.save()
        with self.assertRaises(worker.BindingError):
            self.inspect()

    def test_independently_pinned_cohort_manifest_mismatch_refused(self):
        with self.assertRaises(worker.BindingError):
            self.inspect(cohort_manifest_sha256='0'*64)

    def test_independently_pinned_pair_plan_mismatch_refused(self):
        with self.assertRaises(worker.BindingError):
            self.inspect(pairing_plan_sha256='0'*64)

    def test_original_tiff_modified_after_source_receipt_refused(self):
        with self.f.samples[0].f.tiffs[0].open('ab') as f:
            f.write(b'mutated')
        with self.assertRaises(worker.BindingError):
            self.inspect()

    def test_tampered_real_dls_asset_fails_pinned_evidence_validation(self):
        self.add_assets(0,'sunlightSensor')
        with (self.f.samples[0].f.evidence/'sunlight-sensor-evidence.bin').open('ab') as f:
            f.write(b'tampered')
        with self.assertRaises(worker.BindingError):
            self.inspect()

    def test_late_private_plan_change_rejected_during_full_replay(self):
        original=worker._actual_evidence
        called=0
        def modified(*args,**kwargs):
            nonlocal called
            out=original(*args,**kwargs)
            called+=1
            if called==1:
                with self.plan_file.open('ab') as f:
                    f.write(b'after-pin')
            return out
        with mock.patch.object(worker,'_actual_evidence',side_effect=modified):
            with self.assertRaises(worker.BindingError):
                self.inspect()

    def test_parent_symlink_in_evidence_dir_is_refused(self):
        alias=self.root/'linked'
        alias.symlink_to(self.f.samples[0].f.evidence,target_is_directory=True)
        self.f.items[0]['evidenceDir']=str(alias)
        self.f.save()
        with self.assertRaises(worker.BindingError):
            self.inspect()

    def test_cli_rejection_does_not_publish_paths_or_hashes(self):
        output=io.StringIO()
        with redirect_stderr(output):
            exit_code=worker.main([
                '--cohort-manifest',str(self.f.manifest),
                '--cohort-manifest-sha256','0'*64,
                '--pairing-plan',str(self.plan_file),
                '--pairing-plan-sha256',self.plan_pin])
        self.assertEqual(exit_code,2)
        self.assertNotIn(str(self.root),output.getvalue())
        self.assertNotIn(self.plan_pin,output.getvalue())
        self.assertNotIn(self.pair['A']['sourceReceiptSha256'],output.getvalue())

if __name__ == '__main__':
    unittest.main()
