"""Static guards for the isolated DJI Cloud API demo stack in ops/cloud-api-demo.

They never start Compose or Docker and never read a local .env.
"""
from __future__ import annotations

from pathlib import Path
import re
import subprocess
import unittest

STACK = Path(__file__).resolve().parents[1] / "ops" / "cloud-api-demo"
COMPOSE = (STACK / "docker-compose.yml").read_text(encoding="utf-8")
SCRIPT = STACK / "pi-cloud-api-demo.sh"


class CloudApiDemoStackTest(unittest.TestCase):
    def test_no_service_listens_on_all_interfaces(self) -> None:
        self.assertNotIn("0.0.0.0", COMPOSE.replace("(nicht 0.0.0.0", ""))
        ports = re.findall(r'^\s*-\s*"([^"]+:\d+:\d+)"', COMPOSE, re.M)
        self.assertGreaterEqual(len(ports), 7)
        for mapping in ports:
            self.assertTrue(
                mapping.startswith(("127.0.0.1:", "${DEMO_BIND_ADDRESS")),
                f"port mapping without explicit bind address: {mapping}",
            )

    def test_only_the_dashboard_and_databases_are_loopback_only(self) -> None:
        loopback = re.findall(r'"127\.0\.0\.1:(\d+):', COMPOSE)
        self.assertEqual(sorted(loopback), ["18083", "3307", "6380"])
        lan = re.findall(r'"\$\{DEMO_BIND_ADDRESS[^}]*\}:(\d+):', COMPOSE)
        self.assertEqual(sorted(lan), ["18084", "18830", "6789", "8081"])

    def test_sources_are_pinned_to_full_commits_on_github(self) -> None:
        entries = [
            line.split()
            for line in (STACK / "sources.lock").read_text(encoding="utf-8").splitlines()
            if line.strip() and not line.lstrip().startswith("#")
        ]
        self.assertEqual({e[0] for e in entries}, {"DJI-Cloud-API-Demo", "Cloud-API-Demo-Web"})
        for _directory, url, commit in entries:
            self.assertRegex(url, r"^https://github\.com/dji-sdk/[A-Za-z0-9._-]+\.git$")
            self.assertRegex(commit, r"^[0-9a-f]{40}$")

    def test_no_secrets_or_generated_files_are_committed(self) -> None:
        names = {p.name for p in STACK.rglob("*") if p.is_file()}
        self.assertFalse({".env", "application.yml", "acl.conf", "20-local-users.sql"} & names)
        self.assertFalse((STACK / "runtime").exists())

    def test_script_is_valid_bash_and_guards_destructive_paths(self) -> None:
        subprocess.run(["bash", "-n", str(SCRIPT)], check=True)
        text = SCRIPT.read_text(encoding="utf-8")
        self.assertIn('[[ "$RUNTIME" == "$STACK_DIR"/runtime ]]', text)
        self.assertIn("check_sources", text)
        self.assertNotRegex(text, r"DEMO_BIND_ADDRESS\s+\"?0\.0\.0\.0")

    def test_gitignore_keeps_env_runtime_and_clones_out_of_git(self) -> None:
        ignore = (STACK.parents[1] / ".gitignore").read_text(encoding="utf-8")
        for entry in ("/ops/cloud-api-demo/.env", "/ops/cloud-api-demo/runtime/", "/third_party/"):
            self.assertIn(entry, ignore)


if __name__ == "__main__":
    unittest.main()
