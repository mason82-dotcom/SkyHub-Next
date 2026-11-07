"""Offline regression guard for local SkyHub documentation links.

Uses only the Python standard library. Deliberately skips network URLs and
archived legacy documents. This checks the current checked-out repository,
never the live Raspberry Pi or GitHub PR states.
"""
from __future__ import annotations

import re
import unicodedata
import unittest
from pathlib import Path
from urllib.parse import unquote, urlsplit


ROOT = Path(__file__).resolve().parents[1]
MARKDOWN_LINK = re.compile(r"!?(?:\[[^\]\n]*\])\(([^)\n]+)\)")
HEADING = re.compile(r"^#{1,6}\s+(.+?)\s*#*\s*$", re.MULTILINE)
FENCE = re.compile(r"(?ms)^\s*```[^\n]*\n.*?^\s*```\s*$")
INLINE_CODE = re.compile(r"`[^`\n]*`")
SCHEME = re.compile(r"^[A-Za-z][A-Za-z0-9+.-]*:")


def markdown_files():
    """Check the active docs, not historical copies of the legacy product."""
    result = [ROOT / "README.md", ROOT / "DESIGN.md", ROOT / "UX-CONTRACT.md"]
    result.extend(sorted((ROOT / "docs").rglob("*.md")))
    result.append(ROOT / "stacks" / "README.md")
    return [path for path in result if path.is_file()]


def remove_code(markdown: str) -> str:
    return INLINE_CODE.sub("", FENCE.sub("", markdown))


def heading_slug(heading: str) -> str:
    # GitHub-style punctuation stripping while retaining Unicode letters.
    heading = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", heading)
    heading = heading.replace("`", "").replace("*", "").replace("_", "_")
    heading = unicodedata.normalize("NFC", heading).lower().strip()
    heading = "".join(ch for ch in heading if ch.isalnum() or ch in " _-")
    return re.sub(r"\s+", "-", heading)


def heading_anchors(markdown: str) -> set[str]:
    seen: dict[str, int] = {}
    anchors = set()
    for match in HEADING.finditer(remove_code(markdown)):
        raw = heading_slug(match.group(1))
        count = seen.get(raw, 0)
        seen[raw] = count + 1
        anchors.add(raw if count == 0 else f"{raw}-{count}")
    return anchors


def parse_local_link(raw: str):
    link = raw.strip()
    if not link:
        return None
    if link.startswith("<") and ">" in link:
        link = link[1 : link.index(">")]
    else:
        # Optional Markdown title follows the destination.
        link = link.split(maxsplit=1)[0]
    if link.startswith("//") or SCHEME.match(link):
        return None
    split = urlsplit(link)
    return unquote(split.path), unquote(split.fragment)


class DocumentationLinkTest(unittest.TestCase):
    def test_heading_slug_examples(self):
        self.assertEqual(heading_slug("Pilot 2 connection sequence (handshake)"),
                         "pilot-2-connection-sequence-handshake")
        self.assertEqual(heading_slug("Separate P1 / P2: Map API"), "separate-p1-p2-map-api")

    def test_documentation_navigation_targets(self):
        index = (ROOT / "docs" / "index.md").read_text(encoding="utf-8")
        for reference in (
            "projektstand-2026-10-23.md",
            "integration-priorities-2026-10-23.md",
            "config-reference.md",
            "api-reference.md",
            "ops.md",
            "security.md",
        ):
            with self.subTest(reference=reference):
                self.assertIn(f"]({reference})", index)

    def test_all_relative_documentation_links_resolve(self):
        failures = []
        cache = {}
        for source in markdown_files():
            clean = remove_code(source.read_text(encoding="utf-8"))
            for match in MARKDOWN_LINK.finditer(clean):
                parsed = parse_local_link(match.group(1))
                if parsed is None:
                    continue
                destination, anchor = parsed
                target = (source.parent / destination).resolve() if destination else source
                if not target.is_relative_to(ROOT):
                    failures.append(f"{source.relative_to(ROOT)}: path escapes repository: {destination}")
                    continue
                if not target.exists():
                    failures.append(f"{source.relative_to(ROOT)}: missing {destination}")
                    continue
                if anchor and target.is_file() and target.suffix.lower() == ".md":
                    if target not in cache:
                        cache[target] = heading_anchors(target.read_text(encoding="utf-8"))
                    if anchor not in cache[target]:
                        failures.append(
                            f"{source.relative_to(ROOT)}: missing #{anchor} in "
                            f"{target.relative_to(ROOT)}"
                        )
        self.assertEqual([], failures, "\n".join(failures))


if __name__ == "__main__":
    unittest.main()
