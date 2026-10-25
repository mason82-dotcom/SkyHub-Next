#!/usr/bin/env python3
"""End-to-end Pilot-to-Cloud smoke test against the *isolated* HiveMind lab.

No real DJI devices, production MQTT credentials or arbitrary network targets.
The only mutation is on the explicitly started local simulator (connect, state,
online, offline), never on SkyHub's read-only API. No secrets or serials printed.
"""
from __future__ import annotations

import json
from pathlib import Path
import re
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.request import ProxyHandler, Request, build_opener

HERE = Path(__file__).resolve().parent
LAB_ENV = HERE / "lab.env"
SKYHUB = "http://127.0.0.1:14001"
SIM = "http://127.0.0.1:19090"
OPENER = build_opener(ProxyHandler({}))
TIMEOUT = 8
POLL_SECONDS = 45


class SmokeFailure(RuntimeError):
    """Expected bounded smoke-test failure."""


def request(base: str, path: str, *, method: str = "GET",
            body: dict | None = None, token: str | None = None) -> dict | list:
    if base not in (SKYHUB, SIM) or not path.startswith("/api/"):
        raise SmokeFailure("Refusing unapproved API target")
    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    data = None
    if body is not None:
        data = json.dumps(body, separators=(",", ":")).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = Request(base + path, data=data, headers=headers, method=method)
    try:
        # Upstream Pilot online waits up to 10 seconds for status_reply before
        # continuing without an acknowledgement. Do not mistake this for a hang.
        timeout = 40 if base == SIM and path == "/api/online" else TIMEOUT
        with OPENER.open(req, timeout=timeout) as response:
            if response.status != 200:
                raise SmokeFailure("Unexpected response status")
            raw = response.read(1024 * 1024 + 1)
    except (HTTPError, URLError, TimeoutError, OSError) as exc:
        # Never echo error bodies, request URLs containing query secrets or
        # upstream messages (they may contain serials or DJI credentials).
        raise SmokeFailure(f"Local {base == SIM and 'simulator' or 'SkyHub'} API unavailable ({type(exc).__name__})") from None
    if len(raw) > 1024 * 1024:
        raise SmokeFailure("Oversize local API response")
    try:
        return json.loads(raw)
    except (UnicodeDecodeError, ValueError):
        raise SmokeFailure("Invalid local API JSON") from None


def local_token() -> str:
    if not LAB_ENV.is_file():
        raise SmokeFailure("Missing private lab.env (run lab.sh init-env)")
    # Read without importing shell syntax or exporting credentials.
    entries = re.findall(r"(?m)^SKYHUB_VIEW_TOKEN=([a-f0-9]{64})$", LAB_ENV.read_text())
    if len(entries) != 1:
        raise SmokeFailure("Invalid lab view token in lab.env")
    return entries[0]


def require(condition: bool, reason: str) -> None:
    if not condition:
        raise SmokeFailure(reason)


def assert_lab(health: dict) -> None:
    require(health.get("mqttBrokerPort") == 1884, "Unexpected SkyHub broker port")
    require(health.get("readOnly") is True, "SkyHub is not read-only")
    require(health.get("topologyReplyEnabled") is False, "Topology publisher is enabled")
    require(health.get("trackRecordingEnabled") is False, "Track recording is enabled")
    require(health.get("lanViewEnabled") is False, "LAN token bypass is enabled")
    require(health.get("mqtt") is True and health.get("subscribed") is True,
            "SkyHub not subscribed to lab broker")


def strictly_new(value: object, baseline: object) -> bool:
    return (isinstance(value, int) and not isinstance(value, bool)
            and isinstance(baseline, int) and not isinstance(baseline, bool)
            and value > baseline)


def assert_telemetry(health: dict, before: dict, devices: list,
                     gateway_sn: str, aircraft_sn: str) -> bool:
    if not (strictly_new(health.get("mqttObservedOsdPackets"), before.get("mqttObservedOsdPackets"))
            and strictly_new(health.get("mqttOsdMessages"), before.get("mqttOsdMessages"))
            and strictly_new(health.get("mqttValidTelemetryUpdates"), before.get("mqttValidTelemetryUpdates"))):
        return False
    rc = next((d for d in devices if isinstance(d, dict) and d.get("sn") == gateway_sn), None)
    aircraft = next((d for d in devices if isinstance(d, dict) and d.get("sn") == aircraft_sn), None)
    if not rc or not aircraft:
        return False
    if not rc.get("lastTopologyAt") or not aircraft.get("lastTelemetryAt"):
        return False
    b = aircraft.get("telemetry", {}).get("battery")
    return isinstance(b, (float, int)) and not isinstance(b, bool) and 0 <= b <= 100


def await_lab_ready() -> dict:
    """Give Spring Boot and MQTT subscriptions time to start after Compose."""
    end = time.monotonic() + 120
    last_reason = "startup pending"
    while time.monotonic() < end:
        try:
            health = request(SKYHUB, "/api/health")
            if isinstance(health, dict):
                # Wrong backend configuration is not a temporary startup error.
                assert_lab(health)
                sim_health = request(SIM, "/api/health")
                if isinstance(sim_health, dict) and sim_health.get("status") == "UP":
                    return health
        except SmokeFailure as exc:
            last_reason = str(exc)
            if "not subscribed" not in last_reason and "unavailable" not in last_reason:
                raise
        time.sleep(2)
    raise SmokeFailure("Isolated lab did not become ready: " + last_reason)


def run() -> None:
    token = local_token()
    # Reject unrelated services on the loopback ports BEFORE issuing mutations.
    before = await_lab_ready()
    devices_before = request(SKYHUB, "/api/devices", token=token)
    require(isinstance(devices_before, list), "Invalid SkyHub devices API")
    info = request(SIM, "/api/device-info")
    require(isinstance(info, dict) and "controllerModelKey" in info and "droneSn" in info,
            "Unexpected simulator identity API")
    connection = request(SIM, "/api/connection")
    require(isinstance(connection, dict) and not connection.get("online"),
            "Simulator already online: take it offline manually before smoke test")

    opened = False
    try:
        conn = request(SIM, "/api/connect", method="POST", body={
            "mqtt_host": "hivemind-broker", "mqtt_port": 1884,
            "device_mode": "PILOT", "controller_type": "RC_PLUS_2",
            "app_license": ""
        })
        require(isinstance(conn, dict) and conn.get("success") is True
                and conn.get("mqtt_connected") is True,
                "Pilot simulator MQTT connect failed")
        opened = True

        identity = request(SIM, "/api/device-info")
        require(isinstance(identity, dict) and identity.get("deviceMode") == "PILOT",
                "Simulator did not enter Pilot mode")
        gateway_sn, aircraft_sn = identity.get("controllerSn"), identity.get("droneSn")
        for sn in (gateway_sn, aircraft_sn):
            require(isinstance(sn, str) and re.fullmatch(r"[A-Za-z0-9_.-]{1,100}", sn) is not None,
                    "Unexpected synthetic device identity")
        require(gateway_sn != aircraft_sn, "Gateway and aircraft identity collide")

        online = request(SIM, "/api/online", method="POST", body={})
        require(isinstance(online, dict) and online.get("success") is True
                and online.get("online") is True,
                "Pilot simulator failed to go online")

        # Synthetic state change demonstrates that subsequent packets are
        # produced by this instance (not merely cached device records).
        updated = request(SIM, "/api/state", method="PUT",
                          body={"batteryPercent": 61, "controllerCapacity": 63})
        require(isinstance(updated, dict) and updated.get("success") is True,
                "Synthetic state update failed")

        end = time.monotonic() + POLL_SECONDS
        while time.monotonic() < end:
            health = request(SKYHUB, "/api/health")
            require(isinstance(health, dict), "Invalid SkyHub health after online")
            assert_lab(health)
            devices = request(SKYHUB, "/api/devices", token=token)
            require(isinstance(devices, list), "Invalid SkyHub device response")
            if assert_telemetry(health, before, devices, gateway_sn, aircraft_sn):
                print("PASS: isolated Pilot topology, new OSD and normalized aircraft telemetry")
                print("Counters: OSD received and parsed; valid telemetry updated; identities redacted")
                return
            time.sleep(1)
        raise SmokeFailure("No confirmed new Pilot topology and valid aircraft OSD within test window")
    finally:
        if opened:
            try:
                request(SIM, "/api/offline", method="POST", body={})
            except SmokeFailure:
                print("WARNING: simulator offline cleanup failed; stop the lab explicitly",
                      file=sys.stderr)


if __name__ == "__main__":
    try:
        run()
    except SmokeFailure as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        sys.exit(1)
