"""Static and shell-syntax guards for the opt-in shared MinIO deployment.

These tests never access Docker or change the Raspberry Pi.
"""
from pathlib import Path
import json
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
OVERLAY = ROOT / "docker-compose.storage.yml"
ROOT_COMPOSE = ROOT / "docker-compose.yml"
SCRIPT = ROOT / "scripts/pi-minio-network.sh"


class SharedMinioStorageTest(unittest.TestCase):
    def test_overlay_uses_external_network_without_host_ports(self):
        overlay = OVERLAY.read_text(encoding="utf-8")
        self.assertIn("name: skyhub-storage-net", overlay)
        self.assertIn("external: true", overlay)
        self.assertIn("- skyhub-minio", overlay)
        self.assertIn("SKYHUB_S3_ENDPOINT: http://skyhub-minio:9000", overlay)
        self.assertNotIn("ports:", overlay)
        self.assertNotIn("MINIO_ROOT_PASSWORD", overlay)
        self.assertIn("shared_storage:", overlay)

    def test_external_adoption_overlay_cannot_start_another_minio(self):
        overlay = (ROOT / "docker-compose.storage.external.yml").read_text(encoding="utf-8")
        self.assertIn("name: skyhub-storage-net", overlay)
        self.assertIn("external: true", overlay)
        self.assertIn("SKYHUB_S3_ENDPOINT: http://skyhub-minio:9000", overlay)
        self.assertNotIn("  minio:", overlay)
        self.assertNotIn("ports:", overlay)

    def test_s3_policies_are_bucket_scoped_with_no_public_all_access(self):
        files = sorted((ROOT / "storage/policies").glob("*.json"))
        self.assertEqual(len(files), 4)
        for path in files:
            policy = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(policy["Version"], "2012-10-17")
            for statement in policy["Statement"]:
                self.assertEqual(statement["Effect"], "Allow")
                self.assertNotIn("*", statement["Action"])
                for resource in statement["Resource"]:
                    self.assertTrue(resource.startswith("arn:aws:s3:::skyhub-"))
                    self.assertNotEqual(resource, "arn:aws:s3:::*")
        wpml = json.loads((ROOT / "storage/policies/skyhub-wpml-reader.json").read_text())
        actions = [a for s in wpml["Statement"] for a in s["Action"]]
        self.assertNotIn("s3:PutObject", actions)
        self.assertNotIn("s3:DeleteObject", actions)

    def test_audit_identifies_multiple_stopped_minio_with_distinct_mounts(self):
        import importlib.util
        spec = importlib.util.spec_from_file_location(
            "pi_minio_audit", ROOT / "scripts/pi-minio-audit.py"
        )
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        self.assertTrue(module.identify_minio(
            "abc123\taeronexusadvanced-cloud-minio-1\taeronexus/minio:2025"
        ))
        self.assertFalse(module.identify_minio(
            "abc123\tskyhub-next-postgres-1\tpostgis/postgis:15"
        ))
        def item(name, source, state="exited"):
            return {
                "Name": "/" + name,
                "Config": {"Image": "aeronexus/minio:2025",
                           "Labels": {"com.docker.compose.project": "aeronexus"}},
                "State": {"Status": state, "ExitCode": 0},
                "Mounts": [{"Type": "bind", "Source": source,
                            "Destination": "/data", "RW": True}],
                "NetworkSettings": {"Networks": {"aeronexus_default": {}}},
            }
        rows = module.records([
            item("aeronexusadvanced-cloud-minio-1", "/srv/cloud-minio"),
            item("aeronexus-edge-minio-1", "/srv/edge-minio"),
        ])
        report = module.report(rows)
        self.assertIn("2 non-running MinIO container(s)", report)
        self.assertNotIn("CAUTION: storage source used by multiple containers", report)
        rows = module.records([
            item("aeronexusadvanced-cloud-minio-1", "/srv/shared"),
            item("aeronexus-edge-minio-1", "/srv/shared"),
        ])
        self.assertIn("CAUTION: storage source used by multiple containers",
                      module.report(rows))

    def test_shared_mount_preflight_is_readonly_and_checks_external_mount(self):
        helper = ROOT / "scripts/pi-minio-shared-mount-check.sh"
        self.assertTrue(helper.is_file())
        result = subprocess.run(["bash", "-n", str(helper)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        text = helper.read_text(encoding="utf-8")
        # The data was moved here from aeronexus-data/minio; the check must follow it.
        self.assertIn('data="${SKYHUB_MINIO_DATA:-/mnt/hc4backup/skyhub-next/minio}"', text)
        self.assertIn("findmnt --target", text)
        self.assertIn('mount_target" != "/"', text)
        for destructive in ("docker start ", "docker stop ", "docker rm ", "mkdir -p ", "sudo mount ", "docker network connect "):
            self.assertNotIn(destructive, text)

    def test_adopt_requires_explicit_data_source_and_real_mount(self):
        helper = SCRIPT.read_text(encoding="utf-8")
        self.assertIn("SKYHUB_MINIO_EXPECTED_DATA_SOURCE", helper)
        self.assertIn('if [[ "$mount_type" == bind ]]; then', helper)
        self.assertIn("findmnt --target", helper)
        self.assertIn('mount_target" != "/"', helper)
        self.assertIn('Destination "/data"', helper)

    def test_adopt_refuses_host_published_s3_port_9000(self):
        helper = SCRIPT.read_text(encoding="utf-8")
        self.assertIn('index .HostConfig.PortBindings "9000/tcp"', helper)
        self.assertIn('[[ -z "$s3_host_bindings" ]]', helper)
        self.assertIn("MinIO publishes S3/tcp 9000 to the Docker host", helper)
        self.assertIn("Recreate the chosen container from reviewed Compose", helper)

    def test_adoption_does_not_require_deleting_old_stopped_minio_containers(self):
        helper = SCRIPT.read_text(encoding="utf-8")
        self.assertIn("docker ps --no-trunc --format", helper)
        self.assertIn("expected exactly one running MinIO server", helper)
        self.assertIn("Stopped historical containers remain untouched", helper)

    def test_migrated_runtime_is_separate_no_ports_same_nvme(self):
        standalone = (ROOT / "docker-compose.minio-shared.yml").read_text()
        self.assertIn("name: skyhub-storage", standalone)
        self.assertIn("container_name: skyhub-shared-minio", standalone)
        self.assertIn("image: skyhub/minio:RELEASE.2025-10-15", standalone)
        self.assertIn("pull_policy: never", standalone)
        self.assertIn("create_host_path: false", standalone)
        self.assertIn("/mnt/hc4backup/skyhub-next/minio", standalone)
        self.assertNotIn("\n    ports:", standalone)
        self.assertNotIn("source: /mnt/hc4backup/aeronexus-data/minio", standalone)
        self.assertIn("format: raw", standalone)

    def test_aeronexus_migration_explicitly_copy_free_and_opt_in(self):
        helper = ROOT / "scripts/pi-minio-migrate-from-aeronexus.sh"
        self.assertTrue(helper.is_file())
        parsed = subprocess.run(["bash", "-n", str(helper)], capture_output=True, text=True)
        self.assertEqual(parsed.returncode, 0, parsed.stderr)
        out = subprocess.run(["bash", str(helper), "--help"], capture_output=True, text=True)
        self.assertEqual(out.returncode, 0, out.stderr)
        for mode in ("plan", "move", "up", "status"):
            self.assertIn(mode, out.stdout)
        text = helper.read_text()
        self.assertIn("os.rename(src, dst)", text)
        self.assertIn("os.stat(src).st_dev != os.stat(dst.parent).st_dev", text)
        self.assertIn('ln -s -- "$TARGET" "$LINK"', text)
        self.assertIn('docker image tag "$OLD_IMAGE" "$NEW_IMAGE"', text)
        self.assertIn('verify_old_stopped', text)
        self.assertIn('verify_no_other_running', text)
        self.assertIn('EXPECTED_IMAGE_ID="sha256:117cf7edd05', text)
        self.assertIn("docker compose -f", text)
        for bad in ("cp -a", "rsync", "shutil.copy", "docker compose down",
                    "docker volume rm", "docker start ", "docker stop ",
                    "docker rm -f", "docker pull ", "mv -"):
            self.assertNotIn(bad + "\n", text)
        self.assertIn("/storage/minio-data", (ROOT / ".gitignore").read_text())

    def test_migration_accepts_first_time_checkout_without_storage_directory(self):
        import os
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp)
            (project / "docker-compose.yml").write_text("name: skyhub-next\\n")
            (project / "backend").mkdir()
            self.assertFalse((project / "storage").exists())
            env = {**os.environ, "SKYHUB_PROJECT_DIR": str(project)}
            proc = subprocess.run(
                ["bash", str(ROOT / "scripts/pi-minio-migrate-from-aeronexus.sh"),
                 "--help"],
                capture_output=True, text=True, env=env,
            )
            self.assertEqual(proc.returncode, 0, proc.stderr)
            self.assertIn("PLAN only", (
                ROOT / "scripts/pi-minio-migrate-from-aeronexus.sh"
            ).read_text())
            self.assertFalse((project / "storage").exists(),
                             "Read-only help must never create storage/")
            helper = (ROOT / "scripts/pi-minio-migrate-from-aeronexus.sh").read_text()
            self.assertIn('mkdir -p -- "$STORAGE_DIR"', helper)
            self.assertIn('SkyHub storage/ directory: absent (will be created by move only)', helper)

    def test_migration_rejects_invalid_checkout_path(self):
        import os
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            env = {**os.environ, "SKYHUB_PROJECT_DIR": tmp}
            proc = subprocess.run(
                ["bash", str(ROOT / "scripts/pi-minio-migrate-from-aeronexus.sh"),
                 "plan"],
                capture_output=True, text=True, env=env,
            )
            self.assertEqual(proc.returncode, 2)
            self.assertIn("absolute SkyHub checkout", proc.stderr)

    def test_credentials_exporter_never_prints_values_or_overwrites(self):
        import importlib.util
        path = ROOT / "scripts/pi-minio-credentials.py"
        spec = importlib.util.spec_from_file_location("minio_credentials", path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        config = mod.parse_env([
            "PATH=/bin",
            "MINIO_ROOT_USER=s3-user",
            "MINIO_ROOT_PASSWORD=unit-test-only",
            "MINIO_REGION_NAME=us-east-1",
        ])
        self.assertEqual(config["MINIO_ROOT_USER"], "s3-user")
        self.assertEqual(len(config), 3)
        with self.assertRaises(ValueError):
            mod.parse_env([
                "MINIO_ROOT_USER=s3-user",
                "MINIO_ROOT_PASSWORD=unit-test-only",
                "MINIO_KMS_KES_ENDPOINT=https://kms.local",
            ])
        import tempfile
        with tempfile.TemporaryDirectory() as folder:
            dest = Path(folder) / "secrets.env"
            mod.export_file(config, dest)
            self.assertEqual(dest.stat().st_mode & 0o777, 0o600)
            with self.assertRaises(FileExistsError):
                mod.export_file(config, dest)
        text = path.read_text()
        self.assertNotIn("print(values)", text)
        self.assertNotIn("print(env)", text)
        self.assertIn("O_EXCL", text)

    def test_aeronexusadvanced_credentials_readonly_compare_and_safe_import(self):
        import importlib.util
        import tempfile
        from unittest.mock import patch
        module_path = ROOT / "scripts/pi-minio-env-from-aeronexusadvanced.py"
        spec = importlib.util.spec_from_file_location("aeronexusadv_credentials", module_path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        with tempfile.TemporaryDirectory() as dirname:
            root = Path(dirname)
            source = root / "aeronexus.env"
            source.write_text(
                "MINIO_ROOT_USER='legacy-minio'\n"
                "MINIO_ROOT_PASSWORD='some-legacy-secret'\n"
                "AERONEXUS_MINIO_ACCESS_KEY=not-the-root-account\n"
            )
            source.chmod(0o600)
            existing = root / "skyhub.env"
            existing.write_text(
                "MINIO_ROOT_USER=old-user\nMINIO_ROOT_PASSWORD=old-secret\n"
                "MINIO_API_CORS_ALLOW_ORIGIN=*\n"
            )
            existing.chmod(0o600)
            credentials = mod.root_values(source)
            self.assertEqual(credentials["MINIO_ROOT_USER"], "legacy-minio")
            with patch.object(mod, "TARGET", existing):
                self.assertNotEqual(mod.current_values()["MINIO_ROOT_USER"],
                                    credentials["MINIO_ROOT_USER"])
                with self.assertRaises(mod.ConfigurationError):
                    mod.import_from_project(source, credentials, False)
                self.assertIn("old-user", existing.read_text())
                with patch.object(mod, "assert_minio_stopped"):
                    message = mod.import_from_project(source, credentials, True)
                self.assertIn("UPDATED", message)
                self.assertNotIn("some-legacy-secret", message)
                self.assertEqual(mod.current_values()["MINIO_ROOT_USER"],
                                 "legacy-minio")
                self.assertEqual(mod.current_values()["MINIO_ROOT_PASSWORD"],
                                 "some-legacy-secret")
                self.assertEqual(mod.current_values()["MINIO_API_CORS_ALLOW_ORIGIN"],
                                 "*")
                self.assertEqual(existing.stat().st_mode & 0o777, 0o600)
                backups = list(root.glob("skyhub.env.before-aeronexusadvanced-*"))
                self.assertEqual(len(backups), 1)
                self.assertEqual(backups[0].stat().st_mode & 0o777, 0o600)
                self.assertIn("old-secret", backups[0].read_text())

    def test_aeronexusadvanced_env_refuses_wrong_or_insecure_source(self):
        import importlib.util
        import tempfile
        module_path = ROOT / "scripts/pi-minio-env-from-aeronexusadvanced.py"
        spec = importlib.util.spec_from_file_location("aeronexusadv_rejection", module_path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        with tempfile.TemporaryDirectory() as dirname:
            root = Path(dirname)
            path = root / ".env"
            path.write_text(
                "AERONEXUS_MINIO_ACCESS_KEY=client\n"
                "AERONEXUS_MINIO_SECRET_KEY=client-secret\n"
            )
            path.chmod(0o600)
            with self.assertRaises(mod.ConfigurationError):
                mod.root_values(path)
            path.write_text("MINIO_ROOT_USER=x\nMINIO_ROOT_PASSWORD=${UNSET}\n")
            with self.assertRaises(mod.ConfigurationError):
                mod.root_values(path)
            path.write_text("MINIO_ROOT_USER=x\nMINIO_ROOT_PASSWORD=some-secret\n")
            path.chmod(0o644)
            with self.assertRaises(mod.ConfigurationError):
                mod.root_values(path)
            path.chmod(0o600)
            sym = root / "linked.env"
            sym.symlink_to(path)
            with self.assertRaises(mod.ConfigurationError):
                mod.root_values(sym)

    def test_minio_up_requires_project_credentials_match(self):
        helper = (ROOT / "scripts/pi-minio-migrate-from-aeronexus.sh").read_text()
        self.assertIn("pi-minio-env-from-aeronexusadvanced.py", helper)
        self.assertIn("check --require-match", helper)
        self.assertIn("SKYHUB_AERONEXUSADVANCED_ENV_FILE", helper)

    def test_existing_profile_and_persistent_volume_are_preserved(self):
        compose = ROOT_COMPOSE.read_text(encoding="utf-8")
        self.assertIn('profiles: ["media"]', compose)
        self.assertIn("- minio_data:/data", compose)
        self.assertIn("SKYHUB_MINIO_IMAGE:-minio/minio:RELEASE.2023-09-04T19-57-37Z", compose)

    def test_helper_parses_and_defaults_to_readonly(self):
        syntax = subprocess.run(["bash", "-n", str(SCRIPT)], capture_output=True, text=True)
        self.assertEqual(syntax.returncode, 0, syntax.stderr)
        help_result = subprocess.run(["bash", str(SCRIPT), "--help"], capture_output=True, text=True)
        self.assertEqual(help_result.returncode, 0, help_result.stderr)
        for mode in ("plan", "apply", "adopt", "attach", "verify"):
            self.assertIn(mode, help_result.stdout)
        invalid = subprocess.run(["bash", str(SCRIPT), "invalid"], capture_output=True, text=True)
        self.assertEqual(invalid.returncode, 2)

    def test_helper_avoids_destructive_docker_ops(self):
        text = SCRIPT.read_text(encoding="utf-8")
        self.assertIn('up -d --no-deps minio', text)
        self.assertIn('docker network connect', text)
        self.assertIn("assert_alias_available", text)
        self.assertIn('existing MinIO is not running', text)
        self.assertIn('SkyHub-owned MinIO already exists', text)
        self.assertIn('"--allow-legacy-image"', text)
        for command in ("docker compose down", "docker volume rm", "docker system prune", "docker rm -f"):
            self.assertNotIn(command + "\n", text)
        self.assertNotIn('docker compose up -d --build', text)
        s3wrapper = (ROOT / "scripts/pi-minio-s3-check.sh").read_text(encoding="utf-8")
        self.assertIn("--read-only", s3wrapper)
        self.assertIn("--rm", s3wrapper)
        self.assertIn("--env-file", s3wrapper)
        self.assertNotIn("docker network connect", s3wrapper)
        syntax = subprocess.run(
            ["bash", "-n", str(ROOT / "scripts/pi-minio-s3-check.sh")],
            capture_output=True, text=True
        )
        self.assertEqual(syntax.returncode, 0, syntax.stderr)


if __name__ == "__main__":
    unittest.main()
