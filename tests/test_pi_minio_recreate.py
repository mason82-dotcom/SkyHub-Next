"""scripts/pi-minio-recreate.sh: legt den geteilten MinIO nur nach bestandenen Pruefungen neu an, in der Reihenfolge
Unit stoppen -> compose up --no-start --force-recreate -> Unit starten, und bricht vor jeder Aenderung ab, wenn etwas fehlt.

Hermetisch: Wegwerf-Projekt, docker/sudo/systemctl/pgrep sind Attrappen. Kein echter Container.
"""
from __future__ import annotations

from pathlib import Path
import os
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "pi-minio-recreate.sh"
IMAGE_ID = "sha256:117cf7edd050e6acd4a2d06be79b15eaecd5af76ad73e8927a4bf67528f19d10"

DOCKER = r'''#!/usr/bin/env bash
echo "docker $*" >> "$LOG"
args="$*"
case "$args" in
  "image inspect -f {{.Id}} "*) [[ -n "$NO_IMAGE" ]] && exit 1; echo "%(id)s" ;;
  "network inspect -f {{.Driver}} "*) echo bridge ;;
  *" config --quiet") exit 0 ;;
  *" config --format json") echo '{"services":{"minio":{"labels":{"com.centurylinklabs.watchtower.enable":"false"}}}}' ;;
  *" up "*) exit 0 ;;
  inspect*) f="$3"
    case "$f" in
      *State.Status*) echo running ;; *.Image*) echo "%(id)s" ;; *RestartPolicy*) echo no ;;
      *Mounts*) echo /mnt/hc4backup/skyhub-next/minio ;; *PortBindings*) echo "" ;; *Aliases*) echo "skyhub-minio " ;;
      *Labels*) [[ -n "$LABEL_SET" ]] && echo false || echo "" ;; *) echo abc ;;
    esac ;;
esac
''' % {"id": IMAGE_ID}


class PiMinioRecreateTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        scripts = self.tmp / "scripts"
        scripts.mkdir()
        shutil.copy(SCRIPT, scripts / SCRIPT.name)
        for helper in ("pi-minio-shared-mount-check.sh", "pi-minio-network.sh"):
            (scripts / helper).write_text("#!/usr/bin/env bash\nexit 0\n")
        (self.tmp / "docker-compose.minio-shared.yml").write_text("")
        self.home = self.tmp / "home"
        (self.home / ".config" / "skyhub").mkdir(parents=True)
        cred = self.home / ".config" / "skyhub" / "minio-shared.env"
        cred.write_text("MINIO_ROOT_USER=x\n")
        cred.chmod(0o600)
        self.bin = self.tmp / "bin"
        self.bin.mkdir()
        self.log = self.tmp / "calls.txt"
        stubs = {"docker": DOCKER,
                 "sudo": '#!/usr/bin/env bash\necho "sudo $*" >> "$LOG"\nexit 0\n',
                 "systemctl": '#!/usr/bin/env bash\n[[ "$1" == is-active ]] && echo active\nexit 0\n',
                 "pgrep": "#!/usr/bin/env bash\nexit 1\n"}
        for name, body in stubs.items():
            p = self.bin / name
            p.write_text(body)
            p.chmod(0o755)
        self.env = dict(os.environ, PATH=f"{self.bin}:{os.environ['PATH']}", HOME=str(self.home), LOG=str(self.log),
                        SKYHUB_MINIO_RECREATE_WAIT="0")
        self.env.pop("SKYHUB_SHARED_MINIO_CREDENTIALS_FILE", None)

    def run_script(self, *args, **env):
        return subprocess.run(["bash", str(self.tmp / "scripts" / SCRIPT.name), *args], capture_output=True, text=True,
                              env=dict(self.env, **env))

    def calls(self):
        return self.log.read_text().splitlines() if self.log.exists() else []

    def test_plan_is_read_only_and_shows_the_label_change(self):
        r = self.run_script("plan")
        self.assertEqual(0, r.returncode, r.stdout + r.stderr)
        self.assertIn("heute (nicht gesetzt), nach dem Neuanlegen false", r.stdout)
        self.assertFalse([c for c in self.calls() if c.startswith("sudo") or " up " in c])

    def test_run_recreates_in_order_and_verifies(self):
        r = self.run_script("run", LABEL_SET="1")
        self.assertEqual(0, r.returncode, r.stdout + r.stderr)
        changing = [c for c in self.calls() if c.startswith("sudo") or " up " in c]
        self.assertEqual(3, len(changing), changing)
        self.assertEqual("sudo systemctl stop skyhub-shared-minio.service", changing[0])
        self.assertIn("up --no-start --no-build --no-deps --force-recreate minio", changing[1])
        self.assertEqual("sudo systemctl start skyhub-shared-minio.service", changing[2])
        self.assertIn("Label com.centurylinklabs.watchtower.enable=false", r.stdout)

    def test_run_aborts_before_any_change_when_a_check_fails(self):
        r = self.run_script("run", NO_IMAGE="1")
        self.assertEqual(1, r.returncode)
        self.assertIn("Abbruch vor jeder Aenderung", r.stderr)
        self.assertFalse([c for c in self.calls() if c.startswith("sudo") or " up " in c])

    def test_bad_arguments(self):
        self.assertEqual(2, self.run_script("down").returncode)
        self.assertEqual(2, self.run_script("plan", "x").returncode)


if __name__ == "__main__":
    unittest.main()
