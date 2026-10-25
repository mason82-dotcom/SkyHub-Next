"""Static guards for scripts/pi-minio-backend-access.sh (read-only S3 account for the backend).

They never start Docker and never read a private env file.
"""
from __future__ import annotations

from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "pi-minio-backend-access.sh"
TEXT = SCRIPT.read_text(encoding="utf-8")


class MinioBackendAccessTest(unittest.TestCase):
    def test_script_parses_and_rejects_unknown_modes(self) -> None:
        subprocess.run(["bash", "-n", str(SCRIPT)], check=True)
        proc = subprocess.run(["bash", str(SCRIPT), "write"], capture_output=True, text=True)
        self.assertEqual(proc.returncode, 2)
        self.assertIn("Usage", proc.stderr)

    def test_nothing_mutates_docker_minio_or_files(self) -> None:
        for mutating in ("docker network create", "docker network connect", "docker start", "docker stop",
                         "docker rm ", "docker compose", " ln -s", "mc admin", "mc alias", "--write",
                         "s3:PutObject", ">> \"$envfile\"", "chmod "):
            self.assertNotIn(mutating, TEXT)

    def test_probe_container_is_hardened_and_temporary(self) -> None:
        for flag in ("docker run --rm", "--read-only", "--cap-drop ALL", "--security-opt no-new-privileges",
                     "--tmpfs /tmp:rw,noexec,nosuid", "readonly", "/opt/minio-s3-probe.js --read"):
            self.assertIn(flag, TEXT)
        self.assertIn("-e SKYHUB_S3_ENDPOINT=http://skyhub-minio:9000", TEXT)

    def test_secret_values_are_never_printed_or_passed_as_arguments(self) -> None:
        self.assertNotIn("SECRET_KEY=$", TEXT)
        self.assertNotIn('echo "$(value_of', TEXT)
        self.assertIn("Wert nicht ausgegeben", TEXT)
        self.assertIn("key_count(", TEXT)
        self.assertIn("mehrfach gesetzt", TEXT)
        # The backend must not be given the MinIO root account.
        self.assertIn("nie verwenden", TEXT)

    def test_override_output_keeps_the_backend_on_the_external_storage_network(self) -> None:
        out = subprocess.run(["bash", str(SCRIPT), "override"], check=True, capture_output=True, text=True).stdout
        self.assertIn("name: skyhub-storage-net", out)
        self.assertIn("external: true", out)
        self.assertIn("- shared_storage", out)
        self.assertNotIn("ports:", out)
        self.assertIn("docker-compose.override.yml", (ROOT / ".gitignore").read_text(encoding="utf-8"))
        self.assertIn("docker compose --env-file .env config --format json", TEXT)
        self.assertIn("skyhub-storage-net", TEXT)


if __name__ == "__main__":
    unittest.main()
