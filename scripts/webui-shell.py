#!/usr/bin/env python3
"""Shared page frame of the SkyHub WebUI: one app bar with the grouped navigation on every operator page.

    python3 scripts/webui-shell.py           write the app bar into all pages (idempotent)
    python3 scripts/webui-shell.py --check   exit 1 if a page differs from what would be written (CI / tests)

The navigation is defined once (NAV below). Each page gets the same block between the markers
<!-- skyhub-appbar --> and <!-- /skyhub-appbar -->; only aria-current differs. Static markup on purpose: the pages stay
navigable without JavaScript, skyhub-nav.js only adds closing of the menus. The first run also migrates the old,
page-specific headers (own nav lists, back links, brand copies) into the shared frame; later runs only refresh the block.
pilot-login.html (DJI Pilot 2 WebView) deliberately keeps its compact frame without navigation.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "frontend" / "public"

# (group label or None for a direct link, [(href, label)])
NAV = [
    (None, [("/", "Übersicht")]),
    ("Einsatz", [("/drc.html", "Live-Steuerung Matrice 4"), ("/drc.html?rc=pro", "Kamera Mavic 3 (RC Pro)"),
                 ("/missionsfreigabe.html", "Missionsfreigabe"), ("/kartenelemente.html", "Kartenelemente")]),
    ("Missionen", [("/wpml-editor.html", "Missionsentwurf"), ("/wpml-route-library.html", "Routenbibliothek")]),
    ("Auswertung", [("/media-gallery.html", "Medien"), ("/thermal.html", "Thermal"), ("/ppk.html", "PPK-Geotagging"),
                    ("/abdeckung.html", "Fotoabdeckung"), ("/ndvi.html", "Vegetationsindizes")]),
    ("System", [("/pilot-protokolle.html", "Pilot-2-Protokolle"), ("/fh-diagnostics.html", "RTK & Flugsitzungen")]),
    ("Labor", [("/wpml-survey-preview.html", "Survey-Vorschau"), ("/smart-farming.html", "Smart Farming"),
               ("/smart-farming-map-lab.html", "Vegetationskarte")]),
]
# page file -> (data-skyhub-page, href that is marked as current)
PAGES = {
    "index.html": ("dashboard", "/"),
    "drc.html": ("drc", "/drc.html"),
    "missionsfreigabe.html": ("mission-release", "/missionsfreigabe.html"),
    "kartenelemente.html": ("map-elements", "/kartenelemente.html"),
    "wpml-editor.html": ("wpml-editor", "/wpml-editor.html"),
    "wpml-route-library.html": ("routes", "/wpml-route-library.html"),
    "media-gallery.html": ("media-gallery", "/media-gallery.html"),
    "thermal.html": ("thermal", "/thermal.html"),
    "ppk.html": ("ppk", "/ppk.html"),
    "abdeckung.html": ("coverage", "/abdeckung.html"),
    "ndvi.html": ("ndvi", "/ndvi.html"),
    "pilot-protokolle.html": ("pilot-logs", "/pilot-protokolle.html"),
    "fh-diagnostics.html": ("fh-diagnostics", "/fh-diagnostics.html"),
    "wpml-survey-preview.html": ("survey", "/wpml-survey-preview.html"),
    "smart-farming.html": ("smart-farming", "/smart-farming.html"),
    "smart-farming-map-lab.html": ("map-lab", "/smart-farming-map-lab.html"),
}
START, END = "<!-- skyhub-appbar -->", "<!-- /skyhub-appbar -->"
SKIP = '<a class="skyhub-skip-link" href="#skyhubMain">Zum Inhalt springen</a>'


def esc(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;")


def appbar(current: str) -> str:
    def link(href, label, indent):
        cur = ' aria-current="page"' if href == current else ""
        return f'{indent}<a href="{esc(href)}"{cur}>{esc(label)}</a>'

    out = [START, '<header class="skyhub-appbar">',
           '  <a class="skyhub-appbar-brand" href="/"><span class="brand-symbol" aria-hidden="true">✦</span>'
           'SkyHub <span>Next</span></a>',
           '  <nav class="skyhub-global-nav" aria-label="SkyHub-Bereiche">']
    for group, links in NAV:
        if group is None:
            out += [link(h, label, "    ") for h, label in links]
            continue
        active = any(h == current for h, _ in links)
        cls = "skyhub-nav-group" + (" is-active" if active else "") + (" is-lab" if group == "Labor" else "")
        out.append(f'    <details class="{cls}"><summary>{esc(group)}</summary><div class="skyhub-nav-menu">')
        out += [link(h, label, "      ") for h, label in links]
        out.append("    </div></details>")
    out += ["  </nav>", "</header>", END]
    return "\n".join(out)


def migrate(src: str, page: str) -> str:
    """One-time conversion of the old page-specific headers; a no-op on already migrated pages."""
    if START in src:
        return src
    # old global nav lists and per-page back links
    src = re.sub(r'\s*<nav class="skyhub-global-nav[^"]*"[^>]*>.*?</nav>', "", src, flags=re.S)
    src = re.sub(r'(<header class="mrel-top">.*?)\s*<nav>.*?</nav>', r"\1", src, flags=re.S)
    src = re.sub(r'\s*<nav aria-label="SkyHub-Modulnavigation">.*?</nav>', "", src, flags=re.S)
    src = src.replace('<header><a href="/">← SkyHub Next</a>', "<header>")
    src = re.sub(r'\s*<a class="brand" href="/"[^>]*>.*?</a>', "", src, flags=re.S)
    src = re.sub(r'\s*<h1 class="skyhub-brand">.*?</h1>', "", src, flags=re.S)
    src = re.sub(r'\s*<p class="fh-diagnostics-link">.*?</p>', "", src, flags=re.S)  # dashboard: now in the nav
    # header left without content (media gallery, thermal: only brand + nav before)
    src = re.sub(r'\s*<header class="topbar">\s*</header>', "", src)
    src = src.replace('<a class="skip" href="#skyhubMain">Zum Inhalt springen</a>', SKIP)
    return src


def render(src: str, page: str) -> str:
    key, current = PAGES[page]
    src = migrate(src, page)
    m = re.search(r"<body\b([^>]*)>", src)
    attrs = m.group(1)
    if "data-skyhub-page=" not in attrs:
        attrs += f' data-skyhub-page="{key}"'
    body = f"<body{attrs}>"
    src = src[:m.start()] + body + src[m.end():]
    block = appbar(current)
    if START in src:
        src = re.sub(re.escape(START) + r".*?" + re.escape(END), lambda _: block, src, count=1, flags=re.S)
    else:
        at = src.index(body) + len(body)
        rest = src[at:]
        if rest.lstrip().startswith(SKIP):
            at += rest.index(SKIP) + len(SKIP)
            src = src[:at] + "\n" + block + src[at:]
        else:
            src = src[:at] + "\n" + SKIP + "\n" + block + src[at:]
        # the remaining page header becomes the page head (title, page actions)
        after = src.index(END) + len(END)
        h = re.compile(r"<header\b([^>]*)>").search(src, after)
        mn = src.find("<main", after)
        if h and (mn < 0 or h.start() < mn):
            a = h.group(1)
            if 'class="' in a:
                a = a.replace('class="', 'class="skyhub-pagehead ', 1)
            else:
                a += ' class="skyhub-pagehead"'
            src = src[:h.start()] + f"<header{a}>" + src[h.end():]
    # exactly one focusable main landmark as skip target
    mm = re.search(r"<main\b([^>]*)>", src)
    if mm and 'id="skyhubMain"' not in mm.group(1):
        a = mm.group(1)
        src = src[:mm.start()] + f'<main id="skyhubMain" tabindex="-1"{a}>' + src[mm.end():]
    if '<script defer src="/skyhub-nav.js"></script>' not in src:
        src = src.replace("</head>", '<script defer src="/skyhub-nav.js"></script>\n</head>', 1)
    return src


def main(argv: list[str]) -> int:
    check = "--check" in argv
    bad = []
    for page in PAGES:
        path = ROOT / page
        old = path.read_text(encoding="utf-8")
        new = render(old, page)
        if new != old:
            bad.append(page)
            if not check:
                path.write_text(new, encoding="utf-8")
    if check and bad:
        print("WebUI-Rahmen veraltet in: " + ", ".join(bad) + " (python3 scripts/webui-shell.py)")
        return 1
    print(("geprüft: " if check else "geschrieben: ") + (", ".join(bad) if bad else "alles aktuell"))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
