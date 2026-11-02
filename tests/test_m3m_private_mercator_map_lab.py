"""Synthetic, actually projected Web Mercator preview packages from pinned raster bundle."""
from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path
import stat
import struct
import tempfile
import unittest
from unittest import mock

try:
    import rasterio
except ImportError:
    rasterio = None

ROOT = Path(__file__).resolve().parents[1]


def load(relative, name):
    spec = importlib.util.spec_from_file_location(name, ROOT / relative)
    obj = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(obj)
    return obj


worker = load('backend/workers/m3m_private_mercator_map_lab.py', 'skyhub_mercator_lab')
sealmod = load('backend/workers/m3m_raster_bundle_seal.py', 'skyhub_mercator_lab_seal')
qa = load('tests/test_m3m_raster_bundle_verify.py', 'skyhub_mercator_lab_fixture')


@unittest.skipUnless(rasterio is not None, 'Requires independent rasterio and numpy wheels')
class PrivateMapLabTests(unittest.TestCase):
    def setUp(self):
        f = qa.TestM3mRasterBundleQa(methodName='test_valid_bundle_and_no_writes')
        f.setUp()
        self.addCleanup(f.doCleanups)
        self.bundle = f.root
        self.receipt = f.root.parent / 'sealed-mercator.json'
        self.pin = sealmod.create_seal(self.bundle, self.receipt)['sha256OfSeal']
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.target = self.root / 'private-map'

    def generate(self, **kw):
        cfg = dict(bundle=self.bundle, seal=self.receipt,
                   seal_sha256=self.pin, output_dir=self.target,
                   private_output_ok=True)
        cfg.update(kw)
        return worker.generate(**cfg)

    def test_four_georeferenced_pngs_and_independent_manifest_pin(self):
        report = self.generate()
        self.assertEqual(report['images'], 4)
        self.assertFalse(report['radiometricCalibrationVerified'])
        self.assertFalse(report['operationalUseAllowed'])
        self.assertTrue(report['containsSensitiveGeolocation'])
        self.assertEqual(self.target.stat().st_mode & 0o777, 0o700)
        path = self.target / 'viewport.json'
        raw = path.read_bytes()
        self.assertEqual(hashlib.sha256(raw).hexdigest(), report['manifestSha256'])
        manifest = json.loads(raw)
        self.assertEqual(manifest['schema'], 'skyhub-m3m-private-mercator-map-lab-v1')
        self.assertEqual(manifest['projection'], 'EPSG:3857')
        self.assertTrue(manifest['sourceRasterIntegrityRechecked'])
        self.assertFalse(manifest['imagePixelsAreMeasurements'])
        self.assertFalse(manifest['mapTilesAvailable'])
        self.assertFalse(manifest['operationalUseAllowed'])
        self.assertEqual(manifest['sourceSealSha256'], self.pin)
        self.assertEqual(self.target.stat().st_nlink >= 2, True)
        self.assertEqual(set(p.name for p in self.target.iterdir()),
                         {'viewport.json','ndvi.png','ndre.png','gndvi.png','osavi.png'})
        self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        west,south,east,north = manifest['boundsMeters']
        self.assertLess(west,east)
        self.assertLess(south,north)
        self.assertLessEqual(manifest['width'],512)
        self.assertLessEqual(manifest['height'],512)
        for item in manifest['images']:
            payload = (self.target/item['filename']).read_bytes()
            self.assertEqual(hashlib.sha256(payload).hexdigest(),item['sha256'])
            self.assertEqual(payload[:8],b'\x89PNG\r\n\x1a\n')
            self.assertEqual(struct.unpack('>II',payload[16:24]),
                             (manifest['width'],manifest['height']))
            self.assertEqual(payload[25],6)
            self.assertNotIn(b'EPSG',payload)
            self.assertEqual((self.target/item['filename']).stat().st_mode & 0o777,0o600)
        self.assertNotIn(str(self.bundle),str(report))
        self.assertNotIn(str(self.bundle),raw.decode())
        self.assertNotIn(str(self.receipt),raw.decode())

    def test_no_output_without_private_geolocation_consent(self):
        with self.assertRaises(worker.MapLabError):
            self.generate(private_output_ok=False)
        self.assertFalse(self.target.exists())

    def test_no_overwrite_existing_target(self):
        self.target.mkdir()
        secret = self.target/'important'
        secret.write_text('untouched')
        with self.assertRaises(worker.MapLabError):
            self.generate()
        self.assertEqual(secret.read_text(),'untouched')

    def test_refuse_wrong_seal_and_mutated_numeric_data(self):
        with self.assertRaises(Exception):
            self.generate(seal_sha256='a'*64)
        self.assertFalse(self.target.exists())
        with (self.bundle/'indices/ndre.tif').open('ab') as out:
            out.write(b'mutated')
        with self.assertRaises(Exception):
            self.generate()
        self.assertFalse(self.target.exists())

    def test_recheck_fails_before_any_file_is_created(self):
        real = worker._module
        def altered(name, alias):
            module = real(name, alias)
            if name == 'm3m_private_index_preview.py':
                real_png = module._png_rgba
                mutated = False
                def sabotage(*args):
                    nonlocal mutated
                    result = real_png(*args)
                    if not mutated:
                        mutated = True
                        with (self.bundle/'indices/ndvi.tif').open('ab') as o:
                            o.write(b'changed between QA checks')
                    return result
                module._png_rgba = sabotage
            return module
        with mock.patch.object(worker,'_module',side_effect=altered):
            with self.assertRaises(Exception):
                self.generate()
        self.assertFalse(self.target.exists())

    def test_refuse_nested_symlink_output_parent(self):
        # The direct output parent is a directory, but its ancestor is an
        # alias to a private location inside the sealed source bundle.
        safe = self.bundle / 'private-destination'
        safe.mkdir(mode=0o700)
        inner = safe / 'nested'
        inner.mkdir(mode=0o700)
        alias = self.root / 'alias-to-source'
        alias.symlink_to(safe, target_is_directory=True)
        target = alias / 'nested' / 'attempt'
        with self.assertRaises(worker.MapLabError):
            self.generate(output_dir=target)
        self.assertFalse((inner / 'attempt').exists())

    def test_refuse_symlink_root(self):
        alias = self.root / 'alias'
        alias.symlink_to(self.bundle, target_is_directory=True)
        with self.assertRaises(worker.MapLabError):
            self.generate(bundle=alias)
        self.assertFalse(self.target.exists())


if __name__ == '__main__':
    unittest.main()
