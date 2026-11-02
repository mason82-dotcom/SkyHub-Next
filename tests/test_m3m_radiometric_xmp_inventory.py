"""P3.6b actual synthetic 16-bit TIFF + XMP radiometric marker acceptance."""
from __future__ import annotations

import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from contextlib import redirect_stderr

ROOT = Path(__file__).resolve().parents[1]


def load(path, alias):
    spec = importlib.util.spec_from_file_location(alias, ROOT / path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


worker = load('backend/workers/m3m_radiometric_xmp_inventory.py', 'skyhub_p36b_xmp_worker')
prior = load('tests/test_m3m_field_evidence_preflight.py', 'skyhub_p36b_field_fixture')
source = load('backend/workers/m3m_source_capture_receipt.py', 'skyhub_p36b_p1_receipt')

try:
    import numpy as np
    import tifffile
    import rasterio
    import defusedxml
except ImportError:
    np = tifffile = rasterio = defusedxml = None


@unittest.skipUnless(np is not None and tifffile is not None and
                     rasterio is not None and defusedxml is not None,
                     'Needs binary TIFF and safe XMP parser dependencies')
class RadiometricXmpInventoryTests(unittest.TestCase):
    def setUp(self):
        fixture = prior.FieldEvidencePreflightTests(
            methodName='test_valid_originals_but_evidence_missing_never_calibrated')
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        self.f = fixture
        self.params = dict(
            tiffs=fixture.tiffs,
            source_receipt=fixture.source_receipt,
            source_receipt_sha256=fixture.source_pin,
            evidence_dir=fixture.evidence,
            evidence_manifest_sha256=fixture.evidence_pin,
        )

    def render(self, field_values, *, inject=None, extra=''):
        names = {'G': 'Green', 'R': 'Red', 'RE': 'RedEdge', 'NIR': 'NIR'}
        sources = {'G': 'MS_G_CAMERA', 'R': 'MS_R_CAMERA',
                   'RE': 'MS_RE_CAMERA', 'NIR': 'MS_NIR_CAMERA'}
        for index, band in enumerate(source.BANDS):
            attrs = {
                'BandName': names[band],
                'ImageSource': sources[band],
                'CaptureUUID': self.f.fixture.capture,
                **field_values,
                'SensorIndex': str(index+1),
            }
            if inject and band in inject:
                for key, val in inject[band].items():
                    if val is None:
                        attrs.pop(key, None)
                    else:
                        attrs[key] = val
            attributes = ' '.join('d:'+key+'="'+str(value)+'"' for key, value in attrs.items())
            xml = (('<x:xmpmeta xmlns:x="adobe:ns:meta/" '
                    'xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" '
                    'xmlns:d="http://www.dji.com/drone-dji/1.0/">'
                    '<rdf:RDF><rdf:Description ' + attributes + '>' +
                    extra + '</rdf:Description></rdf:RDF></x:xmpmeta>').encode())
            tifffile.imwrite(self.f.tiffs[index],
                             np.full((16,16), 101+index, dtype='uint16'),
                             metadata=None,
                             extratags=[(700,'B',len(xml),xml,False)])
        data = source.create_receipt(self.f.tiffs)
        saved=(json.dumps(data,sort_keys=True)+'\n').encode()
        self.f.source_receipt.write_bytes(saved)
        self.f.source_pin=hashlib.sha256(saved).hexdigest()
        self.params['source_receipt_sha256']=self.f.source_pin

    @staticmethod
    def complete():
        return dict(SensorGain='1.044', ExposureTime='1000',
                    SensorGainAdjustment='1.002',
                    Irradiance='2000.000', BlackLevel='3200',
                    VignettingData='-0.000070832,1.829488e-06,-5.307911e-09,8.820567e-12,-6.663875e-15,1.885447e-18')

    def test_originals_without_radiometry_report_missing_only(self):
        r=worker.inspect(**self.params)
        self.assertFalse(r['allRequiredFieldsPresentAndWellFormed'])
        self.assertTrue(all(n==4 for n in r['requiredFieldMissingCounts'].values()))
        self.assertTrue(r['sourceAndEvidencePinsReverified'])
        self.assertFalse(r['radiometricCalibrationVerified'])

    def test_complete_documented_fields_yield_presence_not_readiness(self):
        self.render(self.complete())
        report=worker.inspect(**self.params)
        self.assertEqual(report['spectralOriginalsExamined'],4)
        self.assertEqual(report['requiredFieldTypes'],7)
        self.assertTrue(report['allRequiredFieldsPresentAndWellFormed'])
        self.assertEqual(report['requiredFieldMissingCounts'],
                         {k:0 for k in worker.REQUIRED})
        self.assertEqual(report['documentedUnitOfExposureTime'],'microsecond')
        for flag in ('xmpClaimsAuthentic','calibrationVerified',
                     'sunlightSensorValuesValidated',
                     'bandCoregistrationVerified','radiometricCalibrationVerified',
                     'reflectanceReady','ndviReady','ndreReady',
                     'scienceReady','operationalUseAllowed',
                     'prescriptionExportAllowed','flightMissionAllowed'):
            self.assertIs(report[flag],False)
        raw=json.dumps(report)
        for forbidden in (self.f.fixture.capture, '2000.000', '3200',
                          str(self.f.root), str(self.f.fixture.root),
                          self.f.source_pin, '1.044'):
            self.assertNotIn(forbidden,raw)

    def test_partial_fields_are_reported_in_aggregate_without_raw_data(self):
        self.render(self.complete(), inject={
            'R':{'Irradiance':None},'NIR':{'VignettingData':None}})
        out=worker.inspect(**self.params)
        self.assertEqual(out['requiredFieldMissingCounts']['Irradiance'],1)
        self.assertEqual(out['requiredFieldMissingCounts']['VignettingData'],1)
        self.assertFalse(out['allRequiredFieldsPresentAndWellFormed'])
        self.assertFalse(out['reflectanceReady'])

    def test_invalid_gain_exposure_irradiance_and_vignette_fail_closed(self):
        for name,value in [('SensorGain','nan'),('ExposureTime','0'),
                           ('Irradiance','-3'),('VignettingData','0,1,2'),
                           ('SensorGainAdjustment','inf'),
                           ('BlackLevel','65536')]:
            with self.subTest(field=name):
                self.render(self.complete(),inject={'G':{name:value}})
                with self.assertRaises(worker.RadiometricXmpError):
                    worker.inspect(**self.params)

    def test_conflicting_sensor_index_rejected(self):
        self.render(self.complete(),inject={'NIR':{'SensorIndex':'2'}})
        with self.assertRaises(worker.RadiometricXmpError):
            worker.inspect(**self.params)

    def test_duplicate_radiometric_attribute_and_element_rejected(self):
        self.render(self.complete(),extra='<d:SensorGain>1.044</d:SensorGain>')
        with self.assertRaises(worker.RadiometricXmpError):
            worker.inspect(**self.params)

    def test_unsafe_sunsensor_flag_rejected(self):
        self.render({**self.complete(),'VignettingFlag':'1'})
        with self.assertRaises(worker.RadiometricXmpError):
            worker.inspect(**self.params)

    def test_optional_keys_accepted_only_as_numeric_markers(self):
        params={**self.complete(),
                'CalibratedOpticalCenterX':'1296',
                'CalibratedOpticalCenterY':'972',
                'VignettingFlag':'0','LS_status':'2'}
        self.render(params)
        report=worker.inspect(**self.params)
        self.assertEqual(report['optionalFieldPresentCounts'],
                         {k:4 for k in worker.OPTIONAL})
        self.assertFalse(report['sunlightSensorValuesValidated'])

    def test_original_tiff_mutation_after_source_receipt_refused(self):
        self.render(self.complete())
        with self.f.tiffs[0].open('ab') as output:
            output.write(b'unapproved')
        with self.assertRaises(worker.RadiometricXmpError):
            worker.inspect(**self.params)

    def test_bad_evidence_pin_rejected_even_with_complete_metadata(self):
        self.render(self.complete())
        with self.assertRaises(worker.RadiometricXmpError):
            worker.inspect(**{**self.params,
                              'evidence_manifest_sha256':'0'*64})

    def test_cli_failure_never_leaks_private_paths(self):
        err=io.StringIO()
        with redirect_stderr(err):
            rc=worker.main(['--tiff',str(self.f.tiffs[0]),
                            '--source-receipt',str(self.f.source_receipt),
                            '--source-receipt-sha256',self.f.source_pin,
                            '--evidence-dir',str(self.f.evidence),
                            '--evidence-manifest-sha256',self.f.evidence_pin])
        self.assertEqual(rc,2)
        self.assertNotIn(str(self.f.root),err.getvalue())
        self.assertNotIn(self.f.fixture.capture,err.getvalue())


if __name__ == '__main__':
    unittest.main()
