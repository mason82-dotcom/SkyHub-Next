#!/usr/bin/env python3
"""SkyHub PPK geotagging service (internal network only).

Wraps dji-geotagger (geo-raypan, BSD-2-Clause): DJI RTK flight folders (*.MRK, *_PPKRAW.bin, photo headers) plus a
SAPOS reference station (RINEX observation + navigation) -> centimetre camera centres per photo, with uncertainty.

POST /jobs?id=<24 hex>   body: ZIP (max 3 GiB) with flights/<folder>/... and base/<obs>, base/<nav>[, base/*.sp3|*.clk]
                         header X-PPK-Params: JSON {base: {mode: "header"|"manual", lat, lon, height, sigma_e, sigma_n,
                         sigma_u, frame, epoch}}; header Authorization: Bearer <SKYHUB_PPK_TOKEN>
GET  /jobs/<id>          status JSON (no file paths, no coordinates of the base)
GET  /jobs/<id>/result.csv
DELETE /jobs/<id>        cancel / remove
GET  /health

Offline by design: no CSRS-PPP (no e-mail, no upload abroad), broadcast ephemeris from the SAPOS nav file unless the
upload contains precise SP3/CLK products. One job at a time; results are removed after 24 h. Only stdlib + the package.
"""
from __future__ import annotations

import hmac
import json
import logging
import os
import re
import shutil
import threading
import time
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

TOKEN = os.environ.get("SKYHUB_PPK_TOKEN", "")
ROOT = Path(os.environ.get("SKYHUB_PPK_JOBS", "/jobs"))
MAX_UPLOAD = 3 * 1024 ** 3
MAX_FILES = 30000
KEEP_S = 24 * 3600
JOB_ID = re.compile(r"^[0-9a-f]{24}$")
JOBS: dict[str, dict] = {}
LOCK = threading.Lock()
RUNNING = threading.Semaphore(1)


class Problem(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


def number(v, name, lo, hi):
    try:
        x = float(v)
    except (TypeError, ValueError):
        raise Problem(400, f"{name} ungültig")
    if not (lo <= x <= hi):
        raise Problem(400, f"{name} außerhalb {lo}..{hi}")
    return x


def parse_params(raw: str) -> dict:
    try:
        p = json.loads(raw or "{}")
    except ValueError:
        raise Problem(400, "Parameter sind kein JSON")
    b = p.get("base") if isinstance(p, dict) else None
    if not isinstance(b, dict) or b.get("mode") not in ("header", "manual"):
        raise Problem(400, "Basismodus header oder manual")
    out = {"mode": b["mode"],
           "sigma": [number(b.get(k, d), k, 0.001, 1.0) for k, d in (("sigma_e", 0.01), ("sigma_n", 0.01), ("sigma_u", 0.02))],
           "frame": str(b.get("frame") or "ETRS89 (SAPOS)")[:40], "epoch": (str(b["epoch"])[:12] if b.get("epoch") else None)}
    if b["mode"] == "manual":
        out.update(lat=number(b.get("lat"), "lat", -90, 90), lon=number(b.get("lon"), "lon", -180, 180),
                   height=number(b.get("height"), "height (ellipsoidisch)", -500, 9000))
    return out


def safe_extract(zpath: Path, dest: Path) -> None:
    with zipfile.ZipFile(zpath) as z:
        infos = z.infolist()
        if len(infos) > MAX_FILES:
            raise Problem(400, "zu viele Dateien")
        total = 0
        for i in infos:
            name = i.filename.replace("\\", "/")
            parts = [x for x in name.split("/") if x]
            if name.startswith("/") or any(x in (".", "..") for x in parts) or not parts:
                raise Problem(400, "unzulässiger Pfad im ZIP")
            if parts[0] not in ("flights", "base"):
                raise Problem(400, "ZIP-Aufbau: flights/<Flug>/… und base/…")
            total += i.file_size
            if total > 3 * MAX_UPLOAD:
                raise Problem(400, "entpackt zu groß")
        for i in infos:
            if i.is_dir():
                continue
            parts = [x for x in i.filename.replace("\\", "/").split("/") if x]
            target = dest.joinpath(*parts)
            # dji-geotagger globs "*.jpg" / "*.tif" case-sensitively: DJI writes .JPG, so normalise the extension.
            if target.suffix in (".JPG", ".JPEG", ".jpeg"):
                target = target.with_suffix(".jpg")
            if target.suffix == ".TIF":
                target = target.with_suffix(".tif")
            target.parent.mkdir(parents=True, exist_ok=True)
            with z.open(i) as src, open(target, "wb") as out:
                shutil.copyfileobj(src, out, 1024 * 1024)


# RINEX 3 (SAPOS: ..._MO.rnx observation, ..._MN.rnx mixed / _GN, _RN, _EN, _CN navigation) and RINEX 2 (.26o / .26n, .26g …).
def is_obs(name: str) -> bool:
    return bool(re.search(r"(_[A-Z]O\.rnx|\.obs|\.\d\do)$", name, re.I))


def is_nav(name: str) -> bool:
    return bool(re.search(r"(_[A-Z]N\.rnx|\.nav|\.\d\d[nglpfhq])$", name, re.I))


def header_xyz(obs: Path):
    """APPROX POSITION XYZ of a RINEX header (for a SAPOS virtual reference station: the reference position)."""
    with open(obs, "r", errors="replace") as f:
        for _ in range(200):
            line = f.readline()
            if not line:
                break
            if "APPROX POSITION XYZ" in line:
                x, y, z = (float(v) for v in line[:42].split()[:3])
                if abs(x) + abs(y) + abs(z) < 1e6:
                    raise Problem(400, "RINEX-Kopf ohne gültige Position")
                return x, y, z
            if "END OF HEADER" in line:
                break
    raise Problem(400, "RINEX-Kopf ohne APPROX POSITION XYZ – Koordinaten von Hand eingeben")


def run_job(job: dict) -> None:
    import dji_geotagger as dgt
    from dji_geotagger.config import default_ppk_dict
    from dji_geotagger.ppk import ppk_solver
    from dji_geotagger.ppk.base_position import build_base_position
    from dji_geotagger.tools.progress import Progress, OperationCancelled

    jdir: Path = job["dir"]
    log = logging.getLogger("dji_geotagger")
    handler = logging.FileHandler(jdir / "log.txt")
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
    log.addHandler(handler)
    try:
        with RUNNING:
            job.update(state="running", message="entpacke")
            work = jdir / "work"
            safe_extract(jdir / "upload.zip", work)
            (jdir / "upload.zip").unlink(missing_ok=True)
            base_dir = work / "base"
            files = [p for p in base_dir.iterdir() if p.is_file()] if base_dir.is_dir() else []
            obs = [p for p in files if is_obs(p.name)]
            nav = sorted((p for p in files if is_nav(p.name)), key=lambda p: (not re.search(r"_MN\.rnx$", p.name, re.I), p.name))
            if len(obs) != 1 or not nav:
                raise Problem(400, "base/: genau eine RINEX-Beobachtungsdatei und mindestens eine Navigationsdatei erwartet")
            precise = [p for p in files if p.suffix.lower() in (".sp3", ".clk")]
            flights = sorted(p for p in (work / "flights").iterdir() if p.is_dir()) if (work / "flights").is_dir() else []
            if not flights:
                raise Problem(400, "flights/: kein Flugordner")
            p = job["params"]
            if p["mode"] == "header":
                x, y, z = header_xyz(obs[0])
                base = build_base_position(X=x, Y=y, Z=z, sigma_ENU=p["sigma"], coord_sys=p["frame"], epoch=p["epoch"])
            else:
                base = build_base_position(lat_dd=p["lat"], lon_dd=p["lon"], hgt=p["height"], sigma_ENU=p["sigma"],
                                           coord_sys=p["frame"], epoch=p["epoch"])
            # Offline: never download IGS products; broadcast ephemeris unless precise files were uploaded.
            ppk_solver.download_igs_data = lambda *a, **k: [str(x) for x in precise]
            default_ppk_dict.DEFAULT_PPK_CONF["pos1-sateph"] = "precise" if precise else "brdc"
            job["ephemeris"] = "präzise (hochgeladen)" if precise else "Broadcast (SAPOS-Navigationsdatei)"
            prog = Progress(on_progress=lambda ev: job.update(message=str(getattr(ev, "message", ""))[:160],
                                                              fraction=getattr(ev, "fraction", None)),
                            should_cancel=lambda: job.get("cancel", False))
            os.chdir(jdir)  # the package writes DGT_output/ relative to the working directory
            df = dgt.geotag(flight_folders=[str(f) for f in flights], base_obs=str(obs[0]), base_nav=str(nav[0]),
                            base_position=base, progress=prog, on_flight_error="skip")
            df.to_csv(jdir / "result.csv", index=False)
            failed = df.attrs.get("failed_flights", [])
            job.update(state="done", rows=int(len(df)), flights=len(flights),
                       failed=[{"flight": str(n)[:80], "reason": str(r)[:200]} for n, r in failed],
                       message="fertig: " + str(len(df)) + " Kamerapositionen")
    except OperationCancelled:
        job.update(state="cancelled", message="abgebrochen")
    except Problem as e:
        job.update(state="failed", message=str(e))
    except Exception as e:  # noqa: BLE001 - reported as a short message, details in log.txt
        job.update(state="failed", message=(type(e).__name__ + ": " + str(e))[:300])
    finally:
        log.removeHandler(handler)
        job["finished"] = time.time()
        shutil.rmtree(jdir / "work", ignore_errors=True)
        shutil.rmtree(jdir / "DGT_output", ignore_errors=True)


def cleanup():
    now = time.time()
    with LOCK:
        for jid, j in list(JOBS.items()):
            if j.get("finished") and now - j["finished"] > KEEP_S:
                shutil.rmtree(j["dir"], ignore_errors=True)
                del JOBS[jid]


def view(j):
    return {k: j.get(k) for k in ("id", "state", "message", "fraction", "rows", "flights", "failed", "ephemeris",
                                   "created", "finished")}


class Handler(BaseHTTPRequestHandler):
    server_version = "SkyHubPPK/1"

    def log_message(self, fmt, *args):
        pass

    def reply(self, status, body, kind="application/json"):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def authorized(self):
        got = self.headers.get("Authorization", "")
        return bool(TOKEN) and hmac.compare_digest(got.encode(), ("Bearer " + TOKEN).encode())

    def job(self, path):
        m = re.match(r"^/jobs/([0-9a-f]{24})(/result\.csv)?$", path)
        if not m:
            raise Problem(404, "unbekannt")
        j = JOBS.get(m.group(1))
        if not j:
            raise Problem(404, "Auftrag nicht gefunden")
        return j, bool(m.group(2))

    def do_GET(self):
        url = urlsplit(self.path)
        try:
            if url.path == "/health":
                return self.reply(200, {"status": "ok", "running": RUNNING._value == 0})
            if not self.authorized():
                raise Problem(401, "unauthorized")
            j, csv = self.job(url.path)
            if not csv:
                return self.reply(200, view(j))
            f = j["dir"] / "result.csv"
            if j.get("state") != "done" or not f.exists():
                raise Problem(404, "kein Ergebnis")
            return self.reply(200, f.read_bytes(), "text/csv; charset=utf-8")
        except Problem as e:
            self.reply(e.status, {"error": str(e)})

    def do_DELETE(self):
        try:
            if not self.authorized():
                raise Problem(401, "unauthorized")
            j, _ = self.job(urlsplit(self.path).path)
            j["cancel"] = True
            self.reply(200, {"ok": True})
        except Problem as e:
            self.reply(e.status, {"error": str(e)})

    def do_POST(self):
        try:
            if not self.authorized():
                raise Problem(401, "unauthorized")
            url = urlsplit(self.path)
            jid = (parse_qs(url.query).get("id") or [""])[0]
            if url.path != "/jobs" or not JOB_ID.match(jid) or jid in JOBS:
                raise Problem(400, "Auftrags-ID ungültig")
            length = int(self.headers.get("Content-Length") or 0)
            if length < 22 or length > MAX_UPLOAD:
                raise Problem(413, "Upload fehlt oder größer als 3 GiB")
            params = parse_params(self.headers.get("X-PPK-Params", ""))
            cleanup()
            with LOCK:
                if sum(1 for j in JOBS.values() if j.get("state") in ("queued", "running")) >= 2:
                    raise Problem(429, "Es laufen bereits Aufträge")
                jdir = ROOT / jid
                jdir.mkdir(parents=True, exist_ok=False)
                job = {"id": jid, "dir": jdir, "params": params, "state": "receiving", "message": "Upload",
                       "created": time.time()}
                JOBS[jid] = job
            left = length
            with open(jdir / "upload.zip", "wb") as out:
                while left:
                    chunk = self.rfile.read(min(left, 1024 * 1024))
                    if not chunk:
                        raise Problem(400, "Upload abgebrochen")
                    out.write(chunk)
                    left -= len(chunk)
            job.update(state="queued", message="wartet")
            threading.Thread(target=run_job, args=(job,), daemon=True).start()
            self.reply(202, view(job))
        except Problem as e:
            j = JOBS.get(locals().get("jid", ""))
            if j and j.get("state") == "receiving":
                j.update(state="failed", message=str(e), finished=time.time())
                shutil.rmtree(j["dir"] / "work", ignore_errors=True)
                (j["dir"] / "upload.zip").unlink(missing_ok=True)
            self.reply(e.status, {"error": str(e)})


def main():
    if len(TOKEN) < 32:
        raise SystemExit("SKYHUB_PPK_TOKEN (min. 32 Zeichen) fehlt")
    ROOT.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(level=logging.INFO)
    ThreadingHTTPServer(("0.0.0.0", 8090), Handler).serve_forever()


if __name__ == "__main__":
    main()
