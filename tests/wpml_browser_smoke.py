#!/usr/bin/env python3
"""Reproducible real-Chromium acceptance of the OFFLINE SkyHub WPML editor.

Uses real local Leaflet JS/CSS and synthetic 1x1 map tiles. Blocks all
unexpected outbound requests; never talks to DJI, Pilot 2, SkyHub API or MQTT.
This is a browser/UI smoke test, not hardware or terrain acceptance.
"""
from __future__ import annotations

import base64
import contextlib
import io
import json
import os
from pathlib import Path
import tempfile
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from zipfile import ZipFile

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
WEBROOT = ROOT / "frontend" / "public"
LEAFLET_DIST = Path(os.environ["SKYHUB_TEST_LEAFLET_DIST"]).resolve()
ARTIFACT_DIR = ROOT / "artifacts" / "wpml-browser"
TILE = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3t8AAAAASUVORK5CYII="
)
SAMPLE = {
    "name": "Synthetic imported draft",
    "drone_model": 77,
    "payload_model": 66,
    "template_type": "waypoint",
    "global_height": 50,
    "global_speed": 5,
    "waypoints": [
        {"latitude": 49.1, "longitude": 8.6, "height": 50},
        {"latitude": 49.102, "longitude": 8.602, "height": 50,
         "actions": [{"type": "takePhoto"}]},
    ],
}

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEBROOT), **kwargs)

    def log_message(self, _format, *_args):
        return  # Synthetic browser checks must not log access paths or GPS.

def guard(page, base: str, *, real_map: bool, unexpected: list[str]) -> None:
    def route_request(route):
        url = route.request.url
        if url.startswith(base + "/"):
            if route.request.method != "GET":
                unexpected.append("unexpected non-GET request")
                route.abort()
            else:
                route.continue_()
            return
        if real_map and url == "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js":
            route.fulfill(path=str(LEAFLET_DIST / "leaflet.js"),
                          content_type="application/javascript")
            return
        if real_map and url == "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css":
            route.fulfill(path=str(LEAFLET_DIST / "leaflet.css"),
                          content_type="text/css")
            return
        if real_map and url.endswith("marker-icon.png"):
            route.fulfill(path=str(LEAFLET_DIST / "images" / "marker-icon.png"),
                          content_type="image/png")
            return
        if real_map and url.endswith("marker-shadow.png"):
            route.fulfill(path=str(LEAFLET_DIST / "images" / "marker-shadow.png"),
                          content_type="image/png")
            return
        if real_map and url.startswith("https://") and ".tile.openstreetmap.org/" in url:
            route.fulfill(status=200, body=TILE, content_type="image/png")
            return
        if not real_map and url.startswith("https://unpkg.com/leaflet@1.9.4/"):
            route.abort()
            return
        unexpected.append("unexpected outbound request blocked")
        route.abort()

    page.route("**/*", route_request)

def check(condition, message: str):
    if not condition:
        raise AssertionError(message)

def review(page) -> str:
    return page.locator("#mission-review").inner_text()

def click_map(page, x: int, y: int):
    page.locator("#map").click(position={"x": x, "y": y})
    page.wait_for_timeout(100)

def main() -> None:
    for path in [WEBROOT / "wpml-editor.html",
                 WEBROOT / "wpml-editor.js",
                 WEBROOT / "wpml-mission-review.js",
                 LEAFLET_DIST / "leaflet.js", LEAFLET_DIST / "leaflet.css"]:
        if not path.is_file():
            raise RuntimeError("Required local UI or Leaflet asset missing: " + path.name)

    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    with ThreadingHTTPServer(("127.0.0.1", 0), Handler) as httpd:
        thread = Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        base = f"http://127.0.0.1:{httpd.server_port}"
        try:
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(headless=True, args=["--no-sandbox"])
                try:
                    # Desktop: REAL Leaflet map, real DOM controls, file import + KMZ download.
                    context = browser.new_context(viewport={"width": 1365, "height": 850},
                                                  accept_downloads=True)
                    page = context.new_page()
                    unexpected, js_errors = [], []
                    page.on("pageerror", lambda error: js_errors.append(str(error)))
                    page.on("dialog", lambda dialog: dialog.accept())
                    guard(page, base, real_map=True, unexpected=unexpected)
                    page.goto(base + "/wpml-editor.html", wait_until="load")
                    page.locator(".leaflet-container").wait_for()
                    check(page.locator('a[href="/wpml-route-library.html"]').count() == 1,
                          "Parent-branch route-library navigation must survive merge")
                    check(page.locator("#waypoints [role=listitem]").count() == 0,
                          "Expected empty editor")
                    click_map(page, 370, 330)
                    check(page.locator("#waypoints [role=listitem]").count() == 1,
                          "Leaflet map click must create a waypoint")
                    click_map(page, 540, 350)
                    check(page.locator("#waypoints [role=listitem]").count() == 2,
                          "Second Leaflet click must create second waypoint")
                    check("KEINE Flugfreigabe" in review(page),
                          "Review must never imply flight readiness")
                    check(page.locator(".leaflet-marker-icon").count() == 2,
                          "Real Leaflet must render both markers")

                    # Drag a REAL Leaflet marker and verify editor state changes.
                    waypoint_before = page.locator("#waypoints [role=listitem]").first.inner_text()
                    marker_box = page.locator(".leaflet-marker-icon").first.bounding_box()
                    check(marker_box is not None, "Marker drag target not visible")
                    start_x = marker_box["x"] + marker_box["width"] / 2
                    start_y = marker_box["y"] + marker_box["height"] / 2
                    page.mouse.move(start_x, start_y)
                    page.mouse.down()
                    page.mouse.move(start_x + 38, start_y + 22, steps=10)
                    page.mouse.up()
                    page.wait_for_timeout(200)
                    waypoint_after = page.locator("#waypoints [role=listitem]").first.inner_text()
                    check(waypoint_before != waypoint_after, "Marker drag must change waypoint GPS")
                    check(page.locator("#waypoints [role=listitem]").count() == 2,
                          "Dragging must preserve waypoint count")

                    # Browser file import stages without mutating and applies explicitly.
                    before_import = page.locator("#waypoints [role=listitem]").first.inner_text()
                    page.locator("#waylines-reference-file").set_input_files({
                        "name": "synthetic.json",
                        "mimeType": "application/json",
                        "buffer": json.dumps(SAMPLE).encode("utf-8")
                    })
                    page.locator("#waylines-reference-apply:not([disabled])").wait_for()
                    check(page.locator("#waypoints [role=listitem]").first.inner_text() == before_import,
                          "Unconfirmed file import may not overwrite editor")
                    check("49.1" not in page.locator("#waylines-reference-preview").inner_text(),
                          "Unconfirmed preview must not publish GPS values")
                    page.locator("#waylines-reference-apply").click()
                    check(page.locator("#name").input_value() == SAMPLE["name"],
                          "Confirmed import must update draft")
                    check("ENTWURF" in review(page), "Valid imported draft remains review-only")
                    check(page.locator("#waypoints [role=listitem]").count() == 2,
                          "Imported waypoint count mismatch")
                    check("1 markierte" in review(page),
                          "Single point photo count mismatch")

                    # A local export must remain downloadable and structurally parseable.
                    with page.expect_download() as event:
                        page.locator("#export").click()
                    download = event.value
                    check(download.suggested_filename.endswith(".kmz"), "KMZ download suffix")
                    kmz_path = ARTIFACT_DIR / "synthetic-ui-export.kmz"
                    download.save_as(str(kmz_path))
                    with ZipFile(kmz_path) as archive:
                        check(archive.testzip() is None, "Invalid KMZ CRC")
                        names = archive.namelist()
                        check(names == ["wpmz/template.kml", "wpmz/waylines.wpml"],
                              "Unexpected exported KMZ files")
                        wayline = archive.read("wpmz/waylines.wpml").decode("utf-8")
                        check("<wpml:actionActuatorFunc>takePhoto</wpml:actionActuatorFunc>" in wayline,
                              "Expected local reachPoint photo action missing")
                    kmz_path.unlink()  # never preserve even synthetic route content in artifacts

                    # Validate photo interval review is dynamic, without DJI calls.
                    page.locator("#photo-trigger").select_option("multipleDistance")
                    check("Kamera-Minimalintervall" in review(page),
                          "Unknown camera timing must be explicit")
                    page.locator("#photo-camera-min").fill("4")
                    check("EINGABEN PRÜFEN" in review(page),
                          "Camera timing violation not flagged")
                    page.locator("#photo-camera-min").fill("1")
                    check("ENTWURF" in review(page),
                          "Safe synthetic interval should return to review-only")
                    page.locator("#takeoff").fill("0")
                    check("Sicherheitssteighöhe" in review(page),
                          "Invalid takeoff height not flagged")
                    page.locator("#takeoff").fill("30")
                    page.screenshot(path=str(ARTIFACT_DIR / "desktop-review.png"),
                                    full_page=True)
                    check(not unexpected, "Nonlocal network access or write attempted")
                    check(not js_errors, "Browser JS errors: " + " | ".join(js_errors[:2]))
                    context.close()

                    # Mobile: real viewport, no Leaflet/CDN. Manual editing must work offline.
                    mobile = browser.new_context(viewport={"width": 390, "height": 844})
                    phone = mobile.new_page()
                    unexpected_mobile, js_mobile = [], []
                    phone.on("pageerror", lambda error: js_mobile.append(str(error)))
                    phone.on("dialog", lambda dialog: dialog.accept())
                    guard(phone, base, real_map=False, unexpected=unexpected_mobile)
                    phone.goto(base + "/wpml-editor.html", wait_until="load")
                    check("manuell" in phone.locator("#map").inner_text(),
                          "Map outage fallback message missing")
                    width = phone.evaluate("""() => ({
                        viewport: window.innerWidth,
                        scroll: document.documentElement.scrollWidth
                    })""")
                    check(width["scroll"] <= width["viewport"] + 2,
                          "Horizontal page overflow at 390 px viewport")
                    for lat, lon in [("49.100", "8.600"), ("49.102", "8.602")]:
                        phone.locator("#latitude").fill(lat)
                        phone.locator("#longitude").fill(lon)
                        phone.locator("#add").click()
                    check(phone.locator("#waypoints [role=listitem]").count() == 2,
                          "Mobile manual coordinate entry must work offline")
                    phone.locator("#local-heights").check()
                    check("WGS84-Ellipsoidhöhe" in review(phone),
                          "Mobile local-height warning missing")
                    check("EINGABEN PRÜFEN" in review(phone),
                          "Missing measured ellipsoid must remain invalid")
                    phone.screenshot(path=str(ARTIFACT_DIR / "mobile-offline.png"),
                                     full_page=True)
                    check(not unexpected_mobile, "Mobile nonlocal network access attempted")
                    check(not js_mobile, "Mobile JS errors: " + " | ".join(js_mobile[:2]))
                    mobile.close()

                    # P0: real Chromium route-library backup/restore is local-only.
                    route_ctx = browser.new_context(viewport={"width": 1280, "height": 860},
                                                    accept_downloads=True)
                    route_page = route_ctx.new_page()
                    outbound, library_errors = [], []
                    route_page.on("pageerror", lambda err: library_errors.append(str(err)))
                    route_page.on("dialog", lambda dlg: dlg.accept())
                    guard(route_page, base, real_map=False, unexpected=outbound)
                    route_page.goto(base + "/wpml-route-library.html", wait_until="load")
                    route_page.locator("#route-name").fill("Synthetic browser-only route")
                    for idx, (lat, lon) in enumerate([("49.12345", "8.56789"),
                                                       ("49.12445", "8.56889")]):
                        route_page.locator("#add-point").click()
                        item = route_page.locator("#waypoints > .item").nth(idx)
                        item.locator('input[type="number"]').nth(0).fill(lat)
                        item.locator('input[type="number"]').nth(1).fill(lon)
                    route_page.locator("#group-index").select_option("0")
                    route_page.locator("#add-group").click()
                    route_page.locator("#save").click()
                    check(route_page.locator("#routes > .item").count() == 1,
                          "Expected saved local route before backup")
                    with route_page.expect_download() as event:
                        route_page.locator("#backup-export").click()
                    backup_download = event.value
                    check(backup_download.suggested_filename.endswith(".json"),
                          "Browser route backup must use JSON extension")
                    backup_bytes = Path(backup_download.path()).read_bytes()
                    payload = json.loads(backup_bytes)
                    check(payload["schema"] == "skyhub-local-waypoint-backup-v1",
                          "Unexpected backup schema")
                    check(payload["library"]["routes"][0]["revisions"][0]["flightReady"] is False,
                          "Local backup cannot grant flight readiness")
                    check(payload["library"]["routes"][0]["revisions"][0]["plan"]["waypoints"][0]["lat"]
                          == 49.12345, "Local JSON backup must retain exact input waypoints")
                    route_page.locator("#clear-storage").click()
                    check(route_page.locator("#routes > .item").count() == 0,
                          "Clear local browser library must leave empty route list")
                    route_page.locator("#backup-file").set_input_files({
                        "name": "synthetic-route-backup.json",
                        "mimeType": "application/json",
                        "buffer": backup_bytes
                    })
                    route_page.locator("#backup-apply:not([disabled])").wait_for()
                    preview_text = route_page.locator("#backup-preview").inner_text()
                    check("49.12345" not in preview_text and "8.56789" not in preview_text,
                          "Backup preview cannot reveal mission coordinates")
                    check("Synthetic browser-only route" not in preview_text,
                          "Backup preview cannot reveal route names")
                    check(route_page.locator("#routes > .item").count() == 0,
                          "Unconfirmed backup must not alter existing route library")
                    route_page.locator("#backup-apply").click()
                    check(route_page.locator("#routes > .item").count() == 1,
                          "Confirmed local backup must restore one route")
                    route_page.screenshot(
                        path=str(ARTIFACT_DIR / "local-route-backup-synthetic.png"),
                        full_page=True
                    )
                    check(not outbound, "Backup workflow attempted off-origin or write request")
                    check(not library_errors, "Library browser errors: " +
                          " | ".join(library_errors[:2]))
                    route_ctx.close()

                    # Survey: import synthetic Polygon WITH an exclusion hole;
                    # confirm colored gap markers and downloaded preview never become a DJI route.
                    survey_ctx = browser.new_context(viewport={"width": 1260, "height": 850},
                                                     accept_downloads=True)
                    survey = survey_ctx.new_page()
                    survey_requests, survey_errors = [], []
                    survey.on("pageerror", lambda err: survey_errors.append(str(err)))
                    survey.on("dialog", lambda dlg: dlg.accept())
                    guard(survey, base, real_map=True, unexpected=survey_requests)
                    survey.goto(base + "/wpml-survey-preview.html", wait_until="load")
                    survey.locator(".leaflet-container").wait_for()
                    outer = [[8, 49], [8.0018, 49], [8.0018, 49.0011],
                             [8, 49.0011], [8, 49]]
                    hole = [[8.0006, 49.0003], [8.0012, 49.0003],
                            [8.0012, 49.0008], [8.0006, 49.0008],
                            [8.0006, 49.0003]]
                    fixture = {"type": "Polygon", "coordinates": [outer, hole]}
                    survey.locator("#geometry-file").set_input_files({
                        "name": "synthetic-exclusion.geojson",
                        "mimeType": "application/geo+json",
                        "buffer": json.dumps(fixture).encode("utf-8")
                    })
                    survey.locator("#import-geometry").click()
                    # File.text() + geometry validation are asynchronous browser steps.
                    # Wait for completion instead of racing the click callback.
                    survey.wait_for_function("""() => {
                        const s = document.getElementById('status')?.textContent || '';
                        return s.includes('lokal geladen') || s.includes('Survey preview invalid')
                          || s.includes('Ungültige GeoJSON') || s.includes('GeoJSON größer');
                    }""", timeout=5000)
                    status_text = survey.locator("#status").inner_text()
                    check("lokal geladen" in status_text,
                          "Local excluded survey geometry was not imported: "
                          + status_text[:240])
                    survey.locator("#preview").click()
                    check("ungeplante Übergangslücken" in survey.locator("#status").inner_text(),
                          "Gap warning is missing from survey UI")
                    check(survey.locator("#map path[stroke-dasharray]").count() > 0,
                          "Unsafe direct transitions are not visually distinguished")
                    with survey.expect_download() as event:
                        survey.locator("#geojson").click()
                    exported = json.loads(Path(event.value.path()).read_text(encoding="utf-8"))
                    check(exported["properties"]["flightReady"] is False,
                          "Synthetic geometry cannot gain flight authorization")
                    check(exported["properties"]["exportableAsWaylines"] is False,
                          "GeoJSON preview cannot be classified as Waylines")
                    check(exported["features"][0]["geometry"]["type"] == "Polygon",
                          "Survey import lost its Polygon geometry")
                    check(len(exported["features"][0]["geometry"]["coordinates"]) == 2,
                          "Exclusion hole was lost during export")
                    gap_features = [x for x in exported["features"]
                                    if x["properties"].get("kind")
                                    == "unplanned-direct-gaps-NOT-safe-flight-paths"]
                    check(len(gap_features) == 1 and
                          gap_features[0]["properties"]["safetyVerified"] is False,
                          "Survey gap not preserved as explicitly unsafe")
                    # P1: documented DJI Mavic 3M camera mode reference checks.
                    # Values below are synthetic physical optics, NOT DJI calibration.
                    survey.locator("#optics-enable").check()
                    survey.locator("#camera-mode").select_option("m3m-ms-tiff")
                    optical = {
                        "sensor-width": "13.2", "sensor-height": "8.8",
                        "focal": "8.8", "agl": "60", "image-width": "5280",
                        "image-height": "3956", "side-overlap": "70",
                        "front-overlap": "80", "photo-speed": "6"
                    }
                    for field, value in optical.items():
                        survey.locator("#" + field).fill(value)
                    survey.locator("#preview").click()
                    check("image dimensions differ" in survey.locator("#status").inner_text(),
                          "20MP RGB dimensions were silently accepted for M3M multispectral")
                    check(survey.locator("#geojson").is_disabled(),
                          "Incompatible camera dimensions must block even preview download")
                    survey.locator("#image-width").fill("2592")
                    survey.locator("#image-height").fill("1944")
                    survey.locator("#preview").click()
                    report_text=survey.locator("#status").inner_text()
                    check("DJI-M3M-Referenz m3m-ms-tiff" in report_text,
                          "Valid synthetic multispectral selection missing from survey")
                    check("Keine physische Kalibrierung" in report_text,
                          "Survey claimed a physical camera calibration")
                    survey.locator("#photo-speed").fill("12")
                    survey.locator("#preview").click()
                    check("Referenz-Aufnahmeintervall" in survey.locator("#status").inner_text(),
                          "Cadence violation missing for multispectral survey")
                    survey.locator("#photo-speed").fill("6")
                    survey.locator("#camera-mode").select_option("m3m-rgb-ms-tiff")
                    survey.locator("#preview").click()
                    check("DJI-M3M-Referenz m3m-rgb-ms-tiff" in
                          survey.locator("#status").inner_text(),
                          "Combined RGB plus multispectral mode not distinct")
                    with survey.expect_download() as event:
                        survey.locator("#geojson").click()
                    metadata=json.loads(Path(event.value.path()).read_text(encoding="utf-8"))
                    check(metadata["properties"]["cameraReferenceMode"]=="m3m-rgb-ms-tiff",
                          "Offline export lost acquisition reference id")
                    check(metadata["properties"]["cameraReferenceHardwareVerified"] is False,
                          "Reference mode must not imply camera hardware verification")
                    check(metadata["properties"]["flightReady"] is False,
                          "Reference mode cannot grant flight readiness")
                    survey.screenshot(path=str(ARTIFACT_DIR / "synthetic-survey-exclusion.png"),
                                      full_page=True)
                    check(not survey_requests, "Survey attempted outbound or non-GET request")
                    check(not survey_errors,
                          "Survey JS errors: " + " | ".join(survey_errors[:2]))
                    survey_ctx.close()


                    print("Chromium survey hole import, red transition gaps and safe GeoJSON preview PASS")
                    print("Chromium route library: local backup, redacted preview, confirmed restore PASS")
                    print("Chromium desktop (real Leaflet) and 390px mobile (offline fallback): PASS")
                    print("No DJI/MQTT/SkyHub write requests; KMZ verified locally; no flight approval.")
                finally:
                    browser.close()
        finally:
            httpd.shutdown()
            thread.join(timeout=5)

if __name__ == "__main__":
    main()
