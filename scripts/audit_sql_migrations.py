#!/usr/bin/env python3
"""Fail-closed SQL migration inventory audit. Reads repository files only.

This program NEVER connects to a database or executes any SQL.
File-number prefixes are historical labels; order is scoped by family.
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INVENTORY = Path("backend/db/migration-inventory.json")
MIGRATIONS = Path("backend/db/migrations")
SCHEMA = "skyhub-sql-migration-inventory-v1"
ENTRY_KEYS = {"id", "family", "order", "path", "status", "requires"}
STATUSES = {"offline_only", "blocked_draft"}
FILENAME = re.compile(r"^backend/db/migrations/([0-9]{3})_[a-z0-9_]+\.sql$")
IDENTIFIER = re.compile(r"^[a-z][a-z0-9-]{2,63}$")


def audit_inventory(root: Path = ROOT) -> list[str]:
    """Report all safe-to-display violations; no mutation or SQL execution."""
    errors: list[str] = []
    root = root.resolve()
    inventory_path = root / INVENTORY
    migrations = root / MIGRATIONS
    try:
        raw = json.loads(inventory_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return ["Migration inventory is missing or invalid JSON"]
    if not isinstance(raw, dict) or set(raw) != {"schema", "auto_apply", "entries"}:
        return ["Migration inventory has unexpected top-level fields"]
    if raw["schema"] != SCHEMA or raw["auto_apply"] is not False:
        errors.append("Automatic SQL migration execution is forbidden")
    entries = raw["entries"]
    if not isinstance(entries, list) or not entries:
        return errors + ["Migration inventory must enumerate nonempty entries"]
    actual: set[str] = set()
    if not migrations.is_dir():
        return errors + ["Migration directory is absent"]
    for candidate in migrations.rglob("*.sql"):
        if candidate.is_symlink():
            errors.append("Symlinked SQL migration is forbidden")
            continue
        if candidate.is_file():
            actual.add(candidate.relative_to(root).as_posix())

    ids: set[str] = set()
    key_by_id: dict[str, tuple[str, int, str]] = {}
    deps_by_id: dict[str, list[str]] = {}
    paths: set[str] = set()
    family_steps: set[tuple[str, int]] = set()
    for index, item in enumerate(entries):
        if not isinstance(item, dict) or set(item) != ENTRY_KEYS:
            errors.append(f"Entry {index} has unexpected or missing keys")
            continue
        ident, family, order = item["id"], item["family"], item["order"]
        name, status, requires = item["path"], item["status"], item["requires"]
        if not isinstance(ident, str) or not IDENTIFIER.fullmatch(ident):
            errors.append(f"Entry {index} has an invalid ID")
            continue
        if ident in ids:
            errors.append(f"Duplicate migration ID: {ident}")
        ids.add(ident)
        if not isinstance(family, str) or not IDENTIFIER.fullmatch(family):
            errors.append(f"Invalid migration family: {ident}")
            continue
        if type(order) is not int or not 1 <= order <= 999:
            errors.append(f"Invalid migration order: {ident}")
            continue
        if (family, order) in family_steps:
            errors.append(f"Duplicate family/order in {family}: {order:03d}")
        family_steps.add((family, order))
        if not isinstance(name, str) or not FILENAME.fullmatch(name):
            errors.append(f"Migration path not in approved flat directory: {ident}")
            continue
        if int(FILENAME.fullmatch(name).group(1)) != order:
            errors.append(f"Filename/order mismatch: {ident}")
        if name in paths:
            errors.append(f"Duplicate SQL file in inventory: {name}")
        paths.add(name)
        if not isinstance(status, str) or status not in STATUSES:
            errors.append(f"Unreviewed or deployable migration status: {ident}")
        if name.endswith("_draft.sql") != (status == "blocked_draft"):
            errors.append(f"Draft is not explicitly blocked: {ident}")
        if not isinstance(requires, list) or not all(
            isinstance(dep, str) and IDENTIFIER.fullmatch(dep) for dep in requires
        ) or len(requires) != len(set(requires)):
            errors.append(f"Invalid dependencies: {ident}")
            continue
        key_by_id[ident] = (family, order, status)
        deps_by_id[ident] = requires

    for ident, dependencies in deps_by_id.items():
        family, order, status = key_by_id[ident]
        for dependency in dependencies:
            predecessor = key_by_id.get(dependency)
            if predecessor is None:
                errors.append(f"Unknown dependency {dependency} for {ident}")
            elif predecessor[0] != family or predecessor[1] >= order:
                errors.append(f"Non-preceding or cross-family dependency for {ident}")
            elif predecessor[2] == "blocked_draft" and status != "blocked_draft":
                errors.append(f"Active candidate depends on blocked draft: {ident}")

    for missing in sorted(actual - paths):
        errors.append(f"SQL file absent from inventory: {missing}")
    for missing in sorted(paths - actual):
        errors.append(f"Inventory references missing SQL file: {missing}")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT,
                        help="Repository root for read-only inspection")
    args = parser.parse_args()
    failures = audit_inventory(args.root)
    if failures:
        for problem in failures:
            print("FAIL:", problem)
        return 1
    print("PASS: SQL migration inventory is exhaustive, offline-only and fail-closed.")
    print("NOTE: numeric file prefixes are scoped to families; no SQL was executed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
