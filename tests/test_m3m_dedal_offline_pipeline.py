"""Integration tests: real raster IO with synthetic pixels, no DEDAL execution."""
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
    from rasterio.transform import from_origin
except ImportError:
    np = None
    rasterio = None

SCRIPT = Path(__file__).resolve().parents[1] / 'backend/workers/m3m_dedal_offline_pipeline.py'
spec = importlib.util.spec_from_file_location('m3m_dedal_offline_pipeline', SCRIPT)
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


@unittest.skipUnless(np is not None and rasterio is not None, 'Requires optional rasterio+numpy')
class OfflinePipelineTests(unittest.TestCase):
    def setUp(self):
        self.ctx = tempfile.TemporaryDirectory()
        self.addCleanup(self.ctx.cleanup)
        self.root = Path(self.ctx.name)
        self.src = self.root / 'orthophoto.tif'
        self.dest = self.root / 'experiment'
        self.data = np.zeros((5, 2, 3), dtype=np.uint16)
        self.data[0] = 6554   # red = .20
        self.data[1] = 9830   # green = .30
        self.data[2] = 19661  # NIR = .60
        self.data[3] = 13107  # rededge = .40
        self.data[4] = 65535
        self.data[4, 0, 1] = 0
        self.write()

    def write(self):
        with rasterio.open(self.src, 'w', driver='GTiff', count=5, height=2, width=3,
                           dtype='uint16', crs='EPSG:32632',
                           transform=from_origin(440000, 5400000, .05, .05)) as out:
            out.write(self.data)
        self.sha = hashlib.sha256(self.src.read_bytes()).hexdigest()

    def execute(self, **kwargs):
        opts = {'orthophoto': self.src, 'expected_sha256': self.sha,
                'output_dir': self.dest, 'calibration_status': 'accepted'}
        opts.update(kwargs)
        return worker.run_pipeline(**opts)

    def test_entire_two_stage_pipeline_is_numerically_correct(self):
        report = self.execute()
        self.assertTrue(report['sourceSha256MatchesOperatorPin'])
        self.assertTrue(report['independentRasterQaPassed'])
        self.assertFalse(report['calibrationVerified'] if 'calibrationVerified' in report else report['radiometricCalibrationVerified'])
        self.assertFalse(report['operationalUseAllowed'])
        self.assertFalse(report['dedalExecutedBySkyHub'])
        self.assertEqual(report['reflectanceValidPixels']['red'], 5)
        self.assertEqual(report['indicesValidPixels']['ndvi'], 5)
        self.assertEqual(report['stageSchemas'], [
            'skyhub-m3m-dedal-ortho-handoff-v1',
            'skyhub-m3m-experimental-index-raster-v1'])
        with rasterio.open(self.dest / 'indices' / 'ndvi.tif') as tif:
            self.assertEqual(tif.crs.to_epsg(), 32632)
            actual = tif.read(1)
            expected = ((19661/32768) - (6554/32768)) / ((19661/32768) + (6554/32768))
            self.assertAlmostEqual(float(actual[0, 0]), expected, places=5)
            self.assertEqual(float(actual[0, 1]), -9999.0)
        with rasterio.open(self.dest / 'indices' / 'osavi.tif') as tif:
            self.assertAlmostEqual(float(tif.read(1)[0, 0]),
                                   1.16*(19661/32768 - 6554/32768) /
                                   (19661/32768 + 6554/32768 + .16), places=5)
        self.assertEqual(json.loads((self.dest/'bundle-report.json').read_text()), report)

    def test_wrong_sha_fails_before_creating_dir(self):
        with self.assertRaises(worker.PipelineError):
            self.execute(expected_sha256='0'*64)
        self.assertFalse(self.dest.exists())

    def test_invalid_digest_format(self):
        with self.assertRaises(worker.PipelineError):
            self.execute(expected_sha256='xxxx')
        self.assertFalse(self.dest.exists())

    def test_not_calibrated_rejected(self):
        with self.assertRaises(worker.PipelineError):
            self.execute(calibration_status='not_calibrated')
        self.assertFalse(self.dest.exists())

    def test_flagged_requires_explicit_opt_in(self):
        with self.assertRaises(worker.PipelineError):
            self.execute(calibration_status='flagged')
        report = self.execute(calibration_status='flagged', allow_flagged=True)
        self.assertEqual(report['externalCalibrationStatusClaim'], 'flagged')
        self.assertFalse(report['reflectanceReady'])
        self.assertFalse(report['operationalUseAllowed'])

    def test_above_one_reflectance_fails_and_no_partial_data_published(self):
        self.data[0, 1, 0] = 32769
        self.write()
        with self.assertRaises(ValueError):
            self.execute()
        self.assertFalse(self.dest.exists())
        self.assertFalse(any(self.root.glob('.skyhub-m3m-pipeline-*')))

    def test_all_transparent_pixels_are_refused(self):
        self.data[4] = 0
        self.write()
        with self.assertRaises(worker.PipelineError):
            self.execute()
        self.assertFalse(self.dest.exists())

    def test_existing_destination_not_overwritten(self):
        self.dest.mkdir()
        (self.dest/'sentinel').write_text('intact')
        with self.assertRaises(worker.PipelineError):
            self.execute()
        self.assertEqual((self.dest/'sentinel').read_text(), 'intact')

    def test_source_symlink_rejected(self):
        link = self.root/'link.tif'
        link.symlink_to(self.src)
        with self.assertRaises(worker.PipelineError):
            self.execute(orthophoto=link)

    def test_source_changed_after_first_stage_is_refused(self):
        actual = worker._load_worker
        def sabotage(mod):
            obj = actual(mod)
            if mod == 'm3m_reflectance_indices':
                produce = obj.produce
                def altered(*args, **kwargs):
                    result = produce(*args, **kwargs)
                    with self.src.open('ab') as f:
                        f.write(b'modified')
                    return result
                obj.produce = altered
            return obj
        with mock.patch.object(worker, '_load_worker', side_effect=sabotage):
            with self.assertRaises(worker.PipelineError):
                self.execute()
        self.assertFalse(self.dest.exists())
        self.assertFalse(any(self.root.glob('.skyhub-m3m-pipeline-*')))

    def test_refuse_index_stage_fabricated_readiness(self):
        actual = worker._load_worker
        def invalid_report(mod):
            obj = actual(mod)
            if mod == 'm3m_reflectance_indices':
                produce = obj.produce
                def changed(*args, **kwargs):
                    result = produce(*args, **kwargs)
                    result['ndviReady'] = True
                    return result
                obj.produce = changed
            return obj
        with mock.patch.object(worker, '_load_worker', side_effect=invalid_report):
            with self.assertRaises(worker.PipelineError):
                self.execute()
        self.assertFalse(self.dest.exists())

    def test_reject_failed_independent_bundle_qa_and_cleanup(self):
        actual = worker._load_worker
        def fail_qa(module_name):
            obj = actual(module_name)
            if module_name == 'm3m_raster_bundle_verify':
                obj.verify_bundle = lambda bundle: {'pixelFormulaAndMaskChecksPassed': False}
            return obj
        with mock.patch.object(worker, '_load_worker', side_effect=fail_qa):
            with self.assertRaises(worker.PipelineError):
                self.execute()
        self.assertFalse(self.dest.exists())
        self.assertFalse(any(self.root.glob('.skyhub-m3m-pipeline-*')))

    def test_no_private_source_path_leaks_into_report(self):
        report = self.execute()
        self.assertNotIn(str(self.src), json.dumps(report))
        self.assertNotIn(str(self.root), json.dumps(report))


if __name__ == '__main__':
    unittest.main()
