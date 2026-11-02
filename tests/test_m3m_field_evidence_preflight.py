"""P3.6 synthetic actual-TIFF capture/evidence presence; no science approval."""
from __future__ import annotations

import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock
from contextlib import redirect_stdout, redirect_stderr

ROOT = Path(__file__).resolve().parents[1]


def load(file, alias):
    spec = importlib.util.spec_from_file_location(alias, ROOT / file)
    item = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(item)
    return item


pre = load('backend/workers/m3m_field_evidence_preflight.py', 'skyhub_field_preflight')
fixture_module = load('tests/test_m3m_source_capture_receipt.py', 'skyhub_field_fixture')

try:
    import numpy
    import rasterio
    import tifffile
    import defusedxml
except ImportError:
    numpy = rasterio = tifffile = defusedxml = None


@unittest.skipUnless(numpy is not None and rasterio is not None and
                     tifffile is not None and defusedxml is not None,
                     'Requires NumPy, Rasterio, tifffile and defusedxml')
class FieldEvidencePreflightTests(unittest.TestCase):
    def setUp(self):
        fixture = fixture_module.SourceReceiptTests(
            methodName='test_full_capture_has_digest_but_no_readiness_or_private_metadata')
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        self.fixture = fixture
        self.tiffs = fixture.full()
        t = tempfile.TemporaryDirectory()
        self.addCleanup(t.cleanup)
        self.root = Path(t.name)
        self.source_receipt = self.root / 'capture.json'
        source_report = fixture_module.worker.create_receipt(self.tiffs)
        source_bytes = (json.dumps(source_report, sort_keys=True) + '\n').encode()
        self.source_receipt.write_bytes(source_bytes)
        os.chmod(self.source_receipt, 0o600)
        self.source_pin = hashlib.sha256(source_bytes).hexdigest()
        self.evidence = self.root / 'field'
        self.evidence.mkdir(mode=0o700)
        self.supplied = set()
        self.store_manifest()

    def store_manifest(self):
        manifest = {
            'schema': pre.SCHEMA,
            'classification': 'opaque-operator-evidence-unvalidated',
            'operatorClaimOfValidation': False,
            'calibrationVerified': False,
            'operationalUseAllowed': False,
            'assets': [],
        }
        for kind, filename in pre.KINDS:
            provided = kind in self.supplied
            if provided:
                file = self.evidence / filename
                data = file.read_bytes()
                record = {'kind': kind, 'filename': filename,
                          'sha256': hashlib.sha256(data).hexdigest(),
                          'bytes': len(data), 'provided': True,
                          'contentScientificallyVerified': False}
            else:
                record = {'kind': kind, 'filename': None,
                          'sha256': None, 'bytes': None, 'provided': False,
                          'contentScientificallyVerified': False}
            manifest['assets'].append(record)
        self.manifest = manifest
        content = pre._canonical(manifest)
        path = self.evidence / 'field-evidence-manifest.json'
        path.write_bytes(content)
        os.chmod(path, 0o600)
        self.evidence_pin = hashlib.sha256(content).hexdigest()

    def add_evidence(self, *kinds):
        for kind in kinds:
            filename = dict(pre.KINDS)[kind]
            file = self.evidence / filename
            file.write_bytes(('local operator evidence ' + kind).encode())
            os.chmod(file, 0o600)
            self.supplied.add(kind)
        self.store_manifest()

    def check(self, **update):
        cfg = {
            'tiffs': self.tiffs,
            'source_receipt': self.source_receipt,
            'source_receipt_sha256': self.source_pin,
            'evidence_dir': self.evidence,
            'evidence_manifest_sha256': self.evidence_pin,
        }
        cfg.update(update)
        return pre.preflight(**cfg)

    def test_valid_originals_but_evidence_missing_never_calibrated(self):
        r = self.check()
        self.assertEqual(r['originalSpectralTiffCount'], 4)
        self.assertEqual(r['decodedPixelCount'], 4*16*16)
        self.assertEqual(r['evidenceAssetsPresent'], 0)
        self.assertEqual(r['evidencePresentButUnvalidated'], [])
        self.assertEqual(r['evidenceMissing'], [key for key, _ in pre.KINDS])
        self.assertTrue(r['originalBytesMatchIndependentReceiptPin'])
        self.assertTrue(r['evidenceBytesMatchIndependentManifestPin'])
        self.assertTrue(r['sameCaptureXmpHint'])
        self.assertFalse(r['scienceReady'])
        for k in (*pre.FALSE_FLAGS,'djiHardwareProvenanceVerified',
                  'sunlightSensorValuesValidated','panelCalibrationVerified',
                  'independentGroundTruthVerified'):
            self.assertIs(r[k], False)
        data = json.dumps(r)
        self.assertNotIn(self.fixture.capture, data)
        self.assertNotIn(str(self.fixture.root), data)
        self.assertNotIn(str(self.evidence), data)
        self.assertNotIn(self.source_pin, data)
        self.assertNotIn(self.evidence_pin, data)
        for file in self.tiffs:
            self.assertNotIn(file.name, data)

    def test_all_evidence_still_not_scientifically_verified(self):
        self.add_evidence(*(key for key, _ in pre.KINDS))
        r = self.check()
        self.assertTrue(r['allEvidenceTypesSupplied'])
        self.assertEqual(r['evidenceAssetsPresent'], 5)
        self.assertEqual(r['evidenceMissing'], [])
        self.assertFalse(r['radiometricCalibrationVerified'])
        self.assertFalse(r['bandCoregistrationVerified'])
        self.assertFalse(r['operationalUseAllowed'])

    def test_partial_dls_and_panel_material_is_inventory_only(self):
        self.add_evidence('sunlightSensor', 'panelImage')
        r = self.check()
        self.assertEqual(r['evidenceAssetsPresent'], 2)
        self.assertEqual(r['evidencePresentButUnvalidated'],
                         ['sunlightSensor', 'panelImage'])
        self.assertIn('panelCertificate',r['evidenceMissing'])
        self.assertFalse(r['scienceReady'])

    def test_mutated_original_raw_tiff_fails_pinned_source(self):
        with self.tiffs[0].open('ab') as stream:stream.write(b'raw mutation')
        with self.assertRaises(Exception):self.check()

    def test_mismatched_capture_or_untrusted_source_receipt_fails(self):
        new_tiffs = self.tiffs[:]
        new_tiffs[-1] = self.fixture.make_tiff('NIR',
                                              capture='11111111-1111-4111-8111-111111111111')
        with self.assertRaises(Exception):
            self.check(tiffs=new_tiffs)
        data = json.loads(self.source_receipt.read_text())
        data['sourceVerified'] = True
        forged=(json.dumps(data,sort_keys=True)+'\n').encode()
        self.source_receipt.write_bytes(forged)
        with self.assertRaises(pre.EvidenceError):
            self.check(source_receipt_sha256=hashlib.sha256(forged).hexdigest())

    def test_bad_or_fabricated_evidence_hash_rejected(self):
        self.add_evidence('sunlightSensor')
        with (self.evidence/'sunlight-sensor-evidence.bin').open('ab') as stream:
            stream.write(b'tampered')
        with self.assertRaises(pre.EvidenceError):self.check()

    def test_extra_file_symlink_and_public_rights_rejected(self):
        (self.evidence/'stray.json').write_text('unexpected')
        with self.assertRaises(pre.EvidenceError):self.check()
        (self.evidence/'stray.json').unlink()
        self.add_evidence('panelImage')
        entry = self.evidence/'panel-image-evidence.bin'
        backup = self.root/'private-evidence-copy'
        entry.rename(backup)
        entry.symlink_to(backup)
        with self.assertRaises(pre.EvidenceError):self.check()
        entry.unlink()
        backup.rename(entry)
        self.evidence.chmod(0o755)
        with self.assertRaises(pre.EvidenceError):self.check()

    def test_forged_scientific_flag_refused_even_with_new_manifest_pin(self):
        path = self.evidence/'field-evidence-manifest.json'
        for field in ('calibrationVerified', 'operationalUseAllowed'):
            payload = dict(self.manifest)
            payload[field]=True
            content=pre._canonical(payload)
            path.write_bytes(content)
            with self.assertRaises(pre.EvidenceError):
                self.check(evidence_manifest_sha256=hashlib.sha256(content).hexdigest())

    def test_source_receipt_and_manifest_pin_required(self):
        for key in ('source_receipt_sha256','evidence_manifest_sha256'):
            with self.subTest(key=key):
                with self.assertRaises(pre.EvidenceError):
                    self.check(**{key:'0'*64})
                with self.assertRaises(pre.EvidenceError):
                    self.check(**{key:'not-a-sha'})

    def test_changes_between_checks_are_detected(self):
        self.add_evidence('sunlightSensor')
        method = pre._validate_evidence
        n = 0
        def sabotage(*args, **kwargs):
            nonlocal n
            n += 1
            if n == 2:
                with (self.evidence/'sunlight-sensor-evidence.bin').open('ab') as out:
                    out.write(b'late corruption')
            return method(*args, **kwargs)
        with mock.patch.object(pre,'_validate_evidence',side_effect=sabotage):
            with self.assertRaises(pre.EvidenceError):
                self.check()
        self.assertEqual(n,2)

    def test_nested_evidence_directory_alias_is_refused(self):
        alias = self.root / 'evidence-alias'
        alias.symlink_to(self.evidence, target_is_directory=True)
        with self.assertRaises(pre.EvidenceError):
            self.check(evidence_dir=alias)

    def test_nested_capture_file_alias_is_refused(self):
        parent=self.root/'source-alias-parent'
        parent.mkdir(mode=0o700)
        nested=parent/'nested'
        nested.mkdir(mode=0o700)
        alias=self.root/'capture-parent-alias'
        alias.symlink_to(parent, target_is_directory=True)
        new= nested/'G.tif'
        new.write_bytes(self.tiffs[0].read_bytes())
        tiffs = [alias/'nested'/'G.tif', *self.tiffs[1:]]
        with self.assertRaises(pre.EvidenceError):
            self.check(tiffs=tiffs)

    def test_noncanonical_evidence_manifest_rejected_even_after_repin(self):
        manifest = self.evidence/'field-evidence-manifest.json'
        pretty=(json.dumps(self.manifest, sort_keys=True, indent=2)+'\n').encode()
        manifest.write_bytes(pretty)
        with self.assertRaises(pre.EvidenceError):
            self.check(evidence_manifest_sha256=hashlib.sha256(pretty).hexdigest())

    def test_cli_fail_closed_never_prints_paths(self):
        stderr = io.StringIO()
        with redirect_stderr(stderr):
            rc=pre.main(['--tiff',str(self.tiffs[0]),
                         '--source-receipt',str(self.source_receipt),
                         '--source-receipt-sha256',self.source_pin,
                         '--evidence-dir',str(self.evidence),
                         '--evidence-manifest-sha256',self.evidence_pin])
        self.assertEqual(rc,2)
        error=stderr.getvalue()
        self.assertNotIn(str(self.source_receipt),error)
        self.assertNotIn(str(self.evidence),error)
        self.assertNotIn(self.fixture.capture,error)


if __name__ == '__main__':
    unittest.main()
