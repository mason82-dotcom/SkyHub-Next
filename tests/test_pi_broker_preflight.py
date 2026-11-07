"""Synthetic, strictly offline tests of the Raspberry Pi broker preflight."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "pi-preflight.sh"


def executable(directory, name, text):
    path = Path(directory) / name
    path.write_text("#!/bin/sh\n" + text, encoding="utf-8")
    path.chmod(0o755)


class PiBrokerPreflightTests(unittest.TestCase):
    def check_profile(self, kind, port, *, loopback_only=False, active=True,
                      existing_backend=True):
        with tempfile.TemporaryDirectory() as directory:
            mqtt_address = "127.0.0.1" if loopback_only else "0.0.0.0"
            ssh_ports = (
                f"LISTEN 0 64 {mqtt_address}:{port} 0.0.0.0:*\n"
                "LISTEN 0 64 127.0.0.1:4001 0.0.0.0:*\n"
            )
            executable(directory, "ss", "cat <<'PORTS'\n" + ssh_ports + "PORTS\n")
            executable(directory, "docker", (
                'case "$1" in\n'
                'info) exit 0;;\n'
                'port)\n'
                ' if [ "$2" = skyhub_emqx ]; then echo "0.0.0.0:1884"; fi\n'
                ' if [ "$2" = skyhub-next-backend-1 ]; then\n'
                + ('  echo "127.0.0.1:4001"\n' if existing_backend else '  :\n') +
                ' fi;;\n'
                'ps) :;;\n'
                '*) exit 1;;\n'
                'esac\n'
            ))
            executable(directory, "timedatectl", "echo yes\n")
            executable(directory, "systemctl",
                       'exit ' + ('0' if active else '1') + '\n')
            env = dict(os.environ, PATH=directory + os.pathsep + os.environ["PATH"])
            args = ["bash", str(SCRIPT), "--broker-kind", kind, "--broker-port", str(port)]
            return subprocess.run(args, env=env, text=True,
                                  capture_output=True, check=False)

    def test_explicit_mosquitto_1883_with_non_loopback_listener_passes(self):
        result = self.check_profile("mosquitto", 1883)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("Mosquitto service mosquitto is active", result.stdout)
        self.assertNotIn("skyhub_emqx container mapping is absent", result.stderr)
        self.assertIn("does NOT establish MQTT auth", result.stdout)

    def test_dedicated_mosquitto_1884_checks_its_own_unit(self):
        result = self.check_profile("mosquitto-dedicated", 1884)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("Mosquitto service skyhub-mosquitto is active", result.stdout)
        inactive = self.check_profile("mosquitto-dedicated", 1884, active=False)
        self.assertNotEqual(inactive.returncode, 0)
        self.assertIn("skyhub-mosquitto is not confirmed active", inactive.stderr)

    def test_legacy_emqx_1884_still_passes(self):
        result = self.check_profile("emqx", 1884)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("legacy skyhub_emqx", result.stdout)

    def test_mismatched_or_unknown_profiles_fail_closed(self):
        for kind, port in [("mosquitto", 1884), ("emqx", 1883),
                           ("mosquitto", 1885), ("unknown", 1883),
                           ("mosquitto-dedicated", 1883)]:
            with self.subTest(kind=kind, port=port):
                result = self.check_profile(kind, port)
                self.assertEqual(result.returncode, 2)
                self.assertIn("REFUSED", result.stderr)

    def test_mosquitto_loopback_only_fails_for_docker_host_gateway(self):
        result = self.check_profile("mosquitto", 1883, loopback_only=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("no non-loopback listener", result.stderr)

    def test_inactive_mosquitto_fails(self):
        result = self.check_profile("mosquitto", 1883, active=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("not confirmed active", result.stderr)

    def test_unverified_backend_port_4001_fails(self):
        result = self.check_profile("mosquitto", 1883, existing_backend=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("unexpected or unverified listener", result.stderr)


if __name__ == "__main__":
    unittest.main()
