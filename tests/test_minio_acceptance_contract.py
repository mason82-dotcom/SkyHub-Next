"""Independent, CI-discovered safety contract for the shared MinIO runbook.

This test is intentionally outside pi-minio-acceptance/ so that a PR changing
the backup harness cannot silently remove all of its own regression checks.
It uses only text inspection: never contacts Pi, Docker, S3 or a live system.
Operational changes require an explicit review of these pinned invariants.
"""

from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
MINIO = ROOT / "pi-minio-acceptance"


class SharedMinioContractTests(unittest.TestCase):
    def source(self, filename):
        return (MINIO / filename).read_text(encoding="utf-8")

    def test_live_shared_minio_identity_cannot_silently_revert(self):
        for filename in (
            "backup.sh",
            "preflight.sh",
            "recover_backup.py",
            "restore_probe.py",
        ):
            with self.subTest(filename=filename):
                content = self.source(filename)
                self.assertIn("skyhub-shared-minio", content)
                self.assertNotIn("skyhub-next-minio-1", content)
        backup = self.source("backup.sh")
        preflight = self.source("preflight.sh")
        self.assertIn("docker-compose.minio-shared.yml", backup)
        self.assertIn("--filter network=skyhub-storage-net", preflight)

    def test_backup_and_restore_capacity_stay_independent(self):
        backup = self.source("backup.sh")
        self.assertIn(
            "required = total + image['Size'] + 10*1024**3 + entries*4096",
            backup,
        )
        self.assertNotIn("48*1024**3", backup)
        restore = self.source("restore.sh")
        self.assertIn(
            "/mnt/benz|/mnt/hc4backup/skyhub-restore)",
            restore,
        )
        self.assertIn('! -L "$RESTORE_DIR"', restore)
        self.assertIn("shutil.disk_usage(sys.argv[2]).free < 58*1024**3", restore)
        self.assertIn(
            'mktemp "$RESTORE_DIR/skyhub-restore-XXXXXXXX.luks"',
            restore,
        )
        self.assertNotIn("mktemp /mnt/benz/skyhub-restore-", restore)

    def test_isolated_restore_must_probe_denied_writes(self):
        probe = self.source("restore_probe.py")
        self.assertIn("def denied(", probe)
        self.assertIn("def negative_writes(", probe)
        self.assertIn("negative_writes(mc, env, buckets, files_by_bucket)", probe)
        self.assertIn("'accessdenied', 'insufficientpermissions'", probe)
        self.assertIn("raise RuntimeError(", probe)
        for operation in ("'pipe'", "'rm'", "'mb'"):
            with self.subTest(operation=operation):
                self.assertIn(operation, probe)
        self.assertIn("'test/'+bucket+'/'+marker", probe)

    def test_fixture_suite_is_executed_in_general_ci(self):
        workflow = (ROOT / ".github/workflows/ci.yml").read_text(encoding="utf-8")
        self.assertIn("python3 pi-minio-acceptance/test_local.py -v", workflow)
        self.assertIn("python3 -m unittest discover -s tests -p 'test_*.py'", workflow)


if __name__ == "__main__":
    unittest.main()
