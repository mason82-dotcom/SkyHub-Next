"""Fast, strictly offline tests of the opt-in HiveMind Pilot E2E verifier."""
from __future__ import annotations

import importlib.util
from pathlib import Path
import tempfile
import unittest

SOURCE = Path(__file__).resolve().parents[1] / "simulators" / "hivemind" / "smoke.py"
spec = importlib.util.spec_from_file_location("skyhub_hivemind_smoke", SOURCE)
smoke = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(smoke)


class HivemindSmokeContractTest(unittest.TestCase):
    def sample_health(self):
        return {
            "mqttBrokerPort": 1884, "readOnly": True,
            "topologyReplyEnabled": False, "trackRecordingEnabled": False,
            "lanViewEnabled": False, "mqtt": True, "subscribed": True,
            "mqttObservedOsdPackets": 0, "mqttOsdMessages": 0,
            "mqttValidTelemetryUpdates": 0
        }

    def test_preflight_is_fail_closed(self):
        smoke.assert_lab(self.sample_health())
        for key, unsafe in (
            ("mqttBrokerPort", 1883), ("readOnly", False),
            ("topologyReplyEnabled", True), ("trackRecordingEnabled", True),
            ("lanViewEnabled", True), ("mqtt", False), ("subscribed", False)
        ):
            data = self.sample_health()
            data[key] = unsafe
            with self.subTest(key=key), self.assertRaises(smoke.SmokeFailure):
                smoke.assert_lab(data)

    def test_telemetry_requires_new_valid_osd_and_both_devices(self):
        before = self.sample_health()
        after = {**before, "mqttObservedOsdPackets": 4,
                 "mqttOsdMessages": 3, "mqttValidTelemetryUpdates": 2}
        rc = {"sn": "test-controller", "lastTopologyAt": 100, "telemetry": {}}
        aircraft = {"sn": "test-aircraft", "lastTelemetryAt": 101,
                    "telemetry": {"battery": 61}}
        self.assertTrue(smoke.assert_telemetry(after, before, [rc, aircraft],
                                               "test-controller", "test-aircraft"))
        for attr in ("mqttObservedOsdPackets", "mqttOsdMessages",
                     "mqttValidTelemetryUpdates"):
            stale = {**after, attr: 0}
            self.assertFalse(smoke.assert_telemetry(
                stale, before, [rc, aircraft], "test-controller", "test-aircraft"))
        self.assertFalse(smoke.assert_telemetry(
            after, before, [rc], "test-controller", "test-aircraft"))
        self.assertFalse(smoke.assert_telemetry(
            after, before, [rc, {**aircraft, "telemetry": {"battery": None}}],
            "test-controller", "test-aircraft"))

    def test_arbitrary_network_targets_refused_without_io(self):
        for url in ("http://localhost:1884", "https://example.com",
                    "http://192.168.178.63:4000"):
            with self.subTest(url=url), self.assertRaises(smoke.SmokeFailure):
                smoke.request(url, "/api/health")
        with self.assertRaises(smoke.SmokeFailure):
            smoke.request(smoke.SIM, "/unsafe")

    def test_lab_token_parser_rejects_bad_or_missing_values(self):
        original = smoke.LAB_ENV
        with tempfile.TemporaryDirectory() as tmp:
            try:
                smoke.LAB_ENV = Path(tmp) / "lab.env"
                with self.assertRaises(smoke.SmokeFailure):
                    smoke.local_token()
                smoke.LAB_ENV.write_text("SKYHUB_VIEW_TOKEN=real_device_secret\n")
                with self.assertRaises(smoke.SmokeFailure):
                    smoke.local_token()
                expected = "f" * 64
                smoke.LAB_ENV.write_text("SKYHUB_VIEW_TOKEN=" + expected + "\n")
                self.assertEqual(smoke.local_token(), expected)
            finally:
                smoke.LAB_ENV = original


if __name__ == "__main__":
    unittest.main()
