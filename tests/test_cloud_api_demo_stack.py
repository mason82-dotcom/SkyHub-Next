"""Static guards for the isolated DJI Cloud API demo stack in ops/cloud-api-demo.

They never start Compose or Docker and never read a local .env.
"""
from __future__ import annotations

from pathlib import Path
import os
import re
import subprocess
import tempfile
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
                mapping.startswith(("127.0.0.1:", "${DEMO_BIND_ADDRESS", "${DEMO_BACKEND_BIND:-${DEMO_BIND_ADDRESS}}")),
                f"port mapping without explicit bind address: {mapping}",
            )

    def test_emqx_node_name_does_not_depend_on_the_container_ip(self) -> None:
        # Without a fixed name the image derives it from the container IP; a new IP after a reboot means a new,
        # empty Mnesia directory and lost MQTT users (27.10.2026).
        emqx = COMPOSE.split("\n  emqx:\n", 1)[1].split("\n\n", 1)[0]
        self.assertRegex(emqx, re.compile(r"^\s+EMQX_NODE__NAME: emqx@127\.0\.0\.1$", re.M))
        script = SCRIPT.read_text(encoding="utf-8")
        self.assertIn('if mode == "check":', script)
        self.assertIn("cmd_provision check", script)

    def test_only_the_dashboard_and_databases_are_loopback_only(self) -> None:
        loopback = re.findall(r'"127\.0\.0\.1:(\d+):', COMPOSE)
        self.assertEqual(sorted(loopback), ["18083", "3307", "6380"])
        lan = re.findall(r'"\$\{DEMO_BIND_ADDRESS[^}]*\}:(\d+):', COMPOSE)
        self.assertEqual(sorted(lan), ["18084", "18830", "8081"])
        # The backend port follows DEMO_BACKEND_BIND (loopback in same-origin mode), defaulting to the LAN address.
        self.assertIn('"${DEMO_BACKEND_BIND:-${DEMO_BIND_ADDRESS}}:6789:6789"', COMPOSE)

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
        # A local checkout may hold the ignored .env and runtime/ after `apply`; only tracked files count.
        listed = subprocess.run(
            ["git", "ls-files", "--", str(STACK)], cwd=STACK, capture_output=True, text=True
        )
        if listed.returncode != 0:
            self.skipTest("not a git checkout")
        tracked = {Path(line).name for line in listed.stdout.splitlines()}
        self.assertFalse({".env", "application.yml", "acl.conf", "20-local-users.sql"} & tracked)
        self.assertFalse([line for line in listed.stdout.splitlines() if "/runtime/" in line])

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


CADDY_SCRIPT = STACK / "pi-caddy-cloud-api-demo.sh"


def render(same_origin: bool) -> tuple[str, str]:
    """Render the generated web config in a temp dir from a throwaway .env (random secrets, nothing real)."""
    with tempfile.TemporaryDirectory() as tmp:
        env = {**os.environ, "ENV_FILE": f"{tmp}/t.env", "RUNTIME": f"{tmp}/rt", "DEMO_SOURCES_DIR": tmp}
        subprocess.run(["bash", str(SCRIPT), "init"], env=env, check=True, capture_output=True)
        text = Path(f"{tmp}/t.env").read_text(encoding="utf-8")
        text = re.sub(r"^DEMO_SAME_ORIGIN=.*$", f"DEMO_SAME_ORIGIN={str(same_origin).lower()}", text, flags=re.M)
        Path(f"{tmp}/t.env").write_text(text, encoding="utf-8")
        subprocess.run(["bash", str(SCRIPT), "render"], env=env, check=True, capture_output=True)
        return (
            Path(f"{tmp}/rt/web/config.ts").read_text(encoding="utf-8"),
            Path(f"{tmp}/rt/web/nginx.conf").read_text(encoding="utf-8"),
        )


class CloudApiDemoHttpsTest(unittest.TestCase):
    def test_default_mode_keeps_direct_backend_urls_and_has_no_proxy(self) -> None:
        config, nginx = render(False)
        self.assertRegex(config, r'baseURL: "http://[0-9.]+:6789/"')
        self.assertRegex(config, r'websocketURL: "ws://[0-9.]+:6789/api/v1/ws"')
        self.assertNotIn("proxy_pass", nginx)

    def test_same_origin_mode_derives_urls_from_the_page_and_proxies_only_known_prefixes(self) -> None:
        config, nginx = render(True)
        self.assertIn("baseURL: window.location.origin + '/'", config)
        self.assertIn("window.location.protocol === 'https:' ? 'wss://' : 'ws://'", config)
        self.assertIn("/(manage|map|media|wayline|storage|control)/api/v1/", nginx)
        self.assertIn("location = /api/v1/ws", nginx)
        self.assertIn('proxy_set_header Upgrade $http_upgrade;', nginx)
        self.assertEqual(nginx.count("proxy_pass http://backend:6789;"), 2)
        self.assertNotIn("proxy_pass http://backend:6789/;", nginx)

    def test_caddy_route_is_lan_only_on_its_own_port_and_reversible(self) -> None:
        subprocess.run(["bash", "-n", str(CADDY_SCRIPT)], check=True)
        block = subprocess.run(["bash", str(CADDY_SCRIPT), "print"], check=True, capture_output=True, text=True).stdout
        self.assertIn("rpi5.fritz.box:4444, 192.168.178.63:4444 {", block)
        self.assertIn("@lan remote_ip 192.168.178.0/24", block)
        self.assertIn('respond "Forbidden" 403', block)
        self.assertIn("reverse_proxy 192.168.178.63:8081", block)  # the web port, never the backend port
        self.assertNotIn("6789", block)
        for taken in (":443 ", ":4443", ":9443"):
            self.assertNotIn(taken, block)
        text = CADDY_SCRIPT.read_text(encoding="utf-8")
        self.assertIn("before-cloud-api-demo", text)  # backup name used by apply and rollback
        self.assertIn("restore \"$backup\"", text)
        self.assertIn('[ "$(id -u)" -eq 0 ]', text)
        # check waits (bounded) for the slow-starting Java backend instead of reporting a transient 502.
        self.assertIn("wait_for_backend", text)
        self.assertRegex(text, r'WAIT_SECONDS="\$\{WAIT_SECONDS:-\d+\}"')


if __name__ == "__main__":
    unittest.main()
