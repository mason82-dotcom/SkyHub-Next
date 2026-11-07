"""P3.5b: real synthetic GeoTIFF panel ROIs, strict private manifest and zero readiness."""
from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

try:
    import numpy as np
    import rasterio
    from rasterio.warp import transform
except ImportError:
    np = rasterio = None

ROOT = Path(__file__).resolve().parents[1]


def load(path, alias):
    spec = importlib.util.spec_from_file_location(alias, ROOT / path)
    obj = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(obj)
    return obj


worker = load('backend/workers/m3m_private_panel_consistency.py',
              'm3m_private_panel_consistency_lab')
seal = load('backend/workers/m3m_raster_bundle_seal.py',
            'm3m_private_panel_seal')
raster_fixture = load('tests/test_m3m_raster_bundle_verify.py',
                      'm3m_private_panel_raster_fixture')


@unittest.skipUnless(np is not None and rasterio is not None,
                     'NumPy and rasterio optional binary wheels required')
class PanelConsistencyTests(unittest.TestCase):
    def setUp(self):
        self.fixture = raster_fixture.TestM3mRasterBundleQa(
            methodName='test_valid_bundle_and_no_writes')
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.bundle = self.fixture.root
        self.seal = self.bundle.parent / 'private-panel-seal.json'
        self.source_pin = seal.create_seal(self.bundle, self.seal)['sha256OfSeal']
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.folder = Path(tmp.name)
        self.document = self.folder / 'panel-observations.json'
        self.panels = self.sample_data()
        self.save()

    def polygon(self, points):
        x, y = transform('EPSG:32632', 'EPSG:4326',
                         [p[0] for p in points], [p[1] for p in points])
        return {'type': 'Polygon', 'coordinates': [[list(v) for v in zip(x, y)]]}

    def panel(self, name, x1, y1, x2, y2):
        corners = [(x1,y1), (x2,y1), (x2,y2), (x1,y2), (x1,y1)]
        band_values = {'red': .2, 'green': .3, 'red_edge': .4, 'nir': .6}
        return {
            'panelId': name,
            'geometry': self.polygon(corners),
            'operatorReferenceReflectance': {k: v + .01 for k,v in band_values.items()},
            'operatorAbsoluteUncertainty': {k: .025 for k in band_values}
        }

    def sample_data(self):
        return {
            'schema': worker.SCHEMA,
            'classification':
                'operator-supplied-panel-measurements-unverified-independent-provenance',
            'captureProvenanceVerified': False,
            'panelInstrumentTraceabilityVerified': False,
            'radiometricCalibrationVerified': False,
            'operationalUseAllowed': False,
            'samples': [
                self.panel('panelA',450000.005,5399999.995,
                           450000.045,5399999.955),
                self.panel('panelB',450000.105,5399999.945,
                           450000.145,5399999.905)
            ]
        }

    def save(self):
        raw = (json.dumps(self.panels, separators=(',', ':'), sort_keys=True,
                          allow_nan=False) + '\n').encode()
        self.document.write_bytes(raw)
        self.pin = hashlib.sha256(raw).hexdigest()

    def inspect(self, **changed):
        config = dict(bundle=self.bundle, seal=self.seal,
                      seal_sha256=self.source_pin,
                      panels_file=self.document, panels_sha256=self.pin)
        config.update(changed)
        return worker.audit(**config)

    def test_two_disjoint_synthetic_panels_are_quantitatively_compared(self):
        data = self.inspect()
        self.assertEqual(data['panelCount'], 2)
        self.assertEqual(data['uniqueCoveredPixels'], 2)
        self.assertTrue(data['allPanelsWithinOperatorProvidedUncertainty'])
        self.assertTrue(data['sourceBundleQaRecheckedAfterRead'])
        self.assertTrue(data['panelEvidenceSha256RecheckedAfterRead'])
        self.assertEqual(list(data['bands']), list(worker.BANDS))
        for band, row in data['bands'].items():
            self.assertEqual(row['panelCount'],2)
            self.assertEqual(row['samplePixels'],2)
            self.assertEqual(row['withinOperatorUncertaintyCount'],2)
            self.assertAlmostEqual(row['meanSignedDeviation'],-.01,places=5)
            self.assertAlmostEqual(row['meanAbsoluteDeviation'],.01,places=5)
        for flag in (
            'panelInstrumentTraceabilityVerified','independentPanelMeasurementsVerified',
            'radiometricCalibrationVerified','captureProvenanceVerified',
            'bandCoregistrationVerified','reflectanceReady','ndviReady','ndreReady',
            'operationalUseAllowed','prescriptionExportAllowed','flightMissionAllowed'):
            self.assertIs(data[flag],False)
        result=json.dumps(data)
        for sensitive in (str(self.folder),str(self.bundle),self.source_pin,self.pin,
                          'panelA','panelB','coordinates'):
            self.assertNotIn(sensitive,result)

    def test_large_synthetic_reflectance_difference_is_not_silently_approved(self):
        for entry in self.panels['samples']:
            for band in worker.BANDS:
                entry['operatorReferenceReflectance'][band] += .2
        self.save()
        report = self.inspect()
        self.assertFalse(report['allPanelsWithinOperatorProvidedUncertainty'])
        self.assertTrue(all(row['withinOperatorUncertaintyCount']==0
                            for row in report['bands'].values()))
        self.assertFalse(report['radiometricCalibrationVerified'])

    def test_two_overlapping_polygons_do_not_count_as_independent_panels(self):
        self.panels['samples'][1]['geometry'] = self.panels['samples'][0]['geometry']
        self.save()
        with self.assertRaises(worker.PanelEvidenceError):
            self.inspect()

    def test_missing_or_extra_schema_fields_duplicate_ids_and_lied_flags_rejected(self):
        original=self.sample_data()
        for name in ('radiometricCalibrationVerified',
                     'panelInstrumentTraceabilityVerified','operationalUseAllowed'):
            self.panels=dict(original)
            self.panels[name]=True
            self.save()
            with self.assertRaises(worker.PanelEvidenceError):
                self.inspect()
        self.panels=self.sample_data()
        self.panels['samples'][1]['panelId']='panelA'
        self.save()
        with self.assertRaises(worker.PanelEvidenceError):
            self.inspect()
        self.panels=self.sample_data()
        self.panels['GPS_SECRET']='ignore'
        self.save()
        with self.assertRaises(worker.PanelEvidenceError):
            self.inspect()

    def test_invalid_polygon_and_unphysical_claims_rejected(self):
        self.panels['samples'][0]['geometry']={
            'type':'Point', 'coordinates':[9.0,49.0]}
        self.save()
        with self.assertRaises(worker.PanelEvidenceError):
            self.inspect()
        self.panels=self.sample_data()
        self.panels['samples'][0]['operatorReferenceReflectance']['nir']=1.25
        self.save()
        with self.assertRaises(worker.PanelEvidenceError):
            self.inspect()

    def test_wrong_independent_pins_tampering_and_symlink_are_refused(self):
        with self.assertRaises(worker.PanelEvidenceError):
            self.inspect(panels_sha256='0'*64)
        with self.assertRaises(Exception):
            self.inspect(seal_sha256='f'*64)
        symlink=self.folder/'alias.json'
        symlink.symlink_to(self.document)
        with self.assertRaises(worker.PanelEvidenceError):
            self.inspect(panels_file=symlink)
        with (self.bundle/'indices'/'ndvi.tif').open('ab') as file:
            file.write(b'tamper')
        with self.assertRaises(Exception):
            self.inspect()

    def test_noncanonical_manifest_is_refused_even_with_new_sha_pin(self):
        pretty = (json.dumps(self.panels, indent=2, sort_keys=True) + '\n').encode()
        self.document.write_bytes(pretty)
        new_pin = hashlib.sha256(pretty).hexdigest()
        with self.assertRaises(worker.PanelEvidenceError):
            self.inspect(panels_sha256=new_pin)

    def test_nested_panel_path_symlink_is_refused(self):
        private = self.folder / 'private'
        private.mkdir(mode=0o700)
        nested = private / 'nested'
        nested.mkdir(mode=0o700)
        payload = nested / 'copied-panels.json'
        payload.write_bytes(self.document.read_bytes())
        alias = self.folder / 'private-alias'
        alias.symlink_to(private, target_is_directory=True)
        with self.assertRaises(worker.PanelEvidenceError):
            self.inspect(panels_file=alias/'nested'/'copied-panels.json')

    def test_rechecks_panel_manifest_after_raster_sampling(self):
        real = worker._read_private
        count = 0
        def sabotage(path):
            nonlocal count
            count+=1
            if count == 2:
                with self.document.open('ab') as file:
                    file.write(b'late')
            return real(path)
        with mock.patch.object(worker,'_read_private',side_effect=sabotage):
            with self.assertRaises(worker.PanelEvidenceError):
                self.inspect()
        self.assertEqual(count,2)

    def test_empty_raster_panel_is_refused_without_false_statistics(self):
        # The synthetic bundle has NoData at col=1, row=0.
        self.panels['samples'][0]['geometry']=self.polygon([
            (450000.055,5399999.995),(450000.095,5399999.995),
            (450000.095,5399999.955),(450000.055,5399999.955),
            (450000.055,5399999.995)
        ])
        self.save()
        with self.assertRaises(worker.PanelEvidenceError):
            self.inspect()


if __name__ == '__main__':
    unittest.main()
