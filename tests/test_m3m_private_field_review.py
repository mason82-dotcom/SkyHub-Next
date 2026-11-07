"""P3.7 read-only field review: real synthetic TIFF and redaction regression."""
from __future__ import annotations

from contextlib import redirect_stderr, redirect_stdout
import importlib.util
import io
import json
from pathlib import Path
from unittest import mock
import unittest

ROOT = Path(__file__).resolve().parents[1]


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


worker = load('backend/workers/m3m_private_field_review.py', 'skyhub_p37_field_review')
fixture_mod = load('tests/test_m3m_radiometric_xmp_inventory.py', 'skyhub_p37_fixture')
try:
    import numpy
    import rasterio
    import tifffile
    import defusedxml
except ImportError:
    numpy = rasterio = tifffile = defusedxml = None


@unittest.skipUnless(all(x is not None for x in
                         (numpy, rasterio, tifffile, defusedxml)),
                     'Real synthetic TIFF/XMP binary wheels required')
class FieldReviewTests(unittest.TestCase):
    def setUp(self):
        f = fixture_mod.RadiometricXmpInventoryTests(
            methodName='test_complete_documented_fields_yield_presence_not_readiness')
        f.setUp()
        self.addCleanup(f.doCleanups)
        self.f = f

    def audit(self, **updates):
        return worker.review(**{**self.f.params, **updates})

    def args(self):
        result = []
        for file in self.f.f.tiffs:
            result.extend(['--tiff', str(file)])
        result.extend(['--source-receipt', str(self.f.f.source_receipt),
                       '--source-receipt-sha256', self.f.f.source_pin,
                       '--evidence-dir', str(self.f.f.evidence),
                       '--evidence-manifest-sha256', self.f.f.evidence_pin])
        return result

    def test_missing_evidence_and_xmp_remain_explicitly_incomplete(self):
        watched = (*self.f.f.tiffs, self.f.f.source_receipt,
                   self.f.f.evidence/'field-evidence-manifest.json')
        before = [(p.stat().st_size, p.stat().st_mtime_ns) for p in watched]
        report = self.audit()
        self.assertEqual(report['reviewState'],
                         'INCOMPLETE_EVIDENCE_OR_XMP_UNVALIDATED')
        self.assertEqual(report['evidenceMissing'], list(worker.KINDS))
        self.assertEqual(report['evidencePresentButUnvalidated'], [])
        self.assertTrue(all(v == 4
                            for v in report['requiredXmpFieldMissingCounts'].values()))
        self.assertTrue(report['sourceAndEvidencePinsRecheckedAfterXmp'])
        self.assertEqual(before, [(p.stat().st_size, p.stat().st_mtime_ns)
                                  for p in watched])
        for key in ('independentScienceAssessmentPerformed', 'captureFirmwareVerified',
                    'radiometricCalibrationVerified', 'panelCalibrationVerified',
                    'sunlightSensorValuesValidated', 'bandCoregistrationVerified',
                    'reflectanceReady', 'vegetationIndexReady',
                    'operationalUseAllowed', 'prescriptionExportAllowed',
                    'flightMissionAllowed'):
            self.assertIs(report[key], False)
        exposed = json.dumps(report)
        for forbidden in (str(self.f.f.root), str(self.f.f.fixture.root),
                          self.f.f.fixture.capture, self.f.f.source_pin,
                          self.f.f.evidence_pin):
            self.assertNotIn(forbidden, exposed)

    def test_full_xmp_and_operator_evidence_still_never_mean_science_ready(self):
        self.f.render(self.f.complete())
        self.f.f.add_evidence(*worker.KINDS)
        # The synthetic operator added evidence and explicitly re-pinned its
        # manifest. The test must pass that NEW independent fixture pin.
        self.f.params['evidence_manifest_sha256'] = self.f.f.evidence_pin
        report = self.audit()
        self.assertEqual(report['reviewState'], 'STRUCTURAL_FIELDS_PRESENT_UNVALIDATED')
        self.assertEqual(report['evidenceMissing'], [])
        self.assertEqual(report['evidencePresentButUnvalidated'], list(worker.KINDS))
        self.assertTrue(all(v == 0
                            for v in report['requiredXmpFieldMissingCounts'].values()))
        self.assertFalse(report['radiometricCalibrationVerified'])
        self.assertFalse(report['operationalUseAllowed'])

    def test_one_missing_xmp_marker_is_only_reported_as_count(self):
        self.f.render(self.f.complete(), inject={'R': {'Irradiance': None}})
        report = self.audit()
        self.assertEqual(report['requiredXmpFieldMissingCounts']['Irradiance'], 1)
        self.assertNotIn('2000.000', json.dumps(report))
        self.assertEqual(report['reviewState'],
                         'INCOMPLETE_EVIDENCE_OR_XMP_UNVALIDATED')

    def test_invalid_pin_and_modified_original_fail_closed(self):
        with self.assertRaises(worker.ReviewError):
            self.audit(source_receipt_sha256='0'*64)
        self.f.render(self.f.complete())
        with self.f.f.tiffs[0].open('ab') as out:
            out.write(b'changed-original')
        with self.assertRaises(worker.ReviewError):
            self.audit()

    def test_post_xmp_mutation_is_detected_at_last_preflight(self):
        self.f.render(self.f.complete())
        real = worker._inspect_xmp
        def mutate(cfg):
            output = real(cfg)
            with self.f.f.tiffs[0].open('ab') as out:
                out.write(b'late-mutated-tiff')
            return output
        with mock.patch.object(worker, '_inspect_xmp', side_effect=mutate):
            with self.assertRaises(worker.ReviewError):
                self.audit()

    def test_downstream_scientific_overclaim_fails_closed(self):
        self.f.render(self.f.complete())
        real = worker._inspect_xmp
        def lie(cfg):
            return {**real(cfg), 'radiometricCalibrationVerified': True}
        with mock.patch.object(worker, '_inspect_xmp', side_effect=lie):
            with self.assertRaises(worker.ReviewError):
                self.audit()

    def test_new_downstream_private_fields_never_cross_boundary(self):
        self.f.render(self.f.complete())
        real = worker._inspect_xmp
        def extra(cfg):
            return {**real(cfg), 'privateExif': 'SECRET_123',
                    'filePath': '/SECRET_123'}
        with mock.patch.object(worker, '_inspect_xmp', side_effect=extra):
            self.assertNotIn('SECRET_123', json.dumps(self.audit()))

    def test_cli_exit_three_means_incomplete_structure_not_approval(self):
        stdout, stderr = io.StringIO(), io.StringIO()
        with redirect_stdout(stdout), redirect_stderr(stderr):
            code = worker.main([*self.args(), '--require-complete-structure'])
        self.assertEqual(code, 3)
        self.assertEqual(stderr.getvalue(), '')
        self.assertEqual(json.loads(stdout.getvalue())['reviewState'],
                         'INCOMPLETE_EVIDENCE_OR_XMP_UNVALIDATED')

    def test_cli_refuses_missing_spectral_inputs_without_leak(self):
        args = self.args()
        second = args.index('--tiff', 1)
        del args[second:second+2]
        stdout, stderr = io.StringIO(), io.StringIO()
        with redirect_stdout(stdout), redirect_stderr(stderr):
            code = worker.main(args)
        self.assertEqual(code, 2)
        self.assertEqual(stdout.getvalue(), '')
        for sensitive in (str(self.f.f.root), self.f.f.fixture.capture,
                          self.f.f.source_pin):
            self.assertNotIn(sensitive, stderr.getvalue())


if __name__ == '__main__':
    unittest.main()
