"""P3.6c: real synthetic TIFF/P1-pinned DJI-XMP marker cohort tests."""
from __future__ import annotations

import importlib.util
import io
import json
from contextlib import redirect_stderr
from pathlib import Path
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]

def load(path, name):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

worker = load('backend/workers/m3m_private_xmp_cohort.py', 'm3m_p36c_cohort')
previous = load('tests/test_m3m_radiometric_xmp_inventory.py', 'm3m_p36c_b_fixture')

try:
    import numpy
    import tifffile
    import rasterio
    import defusedxml
except ImportError:
    numpy = tifffile = rasterio = defusedxml = None


@unittest.skipUnless(numpy is not None and tifffile is not None and
                     rasterio is not None and defusedxml is not None,
                     'Need TIFF/XMP offline test dependencies')
class M3mXmpCohortTests(unittest.TestCase):
    def setUp(self):
        f = previous.RadiometricXmpInventoryTests(
            methodName='test_originals_without_radiometry_report_missing_only')
        f.setUp()
        self.addCleanup(f.doCleanups)
        self.f = f

    def inspect(self, **changes):
        return worker.census(**{**self.f.params, **changes})

    def test_no_radiometry_only_original_p1_markers(self):
        result = self.inspect()
        self.assertEqual(result['originalSpectralTiffCount'], 4)
        self.assertFalse(result['canonicalRequiredFieldsCompleteOnAllBands'])
        self.assertEqual(sum(result['documentedAdditionalMarkerPresenceCounts'].values()), 0)
        self.assertEqual(result['unknownDjiNamespaceMarkerCountsByInputOrder'], [0,0,0,0])
        self.assertEqual(result['documentedMarkerCountsByInputOrder'], [0,0,0,0])
        self.assertFalse(result['firmwareVersionVerified'])

    def test_manual_2024_markers_present_but_never_calibrated(self):
        extras={name:'1.234' for name in worker.MANUAL_FIELDS}
        self.f.render({**self.f.complete(), **extras})
        out=self.inspect()
        self.assertTrue(out['canonicalRequiredFieldsCompleteOnAllBands'])
        self.assertEqual(out['documentedAdditionalMarkerPresenceCounts'],
                         {k:4 for k in worker.MANUAL_FIELDS})
        self.assertEqual(out['documentedMarkerCountsByInputOrder'],
                         [7+len(worker.MANUAL_FIELDS)]*4)
        self.assertEqual(out['canonicalVignettingAndPolynomialCooccurCount'], 4)
        self.assertTrue(out['manualReviewRequiredForCooccurringVignettingMetadata'])
        for key in ('firmwareVersionVerified',
                    'manufacturerSourceAuthenticityVerified',
                    'xmpMetadataClaimsScientificallyValidated',
                    'sunlightSensorValuesValidated',
                    'radiometricCalibrationVerified',
                    'bandCoregistrationVerified',
                    'reflectanceReady', 'ndviReady', 'ndreReady',
                    'scienceReady', 'operationalUseAllowed',
                    'prescriptionExportAllowed', 'flightMissionAllowed'):
            self.assertIs(out[key], False)

    def test_only_selected_band_has_additional_manual_marker(self):
        self.f.render(self.f.complete(),inject={
            'NIR': {'IrradianceExposureTime':'0.02'}})
        out=self.inspect()
        self.assertEqual(out['documentedAdditionalMarkerPresenceCounts'][
            'IrradianceExposureTime'],1)
        self.assertFalse(out['manualReviewRequiredForCooccurringVignettingMetadata'])

    def test_unfamiliar_dji_marker_count_only_and_no_firmware_exposure(self):
        self.f.render(self.f.complete(),inject={
            'G':{'FirmwareVersion':'private-firmware-token-2026',
                 'PrivateCameraSerial':'private-serial-xyz'}})
        out=self.inspect()
        self.assertEqual(out['unknownDjiNamespaceMarkerCountsByInputOrder'],
                         [2,0,0,0])
        content=json.dumps(out)
        for secret in ('private-firmware-token-2026', 'PrivateCameraSerial',
                       'FirmwareVersion', self.f.f.fixture.capture,
                       str(self.f.f.fixture.root), str(self.f.f.root),
                       self.f.params['source_receipt_sha256']):
            self.assertNotIn(secret,content)
        self.assertFalse(out['firmwareVersionReadOrReleased'])

    def test_untrusted_unknown_marker_is_counted_once_per_band(self):
        self.f.render(self.f.complete(),
                      inject={'G':{'VendorUndocumentedField':'some-secret'}},
                      extra='<d:VendorUndocumentedField>another-secret</d:VendorUndocumentedField>')
        result=self.inspect()
        self.assertEqual(result['unknownDjiNamespaceMarkerCountsByInputOrder'],
                         [1,1,1,1])
        self.assertNotIn('some-secret',str(result))

    def test_duplicate_documented_manual_marker_rejected(self):
        self.f.render({**self.f.complete(),'VignettingPolynomial':'0,0,0,0,0,0'},
                      extra='<d:VignettingPolynomial>0,0,0,0,0,0</d:VignettingPolynomial>')
        with self.assertRaises(worker.CohortError):
            self.inspect()

    def test_duplicate_canonical_marker_rejected_by_upstream(self):
        self.f.render(self.f.complete(),extra='<d:SensorGain>1.044</d:SensorGain>')
        with self.assertRaises(worker.CohortError):
            self.inspect()

    def test_bogus_sensor_index_or_negative_gain_rejected_upstream(self):
        self.f.render(self.f.complete(),inject={'G':{'SensorIndex':'4'}})
        with self.assertRaises(worker.CohortError):self.inspect()
        self.f.render(self.f.complete(),inject={'G':{'SensorGain':'-1'}})
        with self.assertRaises(worker.CohortError):self.inspect()

    def test_wrong_independent_evidence_pin_is_refused(self):
        self.f.render(self.f.complete())
        with self.assertRaises(worker.CohortError):
            self.inspect(evidence_manifest_sha256='0'*64)

    def test_tiff_byte_change_after_pin_fails_closed(self):
        self.f.render(self.f.complete())
        with self.f.f.tiffs[0].open('ab') as file:
            file.write(b'late-change')
        with self.assertRaises(worker.CohortError):self.inspect()

    def test_tiff_mutation_during_marker_scan_rejected_by_replay(self):
        self.f.render(self.f.complete())
        original=worker._probe_tiff
        n=0
        def late(path, known):
            nonlocal n
            output=original(path, known)
            n+=1
            if n==1:
                with self.f.f.tiffs[0].open('ab') as file:
                    file.write(b'altered-during-probe')
            return output
        with mock.patch.object(worker,'_probe_tiff',side_effect=late):
            with self.assertRaises(worker.CohortError):
                self.inspect()
        self.assertEqual(n,4)

    def test_names_not_values_are_measured_without_autocalibration(self):
        self.f.render({**self.f.complete(),
                       'RawData':'private-numeric-171,16',
                       'SunSensorYaw':'secret-angle',
                       'VignettingCenter':'secret-center'})
        result=self.inspect()
        self.assertEqual(result['documentedAdditionalMarkerPresenceCounts']['RawData'],4)
        for banned in ('private-numeric-171,16','secret-angle','secret-center'):
            self.assertNotIn(banned,json.dumps(result))
        self.assertFalse(result['radiometricCalibrationVerified'])

    def test_cli_fails_with_only_one_original_and_never_prints_private_paths(self):
        err=io.StringIO()
        with redirect_stderr(err):
            rc=worker.main(['--tiff',str(self.f.f.tiffs[0]),
                            '--source-receipt',str(self.f.f.source_receipt),
                            '--source-receipt-sha256',
                            self.f.params['source_receipt_sha256'],
                            '--evidence-dir',str(self.f.f.evidence),
                            '--evidence-manifest-sha256',
                            self.f.params['evidence_manifest_sha256']])
        self.assertEqual(rc,2)
        self.assertNotIn(str(self.f.f.tiffs[0]),err.getvalue())
        self.assertNotIn(self.f.f.fixture.capture,err.getvalue())


if __name__ == '__main__':
    unittest.main()
