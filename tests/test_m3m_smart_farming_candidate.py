"""Offline candidate tests: no live backend, database, S3 or DJI calls."""
from __future__ import annotations

import hashlib
import importlib.util
import json
import sys
from pathlib import Path
import tempfile
import types
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / 'backend/workers/m3m_smart_farming_candidate.py'
spec = importlib.util.spec_from_file_location('m3m_smart_farming_candidate', SCRIPT)
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class CandidateTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.bundle = self.root / 'bundle'
        (self.bundle / 'indices').mkdir(parents=True)
        self.seal = self.root / 'receipt.json'
        self.dest = self.root / 'candidate'
        self.pin = 'ab' * 32
        self.report = {
            'schema': 'skyhub-m3m-experimental-index-raster-v1',
            'pixelCount': 100,
            'operationalUseAllowed': False, 'reflectanceReady': False,
            'ndviReady': False, 'ndreReady': False, 'calibrationVerified': False,
            'bandCoregistrationVerified': False,
            'outputs': {name: {'filename': name + '.tif', 'validPixels': 90,
                               'mean': 0.25, 'min': 0.1, 'max': 0.4}
                        for name in worker.INDICES},
        }
        self._save_report()
        self.verifier = types.SimpleNamespace(verify_seal=lambda *args: {
            'pixelQaRechecked': True,
            'filesMatched': 11,
            'sha256OfSeal': self.pin,
            'signedByTrustedAuthority': False,
            'operationalUseAllowed': False,
        })

    def _save_report(self):
        p = self.bundle / 'indices/report.json'
        p.write_text(json.dumps(self.report), encoding='utf-8')
        seal = {
            'schema': 'skyhub-m3m-raster-bundle-integrity-seal-v1',
            'files': [{'relativePath': 'indices/report.json',
                       'sha256': hashlib.sha256(p.read_bytes()).hexdigest(),
                       'bytes': p.stat().st_size}],
        }
        self.seal.write_text(json.dumps(seal), encoding='utf-8')
        self.pin = hashlib.sha256(self.seal.read_bytes()).hexdigest()

    def _run(self, **overrides):
        params = {'bundle': self.bundle, 'seal': self.seal,
                  'trusted_seal_sha256': self.pin, 'output_dir': self.dest}
        params.update(overrides)
        with mock.patch.object(worker, '_seal_module', return_value=self.verifier):
            return worker.create_candidate(**params)

    def test_candidate_is_private_redacted_nonoperational(self):
        self.verifier.verify_seal = lambda *args: {
            'pixelQaRechecked': True, 'filesMatched': 11,
            'sha256OfSeal': self.pin, 'operationalUseAllowed': False,
            'signedByTrustedAuthority': False,
        }
        data = self._run()
        self.assertEqual(data['indexCount'], 4)
        self.assertEqual([x['index'] for x in data['indexLayers']], list(worker.INDICES))
        self.assertEqual(data['state'], 'experimental_candidate')
        self.assertFalse(data['tileUrlsPublished'])
        self.assertFalse(data['prescriptionExportAllowed'])
        self.assertFalse(data['flightMissionAllowed'])
        self.assertFalse(data['operationalUseAllowed'])
        self.assertEqual(self.dest.stat().st_mode & 0o777, 0o700)
        file = self.dest / 'candidate.json'
        self.assertEqual(file.stat().st_mode & 0o777, 0o600)
        self.assertEqual(json.loads(file.read_text()), data)
        for target in (str(self.bundle), str(self.seal), str(self.root)):
            self.assertNotIn(target, json.dumps(data))
        self.assertNotIn('latitude', json.dumps(data))

    @unittest.skipUnless(sys.platform.startswith('linux'), 'Linux renameat2 required')
    def test_atomic_publish_refuses_racing_empty_destination(self):
        """POSIX rename silently replaces an empty directory, renameat2 must not."""
        original = worker._publish_no_replace
        created = []

        def racer(stage, destination):
            # Deterministically race *after* the final lexists() check and
            # before the atomic directory-publish syscall.
            destination.mkdir()
            created.append(destination)
            original(stage, destination)

        with mock.patch.object(worker, '_publish_no_replace', side_effect=racer):
            with self.assertRaises(FileExistsError):
                self._run()
        self.assertEqual(created, [self.dest])
        self.assertTrue(self.dest.is_dir())
        self.assertEqual(list(self.dest.iterdir()), [])
        self.assertFalse((self.dest / 'candidate.json').exists())
        self.assertFalse(list(self.root.glob('.skyhub-m3m-candidate-*')))

    @unittest.skipUnless(sys.platform.startswith('linux'), 'Linux renameat2 required')
    def test_atomic_publish_refuses_existing_empty_destination(self):
        stage = self.root / 'staged'
        stage.mkdir()
        (stage / 'candidate.json').write_text('original')
        self.dest.mkdir()
        with self.assertRaises(FileExistsError):
            worker._publish_no_replace(stage, self.dest)
        self.assertTrue(stage.is_dir())
        self.assertEqual((stage / 'candidate.json').read_text(), 'original')
        self.assertTrue(self.dest.is_dir())
        self.assertEqual(list(self.dest.iterdir()), [])

    @unittest.skipUnless(sys.platform.startswith('linux'), 'Linux renameat2 required')
    def test_atomic_publish_succeeds_with_missing_destination(self):
        stage = self.root / 'staged'
        stage.mkdir()
        (stage / 'candidate.json').write_text('original')
        worker._publish_no_replace(stage, self.dest)
        self.assertFalse(stage.exists())
        self.assertEqual((self.dest / 'candidate.json').read_text(), 'original')

    def test_atomic_publish_refuses_unsupported_platform_without_rename(self):
        stage = self.root / 'staged'
        stage.mkdir()
        with mock.patch.object(worker.sys, 'platform', 'darwin'):
            with self.assertRaises(worker.CandidateError):
                worker._publish_no_replace(stage, self.dest)
        self.assertTrue(stage.is_dir())
        self.assertFalse(self.dest.exists())

    def test_bad_hash_rejected(self):
        with self.assertRaises(worker.CandidateError): self._run(trusted_seal_sha256='bad')
        self.assertFalse(self.dest.exists())

    def test_wrong_pin_rejected(self):
        with self.assertRaises(worker.CandidateError): self._run(trusted_seal_sha256='0' * 64)
        self.assertFalse(self.dest.exists())

    def test_index_report_changed_without_new_receipt(self):
        (self.bundle/'indices/report.json').write_text(json.dumps(self.report) + ' ')
        with self.assertRaises(worker.CandidateError): self._run()
        self.assertFalse(self.dest.exists())

    def test_duplicate_json_keys_rejected(self):
        (self.bundle/'indices/report.json').write_text('{"schema":"x","schema":"y"}')
        with self.assertRaises(worker.CandidateError): self._run()

    def test_forged_readiness_rejected(self):
        self.report['operationalUseAllowed'] = True
        self._save_report()
        with self.assertRaises(worker.CandidateError): self._run()

    def test_float32_mean_raster_rounding_within_epsilon_is_accepted(self):
        self.report['outputs']['ndvi'].update(min=0.25, max=0.25, mean=0.24999996)
        cards = worker._validated_indices(self.report)
        self.assertEqual(len(cards), 4)
        self.assertAlmostEqual(cards[0]['mean'], 0.24999996)
        self.report['outputs']['ndvi']['mean'] = 0.249
        with self.assertRaises(worker.CandidateError):
            worker._validated_indices(self.report)

    def test_nonfinite_mean_rejected(self):
        self.report['outputs']['ndvi']['mean'] = float('nan')
        self._save_report()
        with self.assertRaises(worker.CandidateError): self._run()

    def test_unsupported_index_rejected(self):
        self.report['outputs']['evi'] = dict(filename='evi.tif', validPixels=90, mean=0, min=0, max=0)
        self._save_report()
        with self.assertRaises(worker.CandidateError): self._run()

    def test_unsafe_filename_rejected(self):
        self.report['outputs']['ndvi']['filename'] = '../private.tif'
        self._save_report()
        with self.assertRaises(worker.CandidateError): self._run()

    def test_negative_valid_count_rejected(self):
        self.report['outputs']['ndre']['validPixels'] = -1
        self._save_report()
        with self.assertRaises(worker.CandidateError): self._run()

    def test_inconsistent_minimum_maximum_rejected(self):
        self.report['outputs']['osavi']['min'] = .7
        self._save_report()
        with self.assertRaises(worker.CandidateError): self._run()

    def test_existing_destination_untouched(self):
        self.dest.mkdir()
        marker = self.dest / 'keep.txt'
        marker.write_text('do not alter')
        with self.assertRaises(FileExistsError): self._run()
        self.assertEqual(marker.read_text(), 'do not alter')

    def test_cannot_write_candidate_inside_raster_bundle(self):
        with self.assertRaises(worker.CandidateError): self._run(output_dir=self.bundle/'candidate')
        self.assertFalse((self.bundle/'candidate').exists())

    def test_failed_integrity_receipt_check_rejected(self):
        def refuse(*args):
            raise ValueError('bad QA')
        self.verifier.verify_seal = refuse
        with self.assertRaises(ValueError): self._run()
        self.assertFalse(self.dest.exists())

    def test_weak_claim_of_qa_rejected(self):
        self.verifier.verify_seal = lambda *args: {
            'pixelQaRechecked': False, 'filesMatched': 11,
            'sha256OfSeal': self.pin, 'operationalUseAllowed': False,
            'signedByTrustedAuthority': False,
        }
        with self.assertRaises(worker.CandidateError): self._run()

    def test_bad_received_index_stats_rejected(self):
        self.report['outputs']['ndvi']['mean'] = True
        self._save_report()
        with self.assertRaises(worker.CandidateError): self._run()

    def test_output_parent_symlink_rejected(self):
        real = self.root / 'real'
        real.mkdir()
        alias = self.root / 'shortcut'
        alias.symlink_to(real, target_is_directory=True)
        with self.assertRaises(worker.CandidateError): self._run(output_dir=alias/'candidate')

    def test_invalid_seal_entry_json_rejected(self):
        self.seal.write_text('not json')
        self.pin = hashlib.sha256(self.seal.read_bytes()).hexdigest()
        with self.assertRaises(ValueError): self._run()


try:
    import numpy as np
    import rasterio
except ImportError:
    np = rasterio = None


@unittest.skipUnless(np is not None and rasterio is not None and
                     (ROOT / 'backend/workers/m3m_raster_bundle_seal.py').exists(),
                     'Requires complete SkyHub raster worker tree and rasterio')
class RealRasterCandidateIntegrationTests(unittest.TestCase):
    """Real synthetic GeoTIFF integration through the unmocked seal/QA chain."""

    def setUp(self):
        tests_module = ROOT / 'tests/test_m3m_raster_bundle_verify.py'
        spec = importlib.util.spec_from_file_location('_skyhub_real_candidate_fixture', tests_module)
        fixture = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(fixture)
        self.sample = fixture.TestM3mRasterBundleQa(methodName='test_valid_bundle_and_no_writes')
        self.sample.setUp()
        self.addCleanup(self.sample.doCleanups)
        self.bundle = self.sample.root
        self.seal = self.bundle.parent / 'receipt.json'
        self.dest = self.bundle.parent / 'registered-candidate'
        self.seal_module = worker._seal_module()
        self.receipt = self.seal_module.create_seal(self.bundle, self.seal)

    def test_real_seal_and_full_pixel_qa_required_for_registration(self):
        record = worker.create_candidate(bundle=self.bundle, seal=self.seal,
                                         trusted_seal_sha256=self.receipt['sha256OfSeal'],
                                         output_dir=self.dest)
        self.assertTrue(record['integrity']['rasterQaPassedAtRegistration'])
        self.assertFalse(record['tileUrlsPublished'])
        self.assertEqual(record['indexCount'], 4)
        self.assertTrue((self.dest / 'candidate.json').exists())

    def test_modified_index_before_import_is_refused(self):
        with (self.bundle / 'indices/ndvi.tif').open('ab') as handle:
            handle.write(b'change')
        with self.assertRaises(Exception):
            worker.create_candidate(bundle=self.bundle, seal=self.seal,
                                    trusted_seal_sha256=self.receipt['sha256OfSeal'],
                                    output_dir=self.dest)
        self.assertFalse(self.dest.exists())


if __name__ == '__main__':
    unittest.main()
