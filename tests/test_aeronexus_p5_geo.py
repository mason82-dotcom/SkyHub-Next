import importlib.util
import hashlib
import pathlib
import sys
import tempfile
import unittest
from zipfile import ZipFile

PATH = pathlib.Path(__file__).resolve().parents[1] / 'backend/workers/aeronexus_p5_geo_handoff.py'
spec = importlib.util.spec_from_file_location('aeronexus_p5_handoff', PATH)
p5 = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = p5
spec.loader.exec_module(p5)

class GeoHandoffTests(unittest.TestCase):
    def test_hash_bound_private_zip(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            source, target = root / 'source', root / 'out'
            source.mkdir(mode=0o700); target.mkdir(mode=0o700)
            (source / 'RGB.jpg').write_bytes(b'NOT REAL DJI IMAGE')
            sha = hashlib.sha256((source / 'RGB.jpg').read_bytes()).hexdigest()
            result = p5.prepare_metashape_package(source, target, [
                {'file':'RGB.jpg','channel':'RGB','sha256':sha}])
            with ZipFile(result['package']) as package:
                self.assertEqual(package.read('input/RGB.jpg'),b'NOT REAL DJI IMAGE')
                self.assertFalse(result['manifest']['orthomosaicReady'])
            with self.assertRaises(p5.HandoffError):
                p5.prepare_metashape_package(source,target,[{
                    'file':'RGB.jpg','channel':'RGB','sha256':'0'*64}])
            with self.assertRaises(p5.HandoffError):
                p5.prepare_metashape_package(source,target,[{
                    'file':'../RGB.jpg','channel':'RGB','sha256':sha}])

    def test_tile_is_png_and_does_not_claim_measurements(self):
        values = [0.5] * (256*256)
        result = p5.grayscale_tile(values,256,256,0,1)
        self.assertTrue(result.startswith(b'\\x89PNG\\r\\n\\x1a\\n'))
        with self.assertRaises(p5.HandoffError):
            p5.grayscale_tile(values,256,256,1,1)
if __name__ == '__main__':
    unittest.main()
