#!/usr/bin/env python3
"""Read-only check for accidentally tracked local data or generated files.

Only inspects Git's index. Never deletes files, touches a service, or scans
private contents. This is not a replacement for a secret scanner.
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path, PurePosixPath


ROOT = Path(__file__).resolve().parents[1]
GENERATED_PARTS = frozenset({
    "node_modules", "__pycache__", ".pytest_cache", ".mypy_cache",
    ".ruff_cache", ".venv", "venv", ".idea", ".cache",
})
PRIVATE_SUFFIXES = (".pem", ".key", ".p12", ".pfx")
BACKUP_SUFFIXES = (".bak", ".orig", ".rej", ".swp", ".swo")


def audit_paths(paths: list[str]) -> list[str]:
    """Return actionable findings without mutating the filesystem."""
    findings: list[str] = []
    spellings: dict[str, str] = {}
    for raw in paths:
        if not raw:
            continue
        path = PurePosixPath(raw)
        parts = path.parts
        name = path.name
        folded = raw.casefold()
        if folded in spellings and spellings[folded] != raw:
            findings.append(f"case-insensitive name collision: {spellings[folded]} / {raw}")
        else:
            spellings[folded] = raw

        if any(part.casefold() in GENERATED_PARTS for part in parts):
            findings.append(f"generated/local directory committed: {raw}")
        if name == ".env" or (name.startswith(".env.") and not name.endswith(".example")):
            findings.append(f"private env file committed: {raw}")
        if name.lower().endswith(PRIVATE_SUFFIXES):
            findings.append(f"possible private key/certificate committed: {raw}")
        if name.lower().endswith(BACKUP_SUFFIXES) or ".bak-" in name.lower():
            findings.append(f"backup/patch artifact committed: {raw}")
        if name in (".DS_Store", "Thumbs.db") or name.endswith(".pyc"):
            findings.append(f"machine-generated file committed: {raw}")
    return sorted(set(findings))


def main() -> int:
    try:
        result = subprocess.run(
            ["git", "ls-files", "--cached", "-z"],
            cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            check=True,
        )
    except (OSError, subprocess.CalledProcessError) as error:
        print(f"Repository audit unavailable: {error}", file=sys.stderr)
        return 2
    paths = result.stdout.decode("utf-8", errors="surrogateescape").split("\0")
    findings = audit_paths(paths)
    if findings:
        print("Repository hygiene FAIL:", file=sys.stderr)
        for finding in findings:
            print(f"  - {finding}", file=sys.stderr)
        print("Review and remove from the Git index only after making a backup.", file=sys.stderr)
        return 1
    print(f"Repository hygiene PASS: {len([p for p in paths if p])} tracked paths checked (read-only).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
