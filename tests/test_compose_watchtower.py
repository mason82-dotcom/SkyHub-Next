"""Static guard: Watchtower leaves SkyHub-Next and the shared MinIO alone.

The Pi's Watchtower runs without --label-enable, so it updates every container that does not opt out and restarts the
containers that depend on it (27.10.2026: a new redis:7-alpine also restarted the backend). Never starts Compose.
"""
from __future__ import annotations

from pathlib import Path
import unittest

from test_compose_logging import service_blocks

ROOT = Path(__file__).resolve().parents[1]
LABEL = 'com.centurylinklabs.watchtower.enable: "false"'


class ComposeWatchtowerTests(unittest.TestCase):
    def test_every_skyhub_service_opts_out(self):
        text = (ROOT / "docker-compose.yml").read_text(encoding="utf-8")
        self.assertIn("x-labels: &no-watchtower\n  " + LABEL, text)
        blocks = service_blocks(text)
        self.assertGreaterEqual(len(blocks), 4)
        for name, block in blocks.items():
            self.assertIn("labels: *no-watchtower", block, f"Dienst {name} ohne Watchtower-Ausnahme")

    def test_shared_minio_opts_out(self):
        text = (ROOT / "docker-compose.minio-shared.yml").read_text(encoding="utf-8")
        self.assertIn(LABEL, text)


if __name__ == "__main__":
    unittest.main()
