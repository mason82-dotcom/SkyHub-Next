"""P3.9: real synthetic original TIFF/XMP pairs linked to operator declarations."""
from __future__ import annotations

from contextlib import redirect_stdout, redirect_stderr
import hashlib
import importlib.util
import io
import json
from pathlib import Path
from unittest import mock
import unittest

ROOT = Path(__file__).resolve().parents[1]


def load(path, label):
    spec = importlib.util.spec_from_file_location(label, ROOT / path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


worker = load('backend/workers/m3m_private_capture_pair_linkage.py', 'm3m_p39_link')
matrix_fixture = load('tests/test_m3m_private_firmware_cohort_matrix.py', 'm3m_p39_matrix_fixture')
pair_fixture = load('tests/test_m3m_private_field_pairing_qa.py', 'm3m_p39_pair_fixture')

try:
    import numpy
    import rasterio
    import tifffile
    import defusedxml
except ImportError:
    numpy = rasterio = tifffile = defusedxml = None


@unittest.skipUnless(all(v is not None for v in
                         (numpy, rasterio, tifffile, defusedxml)),
                     'Binary TIFF/XMP offline dependencies needed')
class P39OriginalPairLinkageTests(unittest.TestCase):
    def setUp(self):
        self.matrix = matrix_fixture.M3mPrivateFirmwareCohortMatrixTests(
            methodName='test_two_independent_cohorts_aggregate_without_readiness')
        self.matrix.setUp()
        self.addCleanup(self.matrix.doCleanups)
        self.plan = pair_fixture.PrivateFieldPairingTests(
            methodName='test_valid_pair_counts_imbalances_without_scientific_readiness')
        self.plan.setUp()
        self.addCleanup(self.plan.doCleanups)
        for label, case in zip(('A', 'B'), self.matrix.items):
            side = self.plan.plan['pairs'][0][label]
            side['sourceReceiptSha256'] = case['sourceReceiptSha256']
            side['firmwareEvidenceSha256'] = case['firmwareEvidenceSha256']
            side['dlsEvidenceSha256'] = None
            side['panelEvidenceSha256'] = None
        self.matrix.save()
        self.plan.save()

    def audit(self, **overrides):
        return worker.inspect(**{
            'cohort_manifest': self.matrix.manifest,
            'cohort_manifest_sha256': self.matrix.pin,
            'pair_plan': self.plan.file,
            'pair_plan_sha256': self.plan.pin,
            **overrides,
        })

    def args(self):
        return [
            '--cohort-manifest', str(self.matrix.manifest),
            '--cohort-manifest-sha256', self.matrix.pin,
            '--pair-plan', str(self.plan.file),
            '--pair-plan-sha256', self.plan.pin,
        ]

    def fill_evidence(self):
        for label, case, sample in zip(('A', 'B'), self.matrix.items,
                                       self.matrix.samples):
            sample.f.add_evidence('sunlightSensor', 'panelImage')
            case['evidenceManifestSha256'] = sample.f.evidence_pin
            payload = json.loads(
                (sample.f.evidence / 'field-evidence-manifest.json').read_bytes())
            items = {x['kind']: x for x in payload['assets']}
            self.plan.plan['pairs'][0][label]['dlsEvidenceSha256'] = (
                items['sunlightSensor']['sha256'])
            self.plan.plan['pairs'][0][label]['panelEvidenceSha256'] = (
                items['panelImage']['sha256'])
        self.plan.plan['pairs'][0]['B']['irradianceMilli'] = 9600
        self.matrix.save()
        self.plan.save()

    def test_real_synthetic_source_captures_bind_without_science_approval(self):
        report = self.audit()
        self.assertEqual(report['verifiedOriginalCaptureCount'], 2)
        self.assertEqual(report['operatorDeclaredPairsBoundToOriginals'], 1)
        self.assertEqual(report['pairsWithAllOperatorValuesDeclared'], 1)
        self.assertEqual(report['pairsMeetingOperatorTolerances'], 0)
        self.assertEqual(report['pairsWithoutDlsDeclaration'], 1)
        self.assertEqual(report['pairsWithoutPanelImageDeclaration'], 1)
        self.assertTrue(report['allCaptureAndPlanPinsRecheckedAfterLinkage'])
        self.assertFalse(report['operatorPlanCompletenessOnly'])
        for flag in worker.FALSE_FLAGS:
            self.assertIs(report[flag], False)
        rendered=json.dumps(report)
        for private in (
            str(self.matrix.root), str(self.plan.root),
            self.matrix.pin, self.plan.pin,
            self.matrix.items[0]['sourceReceiptSha256'],
            self.matrix.items[0]['firmwareEvidenceSha256'],
        ):
            self.assertNotIn(private, rendered)

    def test_fully_present_evidence_and_matched_operator_values_is_still_unvalidated(self):
        self.fill_evidence()
        report=self.audit()
        self.assertTrue(report['bindingCoverageComplete'])
        self.assertTrue(report['operatorPlanCompletenessOnly'])
        self.assertEqual(report['pairsWithoutPanelImageDeclaration'],0)
        self.assertEqual(report['pairsWithoutDlsDeclaration'],0)
        self.assertFalse(report['manufacturerFirmwareAttested'])
        self.assertFalse(report['dlsMeasurementsVerified'])
        self.assertFalse(report['radiometricCalibrationVerified'])
        self.assertFalse(report['flightMissionAllowed'])

    def test_forged_source_receipt_pin_refused_even_when_rehashed(self):
        self.plan.plan['pairs'][0]['A']['sourceReceiptSha256'] = 'a' * 64
        self.plan.save()
        with self.assertRaises(worker.LinkageError):
            self.audit()

    def test_firmware_claim_must_match_independently_pinned_capture(self):
        self.plan.plan['pairs'][0]['B']['firmwareEvidenceSha256']='b'*64
        self.plan.save()
        with self.assertRaises(worker.LinkageError):
            self.audit()

    def test_missing_or_fake_evidence_hashes_are_not_accepted_as_present(self):
        self.plan.plan['pairs'][0]['B']['dlsEvidenceSha256'] = 'c'*64
        self.plan.save()
        with self.assertRaises(worker.LinkageError):
            self.audit()
        self.fill_evidence()
        self.plan.plan['pairs'][0]['A']['panelEvidenceSha256']='d'*64
        self.plan.save()
        with self.assertRaises(worker.LinkageError):
            self.audit()

    def test_real_pinned_panel_omitted_from_plan_is_refused(self):
        self.fill_evidence()
        self.plan.plan['pairs'][0]['A']['panelEvidenceSha256']=None
        self.plan.save()
        with self.assertRaises(worker.LinkageError):
            self.audit()

    def test_one_sided_real_field_evidence_remains_incomplete(self):
        sample = self.matrix.samples[0]
        sample.f.add_evidence('sunlightSensor', 'panelImage')
        self.matrix.items[0]['evidenceManifestSha256'] = sample.f.evidence_pin
        items = json.loads(
            (sample.f.evidence / 'field-evidence-manifest.json').read_bytes())
        assets = {item['kind']: item for item in items['assets']}
        side = self.plan.plan['pairs'][0]['A']
        side['dlsEvidenceSha256'] = assets['sunlightSensor']['sha256']
        side['panelEvidenceSha256'] = assets['panelImage']['sha256']
        self.matrix.save()
        self.plan.save()
        result = self.audit()
        self.assertEqual(result['pairsWithoutDlsDeclaration'], 1)
        self.assertEqual(result['pairsWithoutPanelImageDeclaration'], 1)
        self.assertFalse(result['operatorPlanCompletenessOnly'])
        self.assertFalse(result['dlsMeasurementsVerified'])

    def test_mutated_real_dls_asset_is_not_a_valid_hash_declaration(self):
        self.fill_evidence()
        path = self.matrix.samples[0].f.evidence / 'sunlight-sensor-evidence.bin'
        with path.open('ab') as stream:
            stream.write(b'after-pin')
        with self.assertRaises(worker.LinkageError):
            self.audit()

    def test_repeated_pair_cannot_reuse_original_capture(self):
        self.plan.plan['pairs'].append({
            cohort: dict(self.plan.plan['pairs'][0][cohort])
            for cohort in ('A', 'B')
        })
        self.plan.save()
        with self.assertRaises(worker.LinkageError):
            self.audit()

    def test_aliased_evidence_directory_cannot_rebind_capture(self):
        alias = self.plan.root / 'aliased-evidence'
        alias.symlink_to(self.matrix.samples[0].f.evidence, target_is_directory=True)
        self.matrix.items[0]['evidenceDir'] = str(alias)
        self.matrix.save()
        with self.assertRaises(worker.LinkageError):
            self.audit()

    def test_swapped_capture_pair_membership_refused(self):
        pair=self.plan.plan['pairs'][0]
        pair['A']['sourceReceiptSha256'],pair['B']['sourceReceiptSha256']=(
            pair['B']['sourceReceiptSha256'],pair['A']['sourceReceiptSha256'])
        self.plan.save()
        with self.assertRaises(worker.LinkageError):
            self.audit()

    def test_noncanonical_or_modified_manifest_refused_without_raw_exception(self):
        with self.assertRaises(worker.LinkageError):
            self.audit(cohort_manifest_sha256='0'*64)
        with self.plan.file.open('ab') as f:
            f.write(b'changed')
        with self.assertRaises(worker.LinkageError):
            self.audit()

    def test_post_linkage_private_manifest_mutation_refused(self):
        true_asset = worker._asset_pin
        modified = False
        def mutate(*args, **kwargs):
            nonlocal modified
            value = true_asset(*args, **kwargs)
            if not modified:
                with self.plan.file.open('ab') as f:
                    f.write(b'late')
                modified = True
            return value
        with mock.patch.object(worker, '_asset_pin', side_effect=mutate):
            with self.assertRaises(worker.LinkageError):
                self.audit()
        self.assertTrue(modified)

    def test_cli_strict_mode_distinguishes_unvalidated_completeness(self):
        stdout, stderr = io.StringIO(), io.StringIO()
        with redirect_stdout(stdout), redirect_stderr(stderr):
            status = worker.main([*self.args(), '--require-complete-operator-plan'])
        self.assertEqual(status, 3)
        self.assertFalse(json.loads(stdout.getvalue())['operatorPlanCompletenessOnly'])
        self.fill_evidence()
        stdout=io.StringIO()
        with redirect_stdout(stdout):
            status = worker.main([*self.args(), '--require-complete-operator-plan'])
        self.assertEqual(status, 0)
        self.assertFalse(json.loads(stdout.getvalue())['flightMissionAllowed'])

    def test_cli_invalid_inputs_do_not_leak_private_paths_or_pins(self):
        argv=self.args()
        argv[3]='0'*64
        out,err=io.StringIO(),io.StringIO()
        with redirect_stdout(out),redirect_stderr(err):
            status=worker.main(argv)
        self.assertEqual(status, 2)
        self.assertEqual(out.getvalue(), '')
        self.assertNotIn(str(self.matrix.root), err.getvalue())
        self.assertNotIn(self.matrix.pin, err.getvalue())


if __name__ == '__main__':
    unittest.main()
