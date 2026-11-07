#!/usr/bin/env python3
"""Opt-in Dock registration E2E acceptance against disposable lab-only RPC mock.

The simulator must be offline and the lab must be ready, read-only, and
unconnected to production. No real drone credentials or hardware are used.
"""
from __future__ import annotations

import re
import subprocess
import sys
import time
from pathlib import Path

from smoke import (SIM, SKYHUB, POLL_SECONDS, SmokeFailure, assert_lab,
                   await_lab_ready, local_token, request, require, strictly_new)



# Repository-path command uses the *existing*, explicitly opt-in dock-rpc
# container only. No host MQTT port, arbitrary broker URL or shell injection.
HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]

def verify_hms_and_mission(token: str, dock_sn: str) -> None:
    require(isinstance(dock_sn, str) and
            re.fullmatch(r"7UUXN[A-Z0-9]{9}", dock_sn) is not None,
            "Refusing probe without simulator-generated Dock3 SN")
    result = request(SIM, "/api/hms/trigger", method="POST",
                     body={"types": ["WIND_HIGH"]})
    require(isinstance(result, dict) and result.get("success") is True
            and result.get("count") == 1, "Simulator did not publish synthetic HMS")

    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        devices = request(SKYHUB, "/api/devices", token=token)
        dock = next((d for d in devices if isinstance(d, dict)
                     and d.get("sn") == dock_sn), None)
        alerts = dock.get("hms", []) if dock else []
        if any(a.get("code") == "0x160900BF" and a.get("level") == 2
               for a in alerts if isinstance(a, dict)):
            break
        time.sleep(0.5)
    else:
        raise SmokeFailure("SkyHub did not parse expected synthetic Dock HMS")

    # The probe connects only to literal hivemind-broker:1884, publishes
    # four hardcoded lab mission commands and checks actual DJI replies.
    args = [
        "docker", "compose", "--project-name", "skyhub-hivemind-lab",
        "--env-file", str(HERE / "lab.env"),
        "-f", "docker-compose.yml",
        "-f", "simulators/hivemind/compose.lab.yml",
        "--profile", "dock-rpc",
        "exec", "-T", "dock-mock", "node", "/app/mission-probe.js", dock_sn
    ]
    try:
        completed = subprocess.run(args, cwd=ROOT, timeout=45,
                                   capture_output=True, text=True, check=False)
    except (OSError, subprocess.TimeoutExpired):
        raise SmokeFailure("Private mission probe failed to launch or timed out") from None
    if completed.returncode != 0 or "PASS: synthetic ground cancel, airborne stop rejected" not in completed.stdout:
        # Do not echo container logs or uncontrolled stderr; it could contain
        # IDs, arbitrary upstream telemetry, or secrets.
        # Match only fixed diagnostics emitted by our own one-shot test code.
        # Never surface arbitrary container stderr/JSON/device identifiers.
        known = (
            "Ground cancellation event not confirmed",
            "service reply mismatch or failure",
            "service reply timeout: flighttask_undo",
            "service reply timeout: flighttask_stop",
            "no simulator flighttask_progress event",
            "connection closed",
        )
        stages = ("init", "mqtt_connect", "prepare_before_cancel",
                  "ground_undo", "await_cancel_event", "prepare_after_cancel",
                  "execute", "await_progress", "airborne_stop", "pause", "recovery")
        stage = next((item for item in stages
                      if "FAIL_STAGE: " + item in completed.stderr), None)
        matched = stage or next((item for item in known if item in completed.stderr), "unknown")
        raise SmokeFailure("Synthetic mission probe failed: " + matched)

    events = request(SKYHUB, "/api/events", token=token)
    require(isinstance(events, list) and
            any(isinstance(e, dict) and e.get("sn") == dock_sn and
                e.get("method") == "flighttask_progress" and
                isinstance(e.get("missionReport"), dict) and
                e["missionReport"].get("reportedStatus") in
                  ("in_progress", "paused", "canceled", "failed", "ok") and
                isinstance(e["missionReport"].get("progressPercent"), int)
                for e in events),
            "Validated mission progress summary not observed by SkyHub")
    # Metadata-only: storage_config_get MUST deny STS and upload reports MUST
    # acknowledge with matching tid/bid. The monitor runs inside dock-mock,
    # never against a real bucket or production broker.
    media_args = args[:-2] + ["/app/media-probe.js", dock_sn]
    try:
        media = subprocess.run(media_args, cwd=ROOT, timeout=45,
                               capture_output=True, text=True, check=False)
    except (OSError, subprocess.TimeoutExpired):
        raise SmokeFailure("Metadata-only media probe failed to launch") from None
    if media.returncode != 0 or "PASS: STS denied" not in media.stdout:
        safe_reasons = (
            "Refusing nonempty media directory",
            "Unexpected media file listing response",
            "Refusing reused media session",
            "Invalid synthetic Dock3 SN",
            "Media MQTT subscription refused",
            "Metadata-only trigger refused",
            "Incomplete synthetic media acknowledgement sequence",
            "Simulator did not confirm metadata-only upload",
            "Lab simulator media API failed",
            "fetch failed",
        )
        reason = next((x for x in safe_reasons if x in media.stderr), "unknown")
        raise SmokeFailure("Metadata-only media probe failed: " + reason)
    events_after = request(SKYHUB, "/api/events", token=token)
    require(isinstance(events_after, list) and
            any(isinstance(e, dict) and e.get("sn") == dock_sn and
                e.get("method") == "file_upload_callback" and
                e.get("mediaReport") == {
                    "kind": "file_metadata_report",
                    "storageVerification": "not_checked"
                } for e in events_after),
            "Unverified media metadata summary not observed by SkyHub")
    print("PASS: no-STS media metadata, upload priority, callbacks and events_reply")
    print("PASS: synthetic Dock HMS, safe ground cancellation, airborne-stop refusal and progress")

def run() -> None:
    token = local_token()
    before = await_lab_ready()
    require(isinstance(before, dict), "Unexpected SkyHub health response")
    prior = request(SKYHUB, "/api/devices", token=token)
    require(isinstance(prior, list), "Unexpected SkyHub devices response")

    info = request(SIM, "/api/device-info")
    require(isinstance(info, dict) and "dockSn" in info and "droneSn" in info,
            "Not the pinned HiveMind simulator")
    state = request(SIM, "/api/connection")
    require(isinstance(state, dict) and state.get("online") is False,
            "Simulator already online: refusing to reset another test")
    opened = False
    try:
        config = request(SIM, "/api/connect", method="POST", body={
            "mqtt_host": "hivemind-broker", "mqtt_port": 1884,
            "device_mode": "DOCK", "dock_type": "DOCK3",
            "organization_id": "skyhub-lab-org",
            "device_binding_code": "skyhub-lab-code",
            "app_license": ""
        })
        require(isinstance(config, dict) and config.get("success") is True and
                config.get("mqtt_connected") is True, "Mock Dock MQTT connection failed")
        opened = True

        identity = request(SIM, "/api/device-info")
        require(isinstance(identity, dict) and identity.get("deviceMode") == "DOCK" and
                identity.get("dockSnOverride") is None and
                identity.get("droneSnOverride") is None,
                "Simulator is not in Dock mode")
        dock_sn = identity.get("dockSn")
        aircraft_sn = identity.get("droneSn")
        require(isinstance(dock_sn, str) and
                re.fullmatch(r"[A-Za-z0-9_.-]{1,100}", dock_sn) is not None,
                "Invalid test Dock identity")
        require(isinstance(aircraft_sn, str) and aircraft_sn != dock_sn and
                re.fullmatch(r"[A-Za-z0-9_.-]{1,100}", aircraft_sn) is not None,
                "Invalid test aircraft identity")

        # The mock insists on the four ordered DJI requests and the matching
        # lab-only organization/code. This path never sets skip_register=true.
        online = request(SIM, "/api/online", method="POST", body={"skip_register": False})
        require(isinstance(online, dict) and online.get("success") is True
                and online.get("online") is True,
                "Full Dock config/bind/organization registration failed")

        end = time.monotonic() + POLL_SECONDS
        while time.monotonic() < end:
            health = request(SKYHUB, "/api/health")
            require(isinstance(health, dict), "Unexpected SkyHub health after Dock registration")
            assert_lab(health)
            devices = request(SKYHUB, "/api/devices", token=token)
            require(isinstance(devices, list), "Unexpected SkyHub devices response")
            dock = next((d for d in devices if isinstance(d, dict)
                         and d.get("sn") == dock_sn), None)
            if dock and dock.get("role") == "gateway" and dock.get("lastTopologyAt") and (
                strictly_new(health.get("mqttObservedOsdPackets"),
                             before.get("mqttObservedOsdPackets")) and
                strictly_new(health.get("mqttOsdMessages"),
                             before.get("mqttOsdMessages"))):
                print("PASS: four ordered Dock RPC replies, topology and new Dock OSD confirmed")
                verify_hms_and_mission(token, dock_sn)
                print("All identities and simulated organization data suppressed")
                return
            time.sleep(1)
        raise SmokeFailure("Dock registered, but topology/OSD was not confirmed in SkyHub")
    finally:
        if opened:
            try:
                request(SIM, "/api/offline", method="POST", body={})
            except SmokeFailure:
                print("WARNING: Dock shutdown request unsuccessful; stop lab manually",
                      file=sys.stderr)


if __name__ == "__main__":
    try:
        run()
    except SmokeFailure as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        sys.exit(1)
