#!/usr/bin/env python3
"""SkyHub DJI Thermal SDK service (dji_irp via box64), internal network only.

POST /measure?emissivity=&distance=&humidity=&ambient=&reflection=
    body: one DJI R-JPEG (max 20 MiB), header Authorization: Bearer <SKYHUB_THERMAL_SDK_TOKEN>
    200: float32 little-endian temperatures (°C), row-major, headers X-Thermal-Width/-Height,
         X-Thermal-Calibration: dji-tsdk, X-Thermal-Parameters (normalised JSON)
GET  /health  -> {"status":"ok"|"sdk-missing", ...} (no token, no image data)

One SDK process at a time, at most two waiting requests, hard deadline per run (the process group is
killed natively; box64 is a native arm64 process, so no emulated timeout is involved). Input and output
live in a private temporary directory that is always removed. Only stdlib; no network access needed.
"""
from __future__ import annotations

import hmac
import json
import os
import re
import shlex
import shutil
import signal
import subprocess
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

MAX_JPEG = 20 * 1024 * 1024
FRAMES = {(640, 512), (320, 256), (1280, 1024)}
# Ranges as printed by dji_irp V1.7 (DJI Thermal SDK) for --action measure.
RANGES = {
    "emissivity": (0.10, 1.00, 0.95),
    "distance": (1.0, 25.0, 5.0),
    "humidity": (20.0, 100.0, 70.0),
    "ambient": (-40.0, 80.0, 25.0),
    "reflection": (-40.0, 500.0, 23.0),
}
NUMBER = re.compile(r"^-?(?:\d+(?:\.\d*)?|\.\d+)$")
TOKEN = os.environ.get("SKYHUB_THERMAL_SDK_TOKEN", "")
SDK_DIR = Path(os.environ.get("SKYHUB_TSDK_DIR", "/sdk"))
COMMAND = shlex.split(os.environ.get("SKYHUB_TSDK_COMMAND", "box64 /sdk/bin/dji_irp"))
TIMEOUT = float(os.environ.get("SKYHUB_TSDK_TIMEOUT", "30"))
RUN = threading.Semaphore(1)
WAITING = threading.BoundedSemaphore(3)  # one running + two waiting


class Problem(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


def parameters(query: str) -> dict:
    raw = parse_qs(query, keep_blank_values=True, max_num_fields=16)
    unknown = set(raw) - set(RANGES)
    if unknown:
        raise Problem(400, "unknown parameter")
    out = {}
    for name, (low, high, default) in RANGES.items():
        values = raw.get(name)
        if not values or values == [""]:
            out[name] = default
            continue
        if len(values) != 1 or not NUMBER.match(values[0]):
            raise Problem(400, f"{name} must be a decimal number")
        value = float(values[0])
        if not low <= value <= high:
            raise Problem(400, f"{name} outside {low}..{high}")
        out[name] = round(value, 3)
    return out


def measure(jpeg: bytes, params: dict) -> tuple[bytes, int, int]:
    if not jpeg.startswith(b"\xff\xd8"):
        raise Problem(422, "not a JPEG")
    with tempfile.TemporaryDirectory(prefix="tsdk-") as tmp:
        source, target = Path(tmp, "in.jpg"), Path(tmp, "out.raw")
        source.write_bytes(jpeg)
        args = COMMAND + ["--source", str(source), "--action", "measure", "--output", str(target),
                          "--measurefmt", "float32"]
        for name in ("distance", "humidity", "emissivity", "ambient", "reflection"):
            args += [f"--{name}", f"{params[name]:g}"]
        proc = subprocess.Popen(args, cwd=str(SDK_DIR / "bin") if (SDK_DIR / "bin").is_dir() else tmp,
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True,
                                env={**os.environ, "LD_LIBRARY_PATH": f"{SDK_DIR}/bin:{SDK_DIR}"})
        try:
            output, _ = proc.communicate(timeout=TIMEOUT)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGKILL)
            proc.communicate()
            raise Problem(504, "SDK deadline exceeded")
        text = output.decode("utf-8", "replace")
        if proc.returncode != 0 or "return code 0" not in text:
            # Unsupported camera or corrupt file; never echo SDK output (paths, internals).
            raise Problem(422, "SDK could not measure this image")
        width = re.search(r"image\s+width\s*:\s*(\d+)", text)
        height = re.search(r"image\s+height\s*:\s*(\d+)", text)
        if not width or not height:
            raise Problem(502, "SDK reported no resolution")
        size = (int(width.group(1)), int(height.group(1)))
        if size not in FRAMES or not target.is_file():
            raise Problem(502, "unexpected SDK output")
        data = target.read_bytes()
        if len(data) != size[0] * size[1] * 4:
            raise Problem(502, "SDK output size mismatch")
        return data, size[0], size[1]


class Handler(BaseHTTPRequestHandler):
    server_version = "skyhub-thermal-sdk"
    sys_version = ""

    def log_message(self, fmt, *args):  # status only; never paths, tokens or parameters
        if args and str(args[1]) not in ("200",):
            print(f"[thermal-sdk] {self.command} {urlsplit(self.path).path} -> {args[1]}", flush=True)

    def reply(self, status: int, body: bytes, kind: str = "application/json", headers: dict | None = None):
        self.send_response(status)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def error(self, status: int, message: str):
        self.reply(status, json.dumps({"error": message}).encode())

    def do_GET(self):
        if urlsplit(self.path).path != "/health":
            return self.error(404, "not found")
        ready = bool(shutil.which(COMMAND[0])) and (SDK_DIR / "bin" / "dji_irp").is_file()
        self.reply(200, json.dumps({"status": "ok" if ready else "sdk-missing",
                                    "calibration": "dji-tsdk", "ranges": RANGES}).encode())

    def do_POST(self):
        url = urlsplit(self.path)
        if url.path != "/measure":
            return self.error(404, "not found")
        auth = self.headers.get("Authorization", "")
        if len(TOKEN) < 32 or not hmac.compare_digest(auth.encode(), f"Bearer {TOKEN}".encode()):
            return self.error(401, "unauthorized")
        try:
            params = parameters(url.query)
            length = self.headers.get("Content-Length", "")
            if not length.isdigit():
                raise Problem(411, "length required")
            if int(length) > MAX_JPEG:
                raise Problem(413, "image too large")
            jpeg = self.rfile.read(int(length))
            if not WAITING.acquire(blocking=False):
                raise Problem(503, "busy")
            try:
                with RUN:
                    data, width, height = measure(jpeg, params)
            finally:
                WAITING.release()
            self.reply(200, data, "application/octet-stream", {
                "X-Thermal-Width": str(width), "X-Thermal-Height": str(height),
                "X-Thermal-Calibration": "dji-tsdk",
                "X-Thermal-Parameters": json.dumps(params, sort_keys=True, separators=(",", ":"))})
        except Problem as problem:
            self.error(problem.status, str(problem))


def main():
    if len(TOKEN) < 32:
        raise SystemExit("SKYHUB_THERMAL_SDK_TOKEN (min. 32 characters) is required")
    port = int(os.environ.get("SKYHUB_THERMAL_SDK_PORT", "8790"))
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    server.daemon_threads = True
    print(f"[thermal-sdk] listening on :{port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
