"""P3.8: private SHA-pinned XMP report comparison, synthetic TIFF input."""
from __future__ import annotations

from contextlib import redirect_stderr, redirect_stdout
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]


def load(path, alias):
    spec = importlib.util.spec_from_file_location(alias, ROOT / path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


compare = load('backend/workers/m3m_private_xmp_cohort_compare.py',
               'skyhub_m3m_p38_compare')
cohort = load('backend/workers/m3m_private_xmp_cohort.py',
              'skyhub_m3m_p38_cohort')
fixtures = load('tests/test_m3m_private_xmp_cohort.py',
                'skyhub_m3m_p38_fixture')

try:
    import numpy
    import rasterio
    import tifffile
    import defusedxml
except ImportError:
    numpy = rasterio = tifffile = defusedxml = None


@unittest.skipUnless(all(x is not None for x in
                         (numpy, rasterio, tifffile, defusedxml)),
                     'Synthetic TIFF/XMP binary dependencies required')
class PinnedCohortComparisonTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.folder = Path(temp.name) / 'private-reports'
        self.folder.mkdir(mode=0o700)
        self.fixtures = []
        self.reports = []
        self.pins = []
        for n in range(2):
            fixture = fixtures.M3mXmpCohortTests(
                methodName='test_no_radiometry_only_original_p1_markers')
            fixture.setUp()
            self.addCleanup(fixture.doCleanups)
            self.fixtures.append(fixture)
            if n == 1:
                fixture.f.render({
                    **fixture.f.complete(),
                    'SunSensor': 'never-expose-private-sensor',
                    'VignettingPolynomial': 'private-vignetting-data',
                }, inject={'G': {'PrivateFirmwareRevision': 'secret-firmware-XY'}})
            self.persist(fixture.inspect(), self.folder/f'report-{n}.json')

    def persist(self, report, path):
        content = (json.dumps(report, sort_keys=True, allow_nan=False) + '\n').encode()
        path.write_bytes(content)
        os.chmod(path, 0o600)
        pin = hashlib.sha256(content).hexdigest()
        if path not in self.reports:
            self.reports.append(path)
            self.pins.append(pin)
        else:
            self.pins[self.reports.index(path)] = pin
        return pin

    def audit(self, **overrides):
        return compare.compare(**{
            'reports': self.reports, 'report_sha256': self.pins, **overrides})

    def test_two_real_synthetic_captures_have_bounded_difference_summary(self):
        output = self.audit()
        self.assertEqual(output['reportsCompared'], 2)
        self.assertEqual(output['distinctStructuralPatternsObserved'], 2)
        self.assertTrue(output['structuralDifferencesObserved'])
        self.assertEqual(output['canonicalRequiredMissingRangePerFourBands']['SensorGain'],
                         [0, 4])
        self.assertEqual(output['additionalManualMarkerPresenceRangePerFourBands']['SunSensor'],
                         [0, 4])
        self.assertEqual(output['reportsWithCompleteCanonicalRequiredFields'], 1)
        self.assertEqual(output['reportsContainingUnknownDjiMarkers'], 1)
        self.assertEqual(output['unknownMarkerCountRangePerOriginal'], [0, 1])
        self.assertEqual(output['reportsRequiringVignettingManualReview'], 1)
        self.assertFalse(output['firmwareVersionsVerified'])
        self.assertFalse(output['underlyingDistinctPhysicalCapturesVerified'])
        self.assertFalse(output['radiometricCalibrationVerified'])
        self.assertFalse(output['flightMissionAllowed'])
        exposed = json.dumps(output)
        for secret in ('secret-firmware-XY', 'PrivateFirmwareRevision',
                       'never-expose-private-sensor', str(self.folder),
                       *self.pins, self.fixtures[0].f.f.fixture.capture):
            self.assertNotIn(secret, exposed)

    def test_duplicate_shapes_are_not_claimed_as_distinct_firmware(self):
        report = json.loads(self.reports[0].read_text())
        self.persist(report, self.reports[1])
        output = self.audit()
        self.assertEqual(output['distinctStructuralPatternsObserved'], 1)
        self.assertFalse(output['structuralDifferencesObserved'])
        self.assertFalse(output['underlyingDistinctPhysicalCapturesVerified'])

    def test_reordering_four_inputs_does_not_fabricate_a_new_shape(self):
        report = json.loads(self.reports[0].read_text())
        report['unknownDjiNamespaceMarkerCountsByInputOrder'].reverse()
        report['documentedMarkerCountsByInputOrder'].reverse()
        self.persist(report, self.reports[1])
        self.assertEqual(self.audit()['distinctStructuralPatternsObserved'], 1)

    def test_bad_pin_or_changed_report_rejected(self):
        with self.assertRaises(compare.ComparisonError):
            self.audit(report_sha256=[self.pins[0], '0'*64])
        with self.reports[0].open('ab') as stream:
            stream.write(b'late alteration')
        with self.assertRaises(compare.ComparisonError):
            self.audit()

    def test_repin_does_not_allow_scientific_overclaim(self):
        content = json.loads(self.reports[1].read_text())
        content['radiometricCalibrationVerified'] = True
        self.persist(content, self.reports[1])
        with self.assertRaises(compare.ComparisonError):
            self.audit()

    def test_repin_does_not_allow_sensitive_extra_output_fields(self):
        content = json.loads(self.reports[1].read_text())
        content['privateCameraSerial'] = 'SECRET_SERIAL'
        self.persist(content, self.reports[1])
        with self.assertRaises(compare.ComparisonError):
            self.audit()

    def test_repin_does_not_allow_inconsistent_counts(self):
        content = json.loads(self.reports[1].read_text())
        content['canonicalRequiredFieldMissingCounts']['SensorGain'] = 4
        self.persist(content, self.reports[1])
        with self.assertRaises(compare.ComparisonError):
            self.audit()

    def test_repin_does_not_allow_impossible_overlap(self):
        content = json.loads(self.reports[1].read_text())
        content['canonicalVignettingAndPolynomialCooccurCount'] = 5
        self.persist(content, self.reports[1])
        with self.assertRaises(compare.ComparisonError):
            self.audit()

    def test_duplicate_json_keys_and_noncanonical_json_rejected_even_with_pin(self):
        content = self.reports[0].read_bytes()
        noncanonical = json.dumps(json.loads(content), indent=2).encode()
        self.reports[0].write_bytes(noncanonical)
        self.pins[0] = hashlib.sha256(noncanonical).hexdigest()
        with self.assertRaises(compare.ComparisonError):
            self.audit()
        duplicated = b'{"schema":"fake","schema":"fake"}\n'
        self.reports[0].write_bytes(duplicated)
        self.pins[0] = hashlib.sha256(duplicated).hexdigest()
        with self.assertRaises(compare.ComparisonError):
            self.audit()

    def test_world_readable_directory_or_file_refused(self):
        os.chmod(self.folder, 0o755)
        with self.assertRaises(compare.ComparisonError):
            self.audit()
        os.chmod(self.folder, 0o700)
        os.chmod(self.reports[0], 0o644)
        with self.assertRaises(compare.ComparisonError):
            self.audit()

    def test_nested_symlink_ancestor_refused(self):
        alias = self.folder.parent / 'private-alias'
        alias.symlink_to(self.folder, target_is_directory=True)
        paths = [alias/self.reports[0].name, self.reports[1]]
        with self.assertRaises(compare.ComparisonError):
            self.audit(reports=paths)

    def test_modified_between_two_validation_passes_refused(self):
        original = compare._private_report
        reads = 0
        def mutate(path, pin):
            nonlocal reads
            result = original(path, pin)
            reads += 1
            if reads == 2:
                with self.reports[0].open('ab') as file:
                    file.write(b'delayed-mutation')
            return result
        with mock.patch.object(compare, '_private_report', side_effect=mutate):
            with self.assertRaises(compare.ComparisonError):
                self.audit()

    def test_cli_uniform_exit_three_and_invalid_failure_are_private(self):
        args = []
        for path in self.reports:
            args.extend(['--report', str(path)])
        for pin in self.pins:
            args.extend(['--report-sha256', pin])
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            status = compare.main([*args, '--require-uniform'])
        self.assertEqual(status, 3)
        self.assertEqual(err.getvalue(), '')
        self.assertTrue(json.loads(out.getvalue())['structuralDifferencesObserved'])
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            status = compare.main([*args, '--report-sha256', '0'*64])
        self.assertEqual(status, 2)
        self.assertEqual(out.getvalue(), '')
        for private in (str(self.folder), *self.pins):
            self.assertNotIn(private, err.getvalue())

    def test_limits_prevent_single_report_reuse_and_unbounded_batches(self):
        with self.assertRaises(compare.ComparisonError):
            self.audit(reports=self.reports[:1], report_sha256=self.pins[:1])
        with self.assertRaises(compare.ComparisonError):
            self.audit(reports=[self.reports[0], self.reports[0]])
        with self.assertRaises(compare.ComparisonError):
            self.audit(reports=self.reports*5, report_sha256=self.pins*5)


if __name__ == '__main__':
    unittest.main()
