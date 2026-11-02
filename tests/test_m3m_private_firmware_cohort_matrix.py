"""P3.6d private operator-declared firmware cohort matrix tests, synthetic TIFF only."""
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


def _load(path, name):
    spec = importlib.util.spec_from_file_location(name, ROOT/path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


worker = _load('backend/workers/m3m_private_firmware_cohort_matrix.py',
               'm3m_private_fw_matrix_tests')
source = _load('tests/test_m3m_private_xmp_cohort.py',
               'm3m_private_fw_cohort_fixture')

try:
    import numpy as np
    import rasterio
    import tifffile
    import defusedxml
except ImportError:
    np = rasterio = tifffile = defusedxml = None


@unittest.skipUnless(all(x is not None for x in
                         (np, rasterio, tifffile, defusedxml)),
                     'Requires genuine synthetic binary TIFF/XMP fixtures')
class M3mFirmwareCohortMatrixTests(unittest.TestCase):
    def setUp(self):
        t = tempfile.TemporaryDirectory()
        self.addCleanup(t.cleanup)
        self.root = Path(t.name)
        self.cases = []
        self.fixtures = []
        for index in range(2):
            fixture = source.M3mXmpCohortTests(
                methodName='test_no_radiometry_only_original_p1_markers')
            fixture.setUp()
            self.addCleanup(fixture.doCleanups)
            self.fixtures.append(fixture)
            if index == 0:
                fixture.f.render(fixture.f.complete())
            else:
                fixture.f.render({
                    **fixture.f.complete(),
                    'VignettingPolynomial': '0,0,0,0,0,0',
                    'IrradianceExposureTime': '1.234',
                })
                fixture.f.f.add_evidence('sunlightSensor', 'panelImage')
                fixture.f.params['evidence_manifest_sha256'] = fixture.f.f.evidence_pin
            private = fixture.f.f.root
            firmware_doc = private/'operator-firmware-document.bin'
            firmware_doc.write_bytes(('opaque field supplied document for ' +
                                      chr(65+index)).encode())
            firmware_doc.chmod(0o600)
            content = firmware_doc.read_bytes()
            cfg = fixture.f.params
            self.cases.append({
                'slot': chr(65+index),
                'declaredFirmware': 'operator-release-v' + str(index+1),
                'firmwareEvidenceFile': str(firmware_doc),
                'firmwareEvidenceSha256': hashlib.sha256(content).hexdigest(),
                'firmwareEvidenceBytes': len(content),
                'tiffs': {name: str(path) for name,path
                          in zip(worker.BANDS, cfg['tiffs'])},
                'sourceReceipt': str(cfg['source_receipt']),
                'sourceReceiptSha256': cfg['source_receipt_sha256'],
                'evidenceDir': str(cfg['evidence_dir']),
                'evidenceManifestSha256': cfg['evidence_manifest_sha256'],
            })
        self.manifest = self.root/'firmware-cohorts.json'
        self.header = {
            'schema': worker.SCHEMA,
            'classification':
                'private-operator-declared-cohorts-not-manufacturer-attested',
            'scientificApprovalClaim': False,
            'firmwareAttestedClaim': False,
            'cases': self.cases,
        }
        self.save()

    def save(self, *, content=None):
        if content is None:
            content = worker._canonical(self.header)
        self.manifest.write_bytes(content)
        self.manifest.chmod(0o600)
        self.pin = hashlib.sha256(content).hexdigest()
        return self.pin

    def inspect(self, **updates):
        args = {'manifest_file': self.manifest,
                'manifest_sha256': self.pin}
        args.update(updates)
        return worker.matrix(**args)

    def test_two_distinct_operator_cohorts_produce_only_structural_differences(self):
        result=self.inspect()
        self.assertEqual(result['schema'],worker.REPORT_SCHEMA)
        self.assertEqual(result['captureCount'],2)
        self.assertEqual(result['distinctOperatorFirmwareLabels'],2)
        self.assertEqual([x['slot'] for x in result['cohorts']],['A','B'])
        self.assertTrue(result['cohortManifestRecheckedAfterAllCaptureAudits'])
        self.assertEqual(result['cohorts'][0]['reviewState'],
                         'INCOMPLETE_EVIDENCE_OR_XMP_UNVALIDATED')
        self.assertEqual(result['cohorts'][1]['evidencePresentButUnvalidated'],
                         ['sunlightSensor','panelImage'])
        pair=result['pairwiseStructuralDeltas'][0]
        self.assertEqual(pair['fromSlot'],'A')
        self.assertEqual(pair['toSlot'],'B')
        self.assertEqual(pair['documentedAdditionalMarkerCountDelta']
                         ['IrradianceExposureTime'],4)
        self.assertEqual(pair['documentedAdditionalMarkerCountDelta']
                         ['VignettingPolynomial'],4)
        self.assertEqual(pair['evidenceCategoryCountDelta'],2)
        self.assertFalse(pair['numericalRadiometricDeviationComputed'])
        for name in worker.SAFETY_FLAGS:
            self.assertIs(result[name],False)

    def test_output_never_leaks_firmware_or_coordinates_or_receipt_sha(self):
        value=json.dumps(self.inspect(),sort_keys=True)
        for secret in (
            *[case['declaredFirmware'] for case in self.cases],
            *[case['sourceReceiptSha256'] for case in self.cases],
            *[case['firmwareEvidenceSha256'] for case in self.cases],
            str(self.root), str(self.fixtures[0].f.f.root),
            self.fixtures[0].f.f.fixture.capture
        ):
            self.assertNotIn(secret,value)
        self.assertNotIn('operator-firmware-document.bin',value)
        self.assertFalse(json.loads(value)['rawXmpOrCoordinatesReleased'])

    def test_capture_label_collision_not_allowed_even_if_manifest_rehashed(self):
        self.cases[1]['declaredFirmware']=self.cases[0]['declaredFirmware']
        self.save()
        with self.assertRaises(worker.CohortMatrixError):self.inspect()

    def test_duplicate_source_or_firmware_document_hash_rejected(self):
        self.cases[1]['sourceReceiptSha256']=self.cases[0]['sourceReceiptSha256']
        self.save()
        with self.assertRaises(worker.CohortMatrixError):self.inspect()
        self.cases[1]['sourceReceiptSha256']=self.fixtures[1].f.params['source_receipt_sha256']
        self.cases[1]['firmwareEvidenceSha256']=self.cases[0]['firmwareEvidenceSha256']
        self.save()
        with self.assertRaises(worker.CohortMatrixError):self.inspect()

    def test_invalid_or_fabricated_independent_manifest_pin_rejected(self):
        with self.assertRaises(worker.CohortMatrixError):
            self.inspect(manifest_sha256='0'*64)
        with self.assertRaises(worker.CohortMatrixError):
            self.inspect(manifest_sha256='not-sha')

    def test_noncanonical_or_duplicate_manifest_fields_refused(self):
        pretty=json.dumps(self.header,indent=2).encode()+b'\n'
        self.save(content=pretty)
        with self.assertRaises(worker.CohortMatrixError):self.inspect()
        duplicate=worker._canonical(self.header).replace(
            b'"schema":',b'"schema":"forged","schema":',1)
        self.save(content=duplicate)
        with self.assertRaises(worker.CohortMatrixError):self.inspect()

    def test_overclaimed_science_and_firmware_attestation_refused(self):
        for field in ('scientificApprovalClaim','firmwareAttestedClaim'):
            self.header[field]=True
            self.save()
            with self.assertRaises(worker.CohortMatrixError):self.inspect()
            self.header[field]=False

    def test_invalid_extra_case_fields_or_wrong_path_shape_refused(self):
        self.cases[0]['sourceFilenameLeak']='sensitive'
        self.save()
        with self.assertRaises(worker.CohortMatrixError):self.inspect()
        del self.cases[0]['sourceFilenameLeak']
        self.cases[0]['tiffs'].pop('NIR')
        self.save()
        with self.assertRaises(worker.CohortMatrixError):self.inspect()

    def test_firmware_document_changes_or_wrong_mode_refused(self):
        document=Path(self.cases[0]['firmwareEvidenceFile'])
        document.write_bytes(b'different document contents')
        with self.assertRaises(worker.CohortMatrixError):self.inspect()
        document.write_bytes(b'opaque field supplied document for A')
        document.chmod(0o644)
        with self.assertRaises(worker.CohortMatrixError):self.inspect()

    def test_firmware_document_symlink_parent_refused(self):
        document=Path(self.cases[0]['firmwareEvidenceFile'])
        private=document.parent
        alias=self.root/'symlink-to-private'
        alias.symlink_to(private, target_is_directory=True)
        self.cases[0]['firmwareEvidenceFile']=str(alias/document.name)
        self.save()
        with self.assertRaises(worker.CohortMatrixError):self.inspect()

    def test_changed_source_or_evidence_pin_refused_during_real_tiff_read(self):
        self.cases[0]['evidenceManifestSha256']='0'*64
        self.save()
        with self.assertRaises(Exception):self.inspect()

    def test_earlier_document_modified_after_first_pass_rejected(self):
        original=worker._case_result
        calls=0
        file=Path(self.cases[0]['firmwareEvidenceFile'])
        def mutate(item):
            nonlocal calls
            result=original(item)
            calls+=1
            if calls==2:
                file.write_bytes(b'changed after first cohort comparison')
            return result
        with mock.patch.object(worker,'_case_result',side_effect=mutate):
            with self.assertRaises(worker.CohortMatrixError):
                self.inspect()
        self.assertGreaterEqual(calls,2)

    def test_earlier_tiff_modified_after_first_pass_rejected(self):
        original=worker._case_result
        calls=0
        file=self.fixtures[0].f.f.tiffs[0]
        def mutate(item):
            nonlocal calls
            result=original(item)
            calls+=1
            if calls==2:
                with file.open('ab') as out:out.write(b'late-hidden-change')
            return result
        with mock.patch.object(worker,'_case_result',side_effect=mutate):
            with self.assertRaises(Exception):
                self.inspect()
        self.assertGreaterEqual(calls,2)

    def test_upstream_fake_radiometry_flag_rejected(self):
        actual=worker._import
        def make_fake(name, alias):
            mod=actual(name,alias)
            if name == 'm3m_private_field_review.py':
                real=mod.review
                def forged(**opts):
                    x=real(**opts)
                    x['radiometricCalibrationVerified']=True
                    return x
                mod.review=forged
            return mod
        with mock.patch.object(worker,'_import',side_effect=make_fake):
            with self.assertRaises(worker.CohortMatrixError):
                self.inspect()

    def test_cli_missing_manifest_never_leaks_private_path(self):
        error=io.StringIO()
        with redirect_stderr(error):
            code=worker.main(['--manifest-file',str(self.root/'missing.json'),
                              '--manifest-sha256',self.pin])
        self.assertEqual(code,2)
        self.assertNotIn(str(self.root),error.getvalue())


if __name__ == '__main__':
    unittest.main()
