"""Dokumentations-Navigation: jede Datei in docs/ steht im Wegweiser (docs/index.md), und die aktuellen Statusdokumente
sind von README und Wegweiser aus erreichbar. Links und Anker selbst prueft tests/test_documentation_links.py.
"""
from __future__ import annotations

from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
LINK = re.compile(r"(?<!\!)\[[^\]]*\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")


def markdown_files() -> list[Path]:
    return [ROOT / "README.md", *sorted((ROOT / "docs").glob("**/*.md"))]


def local_targets(path: Path) -> list[tuple[str, Path]]:
    found = []
    for match in LINK.finditer(path.read_text(encoding="utf-8")):
        target = match.group(1)
        if target.startswith(("http://", "https://", "mailto:", "#")):
            continue
        relative = target.split("#", 1)[0]
        if relative:
            found.append((target, (path.parent / relative).resolve()))
    return found


class DocsNavigationTests(unittest.TestCase):
    def test_every_docs_file_is_reachable_from_the_index(self):
        index = ROOT / "docs" / "index.md"
        linked = {resolved for _, resolved in local_targets(index)}
        orphans = sorted(p.name for p in (ROOT / "docs").glob("*.md") if p != index and p.resolve() not in linked)
        self.assertEqual([], orphans, "Dateien in docs/, die docs/index.md nicht verlinkt")

    def test_current_status_documents_are_linked_from_readme_and_index(self):
        for name in ("stand-2026-10-27-betriebsstand.md", "vorfaelle-2026-10-26.md", "pi-hub.md", "repository-audit-2026-11-02.md"):
            for entry in (ROOT / "README.md", ROOT / "docs" / "index.md"):
                self.assertIn(name, entry.read_text(encoding="utf-8"), f"{name} fehlt in {entry.name}")


if __name__ == "__main__":
    unittest.main()
