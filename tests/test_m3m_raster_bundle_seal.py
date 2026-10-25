"""Offline SHA-256 artifact-sealing tests using actual synthetic GeoTIFF payloads."""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest

try:
    import numpy as np
    import rasterio
except ImportError:
    np = rasterio = None

ROOT = Path(__file__).resolve().parents[1]
source = ROOT / 'backend/workers/m3m_raster_bundle_seal.py'
spec = importlib.util.spec_from_file_location('m3m_raster_bundle_seal', source)
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)
fixtures = ROOT / 'tests/test_m3m_raster_bundle_verify.py'
fixture_spec = importlib.util.spec_from_file_location('m3m_qa_fixture', fixtures)
qa_fixture = importlib.util.module_from_spec(fixture_spec)
fixture_spec.loader.exec_module(qa_fixture)


@unittest.skipUnless(np is not None and rasterio is not None, 'Requires optional raster dependencies')
class RasterSealTests(unittest.TestCase):
    def setUp(self):
        self.fixture = qa_fixture.TestM3mRasterBundleQa(methodName='test_valid_bundle_and_no_writes')
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.bundle = self.fixture.root
        self.seal = self.bundle.parent / 'm3m-integrity-seal.json'

    def create(self):
        return worker.create_seal(self.bundle, self.seal)

    def test_seal_and_reverify_real_rasters(self):
        original = {str(p): hashlib.sha256(p.read_bytes()).hexdigest()
                    for p in self.bundle.rglob('*') if p.is_file()}
        report = self.create()
        self.assertEqual(report['filesMatched'], 11)
        self.assertEqual(report['pixelQaRechecked'], True)
        self.assertFalse(report['operationalUseAllowed'])
        self.assertFalse(report['signedByTrustedAuthority'])
        self.assertEqual(self.seal.stat().st_mode & 0o777, 0o600)
        self.assertNotIn(str(self.bundle), self.seal.read_text())
        self.assertNotIn(str(self.bundle), json.dumps(report))
        self.assertEqual({str(p): hashlib.sha256(p.read_bytes()).hexdigest()
                          for p in self.bundle.rglob('*') if p.is_file()}, original)
        self.assertEqual(worker.verify_seal(self.bundle, self.seal, report['sha256OfSeal']), report)

    def test_reject_modified_index_file(self):
        report = self.create()
        p = self.bundle / 'indices/ndvi.tif'
        with p.open('ab') as stream:
            stream.write(b'tamper')
        with self.assertRaises(worker.SealError):
            worker.verify_seal(self.bundle, self.seal, report['sha256OfSeal'])

    def test_reject_tampered_metadata(self):
        report = self.create()
        p = self.bundle / 'bundle-report.json'
        with p.open('ab') as stream:
            stream.write(b' ')
        with self.assertRaises(worker.SealError):
            worker.verify_seal(self.bundle, self.seal, report['sha256OfSeal'])

    def test_reject_modified_seal_without_new_pin(self):
        report = self.create()
        with self.seal.open('ab') as f:
            f.write(b' ')
        with self.assertRaises(worker.SealError):
            worker.verify_seal(self.bundle, self.seal, report['sha256OfSeal'])

    def test_refuse_existing_receipt_without_overwrite(self):
        self.seal.write_text('do not overwrite')
        with self.assertRaises(FileExistsError):
            self.create()
        self.assertEqual(self.seal.read_text(), 'do not overwrite')

    def test_refuse_seal_inside_bundle(self):
        with self.assertRaises(worker.SealError):
            worker.create_seal(self.bundle, self.bundle / 'seal.json')
        self.assertFalse((self.bundle / 'seal.json').exists())

    def test_reject_symlink_seal(self):
        receipt = self.create()
        moved = self.bundle.parent / 'real-seal.json'
        self.seal.rename(moved)
        self.seal.symlink_to(moved)
        with self.assertRaises(worker.SealError):
            worker.verify_seal(self.bundle, self.seal, receipt['sha256OfSeal'])

    def test_reject_missing_product(self):
        receipt = self.create()
        (self.bundle/'indices/gndvi.tif').unlink()
        with self.assertRaises(worker.SealError):
            worker.verify_seal(self.bundle, self.seal, receipt['sha256OfSeal'])

    def test_reject_digest_format(self):
        self.create()
        with self.assertRaises(worker.SealError):
            worker.verify_seal(self.bundle, self.seal, 'invalid')

    def test_reject_forged_operational_permission_even_with_new_pin(self):
        self.create()
        payload = json.loads(self.seal.read_text())
        payload['operationalUseAllowed'] = True
        self.seal.write_text(json.dumps(payload), encoding='utf8')
        new_pin = hashlib.sha256(self.seal.read_bytes()).hexdigest()
        with self.assertRaises(worker.SealError):
            worker.verify_seal(self.bundle, self.seal, new_pin)

    def test_reject_forged_file_path_even_with_new_pin(self):
        self.create()
        payload = json.loads(self.seal.read_text())
        payload['files'][0]['relativePath'] = '../outside'
        self.seal.write_text(json.dumps(payload), encoding='utf8')
        new_pin = hashlib.sha256(self.seal.read_bytes()).hexdigest()
        with self.assertRaises(worker.SealError):
            worker.verify_seal(self.bundle, self.seal, new_pin)

    def test_reject_duplicate_json_key_even_with_new_pin(self):
        self.create()
        text = self.seal.read_text().rstrip()
        self.seal.write_text(text[:-1] + ',"schema":"tampered"}')
        new_pin = hashlib.sha256(self.seal.read_bytes()).hexdigest()
        with self.assertRaises(worker.SealError):
            worker.verify_seal(self.bundle, self.seal, new_pin)

    def test_reject_invalid_raster_math_before_sealing(self):
        tif = self.bundle / 'indices/ndvi.tif'
        bad = self.fixture.grids['ndvi'].copy()
        bad[0, 0] = 0.99
        self.fixture._write(tif, bad)
        with self.assertRaises(ValueError):
            self.create()
        self.assertFalse(self.seal.exists())


if __name__ == '__main__':
    unittest.main()
