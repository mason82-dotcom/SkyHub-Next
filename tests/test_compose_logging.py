"""Static guard: every service in docker-compose.yml rotates its json logs.

Without max-size the json-file driver grows without bound. Do not shorten the files from outside (logrotate copytruncate):
Docker tracks the write position itself and `docker logs --tail` hangs afterwards. Never starts Compose.
"""
from __future__ import annotations

from pathlib import Path
import re
import unittest

COMPOSE = Path(__file__).resolve().parents[1] / "docker-compose.yml"


def service_blocks(text: str) -> dict[str, str]:
    body = text.split("\nservices:\n", 1)[1].split("\nvolumes:\n", 1)[0]
    parts = re.split(r"(?m)^  ([A-Za-z0-9_-]+):\s*$", body)
    return {parts[i]: parts[i + 1] for i in range(1, len(parts), 2)}


class ComposeLoggingTests(unittest.TestCase):
    def setUp(self):
        self.text = COMPOSE.read_text(encoding="utf-8")

    def test_default_logging_anchor_has_a_size_limit(self):
        anchor = re.search(r"(?ms)^x-logging: &default-logging\n(.*?)^services:", self.text)
        self.assertIsNotNone(anchor, "x-logging anchor fehlt")
        self.assertIn("json-file", anchor.group(1))
        self.assertRegex(anchor.group(1), r'max-size: "\d+[kmg]"')
        self.assertRegex(anchor.group(1), r'max-file: "\d+"')

    def test_every_service_uses_the_rotating_logging(self):
        blocks = service_blocks(self.text)
        self.assertGreaterEqual(len(blocks), 4)
        for name, block in blocks.items():
            self.assertIn("logging: *default-logging", block, f"Dienst {name} ohne Log-Rotation")


if __name__ == "__main__":
    unittest.main()
