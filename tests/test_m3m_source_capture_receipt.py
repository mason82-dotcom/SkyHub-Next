"""P1 synthetic tests for the local M3M source candidate receipt only."""
from __future__ import annotations

import importlib.util
from pathlib import Path
import tempfile
import unittest
from uuid import uuid4

try:
    import numpy as np
    import tifffile
    import rasterio  # noqa: F401 - required by audited decoder
    import defusedxml  # noqa: F401
except ImportError:
    np = None
    tifffile = None

LOCATION = Path(__file__).resolve().parents[1] / 'backend/workers/m3m_source_capture_receipt.py'
spec = importlib.util.spec_from_file_location('skyhub_m3m_capture_receipt', LOCATION)
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


@unittest.skipUnless(np is not None and tifffile is not None, 'Optional raster packages required')
class SourceReceiptTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.capture = uuid4().hex

    def make_tiff(self, band: str, *, capture=None, no_xmp=False, value=100):
        names = {'G': 'Green', 'R': 'Red', 'RE': 'RedEdge', 'NIR': 'NIR'}
        sources = {'G': 'MS_G_CAMERA', 'R': 'MS_R_CAMERA',
                   'RE': 'MS_RE_CAMERA', 'NIR': 'MS_NIR_CAMERA'}
        metadata = (f'<x:xmpmeta xmlns:x="adobe:ns:meta/" '
                    f'xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" '
                    f'xmlns:d="http://www.dji.com/drone-dji/1.0/">'
                    f'<rdf:RDF><rdf:Description d:BandName="{names[band]}" '
                    f'd:ImageSource="{sources[band]}" '
                    f'd:CaptureUUID="{capture or self.capture}"/></rdf:RDF></x:xmpmeta>').encode()
        dest = self.root / f'{band}.tif'
        tifffile.imwrite(dest, np.full((16, 16), value, dtype='uint16'),
                         metadata=None,
                         extratags=[] if no_xmp else [(700, 'B', len(metadata), metadata, False)])
        return dest

    def full(self):
        return [self.make_tiff(b, value=100+i) for i, b in enumerate(worker.BANDS)]

    def test_full_capture_has_digest_but_no_readiness_or_private_metadata(self):
        paths = self.full()
        receipt = worker.create_receipt(paths)
        self.assertEqual(list(receipt['bands']), list(worker.BANDS))
        self.assertTrue(receipt['captureUuidMatchedPrivately'])
        self.assertEqual(receipt['spectralSourceCount'], 4)
        self.assertEqual(receipt['decodedPixelCount'], 1024)
        self.assertEqual(receipt['rgbCandidate'], None)
        for band in worker.BANDS:
            self.assertEqual(len(receipt['bands'][band]['sha256']), 64)
            self.assertGreater(receipt['bands'][band]['bytes'], 0)
        for name in ('sourceVerified', 'radiometricCalibrationVerified',
                     'bandCoregistrationVerified', 'reflectanceReady', 'ndviReady',
                     'ndreReady', 'operationalUseAllowed', 'prescriptionExportAllowed',
                     'flightMissionAllowed'):
            self.assertIs(receipt[name], False)
        private = str(receipt)
        self.assertNotIn(self.capture, private)
        self.assertNotIn(str(self.root), private)
        for p in paths:
            self.assertNotIn(p.name, private)

    def test_reject_capture_mismatch(self):
        paths = self.full()
        paths[-1] = self.make_tiff('NIR', capture=uuid4().hex)
        with self.assertRaises(worker.CaptureError):
            worker.create_receipt(paths)

    def test_reject_missing_or_duplicate_bands(self):
        paths = self.full()
        with self.assertRaises(worker.CaptureError):
            worker.create_receipt(paths[:3])
        with self.assertRaises(Exception):
            worker.create_receipt([paths[0], paths[0], paths[2], paths[3]])

    def test_reject_missing_xmp(self):
        paths = self.full()
        paths[1] = self.make_tiff('R', no_xmp=True)
        with self.assertRaises(worker.CaptureError):
            worker.create_receipt(paths)

    def test_optional_jpeg_is_just_a_header_and_digest_hint(self):
        paths = self.full()
        rgb = self.root / 'rgb.jpg'
        rgb.write_bytes(b'\xff\xd8\xff\xe0' + b'\0' * 30 + b'\xff\xd9')
        receipt = worker.create_receipt(paths, rgb)
        self.assertTrue(receipt['rgbCandidate']['jpegMarkerChecked'])
        self.assertFalse(receipt['rgbCandidate']['jpegPayloadDecoded'])
        self.assertFalse(receipt['rgbCandidate']['captureLinkVerified'])

    def test_reject_symlink_and_bad_jpeg(self):
        paths = self.full()
        alias = self.root / 'alias.tif'
        alias.symlink_to(paths[0])
        with self.assertRaises(Exception):
            worker.create_receipt([alias, *paths[1:]])
        jpeg = self.root / 'false.jpg'
        jpeg.write_bytes(b'not a valid jpeg in any wayyyyy')
        with self.assertRaises(worker.CaptureError):
            worker.create_receipt(paths, jpeg)


if __name__ == '__main__':
    unittest.main()
