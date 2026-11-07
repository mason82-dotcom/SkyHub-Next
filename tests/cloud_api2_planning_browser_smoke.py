#!/usr/bin/env python3
"""Offline real-Chromium navigation acceptance for SkyHub's Cloud API 2 planning tab.

Runs only against a local static source directory. No DJI hardware, live APIs,
MQTT, remote terrain data or real geographic map tiles are consulted.
"""
from __future__ import annotations

import base64
import contextlib
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
WEBROOT = ROOT / "frontend" / "public"
ARTIFACTS = ROOT / "artifacts" / "cloud-api2-planning-browser"
TILE = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3t8AAAAASUVORK5CYII="
)


class StaticHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEBROOT), **kwargs)

    def log_message(self, _fmt, *_args):
        return


def check(ok: bool, message: str):
    if not ok:
        raise AssertionError(message)


def guard(page, base: str, unexpected: list[str]):
    def intercept(route):
        req = route.request
        url = req.url
        if req.method != "GET":
            unexpected.append("Unexpected browser write: " + req.method)
            route.abort()
            return
        if url.startswith(base + "/"):
            path = urlparse(url).path
            if path.startswith("/api/"):
                route.fulfill(status=401, content_type="application/json", body='{"error":"offline-lab"}')
            elif path.startswith("/tiles/"):
                route.fulfill(status=200, content_type="image/png", body=TILE)
            else:
                route.continue_()
            return
        if url.startswith("https://tile.openstreetmap.org/"):
            route.fulfill(status=200, content_type="image/png", body=TILE)
        else:
            # No external maps, credentials, vendor PaaS or telemetry in this test.
            route.abort()
    page.route("**/*", intercept)


def run():
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer(("127.0.0.1", 0), StaticHandler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{server.server_port}"
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True, args=["--no-sandbox"])
            for width, height in [(320, 720), (390, 844), (834, 900), (1440, 900)]:
                context = browser.new_context(viewport={"width": width, "height": height})
                page = context.new_page()
                unexpected = []
                guard(page, base, unexpected)
                page.goto(base + "/cloud-api2.html#planning", wait_until="domcontentloaded")
                page.locator('#view-planning:not([hidden])').wait_for(timeout=12000)
                check(page.locator('button[data-planning-tool]').count() == 3,
                      "Expected three canonical planning choices")
                initial = page.evaluate("""() => [...document.querySelectorAll('.planning-frame')]
                    .map(frame => frame.getAttribute('src'))""")
                check(initial == [None, None, None], "An iframe loaded without an explicit click")
                check(page.locator("#planningOpenFull").get_attribute("href") == "/wpml-editor.html",
                      "Missing same-origin direct-link fallback")
                page.locator('button[data-planning-tool="editor"]').click()
                page.wait_for_function("""() => {
                    const f=document.getElementById('planningFrame-editor');
                    return f && f.contentDocument && f.contentDocument.title.startsWith('Missionsentwurf');
                }""", timeout=15000)
                page.locator("#planningStatus").filter(has_text="geladen. Entwurfs-").wait_for(timeout=15000)
                check(page.frame_locator("#planningFrame-editor").locator("#map").count() == 1,
                      "Original WPML map not available in embedded editor")
                check(page.locator("#planningOpenFull").get_attribute("href") == "/wpml-editor.html",
                      "Original editor direct link drifted")
                page.locator('button[data-planning-tool="area"]').click()
                page.wait_for_function("""() => {
                    const f=document.getElementById('planningFrame-area');
                    return f && f.contentDocument && f.contentDocument.title.startsWith('Vermessungsvorschau');
                }""", timeout=15000)
                page.locator("#planningStatus").filter(has_text="geladen. Entwurfs-").wait_for(timeout=15000)
                check(page.frame_locator("#planningFrame-area").locator("#preview").count() == 1,
                      "Original area planner control missing")
                check(page.locator("#planningFrame-editor").get_attribute("src") == "/wpml-editor.html",
                      "Changing planning tools unexpectedly destroyed original editor")
                page.locator('button[data-planning-tool="library"]').click()
                page.wait_for_function("""() => {
                    const f=document.getElementById('planningFrame-library');
                    return f && f.contentDocument && f.contentDocument.title.startsWith('Routenbibliothek');
                }""", timeout=15000)
                page.locator("#planningStatus").filter(has_text="geladen. Entwurfs-").wait_for(timeout=15000)
                check(page.frame_locator("#planningFrame-library").locator("#save").count() == 1,
                      "Original route library revision action missing")
                check(page.locator("#planningOpenFull").get_attribute("href") == "/wpml-route-library.html",
                      "Library direct-link fallback drifted")
                # Modify a local, unsaved input; selection changes must not recreate
                # the library iframe or implicitly persist/send anything.
                route_name = page.frame_locator("#planningFrame-library").locator("#route-name")
                transient_name = "Unsaved offline UI test – do not publish"
                route_name.fill(transient_name)
                page.locator('button[data-planning-tool="editor"]').click()
                page.locator('button[data-planning-tool="library"]').click()
                check(route_name.input_value() == transient_name,
                      "Unsaved in-memory route name was lost after switching tools")
                check(page.locator("#planningFrame-library").get_attribute("src") ==
                      "/wpml-route-library.html", "Library iframe reloaded on re-selection")
                check(page.locator('button[data-planning-tool="library"]').get_attribute("aria-pressed")
                      == "true", "Library selection was not restored")
                overflow = page.evaluate("""() => ({
                    width: window.innerWidth, scroll: document.documentElement.scrollWidth,
                    active: document.querySelectorAll('[data-planning-tool][aria-pressed="true"]').length,
                })""")
                check(overflow["active"] == 1, "Exactly one planning choice must be active")
                check(overflow["scroll"] <= overflow["width"] + 2,
                      f"Horizontal body overflow at {width}px: {overflow}")
                check(unexpected == [], "Unexpected non-GET browser traffic: " + str(unexpected))
                if width in (390, 1440):
                    page.screenshot(path=str(ARTIFACTS / f"planning-{width}.png"), full_page=True)
                print(f"PASS: planning iframe, routes, fallback, responsive {width}px; no writes")
                context.close()

            # Real Chromium keyboard acceptance: Enter activates a native button.
            context = browser.new_context(viewport={"width": 834, "height": 900})
            page = context.new_page()
            unexpected = []
            guard(page, base, unexpected)
            page.goto(base + "/cloud-api2.html#planning", wait_until="domcontentloaded")
            button = page.locator('button[data-planning-tool="editor"]')
            button.focus()
            check(button.evaluate("(element) => element === document.activeElement"),
                  "Planning button must be keyboard-focusable")
            page.keyboard.press("Enter")
            page.locator("#planningStatus").filter(has_text="geladen. Entwurfs-").wait_for(timeout=15000)
            check(button.get_attribute("aria-pressed") == "true",
                  "Keyboard activation did not select editor")
            check(unexpected == [], "Unexpected browser writes in keyboard test")
            print("PASS: Enter-key selection and focusable controls")
            context.close()

            # Chromium touch emulation: genuine tap on a mobile-sized viewport.
            context = browser.new_context(viewport={"width": 390, "height": 844},
                                          is_mobile=True, has_touch=True, device_scale_factor=1)
            page = context.new_page()
            unexpected = []
            guard(page, base, unexpected)
            page.goto(base + "/cloud-api2.html#planning", wait_until="domcontentloaded")
            page.locator('button[data-planning-tool="area"]').tap()
            page.locator("#planningStatus").filter(has_text="geladen. Entwurfs-").wait_for(timeout=15000)
            check(page.locator('button[data-planning-tool="area"]').get_attribute("aria-pressed")
                  == "true", "Touch selection did not activate area planner")
            check(unexpected == [], "Unexpected browser writes in touch test")
            print("PASS: touch tap on mobile-sized viewport")
            context.close()

            # A real frame-ancestors denial must never produce a ready indication.
            context = browser.new_context(viewport={"width": 390, "height": 844})
            page = context.new_page()
            unexpected = []
            guard(page, base, unexpected)
            page.route(base + "/wpml-route-library.html",
                       lambda route: route.fulfill(status=200, headers={
                           "content-type": "text/html",
                           "content-security-policy": "frame-ancestors 'none'"
                       }, body="<title>Routenbibliothek · SkyHub</title>"))
            page.goto(base + "/cloud-api2.html#planning", wait_until="domcontentloaded")
            page.locator('button[data-planning-tool="library"]').click()
            page.locator("#planningStatus").filter(has_text="UNBEKANNT").wait_for(timeout=15000)
            check(page.locator("#planningOpenFull").get_attribute("href") == "/wpml-route-library.html",
                  "CSP rejection must retain the canonical fallback link")
            check(unexpected == [], "Unexpected browser writes in CSP rejection test")
            print("PASS: CSP frame-ancestors denial fails closed")
            context.close()

            context = browser.new_context(viewport={"width": 390, "height": 844})
            page = context.new_page()
            unexpected = []
            guard(page, base, unexpected)
            page.route(base + "/wpml-route-library.html",
                       lambda route: route.fulfill(status=404,
                           content_type="text/html", body="<title>404 Not Found</title>"))
            page.goto(base + "/cloud-api2.html#planning", wait_until="domcontentloaded")
            page.locator('button[data-planning-tool="library"]').click()
            page.locator("#planningStatus").filter(has_text="UNBEKANNT").wait_for(timeout=15000)
            check(page.locator("#planningOpenFull").get_attribute("href") == "/wpml-route-library.html",
                  "Fallback must be preserved when iframe cannot be verified")
            check(unexpected == [], "Unexpected browser writes in error case")
            print("PASS: blocked / missing iframe fails closed with original direct link")
            context.close()
            # A loaded, trusted editor can navigate while hidden. Reopening it
            # must not retain the previous green/ready indication after a 404.
            context = browser.new_context(viewport={"width": 390, "height": 844})
            page = context.new_page()
            unexpected = []
            guard(page, base, unexpected)
            page.goto(base + "/cloud-api2.html#planning", wait_until="domcontentloaded")
            page.locator('button[data-planning-tool="editor"]').click()
            page.locator("#planningStatus").filter(has_text="geladen. Entwurfs-").wait_for(timeout=15000)
            page.locator('button[data-planning-tool="area"]').click()
            page.locator("#planningStatus").filter(has_text="geladen. Entwurfs-").wait_for(timeout=15000)
            visible_before = page.locator("#planningStatus").inner_text()
            page.locator("#planningFrame-editor").evaluate(
                "(frame) => frame.setAttribute('src', '/missing-hidden-planning-editor.html')")
            page.wait_for_function("""() => {
                const frame = document.getElementById('planningFrame-editor');
                return frame && frame.contentDocument &&
                    frame.contentDocument.title === 'Error response';
            }""", timeout=15000)
            check(page.locator("#planningStatus").inner_text() == visible_before,
                  "Background iframe navigation must not alter the active tool's status")
            page.locator('button[data-planning-tool="editor"]').click()
            page.locator("#planningStatus").filter(has_text="UNBEKANNT").wait_for(timeout=15000)
            check(page.locator("#planningOpenFull").get_attribute("href") == "/wpml-editor.html",
                  "Hidden iframe failure must preserve the canonical direct link")
            check(unexpected == [], "Unexpected browser writes in hidden navigation test")
            print("PASS: hidden stale editor fails closed after background 404")
            context.close()
            browser.close()
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


if __name__ == "__main__":
    run()
