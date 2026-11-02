"""scripts/dji-tsdk-run.sh with a fake `docker` (no Docker, no SDK): host-side deadline and cleanup."""
from pathlib import Path
import os
import subprocess
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts/dji-tsdk-run.sh"
FAKE = """#!/usr/bin/env bash
echo "$*" >> "$FAKE_LOG"
case "$1" in
  run) exit 0 ;;
  wait) if [ "$FAKE_MODE" = hang ]; then exec sleep 300; else echo "$FAKE_CODE"; fi ;;
  logs) echo "sdk output" ;;
  kill|rm) exit 0 ;;
esac
"""


class DjiTsdkRunTest(unittest.TestCase):
    def run_script(self, mode, code="0", timeout="1"):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            (tmp / "bin").mkdir()
            docker = tmp / "bin/docker"
            docker.write_text(FAKE)
            docker.chmod(0o755)
            (tmp / "sdk").mkdir()
            (tmp / "in.JPG").write_bytes(b"x")
            env = {**os.environ, "PATH": f"{tmp}/bin:{os.environ['PATH']}",
                   "FAKE_LOG": str(tmp / "log"), "FAKE_MODE": mode, "FAKE_CODE": code}
            start = time.monotonic()
            result = subprocess.run(["bash", str(SCRIPT), "--timeout", timeout, "--sdk", str(tmp / "sdk"),
                                     "--input", str(tmp / "in.JPG"), "--", "./dji_irp", "--action", "extract"],
                                    env=env, capture_output=True, text=True, timeout=30)
            return result, time.monotonic() - start, (tmp / "log").read_text()

    def test_hanging_container_is_killed_from_the_host_and_removed(self):
        result, elapsed, log = self.run_script("hang")
        self.assertEqual(result.returncode, 124)
        self.assertLess(elapsed, 10)
        self.assertIn("ZEITÜBERSCHREITUNG", result.stderr)
        self.assertRegex(log, r"(?m)^kill skyhub-tsdk-")
        self.assertRegex(log, r"(?m)^rm -f skyhub-tsdk-")

    def test_exit_code_is_passed_through_and_container_removed(self):
        result, _, log = self.run_script("done", code="7")
        self.assertEqual(result.returncode, 7)
        self.assertIn("sdk output", result.stdout)
        self.assertNotRegex(log, r"(?m)^kill ")
        self.assertRegex(log, r"(?m)^rm -f skyhub-tsdk-")

    def test_isolation_flags(self):
        _, _, log = self.run_script("done")
        run = next(l for l in log.splitlines() if l.startswith("run "))
        for flag in ("--init", "--network none", "--read-only", "--cap-drop ALL",
                     "--security-opt no-new-privileges=true", "--pids-limit 64", "--memory 1g",
                     "dst=/sdk,readonly", "dst=/input.JPG,readonly"):
            self.assertIn(flag, run)
        self.assertNotIn("--rm", run)  # removal happens explicitly after logs are read
        # Default runtime is box64 on arm64; the command is prefixed automatically.
        self.assertIn("--platform linux/arm64", run)
        self.assertIn("skyhub-dji-box64:trixie box64 ./dji_irp", run)

    def test_rejects_invalid_timeout(self):
        result = subprocess.run(["bash", str(SCRIPT), "--timeout", "0", "--sdk", "/", "--input", "/etc/hostname",
                                 "--", "true"], capture_output=True, text=True)
        self.assertEqual(result.returncode, 2)


if __name__ == "__main__":
    unittest.main()
