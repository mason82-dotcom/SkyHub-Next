"""Offline-only preflight tests; all ZIPs and images are synthetic fixtures."""
from __future__ import annotations
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

MODULE=Path(__file__).resolve().parents[1]/'backend/workers/m3m_dedal_preflight.py'
spec=importlib.util.spec_from_file_location('m3m_dedal_preflight',MODULE)
worker=importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class PreflightTests(unittest.TestCase):
    def setUp(self):
        self.context=tempfile.TemporaryDirectory()
        self.addCleanup(self.context.cleanup)
        self.root=Path(self.context.name)
        self.archive=self.root/worker.ARCHIVE_NAME
        with zipfile.ZipFile(self.archive,'w') as file:
            file.writestr('src/calibration.py','print("not executed")')
        self.sha=hashlib.sha256(self.archive.read_bytes()).hexdigest()
        self.md5=hashlib.md5(self.archive.read_bytes()).hexdigest()
        self.panel=self.root/'panel.json'
        self.panel_data={'bands': {b:{'reflectance':0.51,'wavelength_nm':wave}
                                   for b,wave in (('G',560),('R',650),('RE',730),('NIR',860))}}
        self._panel_write()
        self.images=self.root/'images'
        self.images.mkdir()
        self.panel_capture='DJI_20261023070000_0001'
        self.flight_capture='DJI_20261023073000_0002'
        for label in (self.panel_capture,self.flight_capture):
            for band in worker.BANDS:
                (self.images/(label+'_MS_'+band+'.TIF')).write_bytes(b'II*\x00'+(label+band).encode())
        self.output=self.root/'preflight-output'

    def _panel_write(self):
        self.panel.write_text(json.dumps(self.panel_data),encoding='utf8')

    def run_preflight(self,**overrides):
        kw={'archive':self.archive,'expected_sha256':self.sha,'panel':self.panel,
            'images':self.images,'panel_captures':(self.panel_capture,),
            'output_dir':self.output}
        kw.update(overrides)
        with patch.object(worker,'PUBLISHED_MD5',self.md5):
            return worker.preflight(**kw)

    def test_success_is_private_and_never_executes_software(self):
        report=self.run_preflight()
        self.assertEqual(report['captureGroups'],2)
        self.assertEqual(report['spectralFiles'],8)
        self.assertFalse(report['dedalExecuted'])
        self.assertFalse(report['reflectanceReady'])
        self.assertFalse(report['operationalUseAllowed'])
        self.assertNotIn(self.panel_capture,str(report))
        self.assertNotIn(str(self.root),str(report))
        manifest=self.output/'private-preflight.json'
        self.assertEqual(manifest.stat().st_mode&0o777,0o600)
        self.assertEqual(self.output.stat().st_mode&0o777,0o700)
        details=json.loads(manifest.read_text())
        self.assertEqual(details['archive']['sha256'],self.sha)
        self.assertEqual(len(details['captures']),2)
        self.assertFalse(details['runDEDAL'])

    def test_wrong_sha256_fails_without_output(self):
        with self.assertRaises(worker.PreflightError):
            self.run_preflight(expected_sha256='0'*64)
        self.assertFalse(self.output.exists())

    def test_mismatched_published_checksum_fails(self):
        with self.assertRaises(worker.PreflightError):
            worker.preflight(archive=self.archive,expected_sha256=self.sha,panel=self.panel,
                             images=self.images,panel_captures=(self.panel_capture,),
                             output_dir=self.output)

    def test_no_complete_spectral_set_fails(self):
        (self.images/(self.flight_capture+'_MS_RE.TIF')).unlink()
        with self.assertRaises(worker.PreflightError):
            self.run_preflight()

    def test_duplicate_spectral_band_from_case_fails(self):
        (self.images/(self.flight_capture+'_MS_R.tif')).write_bytes(b'II*\x00different')
        with self.assertRaises(worker.PreflightError):
            self.run_preflight()

    def test_panel_capture_must_be_part_of_inventory(self):
        with self.assertRaises(worker.PreflightError):
            self.run_preflight(panel_captures=('DJI_20261023080000_0003',))

    def test_panel_capture_cannot_be_all_images(self):
        with self.assertRaises(worker.PreflightError):
            self.run_preflight(panel_captures=(self.panel_capture,self.flight_capture))

    def test_duplicate_json_keys_rejected(self):
        self.panel.write_text('{"bands":{},"bands":{}}')
        with self.assertRaises(worker.PreflightError):
            self.run_preflight()

    def test_reflectance_fraction_outside_bounds_rejected(self):
        self.panel_data['bands']['R']['reflectance']=51.3
        self._panel_write()
        with self.assertRaises(worker.PreflightError):
            self.run_preflight()

    def test_boolean_panel_reflectance_rejected(self):
        self.panel_data['bands']['R']['reflectance']=True
        self._panel_write()
        with self.assertRaises(worker.PreflightError):
            self.run_preflight()

    def test_reject_uncanonical_tiff_name(self):
        (self.images/'unexpected.TIF').write_bytes(b'II*\x00fake')
        with self.assertRaises(worker.PreflightError):
            self.run_preflight()

    def test_reject_unsafe_symlink_tiff(self):
        original=self.images/(self.flight_capture+'_MS_G.TIF')
        original.unlink()
        original.symlink_to(self.images/(self.flight_capture+'_MS_R.TIF'))
        with self.assertRaises(worker.PreflightError):
            self.run_preflight()

    def test_reject_zip_traversal(self):
        with zipfile.ZipFile(self.archive,'w') as f:
            f.writestr('../escape.py','evil')
        new_md5=hashlib.md5(self.archive.read_bytes()).hexdigest()
        with patch.object(worker,'PUBLISHED_MD5',new_md5):
            with self.assertRaises(worker.PreflightError):
                worker.preflight(archive=self.archive, expected_sha256=hashlib.sha256(self.archive.read_bytes()).hexdigest(),
                                 panel=self.panel,images=self.images,panel_captures=(self.panel_capture,),output_dir=self.output)

    def test_no_overwrite_existing_folder(self):
        self.output.mkdir()
        (self.output/'untouched.txt').write_text('intact')
        with self.assertRaises(worker.PreflightError):
            self.run_preflight()
        self.assertEqual((self.output/'untouched.txt').read_text(),'intact')

    def test_bounded_directory_entries_include_non_tiffs(self):
        (self.images / 'unrelated.txt').write_text('x')
        with patch.object(worker, 'MAX_ENTRIES', 8):
            with self.assertRaises(worker.PreflightError):
                self.run_preflight()

    def test_direct_image_filename_magic_check(self):
        (self.images/(self.flight_capture+'_MS_G.TIF')).write_bytes(b'ZZZZnot-tiff')
        with self.assertRaises(worker.PreflightError):
            self.run_preflight()


if __name__=='__main__':
    unittest.main()
