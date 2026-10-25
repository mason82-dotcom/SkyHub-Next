"""Synthetic-file tests: no genuine DJI hardware, S3, HTTP or flight operation."""
from __future__ import annotations

import importlib.util
from pathlib import Path
import tempfile
import unittest
from uuid import uuid4

try:
    import numpy as np
    import tifffile
except ImportError:  # Main SkyHub CI intentionally has no optional raster packages.
    np = None
    tifffile = None

MODULE = Path(__file__).resolve().parents[1] / 'backend/workers/m3m_raw_tiff_audit.py'
spec = importlib.util.spec_from_file_location('m3m_raw_tiff_audit', MODULE)
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


@unittest.skipUnless(np is not None and tifffile is not None, 'Install optional M3M raster dependencies')
class PayloadAuditTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name)
        self.uuid = uuid4().hex

    def create(self, band='R', name=None, uuid_value=None, include_xmp=True,
               dtype='uint16', invalid_xmp=False, mismatch=False, pixelvalue=100):
        fn = self.path / (name or band)
        fn = fn.with_suffix('.tif')
        values = {'G': 'Green', 'R': 'Red', 'RE': 'RedEdge', 'NIR': 'NIR'}
        image = {'G': 'MS_G_CAMERA', 'R': 'MS_R_CAMERA',
                 'RE': 'MS_RE_CAMERA', 'NIR': 'MS_NIR_CAMERA'}
        xml = f'''<x:xmpmeta xmlns:x="adobe:ns:meta/" xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:drone-dji="http://www.dji.com/drone-dji/1.0/"><rdf:RDF><rdf:Description drone-dji:BandName="{values[band]}" drone-dji:ImageSource="{image['G' if mismatch else band]}" drone-dji:CaptureUUID="{uuid_value or self.uuid}"/></rdf:RDF></x:xmpmeta>'''.encode()
        if invalid_xmp:
            xml = b'<!DOCTYPE html [ <!ENTITY foo "evil"> ]><a>&foo;</a>'
        tags = [(700, 'B', len(xml), xml, False)] if include_xmp else []
        tifffile.imwrite(fn, np.full((16, 16), pixelvalue, dtype=dtype),
                         metadata=None, extratags=tags)
        return fn

    def test_four_bands_decode_grouped_without_false_readiness(self):
        files = [self.create(b) for b in worker.BANDS]
        report = worker.audit(files)
        self.assertEqual(report['decodedPayloads'], 4)
        self.assertEqual(report['bandHints'], dict.fromkeys(worker.BANDS, 1))
        self.assertTrue(report['captureGroupHint'])
        self.assertTrue(report['fullFourBandHint'])
        self.assertEqual(report['totalDecodedPixels'], 1024)
        self.assertFalse(report['sourceVerified'])
        self.assertFalse(report['ndviReady'])
        self.assertFalse(report['reflectanceReady'])
        self.assertFalse(report['operationalUseAllowed'])
        private = str(report)
        self.assertNotIn(self.uuid, private)
        self.assertNotIn(str(self.path), private)

    def test_red_nir_partial_group(self):
        report = worker.audit([self.create('R'), self.create('NIR')])
        self.assertTrue(report['redNirPairHint'])
        self.assertFalse(report['fullFourBandHint'])

    def test_mismatched_capture_prevents_group(self):
        report = worker.audit([self.create('R'), self.create('NIR', uuid_value=uuid4().hex)])
        self.assertFalse(report['captureGroupHint'])
        self.assertFalse(report['redNirPairHint'])

    def test_conflicting_band_fields_fail_closed(self):
        report = worker.audit([self.create('R', mismatch=True)])
        self.assertEqual(report['unknownBandHints'], 1)
        self.assertEqual(report['xmpStatusCounts']['inconsistent-band'], 1)
        self.assertFalse(report['captureGroupHint'])

    def test_missing_xmp_is_not_source_verified(self):
        report = worker.audit([self.create('R', include_xmp=False)])
        self.assertEqual(report['xmpStatusCounts']['unavailable'], 1)
        self.assertFalse(report['sourceVerified'])

    def test_defusedxml_rejects_doctype(self):
        report = worker.audit([self.create('R', invalid_xmp=True)])
        self.assertEqual(report['xmpStatusCounts']['invalid'], 1)

    def test_reject_nonuint16(self):
        with self.assertRaises(worker.InvalidTiff):
            worker.audit([self.create('R', dtype='uint8')])

    def test_reject_all_zero(self):
        with self.assertRaises(worker.InvalidTiff):
            worker.audit([self.create('R', pixelvalue=0)])

    def test_reject_duplicate_file(self):
        p = self.create('R')
        with self.assertRaises(worker.InvalidTiff):
            worker.audit([p, p])

    def test_reject_identical_payload_different_paths(self):
        p = self.create('R')
        other = self.path / 'other.tif'
        other.write_bytes(p.read_bytes())
        with self.assertRaises(worker.InvalidTiff):
            worker.audit([p, other])

    def test_refuse_symlinks(self):
        p = self.create('R')
        alias = self.path / 'link.tif'
        alias.symlink_to(p)
        with self.assertRaises(worker.InvalidTiff):
            worker.audit([alias])

    def test_refuse_bad_magic_and_no_identifier_leak(self):
        p = self.path / 'broken.tif'
        p.write_bytes(b'notATiffFile0000')
        with self.assertRaises(worker.InvalidTiff):
            worker.audit([p])

    def test_do_not_accept_five_inputs(self):
        with self.assertRaises(worker.InvalidTiff):
            worker.audit([self.create('R')] * 5)

    def test_one_sample_does_not_make_a_group(self):
        r = worker.audit([self.create('NIR')])
        self.assertFalse(r['captureGroupHint'])
        self.assertFalse(r['fullFourBandHint'])
        self.assertFalse(r['ndviReady'])


if __name__ == '__main__':
    unittest.main()
