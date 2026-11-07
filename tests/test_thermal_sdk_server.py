"""docker/dji-tsdk-box64/sdk_server.py with a fake dji_irp (no SDK, no box64, no Docker)."""
from pathlib import Path
import json
import os
import socket
import struct
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
SERVER = ROOT / "docker/dji-tsdk-box64/sdk_server.py"
TOKEN = "t" * 40
FAKE = r'''
import struct, sys, time, os
a = sys.argv[1:]
arg = lambda k: a[a.index(k) + 1]
src = open(arg("--source"), "rb").read()
if b"HANG" in src:
    time.sleep(60)
if b"BROKEN" in src:
    print("Test done with return code -1"); sys.exit(3)
w, h = (320, 256) if b"SMALL" in src else (640, 512)
print("R-JPEG resolution size\n      image  width : %d\n      image height : %d" % (w, h))
e = float(arg("--emissivity")); d = float(arg("--distance"))
open(arg("--output"), "wb").write(struct.pack("<%df" % (w * h), *([e * 10 + d] * (w * h))))
open(os.environ["FAKE_ARGS"], "w").write(" ".join(a))
print("Test done with return code 0")
'''


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class ThermalSdkServerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        tmp = Path(cls.tmp.name)
        (tmp / "sdk/bin").mkdir(parents=True)
        (tmp / "sdk/bin/dji_irp").write_text("placeholder")
        (tmp / "fake.py").write_text(FAKE)
        cls.args_file = tmp / "args"
        cls.port = free_port()
        env = {**os.environ, "SKYHUB_THERMAL_SDK_TOKEN": TOKEN, "SKYHUB_TSDK_DIR": str(tmp / "sdk"),
               "SKYHUB_TSDK_COMMAND": f"{sys.executable} {tmp / 'fake.py'}", "SKYHUB_TSDK_TIMEOUT": "2",
               "SKYHUB_THERMAL_SDK_PORT": str(cls.port), "FAKE_ARGS": str(cls.args_file)}
        cls.proc = subprocess.Popen([sys.executable, str(SERVER)], env=env,
                                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        for _ in range(100):
            try:
                socket.create_connection(("127.0.0.1", cls.port), 0.1).close()
                break
            except OSError:
                time.sleep(0.05)

    @classmethod
    def tearDownClass(cls):
        cls.proc.kill()
        cls.proc.wait()
        cls.tmp.cleanup()

    def call(self, path, body=None, token=TOKEN):
        req = urllib.request.Request(f"http://127.0.0.1:{self.port}{path}", data=body,
                                     method="POST" if body is not None else "GET")
        if token:
            req.add_header("Authorization", "Bearer " + token)
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                return r.status, dict(r.headers), r.read()
        except urllib.error.HTTPError as e:
            return e.code, dict(e.headers), e.read()

    def test_health_reports_sdk_and_ranges(self):
        status, _, body = self.call("/health", token=None)
        data = json.loads(body)
        self.assertEqual(status, 200)
        self.assertEqual(data["status"], "ok")
        self.assertEqual(data["ranges"]["distance"][:2], [1.0, 25.0])

    def test_measure_returns_float32_with_parameters(self):
        status, headers, body = self.call("/measure?emissivity=0.9&distance=10&humidity=60",
                                          b"\xff\xd8 image")
        self.assertEqual(status, 200)
        self.assertEqual((headers["X-Thermal-Width"], headers["X-Thermal-Height"]), ("640", "512"))
        self.assertEqual(headers["X-Thermal-Calibration"], "dji-tsdk")
        self.assertEqual(json.loads(headers["X-Thermal-Parameters"])["ambient"], 25.0)
        self.assertEqual(len(body), 640 * 512 * 4)
        self.assertAlmostEqual(struct.unpack_from("<f", body)[0], 19.0, places=4)
        args = self.args_file.read_text()
        self.assertIn("--measurefmt float32", args)
        self.assertIn("--humidity 60", args)
        self.assertIn("--reflection 23", args)

    def test_token_and_parameter_validation(self):
        self.assertEqual(self.call("/measure", b"\xff\xd8", token=None)[0], 401)
        self.assertEqual(self.call("/measure", b"\xff\xd8", token="x" * 40)[0], 401)
        for q in ("distance=0.5", "distance=26", "emissivity=1.1", "humidity=1e2", "distance=abc",
                  "ambient=-41", "reflection=501", "foo=1", "distance=1&distance=2"):
            self.assertEqual(self.call("/measure?" + q, b"\xff\xd8")[0], 400, q)
        self.assertEqual(self.call("/measure", b"no jpeg")[0], 422)
        self.assertEqual(self.call("/other", b"\xff\xd8")[0], 404)

    def test_sdk_failure_and_deadline(self):
        status, _, body = self.call("/measure", b"\xff\xd8 BROKEN")
        self.assertEqual(status, 422)
        self.assertNotIn(b"return code", body)  # SDK output is never echoed
        start = time.monotonic()
        status, _, _ = self.call("/measure", b"\xff\xd8 HANG")
        self.assertEqual(status, 504)
        self.assertLess(time.monotonic() - start, 8)
        # The server keeps working after a killed run.
        self.assertEqual(self.call("/measure", b"\xff\xd8 SMALL")[0], 200)

    def test_refuses_to_start_without_token(self):
        result = subprocess.run([sys.executable, str(SERVER)], env={**os.environ, "SKYHUB_THERMAL_SDK_TOKEN": "short"},
                                capture_output=True, text=True, timeout=10)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("SKYHUB_THERMAL_SDK_TOKEN", result.stderr)


if __name__ == "__main__":
    unittest.main()
