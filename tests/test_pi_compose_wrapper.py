"""scripts/pi-compose.sh gibt immer die Pi-Overlays mit und lehnt stack-weite Befehle ohne Dienstnamen ab.

Hermetisch: kopiert das Skript in ein Wegwerf-Projekt und ersetzt `docker` durch eine Attrappe. Kein echtes Compose.
"""
from __future__ import annotations

from pathlib import Path
import os
import shutil
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "pi-compose.sh"


class PiComposeWrapperTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        (self.tmp / "scripts").mkdir()
        shutil.copy(SCRIPT, self.tmp / "scripts" / "pi-compose.sh")
        for name in (".env", "docker-compose.yml", "docker-compose.arm64.yml"):
            (self.tmp / name).write_text("")
        self.bin = self.tmp / "bin"
        self.bin.mkdir()
        self.log = self.tmp / "docker-calls.txt"
        stub = self.bin / "docker"
        stub.write_text(f'#!/usr/bin/env bash\necho "$@" >> "{self.log}"\n')
        stub.chmod(0o755)
        self.env = dict(os.environ, PATH=f"{self.bin}:{os.environ['PATH']}")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def run_wrapper(self, *args):
        return subprocess.run(["bash", str(self.tmp / "scripts" / "pi-compose.sh"), *args],
                              capture_output=True, text=True, env=self.env)

    def calls(self):
        return self.log.read_text().splitlines() if self.log.exists() else []

    def test_stack_wide_commands_without_service_names_are_refused(self):
        for args in (("up", "-d"), ("up", "-d", "--no-build"), ("down",), ("restart",), ("stop",), ("rm", "-f")):
            r = self.run_wrapper(*args)
            self.assertEqual(2, r.returncode, args)
            self.assertIn("ABGELEHNT", r.stderr)
        self.assertEqual([], self.calls())                      # docker wurde nie aufgerufen

    def test_named_service_and_explicit_all_services_pass_with_the_overlays(self):
        self.assertEqual(0, self.run_wrapper("up", "-d", "--no-build", "backend").returncode)
        self.assertEqual(0, self.run_wrapper("up", "-d", "--all-services").returncode)
        first, second = self.calls()
        for line in (first, second):
            self.assertIn("-p skyhub-next --env-file .env -f docker-compose.yml -f docker-compose.arm64.yml", line)
        self.assertTrue(first.endswith("up -d --no-build backend"))
        self.assertNotIn("--all-services", second)              # das Schutz-Flag wird nicht an Compose weitergereicht

    def test_read_only_commands_pass_and_override_is_added_when_present(self):
        self.assertEqual(0, self.run_wrapper("ps").returncode)
        self.assertEqual(0, self.run_wrapper("config", "--quiet").returncode)
        (self.tmp / "docker-compose.override.yml").write_text("")
        self.assertEqual(0, self.run_wrapper("ps").returncode)
        ps_plain, config, ps_override = self.calls()
        self.assertTrue(ps_plain.endswith("docker-compose.arm64.yml ps"))
        self.assertTrue(config.endswith("config --quiet"))
        self.assertIn("-f docker-compose.override.yml", ps_override)

    def test_missing_overlay_or_env_is_an_error(self):
        (self.tmp / "docker-compose.arm64.yml").unlink()
        self.assertEqual(2, self.run_wrapper("ps").returncode)
        self.assertEqual([], self.calls())


if __name__ == "__main__":
    unittest.main()
