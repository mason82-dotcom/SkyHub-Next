#!/usr/bin/env python3
"""Non-mutating pre/postflight for the SkyHub-Next planning UI on brix-node.

This tool does NOT git pull, build images, recreate containers, query MQTT, touch
MinIO objects, modify config, or run any DRC/flight commands. Docker Compose
config is parsed in memory; interpolated secrets are never printed.
"""
from __future__ import annotations

import argparse
import ipaddress
import json
import platform
import re
import stat
import subprocess
import sys
from pathlib import Path
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
REQUIRED_STATIC = {
    "frontend/public/cloud-api2.html": ('data-view="planning"', 'id="portalModeBadge"'),
    "frontend/public/cloud-api2-planning.mjs": (
        "/wpml-editor.html", "/wpml-survey-preview.html", "/wpml-route-library.html",
        "flightReady: false", "dispatchAllowed: false",
    ),
    "frontend/public/cloud-api2-planning.css": ("planning-flow", "planning-frame"),
    "backend/Dockerfile": ("COPY frontend/public /app/frontend/public",),
}
HTTP_PAGES = {
    "/cloud-api2.html": ('data-view="planning"', 'id="portalModeBadge"'),
    "/cloud-api2-planning.mjs": (
        "/wpml-editor.html", "/wpml-survey-preview.html", "/wpml-route-library.html",
        "flightReady: false", "dispatchAllowed: false",
    ),
    "/wpml-editor.html": ("Missionsentwurf",),
    "/wpml-survey-preview.html": ("Vermessungsvorschau",),
    "/wpml-route-library.html": ("Routenbibliothek",),
}


class Refusal(Exception):
    pass


def require(ok: bool, message: str) -> None:
    if not ok:
        raise Refusal(message)


def execute(*args: str) -> str:
    result = subprocess.run(args, cwd=ROOT, text=True, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, check=False, timeout=20)
    # Never display command output: Compose config may include interpolated credentials.
    require(result.returncode == 0, "Prüfkommando fehlgeschlagen: " + args[0])
    return result.stdout.strip()


def source_check() -> None:
    for name, terms in REQUIRED_STATIC.items():
        path = ROOT / name
        require(path.is_file(), "Quelldatei fehlt: " + name)
        body = path.read_text(encoding="utf-8")
        require(all(term in body for term in terms), "Quellvertrag verletzt: " + name)
    print("PASS SOURCE: Kanonische WPML-Planungsdateien und Backend-COPY vorhanden")


def read_env_flags() -> dict[str, str]:
    path = ROOT / ".env"
    require(path.is_file(), "Private .env fehlt: kein Runtime-Check")
    mode = path.stat().st_mode
    require(not (mode & (stat.S_IROTH | stat.S_IWOTH | stat.S_IWGRP)),
            "Private .env hat unsichere Schreib-/Leserechte")
    allowed = {"SKYHUB_DRC_ENABLED", "SKYHUB_BRIX_BIND", "SKYHUB_HTTP_PORT"}
    flags: dict[str, str] = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if key in allowed:
            require(key not in flags, "Doppelter kritischer .env-Schlüssel: " + key)
            flags[key] = value.strip().strip('"').strip("'")
    return flags


def runtime_context() -> tuple[str, int]:
    require(platform.system() == "Linux" and platform.machine() == "x86_64",
            "Nur Linux x86_64 (brix-node), kein Pi-/ARM64-Update")
    require(execute("git", "branch", "--show-current") == "main",
            "Deployment-Checkout muss Branch main sein")
    require(not execute("git", "status", "--porcelain", "--untracked-files=no"),
            "Getrackte Dateien lokal verändert: Abbruch")
    head = execute("git", "rev-parse", "HEAD")
    remote = execute("git", "rev-parse", "origin/main")
    require(head == remote, "HEAD unterscheidet sich von lokal bekanntem origin/main")
    flags = read_env_flags()
    require(flags.get("SKYHUB_DRC_ENABLED", "false").lower() == "false",
            "DRC ist lokal aktiviert: kein unbegleiteter Backend-Rollout")
    bind = flags.get("SKYHUB_BRIX_BIND", "")
    try:
        ip = ipaddress.IPv4Address(bind)
        require(ip.is_private and not ip.is_loopback and not ip.is_unspecified,
                "Backend-Bind-Adresse ist keine private LAN-IPv4")
        port = int(flags.get("SKYHUB_HTTP_PORT", "4001"))
        require(1 <= port <= 65535, "Backend-Port außerhalb des zulässigen Bereichs")
    except (ValueError, ipaddress.AddressValueError):
        raise Refusal("Ungültige SKYHUB_BRIX_BIND/HTTP_PORT-Konfiguration") from None
    # Resolved Compose environment is more authoritative than raw .env flags.
    config = json.loads(execute("bash", "scripts/brix-compose.sh", "config", "--format", "json"))
    services = config.get("services", {})
    env = services.get("backend", {}).get("environment", {})
    require(str(env.get("SKYHUB_DRC_ENABLED", "")).lower() == "false",
            "Effective Compose DRC gate != false")
    ports = services.get("backend", {}).get("ports", [])
    require(any(str(p.get("published")) == str(port) and p.get("host_ip") == bind
                and str(p.get("target")) == "4000" for p in ports),
            "Effective Compose backend Bind/Port nicht wie erwartet")
    for service in ("backend", "postgres", "redis", "mosquitto"):
        ident = execute("bash", "scripts/brix-compose.sh", "ps", "-q", service)
        require(bool(re.fullmatch(r"[a-f0-9]{12,64}", ident)),
                "Dienstecontainer fehlt/mehrdeutig: " + service)
        state = json.loads(execute("docker", "inspect", "--format", "{{json .State}}", ident))
        require(state.get("Running") is True, "Container läuft nicht: " + service)
        health = state.get("Health")
        if health is not None:
            require(health.get("Status") == "healthy", "Container unhealthy: " + service)
        if service == "backend":
            running_env = json.loads(execute("docker", "inspect", "--format",
                                             "{{json .Config.Env}}", ident))
            # Read it in memory only. Docker inspect otherwise exposes credentials.
            drc = [entry.split("=", 1)[1] for entry in running_env
                   if entry.startswith("SKYHUB_DRC_ENABLED=")]
            require(len(drc) == 1 and drc[0].lower() == "false",
                    "Laufender Backend-Container hat DRC nicht nachweislich aus")
            previous_image = execute("docker", "inspect", "--format", "{{.Image}}", ident)
            require(bool(re.fullmatch(r"sha256:[a-f0-9]{64}", previous_image)),
                    "Altes Backend-Image nicht eindeutig identifizierbar")
            restored = execute("docker", "image", "inspect", "--format",
                               "{{.Id}}", previous_image)
            require(restored.startswith("sha256:"),
                    "Vorheriges Image nicht für Rollback auflösbar")
    print("PASS RUNTIME: main/Compose, DRC aus, vier Container laufen")
    return bind, port


def fetch_local(base: str, route: str) -> str:
    # Only the known LAN host and hard-coded GET paths; no user-entered URL.
    with urlopen(base + route, timeout=5) as response:
        require(response.status == 200, "HTTP nicht 200: " + route)
        payload = response.read(256 * 1024 + 1)
        require(len(payload) <= 256 * 1024, "HTTP-Antwort zu groß: " + route)
    return payload.decode("utf-8", errors="replace")


def http_check(bind: str, port: int, *, post: bool) -> None:
    base = "http://" + bind + ":" + str(port)
    try:
        health = json.loads(fetch_local(base, "/api/health"))
        require(health.get("readOnly") is True and health.get("status") in ("online", "degraded"),
                "Health contract readOnly/status nicht bestätigt")
        if post:
            for route, terms in HTTP_PAGES.items():
                body = fetch_local(base, route)
                require(all(term in body for term in terms), "Portal-HTTP-Asset fehlt/alt: " + route)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        raise Refusal("Lokale Backend-HTTP-Prüfung nicht bestätigt (" +
                      type(exc).__name__ + ")") from None
    print("PASS HTTP: Backend-Health" + (" und alle Planungs-Assets" if post else " (Baseline)"))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", choices=("source", "preflight", "postflight"),
                        default="source", help="source offline; pre/post prüfen den laufenden BRIX lesend")
    args = parser.parse_args()
    try:
        source_check()
        if args.mode != "source":
            bind, port = runtime_context()
            http_check(bind, port, post=args.mode == "postflight")
        print("RESULT PASS: Keine Betriebsänderung durchgeführt")
        return 0
    except (Refusal, subprocess.TimeoutExpired, OSError, json.JSONDecodeError) as exc:
        # Refusal messages must not contain interpolated Compose contents / private data.
        print("RESULT FAIL: " + str(exc), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
