"""Read-only manifest recheck with synthetic private paths and hashes."""
from __future__ import annotations
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

MODULE = Path(__file__).resolve().parents[1] / 'backend/workers/m3m_dedal_manifest_recheck.py'
spec = importlib.util.spec_from_file_location('m3m_dedal_manifest_recheck', MODULE)
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class RecheckTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.images = self.root / 'images'
        self.images.mkdir()
        self.archive = self.root / 'dedal-calibration-0.1.0.zip'
        self.archive.write_bytes(b'synthetic-not-a-valid-zip')
        self.panel = self.root / 'panel.json'
        self.panel.write_text('{"bands":{"G":{"reflectance":0.5}}}')
        self.manifest_dir = self.root / 'private'
        self.manifest_dir.mkdir(mode=0o700)
        self.manifest = self.manifest_dir / 'private-preflight.json'
        self.labels = ['DJI_20261023070000_0001', 'DJI_20261023073000_0002']
        groups = []
        for capture in self.labels:
            bands = {}
            for band in worker.BANDS:
                name = f'{capture}_MS_{band}.TIF'
                content = b'II*\x00' + name.encode()
                (self.images/name).write_bytes(content)
                bands[band] = {'name':name, 'sha256':hashlib.sha256(content).hexdigest(), 'bytes':len(content)}
            groups.append({'capture':capture,'bands':bands})
        self.data={
            'schema':'skyhub-m3m-dedal-preflight-private-v1',
            'recordUrl':'https://zenodo.org/records/23301986',
            'recordVersion':'0.1.1','archiveFilenameVersion':'0.1.0',
            'archive': {'path':str(self.archive),'sha256':hashlib.sha256(self.archive.read_bytes()).hexdigest(),
                        'bytes':self.archive.stat().st_size,'zipEntries':1},
            'panel': {'path':str(self.panel),'sha256':hashlib.sha256(self.panel.read_bytes()).hexdigest(),
                      'bands':{'G':0.5,'R':0.5,'RE':0.5,'NIR':0.5}},
            'imagesRoot':str(self.images), 'captures':groups,
            'panelCaptures':[self.labels[0]], 'runDEDAL':False,
            'calibrationVerified':False,'reflectanceReady':False,'operationalUseAllowed':False,
        }
        self._save()
        self.actual_md5=hashlib.md5(self.archive.read_bytes()).hexdigest()

    def _save(self):
        self.manifest.write_text(json.dumps(self.data),encoding='utf8')
        self.sha=hashlib.sha256(self.manifest.read_bytes()).hexdigest()

    def check(self):
        with patch.object(worker,'PUBLISHED_MD5',self.actual_md5):
            return worker.recheck(self.manifest, self.sha)

    def test_valid_private_manifest_rehash_has_no_readiness_or_paths(self):
        r = self.check()
        self.assertEqual(r['spectralFilesRehashed'],8)
        self.assertEqual(r['captureGroupsRechecked'],2)
        self.assertFalse(r['dedalExecuted'])
        self.assertFalse(r['calibrationVerified'])
        self.assertFalse(r['operationalUseAllowed'])
        self.assertNotIn(str(self.root), str(r))
        self.assertNotIn(self.labels[0], str(r))

    def test_reject_tampered_manifest_without_new_pin(self):
        self.manifest.write_text(self.manifest.read_text() + ' ')
        with self.assertRaises(worker.RecheckError): self.check()

    def test_reject_modified_image_after_pin(self):
        filename=self.data['captures'][1]['bands']['G']['name']
        (self.images/filename).write_bytes(b'II*\x00different-contents')
        with self.assertRaises(worker.RecheckError): self.check()

    def test_reject_modified_panel_after_pin(self):
        self.panel.write_text(self.panel.read_text()+' ')
        with self.assertRaises(worker.RecheckError): self.check()

    def test_reject_replaced_archive_against_published_md5(self):
        with self.assertRaises(worker.RecheckError):
            worker.recheck(self.manifest,self.sha)

    def test_reject_source_symlink(self):
        file=self.images/self.data['captures'][1]['bands']['R']['name']
        target=self.root/'R.orig'
        file.rename(target)
        file.symlink_to(target)
        with self.assertRaises(worker.RecheckError): self.check()

    def test_reject_missing_band(self):
        self.data['captures'][0]['bands'].pop('RE')
        self._save()
        with self.assertRaises(worker.RecheckError): self.check()

    def test_reject_label_path_escape(self):
        self.data['captures'][0]['bands']['G']['name'] = '../outside.tif'
        self._save()
        with self.assertRaises(worker.RecheckError): self.check()

    def test_reject_missing_panel_capture(self):
        self.data['panelCaptures']=['DJI_20261023080000_0003']
        self._save()
        with self.assertRaises(worker.RecheckError): self.check()

    def test_reject_readiness_true(self):
        self.data['calibrationVerified']=True
        self._save()
        with self.assertRaises(worker.RecheckError): self.check()

    def test_reject_duplicate_json_keys_even_when_pinned(self):
        self.manifest.write_text(self.manifest.read_text().rstrip()[:-1] + ',"schema":"override"}')
        self.sha=hashlib.sha256(self.manifest.read_bytes()).hexdigest()
        with self.assertRaises(worker.RecheckError): self.check()

    def test_reject_repeated_inode_in_other_band(self):
        p1=self.images/self.data['captures'][1]['bands']['R']['name']
        p2=self.images/self.data['captures'][1]['bands']['RE']['name']
        p2.unlink()
        p2.hardlink_to(p1)
        self.data['captures'][1]['bands']['RE']['sha256'] = hashlib.sha256(p2.read_bytes()).hexdigest()
        self.data['captures'][1]['bands']['RE']['bytes'] = p2.stat().st_size
        self._save()
        with self.assertRaises(worker.RecheckError): self.check()

    def test_reject_wrong_private_manifest_filename(self):
        alias=self.root/'different.json'
        alias.write_bytes(self.manifest.read_bytes())
        with self.assertRaises(worker.RecheckError):
            worker.recheck(alias,self.sha)

    def test_reject_unpinned_manifest_hash(self):
        with self.assertRaises(worker.RecheckError):
            worker.recheck(self.manifest, 'xyz')


if __name__=='__main__': unittest.main()
