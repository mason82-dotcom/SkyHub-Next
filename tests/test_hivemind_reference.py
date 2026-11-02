"""Offline safety guards for the optional AGPL HiveMind simulator lab."""
from __future__ import annotations

from pathlib import Path
import os
import re
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
LAB = ROOT / "simulators" / "hivemind"


class HivemindReferenceLabTest(unittest.TestCase):
    def test_reference_is_pinned_and_not_vendored(self):
        prepare = (LAB / "prepare.sh").read_text()
        self.assertIn("be269a3458ff6b2602d9a4dae14df278946cf7c1", prepare)
        self.assertIn("https://github.com/cdmiltd/hivemind-simulator.git", prepare)
        self.assertIn("git -C \"$SOURCE\" rev-parse HEAD", prepare)
        ignore = (ROOT / ".gitignore").read_text()
        for name in (".upstream/", ".m2-cache/", "lab.env"):
            self.assertIn("simulators/hivemind/" + name, ignore)

    def test_overlay_no_host_broker_or_prod_mounts(self):
        overlay = (LAB / "compose.lab.yml").read_text()
        self.assertIn('driver: bridge', overlay)
        self.assertIn('com.docker.network.bridge.host_binding_ipv4: "127.0.0.1"', overlay)
        self.assertIn('MQTT_BROKER_URL: mqtt://hivemind-broker:1884', overlay)
        self.assertIn('127.0.0.1:19090:9090', overlay)
        self.assertIn('dockerfile: ../Dockerfile.lab', overlay)
        self.assertIn('SKYHUB_TRACK_RECORDING_ENABLED: "false"', overlay)
        # Upstream MediaSampleInitializer auto-populates any nonempty media-dir.
        self.assertIn('SIMULATOR_MEDIA_MEDIADIR: ""', overlay)
        self.assertIn('SKYHUB_PILOT_ENABLED: "false"', overlay)
        self.assertNotRegex(overlay, r'(?m)^\s*-\s*["\x27]?(?:1883|1884|4000|4001):')
        self.assertNotIn("network_mode: host", overlay)
        self.assertNotIn("/var/run/docker.sock", overlay)
        self.assertNotIn("uas-network", overlay)

    def test_wrapper_guards_project_and_secrets(self):
        wrapper = (LAB / "lab.sh").read_text()
        self.assertIn('PROJECT="skyhub-hivemind-lab"', wrapper)
        self.assertIn("MQTT_BROKER_URL=mqtt://hivemind-broker:1884", wrapper)
        self.assertIn("SKYHUB_HTTP_PORT=14001", wrapper)
        self.assertIn('docker --host unix:///var/run/docker.sock', wrapper)
        self.assertIn('if [[ -e "$ENV_FILE" ]]', wrapper)
        self.assertIn("openssl rand -hex 32", wrapper)
        self.assertNotIn("down -v", wrapper)

    def test_wrapper_rejects_extra_keys_and_ambient_credentials(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            lab = root / "simulators" / "hivemind"
            lab.mkdir(parents=True)
            script = lab / "lab.sh"
            script.write_text((LAB / "lab.sh").read_text())
            binary = root / "bin"
            binary.mkdir()
            docker = binary / "docker"
            docker.write_text('#!/bin/sh\nprintf "args:%s\\n" "$*"\n'
                              'printf "ambient:%s\\n" "${SKYHUB_DJI_APP_KEY-unset}"\n')
            docker.chmod(0o755)
            env = {**os.environ, "PATH": f"{binary}:{os.environ['PATH']}",
                   "HOME": str(root), "SKYHUB_DJI_APP_KEY": "REAL_SECRET",
                   "COMPOSE_PROFILES": "media"}
            generated = "# Disposable lab only\n" + "\n".join([
                "SKYHUB_VIEW_TOKEN=" + "a" * 64,
                "SKYHUB_DB_PASSWORD=" + "b" * 64,
                "SKYHUB_MINIO_USER=lab_minio",
                "SKYHUB_MINIO_PASSWORD=" + "c" * 64,
                "MQTT_BROKER_URL=mqtt://hivemind-broker:1884",
                "MQTT_USER=", "MQTT_PASSWORD=", "SKYHUB_HTTP_PORT=14001",
                "SKYHUB_BIND_ADDRESS=127.0.0.1", "SKYHUB_PILOT_ENABLED=false",
                "SKYHUB_TOPOLOGY_ACK_ENABLED=false",
                "SKYHUB_TRACK_RECORDING_ENABLED=false", "SKYHUB_LAN_VIEW_CIDR=",
            ]) + "\n"
            envfile = lab / "lab.env"
            def run(contents, mode=0o600):
                envfile.write_text(contents)
                envfile.chmod(mode)
                return subprocess.run(["bash", str(script), "config"], env=env,
                                      text=True, capture_output=True, check=False)
            accepted = run(generated)
            self.assertEqual(accepted.returncode, 0, accepted.stderr)
            self.assertIn("--host unix:///var/run/docker.sock", accepted.stdout)
            self.assertIn("ambient:unset", accepted.stdout)
            for contents, mode in [
                (generated + "SKYHUB_DJI_APP_KEY=REAL_SECRET\n", 0o600),
                (generated + "SKYHUB_VIEW_TOKEN=" + "d" * 64 + "\n", 0o600),
                (generated, 0o644),
            ]:
                rejected = run(contents, mode)
                self.assertNotEqual(rejected.returncode, 0)
                self.assertNotIn("REAL_SECRET", rejected.stderr)

    def test_minimal_lab_runtime_is_unprivileged_and_no_ffmpeg(self):
        dockerfile = (LAB / "Dockerfile.lab").read_text()
        self.assertIn("FROM eclipse-temurin:21-jre", dockerfile)
        self.assertIn("USER 1000:1000", dockerfile)
        self.assertIn("target/dji-dock-simulator-1.4.10.jar", dockerfile)
        self.assertNotIn("apt-get", dockerfile)
        self.assertNotIn("SIMULATOR_MEDIA_MEDIADIR", dockerfile)
        self.assertNotIn("ffmpeg", dockerfile.lower().split("from eclipse-temurin")[1])

    def test_dock_mock_explicit_profile_and_no_exposed_ports(self):
        overlay = (LAB / "compose.lab.yml").read_text()
        self.assertIn('profiles: ["dock-rpc"]', overlay)
        mock = overlay.split("  dock-mock:", 1)[1].split("  hivemind-simulator:", 1)[0]
        self.assertNotIn("ports:", mock)
        self.assertIn("cap_drop: [ALL]", mock)
        self.assertIn("no-new-privileges:true", mock)
        wrapper = (LAB / "lab.sh").read_text()
        self.assertIn("--profile dock-rpc", wrapper)
        self.assertIn("dock-smoke", wrapper)
        dockerfile = (LAB / "Dockerfile.dock-mock").read_text()
        self.assertIn("USER node", dockerfile)
        self.assertIn("node:22-alpine", dockerfile)

    def test_lab_broker_anonymous_only_inside_lab(self):
        conf = (LAB / "mosquitto.conf").read_text()
        self.assertIn("listener 1884 0.0.0.0", conf)
        self.assertIn("allow_anonymous true", conf)
        self.assertIn("persistence false", conf)
        self.assertIn('No broker port', (LAB / "README.md").read_text())


if __name__ == "__main__":
    unittest.main()
