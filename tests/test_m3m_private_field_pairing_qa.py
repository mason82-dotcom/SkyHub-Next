"""P3.6e synthetic operator pairing-screen tests; no actual DJI evidence."""
from __future__ import annotations

import copy
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
spec = importlib.util.spec_from_file_location(
    'm3m_private_field_pairing_qa',
    ROOT / 'backend/workers/m3m_private_field_pairing_qa.py')
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)

def pin(text):
    return hashlib.sha256(text.encode('utf-8')).hexdigest()

def side(code, fw, *, missing=False):
    return {
        'sourceReceiptSha256': pin('capture-'+code),
        'firmwareEvidenceSha256': pin('firmware-operator-note-'+fw),
        'dlsEvidenceSha256': None if missing else pin('dls-'+code),
        'panelEvidenceSha256': None if missing else pin('panel-'+code),
        'exposureUs': 1000,
        'sensorGainMilli': 1000,
        'irradianceMilli': 10000,
        'flightHeightCm': 10000,
        'captureTimeSeconds': 1700000000,
    }


class PrivateFieldPairingTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.file = self.root / 'private-plan.json'
        a, b = side('A1', 'A'), side('B1', 'B')
        b['exposureUs'] = 1050
        b['irradianceMilli'] = 9000  # Outside 10% of pairwise mean.
        b['flightHeightCm'] = 10040
        b['captureTimeSeconds'] += 120
        self.plan = {
            'schema': worker.SCHEMA,
            'tolerances': {
                'exposureUsPctMax':10,
                'sensorGainMilliPctMax':10,
                'irradianceMilliPctMax':10,
                'flightHeightCmPctMax':5,
                'captureTimeSecondsMax':180,
            },
            'pairs':[{'A':a, 'B':b}],
        }
        self.save()

    def save(self):
        raw=worker._canonical(self.plan)
        self.file.write_bytes(raw)
        self.file.chmod(0o600)
        self.pin=hashlib.sha256(raw).hexdigest()

    def run_audit(self, **overrides):
        return worker.inspect(**{'plan':self.file, 'plan_sha256':self.pin,
                                 **overrides})

    def test_valid_pair_counts_imbalances_without_scientific_readiness(self):
        r=self.run_audit()
        self.assertEqual(r['pairedCaptureCount'], 1)
        self.assertEqual(r['operatorCovariateComparisonCounts']['irradianceMilli'],
                         {'matched':0, 'mismatched':1, 'unmeasured':0})
        self.assertEqual(r['operatorCovariateComparisonCounts']['exposureUs'],
                         {'matched':1, 'mismatched':0, 'unmeasured':0})
        self.assertEqual(r['pairsWithAllCovariatesDeclared'],1)
        self.assertEqual(r['pairsMatchingAllOperatorTolerances'],0)
        self.assertTrue(r['operatorMeasurementsAreClaimsOnly'])
        self.assertFalse(r['rawCovariatesOrPinsReleased'])
        for flag in worker.FALSE_FLAGS:
            self.assertIs(r[flag],False)
        output=json.dumps(r)
        for private in (str(self.file),self.pin,
                        self.plan['pairs'][0]['A']['sourceReceiptSha256'],
                        '1700000000', '10000'):
            self.assertNotIn(private, output)

    def test_all_operator_thresholds_met_is_still_not_scientific_approval(self):
        self.plan['pairs'][0]['B']['irradianceMilli']=9600
        self.save()
        r=self.run_audit()
        self.assertEqual(r['pairsMatchingAllOperatorTolerances'],1)
        self.assertFalse(r['scienceReady'])
        self.assertFalse(r['operatorTolerancesProspectivelyRegistered'])

    def test_unmeasured_value_is_not_mistaken_for_match(self):
        self.plan['pairs'][0]['B']['irradianceMilli']=None
        self.save()
        r=self.run_audit()
        self.assertEqual(r['operatorCovariateComparisonCounts']['irradianceMilli'],
                         {'matched':0,'mismatched':0,'unmeasured':1})
        self.assertEqual(r['pairsWithAllCovariatesDeclared'],0)
        self.assertEqual(r['pairsMatchingAllOperatorTolerances'],0)

    def test_missing_panel_or_dls_is_reported_as_an_unvalidated_declaration(self):
        self.plan['pairs'][0]['A']['panelEvidenceSha256']=None
        self.plan['pairs'][0]['B']['dlsEvidenceSha256']=None
        self.save()
        r=self.run_audit()
        self.assertEqual(r['pairsMissingPanelEvidenceDeclaration'],1)
        self.assertEqual(r['pairsMissingDlsEvidenceDeclaration'],1)
        self.assertFalse(r['panelCalibrationVerified'])
        self.assertFalse(r['sunlightSensorValuesValidated'])

    def test_source_receipt_reuse_across_pair_sides_is_refused(self):
        p=self.plan['pairs'][0]
        p['B']['sourceReceiptSha256']=p['A']['sourceReceiptSha256']
        self.save()
        with self.assertRaises(worker.PairingError):self.run_audit()

    def test_reused_source_digest_across_two_pairs_is_refused(self):
        second=copy.deepcopy(self.plan['pairs'][0])
        second['B']['sourceReceiptSha256']=pin('new-B2')
        self.plan['pairs'].append(second)
        self.save()
        with self.assertRaises(worker.PairingError):self.run_audit()

    def test_same_firmware_pin_across_cohorts_is_refused(self):
        p=self.plan['pairs'][0]
        p['B']['firmwareEvidenceSha256']=p['A']['firmwareEvidenceSha256']
        self.save()
        with self.assertRaises(worker.PairingError):self.run_audit()

    def test_multiple_firmware_evidence_pins_within_same_cohort_refused(self):
        second={'A':side('A2','new-other-firmware'),
                'B':side('B2','B')}
        self.plan['pairs'].append(second)
        self.save()
        with self.assertRaises(worker.PairingError):self.run_audit()

    def test_second_pair_with_same_firmware_claims_is_supported(self):
        second={'A':side('A2','A'), 'B':side('B2','B')}
        self.plan['pairs'].append(second)
        self.save()
        r=self.run_audit()
        self.assertEqual(r['pairedCaptureCount'],2)
        self.assertEqual(r['operatorCovariateComparisonCounts']['exposureUs']['matched'],2)

    def test_bad_external_sha256_and_tampered_manifest_refused(self):
        with self.assertRaises(worker.PairingError):
            self.run_audit(plan_sha256='0'*64)
        with self.file.open('ab') as f:f.write(b' ')
        with self.assertRaises(worker.PairingError):self.run_audit()

    def test_noncanonical_json_rejected_even_with_correct_hash(self):
        raw=json.dumps(self.plan,indent=3).encode()
        self.file.write_bytes(raw)
        with self.assertRaises(worker.PairingError):
            self.run_audit(plan_sha256=hashlib.sha256(raw).hexdigest())

    def test_duplicate_json_fields_and_unknown_flags_refused(self):
        raw=self.file.read_bytes().replace(b'"pairs":',b'"pairs":[],"pairs":',1)
        self.file.write_bytes(raw)
        with self.assertRaises(worker.PairingError):
            self.run_audit(plan_sha256=hashlib.sha256(raw).hexdigest())
        self.plan['scienceReady']=True
        self.save()
        with self.assertRaises(worker.PairingError):self.run_audit()

    def test_public_permissions_or_symlink_input_refused(self):
        self.file.chmod(0o644)
        with self.assertRaises(worker.PairingError):self.run_audit()
        self.file.chmod(0o600)
        alias=self.root/'alias.json'
        alias.symlink_to(self.file)
        with self.assertRaises(worker.PairingError):
            self.run_audit(plan=alias)

    def test_parent_directory_symlink_refused(self):
        alias=self.root/'linked'
        alias.symlink_to(self.root,target_is_directory=True)
        with self.assertRaises(worker.PairingError):
            self.run_audit(plan=alias/'private-plan.json')

    def test_boolean_and_out_of_range_operator_numbers_refused(self):
        self.plan['pairs'][0]['A']['exposureUs']=True
        self.save()
        with self.assertRaises(worker.PairingError):self.run_audit()
        self.plan['pairs'][0]['A']['exposureUs']=0
        self.save()
        with self.assertRaises(worker.PairingError):self.run_audit()
        self.plan['pairs'][0]['A']['exposureUs']=1000
        self.plan['tolerances']['exposureUsPctMax']=101
        self.save()
        with self.assertRaises(worker.PairingError):self.run_audit()

    def test_late_manifest_mutation_detected(self):
        original=worker._compare_numeric
        calls=0
        def mutate(*args,**kwargs):
            nonlocal calls
            calls += 1
            if calls==1:
                with self.file.open('ab') as f:f.write(b'late-edit')
            return original(*args,**kwargs)
        with mock.patch.object(worker,'_compare_numeric',side_effect=mutate):
            with self.assertRaises(worker.PairingError):self.run_audit()
        self.assertGreaterEqual(calls,1)

    def test_cli_failure_does_not_leak_path_or_pins(self):
        err=io.StringIO()
        with redirect_stderr(err):
            code=worker.main(['--plan',str(self.file),'--plan-sha256','0'*64])
        self.assertEqual(code,2)
        self.assertNotIn(str(self.file),err.getvalue())
        self.assertNotIn(self.pin,err.getvalue())


if __name__=='__main__':
    unittest.main()
