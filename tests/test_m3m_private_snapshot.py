"""Synthetic P1 private snapshot tests; no real M3M/SD media or network."""
from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock
from uuid import uuid4

try:
    import numpy as np
    import tifffile
    import rasterio  # noqa
    import defusedxml  # noqa
except ImportError:
    np = tifffile = None

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / 'backend/workers/m3m_private_snapshot.py'
spec = importlib.util.spec_from_file_location('m3m_private_snapshot', SCRIPT)
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


@unittest.skipUnless(np is not None and tifffile is not None, 'Optional TIFF raster wheels required')
class PrivateSnapshotTests(unittest.TestCase):
    def setUp(self):
        ctx = tempfile.TemporaryDirectory()
        self.addCleanup(ctx.cleanup)
        self.root = Path(ctx.name)
        self.capture = uuid4().hex
        self.bands = []
        self.dest = self.root / 'private-dataset'
        names = {'G': 'Green', 'R': 'Red', 'RE': 'RedEdge', 'NIR': 'NIR'}
        cameras = {'G': 'MS_G_CAMERA', 'R': 'MS_R_CAMERA',
                   'RE': 'MS_RE_CAMERA', 'NIR': 'MS_NIR_CAMERA'}
        for i, band in enumerate(worker.BANDS):
            xml = (f'<x:xmpmeta xmlns:x="adobe:ns:meta/" '
                   f'xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" '
                   f'xmlns:d="http://www.dji.com/drone-dji/1.0/">'
                   f'<rdf:RDF><rdf:Description d:BandName="{names[band]}" '
                   f'd:ImageSource="{cameras[band]}" '
                   f'd:CaptureUUID="{self.capture}"/></rdf:RDF></x:xmpmeta>').encode()
            p = self.root / (band + '.tif')
            tifffile.imwrite(p, np.full((16, 16), i + 100, dtype=np.uint16),
                             extratags=[(700, 'B', len(xml), xml, False)], metadata=None)
            self.bands.append(p)

    def test_private_original_bytes_copied_without_metadata_leak(self):
        result = worker.snapshot(self.bands[::-1], self.dest)
        self.assertTrue(result['completed'])
        self.assertEqual(result['filesCopied'], 4)
        self.assertFalse(result['reflectanceReady'])
        self.assertEqual(self.dest.stat().st_mode & 0o777, 0o700)
        manifest = json.loads((self.dest / 'manifest.json').read_text())
        self.assertTrue(manifest['completed'])
        self.assertFalse(manifest['sourceVerified'])
        self.assertFalse(manifest['operationalUseAllowed'])
        self.assertEqual(set(p.name for p in self.dest.iterdir()),
                         {'G.tif', 'R.tif', 'RE.tif', 'NIR.tif', 'manifest.json'})
        for b, p in zip(worker.BANDS, self.bands):
            target = self.dest / (b + '.tif')
            self.assertEqual(p.read_bytes(), target.read_bytes())
            self.assertEqual(target.stat().st_mode & 0o777, 0o600)
            self.assertEqual(manifest['files'][b + '.tif']['sha256'],
                             hashlib.sha256(target.read_bytes()).hexdigest())
        self.assertNotIn(self.capture, str(manifest))
        self.assertNotIn(str(self.root), str(manifest))
        self.assertNotIn(str(self.root), str(result))

    def test_existing_directory_never_overwritten(self):
        self.dest.mkdir()
        sentinel = self.dest / 'not-yours'
        sentinel.write_text('preserve')
        with self.assertRaises(worker.SnapshotError):
            worker.snapshot(self.bands, self.dest)
        self.assertEqual(sentinel.read_text(), 'preserve')

    def test_bad_source_rejected_before_destination(self):
        self.bands[0].write_bytes(b'not a TIFF')
        with self.assertRaises(Exception):
            worker.snapshot(self.bands, self.dest)
        self.assertFalse(self.dest.exists())

    def test_duplicate_source_rejected_before_destination(self):
        with self.assertRaises(Exception):
            worker.snapshot([self.bands[0]] * 4, self.dest)
        self.assertFalse(self.dest.exists())

    def test_partial_write_failure_cleans_own_output(self):
        original = worker._copy_one
        count = 0
        def sabotage(*args):
            nonlocal count
            count += 1
            if count == 2:
                raise worker.SnapshotError('simulated disk failure')
            return original(*args)
        with mock.patch.object(worker, '_copy_one', side_effect=sabotage):
            with self.assertRaises(worker.SnapshotError):
                worker.snapshot(self.bands, self.dest)
        self.assertFalse(self.dest.exists())
        self.assertEqual(count, 2)

    def test_source_changed_during_copy_has_no_committed_manifest(self):
        original = worker._copy_one
        first = True
        def change(*args):
            nonlocal first
            original(*args)
            if first:
                first = False
                with self.bands[0].open('ab') as f:
                    f.write(b'changed source')
        with mock.patch.object(worker, '_copy_one', side_effect=change):
            with self.assertRaises(Exception):
                worker.snapshot(self.bands, self.dest)
        self.assertFalse(self.dest.exists())

    def test_optional_rgb_not_claimed_verified(self):
        rgb = self.root / 'D.JPG'
        rgb.write_bytes(b'\xff\xd8\xff\xe0' + b'\0' * 32)
        result = worker.snapshot(self.bands, self.dest, rgb=rgb)
        self.assertEqual(result['filesCopied'], 5)
        self.assertEqual((self.dest / 'RGB.jpg').read_bytes(), rgb.read_bytes())
        manifest = json.loads((self.dest / 'manifest.json').read_text())
        self.assertIs(manifest['rgbCandidate']['captureLinkVerified'], False)

    def test_source_symlink_refused(self):
        alias = self.root / 'link.tif'
        alias.symlink_to(self.bands[0])
        with self.assertRaises(Exception):
            worker.snapshot([alias, *self.bands[1:]], self.dest)
        self.assertFalse(self.dest.exists())


if __name__ == '__main__':
    unittest.main()
