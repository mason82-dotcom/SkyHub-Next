"""P3.6d two-cohort pinned private M3M matrix regression tests."""
from __future__ import annotations

import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from contextlib import redirect_stderr
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]

def load(path, alias):
    spec = importlib.util.spec_from_file_location(alias, ROOT / path)
    item = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(item)
    return item

worker = load('backend/workers/m3m_private_firmware_cohort_matrix.py',
              'm3m_p36d_matrix')
prior = load('tests/test_m3m_radiometric_xmp_inventory.py',
             'm3m_p36d_xmp_fixture')

try:
    import numpy
    import tifffile
    import rasterio
    import defusedxml
except ImportError:
    numpy = tifffile = rasterio = defusedxml = None


@unittest.skipUnless(numpy is not None and tifffile is not None and
                     rasterio is not None and defusedxml is not None,
                     'Requires actual synthetic TIFF/XMP offline libraries')
class M3mPrivateFirmwareCohortMatrixTests(unittest.TestCase):
    def setUp(self):
        self.samples=[]
        for _ in range(2):
            fixture = prior.RadiometricXmpInventoryTests(
                methodName='test_originals_without_radiometry_report_missing_only')
            fixture.setUp()
            self.addCleanup(fixture.doCleanups)
            self.samples.append(fixture)
        t = tempfile.TemporaryDirectory()
        self.addCleanup(t.cleanup)
        self.root = Path(t.name)
        self.manifest = self.root/'matrix.json'
        self.items = []
        for cohort, sample in zip(('A','B'), self.samples):
            sample.render(sample.complete())
            fw = sample.f.root/'operator-firmware-evidence.bin'
            content = ('private operator claim cohort ' + cohort).encode()
            fw.write_bytes(content)
            fw.chmod(0o600)
            self.items.append({
                'cohort':cohort,
                'tiffs':[str(p) for p in sample.f.tiffs],
                'sourceReceipt':str(sample.f.source_receipt),
                'sourceReceiptSha256':sample.params['source_receipt_sha256'],
                'evidenceDir':str(sample.f.evidence),
                'evidenceManifestSha256':sample.params['evidence_manifest_sha256'],
                'firmwareEvidence':str(fw),
                'firmwareEvidenceSha256':hashlib.sha256(content).hexdigest(),
            })
        self.save()

    def save(self):
        self.data={'schema':worker.SCHEMA,'cases':self.items}
        raw=worker._canonical(self.data)
        self.manifest.write_bytes(raw)
        self.manifest.chmod(0o600)
        self.pin=hashlib.sha256(raw).hexdigest()

    def check(self, **overrides):
        return worker.compare(**{'manifest':self.manifest,
                                 'manifest_sha256':self.pin,**overrides})

    def test_two_independent_cohorts_aggregate_without_readiness(self):
        r=self.check()
        self.assertEqual(r['capturesPerAnonymousCohort'],{'A':1,'B':1})
        self.assertEqual(r['spectralTiffsPerAnonymousCohort'],{'A':4,'B':4})
        self.assertTrue(r['allCanonicalRequiredFieldsCompleteByCohort']['A'])
        self.assertTrue(r['operatorFirmwareEvidenceBytesIndependentlyPinned'])
        self.assertTrue(r['originalTiffAndEvidencePinsRecheckedPerCapture'])
        self.assertTrue(r['manifestSha256RecheckedAfterScan'])
        self.assertTrue(r['manualInterpretationRequired'])
        for field in worker.FALSE_FLAGS:
            self.assertIs(r[field],False)
        self.assertFalse(r['rawMetadataOrFirmwareVersionsReleased'])
        output=json.dumps(r)
        for sample in self.samples:
            self.assertNotIn(str(sample.f.root),output)
            self.assertNotIn(sample.f.fixture.capture,output)
            self.assertNotIn(sample.params['source_receipt_sha256'],output)
        self.assertNotIn(self.pin,output)
        self.assertNotIn('private operator claim',output)

    def test_different_documented_fields_produce_anonymous_delta(self):
        self.samples[1].render({**self.samples[1].complete(),
                                'VignettingPolynomial':'0.001',
                                'SunSensorYaw':'12'})
        self.items[1]['sourceReceiptSha256']=self.samples[1].params['source_receipt_sha256']
        self.save()
        r=self.check()
        self.assertEqual(r['documentedMarkerPresenceDeltaBMinusA']['SunSensorYaw'],4)
        self.assertEqual(r['documentedMarkerPresenceDeltaBMinusA']['VignettingPolynomial'],4)
        self.assertEqual(r['documentedMarkerPresenceDeltaBMinusA']['RawData'],0)
        self.assertFalse(r['firmwareVersionVerified'])

    def test_incorrect_manifest_pin_rejected(self):
        with self.assertRaises(worker.MatrixError):
            self.check(manifest_sha256='0'*64)

    def test_noncanonical_json_rejected_even_with_matching_pin(self):
        raw=json.dumps(self.data,indent=2).encode()
        self.manifest.write_bytes(raw)
        with self.assertRaises(worker.MatrixError):
            self.check(manifest_sha256=hashlib.sha256(raw).hexdigest())

    def test_duplicate_json_key_rejected(self):
        raw=self.manifest.read_bytes().replace(b'"cases":',b'"cases":[],"cases":',1)
        self.manifest.write_bytes(raw)
        with self.assertRaises(worker.MatrixError):
            self.check(manifest_sha256=hashlib.sha256(raw).hexdigest())

    def test_duplicate_capture_receipt_or_missing_cohort_refused(self):
        self.items[1]['sourceReceipt']=self.items[0]['sourceReceipt']
        self.save()
        with self.assertRaises(worker.MatrixError):self.check()
        self.items[1]['sourceReceipt']=str(self.samples[1].f.source_receipt)
        self.items[1]['cohort']='A'
        self.save()
        with self.assertRaises(worker.MatrixError):self.check()

    def test_copied_receipt_with_same_sha_is_not_an_independent_capture(self):
        original=Path(self.items[0]['sourceReceipt'])
        clone=self.root/'copied-capture-receipt.json'
        clone.write_bytes(original.read_bytes())
        clone.chmod(0o600)
        self.items[1]['sourceReceipt']=str(clone)
        self.items[1]['sourceReceiptSha256']=self.items[0]['sourceReceiptSha256']
        self.save()
        with self.assertRaises(worker.MatrixError):
            self.check()

    def test_tiff_path_reused_between_cohorts_is_refused(self):
        # Even separate receipt paths must not reuse an original source image.
        self.items[1]['tiffs'][0]=self.items[0]['tiffs'][0]
        self.save()
        with self.assertRaises(worker.MatrixError):
            self.check()

    def test_same_firmware_evidence_bytes_in_distinct_cohorts_refused(self):
        # Two different filenames and matching hashes do not establish
        # different firmware versions when both content hashes are identical.
        first=Path(self.items[0]['firmwareEvidence']).read_bytes()
        second=Path(self.items[1]['firmwareEvidence'])
        second.write_bytes(first)
        second.chmod(0o600)
        self.items[1]['firmwareEvidenceSha256']=hashlib.sha256(first).hexdigest()
        self.save()
        with self.assertRaises(worker.MatrixError):
            self.check()

    def test_firmware_evidence_reuse_within_a_single_cohort_is_not_validation(self):
        # A and B must have distinct operator proof, but repeat observations
        # within the same operator-labeled cohort are a valid experimental input.
        # Keep this as a structural (not scientific) assertion of the SHA gate.
        self.assertNotEqual(
            self.items[0]['firmwareEvidenceSha256'],
            self.items[1]['firmwareEvidenceSha256'])
        report=self.check()
        self.assertFalse(report['firmwareVersionVerified'])

    def test_invalid_firmware_evidence_pin_refused(self):
        self.items[1]['firmwareEvidenceSha256']='0'*64
        self.save()
        with self.assertRaises(worker.MatrixError):self.check()

    def test_firmware_evidence_bytes_modified_refused(self):
        fw=Path(self.items[1]['firmwareEvidence'])
        with fw.open('ab') as f:f.write(b'altered')
        with self.assertRaises(worker.MatrixError):self.check()

    def test_private_manifest_permissions_and_symlink_refused(self):
        self.manifest.chmod(0o644)
        with self.assertRaises(worker.MatrixError):self.check()
        self.manifest.chmod(0o600)
        link=self.root/'alias.json'
        link.symlink_to(self.manifest)
        with self.assertRaises(worker.MatrixError):
            self.check(manifest=link)

    def test_manifest_parent_symlink_refused(self):
        alias=self.root/'alias-parent'
        alias.symlink_to(self.root,target_is_directory=True)
        with self.assertRaises(worker.MatrixError):
            self.check(manifest=alias/'matrix.json')

    def test_unknown_key_and_readiness_spoof_refused(self):
        self.items[0]['scienceReady']=True
        self.save()
        with self.assertRaises(worker.MatrixError):self.check()

    def test_bad_source_pin_rejected_even_with_valid_firmware_evidence(self):
        self.items[1]['sourceReceiptSha256']='0'*64
        self.save()
        with self.assertRaises(worker.MatrixError):self.check()

    def test_tiff_modified_after_capture_receipt_refused(self):
        with self.samples[0].f.tiffs[0].open('ab') as f:f.write(b'tampered')
        with self.assertRaises(worker.MatrixError):self.check()

    def test_firmware_evidence_mutation_during_xmp_scan_refused(self):
        real=worker._load_cohort_worker()
        original=real.census
        count=0
        def sabotage(**kwargs):
            nonlocal count
            output=original(**kwargs)
            count+=1
            if count==1:
                with Path(self.items[0]['firmwareEvidence']).open('ab') as f:
                    f.write(b'late')
            return output
        with mock.patch.object(worker,'_load_cohort_worker',return_value=real):
            with mock.patch.object(real,'census',side_effect=sabotage):
                with self.assertRaises(worker.MatrixError):self.check()
        self.assertEqual(count,1)

    def test_cli_rejects_bad_input_without_paths_or_private_evidence(self):
        err=io.StringIO()
        with redirect_stderr(err):
            code=worker.main(['--manifest',str(self.manifest),
                              '--manifest-sha256','0'*64])
        self.assertEqual(code,2)
        self.assertNotIn(str(self.root),err.getvalue())
        self.assertNotIn(self.items[0]['sourceReceipt'],err.getvalue())


if __name__=='__main__':
    unittest.main()
