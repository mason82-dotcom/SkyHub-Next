---
name: skyhub-sql-migration-review
description: Read-only SQL inventory and change-control for SkyHub-Next PostgreSQL/PostGIS migration files. No migrations may be executed by this skill.
---
# SkyHub SQL migration review (offline only)

Use this project skill for edits under `backend/db/migrations/`, the SQL inventory, and DB migration release preparation. This skill does not authorize database deployments.

## Safety invariants
1. Read the current `main` and `docs/sql-migration-inventory.md` before editing. Do not confuse version prefixes with globally unique migration IDs; both existing `003` files belong to different families.
2. **Never** run migration SQL, connect to production PostgreSQL, modify Pi services, restart Docker, publish MQTT messages, or issue flight controls.
3. The WPML `003_wpml_route_library_draft.sql` stays `blocked_draft` with no automatic application or runtime import.
4. Any SQL change requires a reviewed, deliberate `git_blob_sha` change in `backend/db/migration-inventory.json`; `git hash-object <path>` calculates the object ID. Updating the pin is not approval to apply SQL.
5. Never re-use a migration ID for different SQL. Prefer an additive new migration with reviewed dependencies, idempotency and rollback plan over rewriting previously applied SQL, especially the manually migrated Pilot media schema.
6. A future rollout requires separate PostgreSQL 15/16 isolated integration, role/RLS tests, preexisting-table and second-run tests, explicit backup/restore proof and operator sign-off. CI alone never grants approval.

## Required checks (no database or DJI devices)
```bash
python3 scripts/audit_sql_migrations.py
python3 -m unittest discover -s tests -p 'test_sql_migration_inventory.py' -v
python3 -m py_compile scripts/audit_sql_migrations.py
```

## PR checklist
- Record base commit and changed SQL object SHA(s); list which already-installed migrations are affected.
- Validate `blocked_draft` remains blocked, no auto-apply path added.
- Link CI on the final PR head and clearly state `DATABASE_DEPLOYED=false`.
- For changes to existing SQL, document why an immutable append-only migration was not used, and block any production rollout pending manual review.
