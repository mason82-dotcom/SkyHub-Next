"""Synthetic ZIP-only DEDAL archive inspection; no upstream code is executed."""
from __future__ import annotations
import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

MODULE = Path(__file__).resolve().parents[1] / 'backend/workers/m3m_dedal_archive_inspect.py'
spec = importlib.util.spec_from_file_location('m3m_dedal_archive_inspect', MODULE)
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class TestDedalArchiveInspector(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.archive = self.root / worker.ARCHIVE_NAME
        self.toml = '[project]\nname="dedal-calibration"\nversion="0.1.0"\n[project.scripts]\ndedal-calibrate="panelcal.calibrate:main"\n'
        self.calibrate = 'def main():\n    pass\nif __name__ == "__main__":\n    main()\n'
        self.extra = {}
        self.omit = set()
        self.write_zip()

    def write_zip(self):
        prefix = worker.ARCHIVE_PREFIX
        with zipfile.ZipFile(self.archive, 'w', compression=zipfile.ZIP_DEFLATED) as zf:
            for rel in sorted(worker.EXPECTED_FILES - self.omit):
                val = self.toml if rel == 'pyproject.toml' else self.calibrate if rel == 'panelcal/calibrate.py' else 'x'
                zf.writestr(prefix + rel, val)
            for name, data in self.extra.items():
                zf.writestr(name, data)
        self.sha = hashlib.sha256(self.archive.read_bytes()).hexdigest()
        self.md5 = hashlib.md5(self.archive.read_bytes()).hexdigest()

    def inspect(self):
        with patch.object(worker, 'PUBLISHED_MD5', self.md5):
            return worker.inspect(self.archive, self.sha)

    def test_static_cli_syntax_and_no_runtime_claim(self):
        result = self.inspect()
        self.assertEqual(result['archiveEntryCount'], len(worker.EXPECTED_FILES))
        self.assertEqual(result['declaredCliEntryPointCount'], 1)
        self.assertTrue(result['calibrateMainFunctionPresent'])
        self.assertTrue(result['calibrateMainGuardPresent'])
        self.assertFalse(result['cliRuntimeVerified'])
        self.assertFalse(result['dedalExecuted'])
        self.assertFalse(result['operationalUseAllowed'])
        self.assertFalse(result['projectVersionMatchesZenodoRecord'])
        self.assertNotIn('panelcal', str(result))
        self.assertNotIn(str(self.root), str(result))

    def test_reject_wrong_sha(self):
        with patch.object(worker, 'PUBLISHED_MD5', self.md5):
            with self.assertRaises(worker.ArchiveInspectionError):
                worker.inspect(self.archive, '0' * 64)

    def test_reject_wrong_zenodo_md5(self):
        with self.assertRaises(worker.ArchiveInspectionError):
            worker.inspect(self.archive, self.sha)

    def test_reject_missing_required_source(self):
        self.omit.add('panelcal/radiometry.py')
        self.write_zip()
        with self.assertRaises(worker.ArchiveInspectionError): self.inspect()

    def test_reject_zip_traversal(self):
        self.extra[worker.ARCHIVE_PREFIX + '../outside.py'] = 'attack'
        self.write_zip()
        with self.assertRaises(worker.ArchiveInspectionError): self.inspect()

    def test_reject_archive_member_outside_prefix(self):
        self.extra['arbitrary-module.py'] = 'payload'
        self.write_zip()
        with self.assertRaises(worker.ArchiveInspectionError): self.inspect()

    def test_reject_duplicate_zip_name(self):
        prefix = worker.ARCHIVE_PREFIX
        with zipfile.ZipFile(self.archive, 'a') as zf:
            import warnings
            with warnings.catch_warnings():
                warnings.simplefilter('ignore', UserWarning)
                zf.writestr(prefix + 'README.md', 'replacement')
        self.sha = hashlib.sha256(self.archive.read_bytes()).hexdigest()
        self.md5 = hashlib.md5(self.archive.read_bytes()).hexdigest()
        with self.assertRaises(worker.ArchiveInspectionError): self.inspect()

    def test_reject_suspicious_cli_target(self):
        self.toml = '[project.scripts]\nrun="/bin/sh -c evil"\n'
        self.write_zip()
        with self.assertRaises(worker.ArchiveInspectionError): self.inspect()

    def test_reject_invalid_python_source(self):
        self.calibrate = 'def main(:\n'
        self.write_zip()
        with self.assertRaises(worker.ArchiveInspectionError): self.inspect()

    def test_reject_invalid_toml(self):
        self.toml = '[project\ninvalid'
        self.write_zip()
        with self.assertRaises(worker.ArchiveInspectionError): self.inspect()

    def test_detect_absent_cli_without_fabrication(self):
        self.toml = '[project]\nname="dedal-calibration"\nversion="0.1.1"\n'
        self.calibrate = 'def calibrate():\n    return None\n'
        self.write_zip()
        result = self.inspect()
        self.assertEqual(result['declaredCliEntryPointCount'], 0)
        self.assertFalse(result['calibrateMainFunctionPresent'])
        self.assertFalse(result['calibrateMainGuardPresent'])
        self.assertTrue(result['projectVersionMatchesZenodoRecord'])
        self.assertFalse(result['cliRuntimeVerified'])

    def test_reject_symlink_input(self):
        target = self.root / 'copy.zip'
        self.archive.rename(target)
        self.archive.symlink_to(target)
        with self.assertRaises(worker.ArchiveInspectionError): self.inspect()

    def test_reject_too_many_members(self):
        self.extra[worker.ARCHIVE_PREFIX + 'extra.txt'] = 'x'
        self.write_zip()
        with patch.object(worker, 'MAX_MEMBERS', len(worker.EXPECTED_FILES)):
            with self.assertRaises(worker.ArchiveInspectionError): self.inspect()

    def test_bounded_source_parsing(self):
        self.calibrate = 'a=' + ('x' * (worker.MAX_METADATA_BYTES + 1))
        self.write_zip()
        with self.assertRaises(worker.ArchiveInspectionError): self.inspect()


if __name__ == '__main__': unittest.main()
