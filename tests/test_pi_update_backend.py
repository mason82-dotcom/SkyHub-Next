"""Synthetic, strictly offline tests of scripts/pi-update-backend.sh.

The script is copied into a throwaway tree and run with stubbed docker, git, uname, ss, curl,
systemctl and timedatectl. Nothing here touches Docker, the Pi, the network or the real $HOME.
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"

STUBS = {
    "uname": '[ "$1" = "-s" ] && echo Linux\n[ "$1" = "-m" ] && echo "${STUB_ARCH:-aarch64}"\nexit 0\n',
    "git": (
        'case "$*" in\n'
        ' "branch --show-current") echo "${STUB_BRANCH:-main}";;\n'
        ' "status --porcelain --untracked-files=no") printf "%s" "${STUB_DIRTY:-}";;\n'
        ' "rev-parse HEAD") echo "${STUB_HEAD:-aaa111}";;\n'
        ' "rev-parse origin/main") echo "${STUB_ORIGIN:-aaa111}";;\n'
        'esac\n'
    ),
    "docker": (
        'echo "$*" >> "$STUB_LOG"\n'
        'case "$1" in\n'
        ' info) exit 0;;\n'
        ' image) exit 0;;\n'
        ' ps) exit 0;;\n'
        ' inspect) case "$*" in\n'
        '   *State.Running*) echo true;;\n'
        '   *.Name*) echo /skyhub-next-backend-1;;\n'
        '   *.Image*) echo sha256:oldimage;;\n'
        '  esac;;\n'
        ' port) case "$2" in\n'
        '   skyhub-next-backend-1) echo 127.0.0.1:4001;;\n'
        '   skyhub_emqx) echo 0.0.0.0:1884;;\n'
        '  esac;;\n'
        ' compose) shift; all="$*"; case "$all" in\n'
        '   *"config --format json"*) cat "$STUB_COMPOSE_JSON";;\n'
        '   *"config --quiet"*) ;;\n'
        '   *"ps -q"*) echo "id-${all##* }";;\n'
        '   *" exec "*) [ -n "$STUB_EMPTY_DUMP" ] || echo DUMPDATA;;\n'
        '  esac;;\n'
        'esac\n'
    ),
    "ss": 'printf "LISTEN 0 64 0.0.0.0:%s 0.0.0.0:*\\nLISTEN 0 64 127.0.0.1:4001 0.0.0.0:*\\n" "$STUB_PORT"\n',
    "curl": 'echo \'{"readOnly":true,"status":"online"}\'\n',
    "timedatectl": "echo yes\n",
    "systemctl": "exit 0\n",
    "sleep": "exit 0\n",
}


def compose_json(kind="mosquitto-dedicated", pin="1884", url=None, pilot=None):
    env = {
        "SKYHUB_MQTT_BROKER_KIND": kind,
        "SKYHUB_MQTT_REQUIRED_PORT": pin,
        "MQTT_BROKER_URL": url or "mqtt://host.docker.internal:" + pin,
        "SKYHUB_PILOT_ENABLED": "true" if pilot else "false",
    }
    if pilot:
        env["SKYHUB_PILOT_MQTT_URL"] = pilot
    return json.dumps({"services": {"backend": {"environment": env}}})


class PiUpdateBackendTests(unittest.TestCase):
    def run_update(self, args=("--apply",), compose=None, port="1884", env_file=True, **stub_env):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        root = Path(directory.name)
        repo, bin_dir, home = root / "repo", root / "bin", root / "home"
        for path in (repo / "scripts", bin_dir, home):
            path.mkdir(parents=True)
        for name in ("pi-update-backend.sh", "pi-preflight.sh"):
            shutil.copy(SCRIPTS / name, repo / "scripts" / name)
        if env_file:
            (repo / ".env").write_text("SKYHUB_VIEW_TOKEN=not-a-real-secret\n", encoding="utf-8")
        for name, text in STUBS.items():
            stub = bin_dir / name
            stub.write_text("#!/bin/sh\n" + text, encoding="utf-8")
            stub.chmod(0o755)
        (root / "compose.json").write_text(compose or compose_json(), encoding="utf-8")
        log = root / "docker.log"
        log.write_text("", encoding="utf-8")
        env = dict(os.environ, PATH=str(bin_dir) + os.pathsep + os.environ["PATH"], HOME=str(home),
                   STUB_COMPOSE_JSON=str(root / "compose.json"), STUB_LOG=str(log), STUB_PORT=port,
                   **stub_env)
        result = subprocess.run(["bash", str(repo / "scripts" / "pi-update-backend.sh"), *args],
                                cwd=repo, env=env, text=True, capture_output=True, check=False)
        result.docker_log = log.read_text(encoding="utf-8")
        result.backups = list((home / "Projekte" / "_backups" / "skyhub-next").glob("*"))
        return result

    def assert_refused(self, result, message=None, code=2):
        self.assertEqual(result.returncode, code, result.stdout + result.stderr)
        self.assertIn("REFUSED", result.stderr)
        if message:
            self.assertIn(message, result.stderr)
        # A refusal must happen before anything is backed up, built or recreated.
        self.assertEqual(result.backups, [], "a refused run must not create a backup")
        self.assertNotIn("build", result.docker_log)
        self.assertNotIn("up -d", result.docker_log)

    def test_requires_explicit_apply_flag(self):
        for args in ((), ("--dry-run",), ("--apply", "extra")):
            with self.subTest(args=args):
                result = self.run_update(args)
                self.assertEqual(result.returncode, 2)
                self.assertIn("Usage", result.stderr)

    def test_refuses_other_architectures(self):
        self.assert_refused(self.run_update(STUB_ARCH="x86_64"), "ARM64")

    def test_refuses_without_local_env(self):
        self.assert_refused(self.run_update(env_file=False), ".env missing")

    def test_refuses_wrong_branch_dirty_tree_and_unfetched_head(self):
        for label, stub_env, message in (
            ("branch", {"STUB_BRANCH": "feature/x"}, "main branch and clean"),
            ("dirty", {"STUB_DIRTY": " M backend/server.js"}, "main branch and clean"),
            ("diverged", {"STUB_HEAD": "aaa111", "STUB_ORIGIN": "bbb222"}, "does not match fetched origin/main"),
        ):
            with self.subTest(label):
                self.assert_refused(self.run_update(**stub_env), message)

    def test_accepts_every_known_broker_profile(self):
        for kind, pin in (("emqx", "1884"), ("mosquitto", "1883"), ("mosquitto-dedicated", "1884")):
            with self.subTest(kind=kind):
                result = self.run_update(compose=compose_json(kind, pin), port=pin)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertIn("SUCCESS", result.stdout)

    def test_refuses_inconsistent_broker_profiles(self):
        bad = {
            "dedicated on the 1883 port": compose_json("mosquitto-dedicated", "1883"),
            "mosquitto on the 1884 port": compose_json("mosquitto", "1884"),
            "emqx on the 1883 port": compose_json("emqx", "1883"),
            "unknown broker kind": compose_json("rabbitmq", "1884"),
            "URL port differs from pin": compose_json(url="mqtt://host.docker.internal:1883"),
            "credentials in URL": compose_json(url="mqtt://user:pw@host.docker.internal:1884"),
            "RC endpoint on another port": compose_json(pilot="mqtt://192.168.178.63:1883"),
            "RC endpoint with TLS scheme": compose_json(pilot="mqtts://192.168.178.63:1884"),
        }
        for label, compose in bad.items():
            with self.subTest(label):
                self.assert_refused(self.run_update(compose=compose), "profile is inconsistent")

    def test_happy_path_backs_up_then_rebuilds_only_the_backend(self):
        result = self.run_update()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(len(result.backups), 1)
        backup = result.backups[0]
        self.assertTrue((backup / ".env").is_file())
        self.assertGreater((backup / "postgis.dump").stat().st_size, 0)
        self.assertEqual((backup / "source-commit.txt").read_text(encoding="utf-8").strip(), "aaa111")
        self.assertIn("build backend", result.docker_log)
        self.assertIn("up -d --no-deps --no-build backend", result.docker_log)
        for forbidden in ("down", "volume rm", "rm -f", "restart postgres", "restart redis"):
            self.assertNotIn(forbidden, result.docker_log)

    def test_empty_database_dump_is_refused_before_any_rebuild(self):
        result = self.run_update(STUB_EMPTY_DUMP="1")
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn("backup appears empty", result.stderr)
        self.assertNotIn("build", result.docker_log)
        self.assertNotIn("up -d", result.docker_log)
        self.assertFalse(any((b / "postgis.dump").exists() for b in result.backups),
                         "an empty dump must not be left behind as a backup")


if __name__ == "__main__":
    unittest.main()
