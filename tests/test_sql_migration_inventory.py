"""Offline-only regression tests for the complete SQL migration catalog.

Creates private temporary fixtures; never connects to PostgreSQL or the Pi.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from audit_sql_migrations import audit_applied_lock, audit_inventory, git_blob_sha  # noqa: E402

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

    def test_existing_sql_change_is_not_silent(self) -> None:
        target = self.root / DIRECTORY / "003_dji_pilot_media_verified.sql"
        target.write_bytes(target.read_bytes() + b"\n-- unreviewed alteration\n")
        self.assert_fails("Migration contents differ from pinned Git blob SHA")

    def test_wrong_or_malformed_git_blob_pin_is_rejected(self) -> None:
        data = self.data()
        data["entries"][0]["git_blob_sha"] = "0" * 40
        self.write(data)
        self.assert_fails("Migration contents differ from pinned Git blob SHA")
        data["entries"][0]["git_blob_sha"] = "../relative/path"
        self.write(data)
        self.assert_fails("Invalid Git blob SHA")

    def test_missing_content_pin_is_rejected(self) -> None:
        data = self.data()
        del data["entries"][0]["git_blob_sha"]
        self.write(data)
        self.assert_fails("unexpected or missing keys")

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


    def test_uppercase_pin_is_rejected(self) -> None:
        data = self.data()
        data["entries"][0]["git_blob_sha"] = data["entries"][0]["git_blob_sha"].upper()
        self.write(data)
        self.assert_fails("Invalid Git blob SHA")

    def test_symlinked_pinned_sql_fails_closed(self) -> None:
        target = self.root / DIRECTORY / "001_dji_map_elements.sql"
        copy = self.root / "outside.sql"
        shutil.copy2(target, copy)
        target.unlink()
        os.symlink(copy, target)
        errors = audit_inventory(self.root)
        self.assertIn("Symlinked SQL migration is forbidden", errors)
        self.assertTrue(any("Inventory references missing SQL file" in e for e in errors), errors)

    def test_schema_version_mismatch_has_its_own_message(self) -> None:
        data = self.data()
        data["schema"] = "skyhub-sql-migration-inventory-v1"
        self.write(data)
        errors = audit_inventory(self.root)
        self.assertTrue(any("Unsupported migration inventory schema" in e for e in errors), errors)
        self.assertFalse(any("Automatic SQL migration execution" in e for e in errors), errors)

    def test_applied_flag_must_be_boolean_and_never_on_drafts(self) -> None:
        data = self.data()
        data["entries"][0]["applied"] = "yes"
        data["entries"][3]["applied"] = True
        self.write(data)
        self.assert_fails("Applied flag must be true or false")
        self.assert_fails("Blocked draft cannot be marked applied")

    def test_pilot_media_migrations_are_marked_applied(self) -> None:
        applied = {e["id"] for e in self.data()["entries"] if e["applied"]}
        self.assertEqual({"pilot-media-verified-003", "pilot-media-http-004", "pilot-media-library-005"}, applied)

    def test_git_blob_sha_matches_git_hash_object(self) -> None:
        sample = self.root / DIRECTORY / "001_dji_map_elements.sql"
        expected = subprocess.run(["git", "hash-object", str(sample)], capture_output=True, text=True,
                                  check=True).stdout.strip()
        self.assertEqual(expected, git_blob_sha(sample.read_bytes()))


class AppliedMigrationLockTest(unittest.TestCase):
    """An applied migration must keep ID, path and pin; editing the pin in the same PR is not enough."""

    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="skyhub-sql-lock-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        (self.root / MANIFEST.parent).mkdir(parents=True)
        shutil.copy2(ROOT / MANIFEST, self.root / MANIFEST)
        shutil.copytree(ROOT / DIRECTORY, self.root / DIRECTORY)
        env = {**os.environ, "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t", "GIT_COMMITTER_NAME": "t",
               "GIT_COMMITTER_EMAIL": "t@t"}
        for cmd in (["init", "-q"], ["add", "-A"], ["commit", "-q", "-m", "base"], ["tag", "base"]):
            subprocess.run(["git", "-C", str(self.root), *cmd], check=True, env=env, capture_output=True)

    def edit(self, change) -> list[str]:
        data = json.loads((self.root / MANIFEST).read_text(encoding="utf-8"))
        change({e["id"]: e for e in data["entries"]}, data)
        (self.root / MANIFEST).write_text(json.dumps(data), encoding="utf-8")
        return audit_applied_lock("base", self.root)

    def test_unchanged_inventory_passes(self) -> None:
        self.assertEqual([], audit_applied_lock("base", self.root))

    def test_rewriting_applied_migration_with_new_pin_fails(self) -> None:
        errors = self.edit(lambda e, d: e["pilot-media-http-004"].update(git_blob_sha="1" * 40))
        self.assertTrue(any("Applied migration is immutable" in x for x in errors), errors)

    def test_unapplying_or_removing_fails(self) -> None:
        errors = self.edit(lambda e, d: e["pilot-media-library-005"].update(applied=False))
        self.assertTrue(any("cannot be un-applied" in x for x in errors), errors)
        errors = self.edit(lambda e, d: d["entries"].remove(e["pilot-media-verified-003"]))
        self.assertTrue(any("Applied migration removed" in x for x in errors), errors)

    def test_unapplied_migration_may_still_change(self) -> None:
        self.assertEqual([], self.edit(lambda e, d: e["map-elements-001"].update(git_blob_sha="2" * 40)))

    def test_unknown_base_ref_fails_closed(self) -> None:
        self.assertTrue(audit_applied_lock("does-not-exist", self.root))

if __name__ == "__main__":
    unittest.main()
