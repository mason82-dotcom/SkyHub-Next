"""Offline-only regression tests for the complete SQL migration catalog.

Creates private temporary fixtures; never connects to PostgreSQL or the Pi.
"""
from __future__ import annotations

import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from audit_sql_migrations import audit_inventory  # noqa: E402

MANIFEST = Path("backend/db/migration-inventory.json")
DIRECTORY = Path("backend/db/migrations")


class SqlMigrationInventoryTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="skyhub-sql-inventory-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        (self.root / MANIFEST.parent).mkdir(parents=True)
        shutil.copy2(ROOT / MANIFEST, self.root / MANIFEST)
        shutil.copytree(ROOT / DIRECTORY, self.root / DIRECTORY)

    def data(self) -> dict:
        return json.loads((self.root / MANIFEST).read_text(encoding="utf-8"))

    def write(self, manifest: dict) -> None:
        (self.root / MANIFEST).write_text(json.dumps(manifest), encoding="utf-8")

    def assert_fails(self, fragment: str) -> None:
        errors = audit_inventory(self.root)
        self.assertTrue(any(fragment in error for error in errors), errors)

    def test_real_repository_inventory_has_no_gaps(self) -> None:
        self.assertEqual(audit_inventory(ROOT), [])
        self.assertEqual(audit_inventory(self.root), [])
        entries = self.data()["entries"]
        duplicates = [e for e in entries if e["order"] == 3]
        self.assertEqual({e["family"] for e in duplicates},
                         {"pilot-media", "wpml-draft"})
        self.assertEqual({e["status"] for e in duplicates},
                         {"offline_only", "blocked_draft"})

    def test_wpml_audit_requires_blocked_draft_dependency(self) -> None:
        data = self.data()
        audit = next(entry for entry in data["entries"]
                     if entry["id"] == "wpml-audit-draft-004")
        self.assertEqual(audit["status"], "blocked_draft")
        self.assertEqual(audit["family"], "wpml-draft")
        self.assertEqual(audit["requires"], ["wpml-library-draft-003"])
        self.assertEqual(audit_inventory(self.root), [])
        audit["status"] = "offline_only"
        self.write(data)
        self.assert_fails("Draft is not explicitly blocked")
        audit["status"] = "blocked_draft"
        audit["requires"] = ["pilot-media-verified-003"]
        self.write(data)
        self.assert_fails("cross-family dependency")

    def test_new_unregistered_sql_fails_closed(self) -> None:
        (self.root / DIRECTORY / "005_unreviewed.sql").write_text("-- unsafe draft", encoding="utf-8")
        self.assert_fails("SQL file absent from inventory")

    def test_missing_file_fails_closed(self) -> None:
        (self.root / DIRECTORY / "004_dji_pilot_media_http.sql").unlink()
        self.assert_fails("Inventory references missing SQL file")

    def test_duplicate_family_number_fails_closed(self) -> None:
        data = self.data()
        data["entries"][3]["family"] = "pilot-media"
        self.write(data)
        self.assert_fails("Duplicate family/order")

    def test_duplicate_id_fails_closed(self) -> None:
        data = self.data()
        data["entries"][3]["id"] = "pilot-media-verified-003"
        self.write(data)
        self.assert_fails("Duplicate migration ID")

    def test_unblocked_wpml_draft_fails_closed(self) -> None:
        data = self.data()
        data["entries"][3]["status"] = "offline_only"
        self.write(data)
        self.assert_fails("Draft is not explicitly blocked")

    def test_automatic_migration_execution_fails_closed(self) -> None:
        data = self.data()
        data["auto_apply"] = True
        self.write(data)
        self.assert_fails("Automatic SQL migration execution is forbidden")

    def test_unrecognized_status_fails_closed(self) -> None:
        data = self.data()
        data["entries"][0]["status"] = {"enabled": True}
        self.write(data)
        self.assert_fails("Unreviewed or deployable migration status")

    def test_missing_dependency_fails_closed(self) -> None:
        data = self.data()
        data["entries"][4]["requires"] = ["unknown-migration"]
        self.write(data)
        self.assert_fails("Unknown dependency")

    def test_cross_family_dependency_fails_closed(self) -> None:
        data = self.data()
        data["entries"][4]["requires"] = ["map-elements-001"]
        self.write(data)
        self.assert_fails("cross-family dependency")

    def test_path_traversal_fails_closed(self) -> None:
        data = self.data()
        data["entries"][0]["path"] = "backend/db/migrations/../schema.sql"
        self.write(data)
        self.assert_fails("Migration path not in approved flat directory")

    def test_new_top_level_keys_fail_closed(self) -> None:
        data = self.data()
        data["deploy"] = True
        self.write(data)
        self.assert_fails("unexpected top-level fields")


if __name__ == "__main__":
    unittest.main()
