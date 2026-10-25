"""Offline tests for the read-only repository hygiene guard."""
import runpy
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
audit_paths = runpy.run_path(str(ROOT / "scripts" / "repository-hygiene.py"))["audit_paths"]


class RepositoryHygieneTest(unittest.TestCase):
    def test_allows_templates_and_historical_sources(self):
        paths = [
            ".env.example", "stacks/legacy-skyhub/.env.example",
            "stacks/legacy-skyhub/emqx/emqx.conf",
            "backend/data/hms-texts.json", "docs/pr-triage-2026-10-24.md",
        ]
        self.assertEqual([], audit_paths(paths))

    def test_detects_secrets_caches_and_backups(self):
        paths = [
            ".env", "backend/.env.production", "frontend/node_modules/x.js",
            "docs/private.pem", "backend/__pycache__/x.pyc",
            "frontend/public/index.html.bak-123", ".pytest_cache/status",
        ]
        findings = audit_paths(paths)
        self.assertEqual(7, len(findings))
        self.assertTrue(any("private env" in item for item in findings))
        self.assertTrue(any("possible private key" in item for item in findings))

    def test_detects_case_insensitive_collisions(self):
        findings = audit_paths(["docs/Plan.md", "docs/plan.md"])
        self.assertEqual(1, len(findings))
        self.assertIn("collision", findings[0])


if __name__ == "__main__":
    unittest.main()
