"""docker/ppk/ppk_server.py header_xyz: server-side base checks in header mode (same rules as frontend/public/rinex-head.js)."""
from pathlib import Path
import importlib.util
import math
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("ppk_server", ROOT / "docker/ppk/ppk_server.py")
ppk = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ppk)


def L(body, label):
    return body.ljust(60) + label + "\n"


def ecef(lat, lon, h):
    a, f = 6378137.0, 1 / 298.257222101
    e2, r = f * (2 - f), math.pi / 180
    n = a / math.sqrt(1 - e2 * math.sin(lat * r) ** 2)
    return ((n + h) * math.cos(lat * r) * math.cos(lon * r), (n + h) * math.cos(lat * r) * math.sin(lon * r),
            (n * (1 - e2) + h) * math.sin(lat * r))


def header(xyz, receiver="0000                VRS                 GNSMART", antenna="0000                LEIAR25.R4      NONE"):
    pos = "".join(("%.4f" % v).rjust(14) for v in xyz)
    return (L("     3.04           OBSERVATION DATA    M (MIXED)", "RINEX VERSION / TYPE") + L("VRS_0416", "MARKER NAME")
            + L(receiver, "REC # / TYPE / VERS") + L(antenna, "ANT # / TYPE") + L(pos, "APPROX POSITION XYZ")
            + L("", "END OF HEADER"))


class HeaderXyzTest(unittest.TestCase):
    def check(self, text):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "base_MO.rnx"
            p.write_text(text)
            return ppk.header_xyz(p)

    def test_sapos_station_accepted(self):
        xyz = ecef(49.15, 8.60, 160)
        got = self.check(header(xyz))
        self.assertTrue(all(abs(a - b) < 1e-3 for a, b in zip(got, xyz)))
        self.assertAlmostEqual(ppk.ellipsoidal_height(*xyz), 160, places=2)

    def test_drone_file_refused(self):
        with self.assertRaisesRegex(ppk.Problem, "Drohne"):
            self.check(header((0, 0, 0), receiver="", antenna=""))

    def test_missing_position_refused(self):
        with self.assertRaisesRegex(ppk.Problem, "ohne gültige Position"):
            self.check(header((0, 0, 0)))

    def test_implausible_height_refused(self):
        xyz = tuple(v * 1.001 for v in ecef(49.15, 8.60, 160))   # ~6 km too high, e.g. wrong units
        with self.assertRaisesRegex(ppk.Problem, "unplausibel"):
            self.check(header(xyz))


if __name__ == "__main__":
    unittest.main()
