"""Hermetic contract tests: no Docker, Git remote, Pi, MQTT or secrets required."""
from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[1] / "scripts" / "brix-planning-rollout-check.py"
spec = importlib.util.spec_from_file_location("brix_planning_check", SOURCE)
checker = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(checker)


class FakeResponse:
    def __init__(self, body, status=200):
        self.body = body
        self.status = status

    def read(self, _limit):
        return self.body


class FakeConnection:
    def __init__(self, _bind, _port, timeout=5):
        self.route = None
        self.closed = False

    def request(self, method, route, headers):
        assert method == "GET"
        self.route = route

    def getresponse(self):
        if self.route == "/api/health":
            return FakeResponse(b'{"readOnly":true,"status":"online"}')
        return FakeResponse(b"<html><title>Old Portal</title></html>")

    def close(self):
        self.closed = True


class BrixPlanningRolloutCheckTests(unittest.TestCase):
    def test_repository_assets_have_required_contract(self):
        checker.source_check()

    def test_missing_source_fails_closed(self):
        with tempfile.TemporaryDirectory() as temp, patch.object(checker, "ROOT", Path(temp)):
            with self.assertRaisesRegex(checker.Refusal, "Quelldatei fehlt"):
                checker.source_check()

    def test_duplicate_critical_env_is_refused_without_value_echo(self):
        with tempfile.TemporaryDirectory() as temp, patch.object(checker, "ROOT", Path(temp)):
            env = Path(temp) / ".env"
            env.write_text("SKYHUB_DRC_ENABLED=false\nSKYHUB_DRC_ENABLED=true\n")
            env.chmod(0o600)
            with self.assertRaisesRegex(checker.Refusal, "Doppelter kritischer"):
                checker.read_env_flags()

    def test_insecure_private_env_permissions_are_refused(self):
        with tempfile.TemporaryDirectory() as temp, patch.object(checker, "ROOT", Path(temp)):
            env = Path(temp) / ".env"
            env.write_text("SKYHUB_DRC_ENABLED=false\n")
            env.chmod(0o666)
            with self.assertRaisesRegex(checker.Refusal, "unsichere"):
                checker.read_env_flags()

    def test_runtime_uses_only_read_commands_and_fails_on_drc_enabled(self):
        with tempfile.TemporaryDirectory() as temp, patch.object(checker, "ROOT", Path(temp)):
            env = Path(temp) / ".env"
            env.write_text("SKYHUB_DRC_ENABLED=true\nSKYHUB_BRIX_BIND=192.168.178.50\n")
            env.chmod(0o600)
            calls = []

            def fake_exec(*args):
                calls.append(args)
                if args[:3] == ("git", "branch", "--show-current"): return "main"
                if args[:3] == ("git", "status", "--porcelain"): return ""
                if args == ("git", "rev-parse", "HEAD"): return "1" * 40
                if args == ("git", "rev-parse", "origin/main"): return "1" * 40
                self.fail("Unexpected command: " + repr(args))

            with patch.object(checker.platform, "system", return_value="Linux"), \
                 patch.object(checker.platform, "machine", return_value="x86_64"), \
                 patch.object(checker, "execute", side_effect=fake_exec):
                with self.assertRaisesRegex(checker.Refusal, "DRC ist lokal aktiviert"):
                    checker.runtime_context()
            self.assertEqual(4, len(calls))
            self.assertTrue(all(cmd[0] == "git" for cmd in calls))

    def test_effective_compose_drc_gate_refuses_hidden_activation(self):
        with tempfile.TemporaryDirectory() as temp, patch.object(checker, "ROOT", Path(temp)):
            env = Path(temp) / ".env"
            env.write_text("SKYHUB_DRC_ENABLED=false\nSKYHUB_BRIX_BIND=192.168.178.50\n")
            env.chmod(0o600)

            def fake_exec(*args):
                if args[:3] == ("git", "branch", "--show-current"): return "main"
                if args[:3] == ("git", "status", "--porcelain"): return ""
                if args == ("git", "rev-parse", "HEAD"): return "1" * 40
                if args == ("git", "rev-parse", "origin/main"): return "1" * 40
                if args[:3] == ("bash", "scripts/brix-compose.sh", "config"):
                    return json.dumps({"services": {"backend": {
                        "environment": {"SKYHUB_DRC_ENABLED": "true", "SECRET": "NEVER_PRINT"},
                        "ports": [{"host_ip": "192.168.178.50", "published": 4001,
                                   "target": 4000}]}}})
                self.fail("Unexpected command: " + repr(args))

            with patch.object(checker.platform, "system", return_value="Linux"), \
                 patch.object(checker.platform, "machine", return_value="x86_64"), \
                 patch.object(checker, "execute", side_effect=fake_exec):
                with self.assertRaisesRegex(checker.Refusal, "Effective Compose DRC gate"):
                    checker.runtime_context()

    def test_http_check_rejects_stale_planning_page(self):
        # HTTPConnection cannot follow redirects or honor an environment proxy.
        with patch.object(checker, "HTTPConnection", FakeConnection):
            checker.http_check("192.168.178.50", 4001, post=False)
            with self.assertRaisesRegex(checker.Refusal, "Portal-HTTP-Asset fehlt/alt"):
                checker.http_check("192.168.178.50", 4001, post=True)

    def test_http_redirect_is_not_followed(self):
        class RedirectConnection(FakeConnection):
            def getresponse(self):
                return FakeResponse(b"", status=302)
        with patch.object(checker, "HTTPConnection", RedirectConnection):
            with self.assertRaisesRegex(checker.Refusal, "HTTP nicht 200"):
                checker.fetch_local("192.168.178.50", 4001, "/cloud-api2.html")


if __name__ == "__main__":
    unittest.main()
