"""P3.5b: independently pinned reproducible private reference-result receipt tests."""
from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]


def load(rel, alias):
    spec = importlib.util.spec_from_file_location(alias, ROOT / rel)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


receipt = load('backend/workers/m3m_private_reference_receipt.py', 'm3m_receipt_fixture')
agreement_tests = load('tests/test_m3m_private_reference_agreement.py',
                       'm3m_receipt_agreement_tests')

try:
    import numpy
    import rasterio
except ImportError:
    numpy = rasterio = None


@unittest.skipUnless(numpy is not None and rasterio is not None,
                     'Requires NumPy and rasterio offline wheels')
class ReferenceReceiptTests(unittest.TestCase):
    def setUp(self):
        f = agreement_tests.M3mReferenceAgreementTests(
            methodName='test_small_reference_offsets_yield_metrics_but_no_scientific_readiness')
        f.setUp()
        self.addCleanup(f.doCleanups)
        self.fixture = f
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.private = Path(temp.name) / 'receipts'
        self.private.mkdir(mode=0o700)
        self.target = self.private / 'agreement-receipt.json'
        self.common = {
            'bundle': f.bundle,
            'seal': f.seal,
            'seal_sha256': f.pin,
            'reference_dir': f.reference_dir,
            'reference_manifest_sha256': f.reference_pin,
        }

    def create(self, **updates):
        params = {**self.common, 'output_file': self.target,
                  'private_output_ok': True, **updates}
        return receipt.create(**params)

    def verify(self, digest, **updates):
        params = {**self.common, 'receipt_file': self.target,
                  'receipt_sha256': digest, **updates}
        return receipt.verify(**params)

    def test_create_private_canonical_receipt_and_replay_all_metrics(self):
        created = self.create()
        self.assertFalse(created['freshIndependentReplayMatched'])
        self.assertEqual(created['comparedBandCount'], 4)
        self.assertTrue(created['allBandsWithinExploratoryLimits'])
        self.assertFalse(created['radiometricCalibrationVerified'])
        self.assertFalse(created['operationalUseAllowed'])
        self.assertEqual(self.target.stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.private.stat().st_mode & 0o777, 0o700)
        data = self.target.read_bytes()
        self.assertEqual(hashlib.sha256(data).hexdigest(), created['receiptSha256'])
        report = json.loads(data)
        self.assertEqual(report['schema'], receipt.SCHEMA)
        self.assertEqual(report['sourceBundleSealSha256'], self.fixture.pin)
        self.assertEqual(report['referenceManifestSha256'], self.fixture.reference_pin)
        self.assertEqual(set(report['implementation']['workerSha256']),
                         set(receipt.CODE_FILES))
        self.assertFalse(report['cryptographicallySigned'])
        self.assertEqual(report['referenceAgreement']['pixelCount'], 6)
        self.assertNotIn(str(self.fixture.root), str(report))
        self.assertNotIn(str(self.fixture.bundle), str(report))
        self.assertNotIn(str(self.target), str(report))
        checked = self.verify(created['receiptSha256'])
        self.assertTrue(checked['freshIndependentReplayMatched'])
        self.assertEqual(checked['receiptSha256'], created['receiptSha256'])
        self.assertFalse(checked['flightMissionAllowed'])

    def test_consent_and_existing_target_never_overwritten(self):
        with self.assertRaises(receipt.ReceiptError):
            self.create(private_output_ok=False)
        self.assertFalse(self.target.exists())
        self.target.write_text('untouched')
        with self.assertRaises(receipt.ReceiptError):
            self.create()
        self.assertEqual(self.target.read_text(), 'untouched')

    def test_no_independent_or_incorrect_pins_fail_closed(self):
        with self.assertRaises(receipt.ReceiptError):
            self.create(seal_sha256='0'*64)
        self.assertFalse(self.target.exists())
        created = self.create()
        with self.assertRaises(receipt.ReceiptError):
            self.verify('0'*64)
        with self.assertRaises(receipt.ReceiptError):
            self.verify(created['receiptSha256'],
                        reference_manifest_sha256='0'*64)

    def test_changed_reference_or_source_after_issue_invalidates_replay(self):
        original = self.create()['receiptSha256']
        with (self.fixture.reference_dir/'red.tif').open('ab') as f:
            f.write(b'late reference mutation')
        with self.assertRaises(Exception):
            self.verify(original)
        self.assertTrue(self.target.exists())
        self.assertEqual(original, hashlib.sha256(self.target.read_bytes()).hexdigest())

    def test_tampered_report_even_with_recomputed_external_pin_is_not_reproducible(self):
        self.create()
        original = json.loads(self.target.read_text())
        original['referenceAgreement']['bands']['red']['rmse'] = 0.00001
        self.target.write_bytes(receipt.canonical(original))
        independent = hashlib.sha256(self.target.read_bytes()).hexdigest()
        with self.assertRaises(receipt.ReceiptError):
            self.verify(independent)

    def test_reject_forged_operational_readiness_even_if_receipt_hash_recomputed(self):
        self.create()
        record = json.loads(self.target.read_text())
        record['radiometricCalibrationVerified'] = True
        self.target.write_bytes(receipt.canonical(record))
        newly_pinned = hashlib.sha256(self.target.read_bytes()).hexdigest()
        with self.assertRaises(receipt.ReceiptError):
            self.verify(newly_pinned)

    def test_reject_code_or_runtime_version_drift(self):
        created = self.create()
        old = receipt._version_contract
        def drift():
            x = old()
            x['workerSha256'] = dict(x['workerSha256'])
            x['workerSha256']['m3m_raster_bundle_verify.py'] = '0'*64
            return x
        with mock.patch.object(receipt, '_version_contract', side_effect=drift):
            with self.assertRaises(receipt.ReceiptError):
                self.verify(created['receiptSha256'])

    def test_noncanonical_or_symlink_report_is_refused(self):
        created = self.create()
        parsed = json.loads(self.target.read_text())
        self.target.write_text(json.dumps(parsed) + '\n')
        repin = hashlib.sha256(self.target.read_bytes()).hexdigest()
        with self.assertRaises(receipt.ReceiptError):
            self.verify(repin)
        self.target.unlink()
        other = self.private/'other.json'
        other.write_text('private')
        self.target.symlink_to(other)
        with self.assertRaises(receipt.ReceiptError):
            self.verify(created['receiptSha256'])

    def test_output_parent_cannot_be_public_or_inside_source(self):
        public_dir = self.private/'public'
        public_dir.mkdir(mode=0o755)
        with self.assertRaises(receipt.ReceiptError):
            self.create(output_file=public_dir/'report.json')
        with self.assertRaises(receipt.ReceiptError):
            self.create(output_file=self.fixture.reference_dir/'receipt.json')
        self.assertFalse((self.fixture.reference_dir/'receipt.json').exists())

    def test_nested_symlink_output_parent_is_rejected_before_write(self):
        destination = self.private/'private-target'
        destination.mkdir(mode=0o700)
        subdir = destination/'nested'
        subdir.mkdir(mode=0o700)
        alias = self.private/'alias'
        alias.symlink_to(destination, target_is_directory=True)
        target = alias/'nested'/'replay.json'
        with self.assertRaises(receipt.ReceiptError):
            self.create(output_file=target)
        self.assertFalse((subdir/'replay.json').exists())

    def test_nested_symlink_receipt_directory_rejected_before_replay(self):
        result = self.create()
        alias = self.private.parent/'aliased-private'
        alias.symlink_to(self.private, target_is_directory=True)
        with self.assertRaises(receipt.ReceiptError):
            self.verify(result['receiptSha256'], receipt_file=alias/self.target.name)

    def test_nested_symlink_source_path_rejected_before_create(self):
        alias = self.private.parent/'aliased-source'
        alias.symlink_to(self.fixture.bundle, target_is_directory=True)
        with self.assertRaises(receipt.ReceiptError):
            self.create(bundle=alias)
        self.assertFalse(self.target.exists())

    def test_replay_mismatch_is_fail_closed_without_report_rewriting(self):
        created = self.create()
        before = self.target.read_bytes()
        original = receipt._recompute
        def deviating(*args):
            result=original(*args)
            result['bands']['nir']['meanAbsoluteError'] += 0.002
            return result
        with mock.patch.object(receipt, '_recompute', side_effect=deviating):
            with self.assertRaises(receipt.ReceiptError):
                self.verify(created['receiptSha256'])
        self.assertEqual(before, self.target.read_bytes())


if __name__ == '__main__':
    unittest.main()
