#!/usr/bin/env python3
"""Non-mutating pre/postflight for the SkyHub-Next planning UI on brix-node.

This tool does NOT git pull, build images, recreate containers, query MQTT, touch
MinIO objects, modify config, or run any DRC/flight commands. Docker Compose
config is parsed in memory; interpolated secrets are never printed.
"""
from __future__ import annotations

import argparse
import hashlib
import ipaddress
import json
import platform
import re
import stat
import subprocess
import sys
from pathlib import Path
from http.client import HTTPConnection

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
    "/cloud-api2-planning.css": ("planning-flow", "planning-frame"),
    "/wpml-editor.html": ("Missionsentwurf",),
    "/wpml-survey-preview.html": ("Vermessungsvorschau",),
    "/wpml-route-library.html": ("Routenbibliothek",),
}


# This command reads only first-party files explicitly copied by backend/Dockerfile.
# No shell expansion of user-controlled paths; output is processed in memory only.
BACKEND_HASH_COMMAND = "sha256sum /app/backend/*.js /app/backend/package*.json"
RFC1918_NETWORKS = tuple(ipaddress.IPv4Network(cidr) for cidr in
                         ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"))


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
    allowed = {"SKYHUB_DRC_ENABLED", "SKYHUB_BRIX_BIND", "SKYHUB_HTTP_PORT",
               "SKYHUB_S3_UPLOAD_PROXY_HOST_PORT"}
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


def is_rfc1918_bind(bind: str) -> bool:
    try:
        address = ipaddress.IPv4Address(bind)
        return any(address in network for network in RFC1918_NETWORKS)
    except (ipaddress.AddressValueError, ValueError):
        return False


def expected_bindings(bind: str, http_port: int, upload_port: int) -> dict[str, set[tuple[str, str, str, str]]]:
    return {
        "backend": {(bind, str(http_port), "4000", "tcp"),
                    (bind, str(upload_port), "4002", "tcp")},
        "mosquitto": {(bind, "1884", "1884", "tcp")},
        "postgres": set(),
        "redis": set(),
    }


def validate_compose_ports(services: dict, bind: str, http_port: int, upload_port: int) -> None:
    """All published ports must match the expected LAN-only binding set."""
    require(isinstance(services, dict), "Compose-Dienstliste ungültig")
    for name, expected in expected_bindings(bind, http_port, upload_port).items():
        service = services.get(name)
        require(isinstance(service, dict), "Compose-Dienst fehlt: " + name)
        ports = service.get("ports") or []
        require(isinstance(ports, list), "Compose-Portliste ungültig: " + name)
        actual = []
        for port in ports:
            require(isinstance(port, dict), "Compose-Porteintrag ungültig: " + name)
            actual.append((str(port.get("host_ip")), str(port.get("published")),
                           str(port.get("target")), str(port.get("protocol", "tcp"))))
        require(len(actual) == len(expected) and set(actual) == expected,
                "Unerwartete Compose-Portfreigabe: " + name)


def validate_runtime_ports(name: str, ports: object, bind: str,
                           http_port: int, upload_port: int) -> None:
    """Docker inspect NetworkSettings.Ports proves what is actually published."""
    require(isinstance(ports, dict), "Runtime-Portliste ungültig: " + name)
    actual = []
    for target, mappings in ports.items():
        if mappings is None:
            continue  # exposed but deliberately unpublished
        match = re.fullmatch(r"([0-9]{1,5})/(tcp|udp)", str(target))
        require(match is not None and isinstance(mappings, list) and len(mappings) > 0,
                "Runtime-Porteintrag ungültig: " + name)
        for mapping in mappings:
            require(isinstance(mapping, dict), "Runtime-Portabbildung ungültig: " + name)
            actual.append((str(mapping.get("HostIp")), str(mapping.get("HostPort")),
                           match.group(1), match.group(2)))
    expected = expected_bindings(bind, http_port, upload_port)[name]
    require(len(actual) == len(expected) and set(actual) == expected,
            "Unerwartete laufende Portfreigabe: " + name)


def runtime_context() -> tuple[str, int, str]:
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
        require(is_rfc1918_bind(bind), "Backend-Bind-Adresse ist keine RFC1918-LAN-IPv4")
        port = int(flags.get("SKYHUB_HTTP_PORT", "4001"))
        upload_port = int(flags.get("SKYHUB_S3_UPLOAD_PROXY_HOST_PORT", "4002"))
        require(all(1 <= p <= 65535 for p in (port, upload_port)),
                "Backend-Port außerhalb des zulässigen Bereichs")
        require(len({port, upload_port, 1884}) == 3, "Backend-/MQTT-Hostports überlappen")
    except (ValueError, ipaddress.AddressValueError):
        raise Refusal("Ungültige SKYHUB_BRIX_BIND/HTTP_PORT-Konfiguration") from None
    # Resolved Compose environment is more authoritative than raw .env flags.
    config = json.loads(execute("bash", "scripts/brix-compose.sh", "config", "--format", "json"))
    services = config.get("services", {})
    env = services.get("backend", {}).get("environment", {})
    require(str(env.get("SKYHUB_DRC_ENABLED", "")).lower() == "false",
            "Effective Compose DRC gate != false")
    validate_compose_ports(services, bind, port, upload_port)
    backend_id = None
    for service in ("backend", "postgres", "redis", "mosquitto"):
        ident = execute("bash", "scripts/brix-compose.sh", "ps", "-q", service)
        require(bool(re.fullmatch(r"[a-f0-9]{12,64}", ident)),
                "Dienstecontainer fehlt/mehrdeutig: " + service)
        state = json.loads(execute("docker", "inspect", "--format", "{{json .State}}", ident))
        require(state.get("Running") is True, "Container läuft nicht: " + service)
        runtime_ports = json.loads(execute("docker", "inspect", "--format",
                                           "{{json .NetworkSettings.Ports}}", ident))
        validate_runtime_ports(service, runtime_ports, bind, port, upload_port)
        health = state.get("Health")
        if health is not None:
            require(health.get("Status") == "healthy", "Container unhealthy: " + service)
        if service == "backend":
            backend_id = ident
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
    require(backend_id is not None, "Backend-Container nicht nachgewiesen")
    return bind, port, backend_id


def backend_image_check(backend_id: str) -> None:
    """Bind the running image's first-party JS and package manifests to checked-out source."""
    require(bool(re.fullmatch(r"[a-f0-9]{12,64}", backend_id)),
            "Ungültige Backend-Containerkennung")
    source_dir = ROOT / "backend"
    expected_files = sorted([*source_dir.glob("*.js"), *source_dir.glob("package*.json")])
    require(bool(expected_files) and (source_dir / "server.js") in expected_files and
            (source_dir / "package.json") in expected_files,
            "Backend-Quelldateien fehlen")
    expected = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in expected_files}
    raw = execute("docker", "exec", backend_id, "sh", "-c", BACKEND_HASH_COMMAND)
    actual = {}
    for line in raw.splitlines():
        match = re.fullmatch(r"([a-f0-9]{64})  /app/backend/([A-Za-z0-9_.-]+)", line)
        require(match is not None, "Ungültige Container-Hash-Ausgabe")
        name = match.group(2)
        require(name not in actual, "Doppelter Backend-Dateiname im Container")
        actual[name] = match.group(1)
    require(actual.keys() == expected.keys(), "Backend-Dateibestand weicht vom Checkout ab")
    require(actual == expected, "Backend-Dateihashes weichen vom Checkout ab")
    print("PASS BACKEND: Laufender Container entspricht JS-/Paketmanifest-Checkout")


def fetch_local(bind: str, port: int, route: str) -> bytes:
    # Direct, non-proxied HTTP GET to the private IPv4 only. HTTPConnection
    # does not follow redirects, preventing requests from leaving the LAN.
    connection = HTTPConnection(bind, port, timeout=5)
    try:
        connection.request("GET", route, headers={"Connection": "close", "Accept-Encoding": "identity",
                                                  "Cache-Control": "no-cache"})
        response = connection.getresponse()
        require(response.status == 200, "HTTP nicht 200: " + route)
        payload = response.read(256 * 1024 + 1)
        require(len(payload) <= 256 * 1024, "HTTP-Antwort zu groß: " + route)
        return payload
    finally:
        connection.close()


def http_check(bind: str, port: int, *, post: bool) -> None:
    try:
        health = json.loads(fetch_local(bind, port, "/api/health"))
        require(health.get("readOnly") is True and health.get("status") in ("online", "degraded"),
                "Health contract readOnly/status nicht bestätigt")
        if post:
            for route, terms in HTTP_PAGES.items():
                payload = fetch_local(bind, port, route)
                body = payload.decode("utf-8")  # Invalid UTF-8 must fail closed.
                require(all(term in body for term in terms), "Portal-HTTP-Asset fehlt/alt: " + route)
                # Text markers are not proof of the deployed revision: an older
                # image may still contain every marker. Static files are served
                # verbatim by Express; bind HTTP bytes to the checked-out source.
                source = ROOT / "frontend/public" / route.lstrip("/")
                require(source.is_file(), "Lokale Quelldatei fehlt: " + route)
                require(hashlib.sha256(payload).digest() == hashlib.sha256(source.read_bytes()).digest(),
                        "Ausgeliefertes HTTP-Asset weicht von Source ab: " + route)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        raise Refusal("Lokale Backend-HTTP-Prüfung nicht bestätigt (" +
                      type(exc).__name__ + ")") from None
    print("PASS HTTP: Backend-Health" + (" und bytegenaue Planungs-Assets" if post else " (Baseline)"))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", choices=("source", "preflight", "postflight"),
                        default="source", help="source offline; pre/post prüfen den laufenden BRIX lesend")
    args = parser.parse_args()
    try:
        source_check()
        if args.mode != "source":
            bind, port, backend_id = runtime_context()
            http_check(bind, port, post=args.mode == "postflight")
            if args.mode == "postflight":
                backend_image_check(backend_id)
                require(execute("bash", "scripts/brix-compose.sh", "ps", "-q", "backend") == backend_id,
                        "Backend-Container hat sich während der Prüfung geändert")
        print("RESULT PASS: Keine Betriebsänderung durchgeführt")
        return 0
    except (Refusal, subprocess.TimeoutExpired, OSError, json.JSONDecodeError) as exc:
        # Refusal messages must not contain interpolated Compose contents / private data.
        print("RESULT FAIL: " + str(exc), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
