# SQL-Migrationsregister und Freigabegrenzen – 25.10.2026

**Registerstand:** Statische Bestandsaufnahme ab Main `f2a523cc`, [Issue #177](https://github.com/mason82-dotcom/SkyHub-Next/issues/177). **Betriebsnachtrag 25.10.2026:** Auf `rpi5` wurden ausschließlich die drei `pilot-media`-Migrationen 003/004/005 nach Dump-/Restore-Probe manuell angewandt. Das Register selbst führt weiterhin keine Migration aus und erfasst keinen produktiven Ausführungsstand.

## Verbindlicher Mechanismus

- [`backend/db/migration-inventory.json`](../backend/db/migration-inventory.json) erfasst **jede** `.sql`-Datei direkt oder indirekt im Verzeichnis `backend/db/migrations/`.
- `auto_apply:false` ist vorgeschrieben. Aktuell enthält das Register **keine** deploybare Kategorie. `offline_only` heißt ausschließlich, dass die Datei für isolierte Tests zur Verfügung steht; `blocked_draft` blockiert ausdrücklich die WPML-SQL-Skizze.
- [`scripts/audit_sql_migrations.py`](../scripts/audit_sql_migrations.py) prüft Lesbarkeit, vollständige Inventur, eindeutige IDs, Versionen **innerhalb** einer Fachfamilie, Abhängigkeitsordnung, unbekannte Dateien und die Draft-Sperre. Weder eine Datenbankverbindung noch SQL-Ausführung oder Dateischreibzugriffe gehören zum Prüfer.
- Die CI führt diesen statischen Prüfer und dessen negativen Regressionstests aus. Der Python-Check ist **kein** Ersatz für isolierte PostGIS-Tests oder späteren Backup-/Restore-Nachweis.

## Bestandsaufnahme

| Familie | Kennung | SQL-Datei | Zulässige Verwendung |
| --- | --- | --- | --- |
| `map-elements` | `map-elements-001` | `001_dji_map_elements.sql` | Isolierter DJI-Karten-GET-/Schema-Test; noch keine Live-Migration |
| `map-elements` | `map-contract-002` | `002_dji_map_mutation_contract.sql` | Isolierter Schreibvertragsentwurf, nach `map-elements-001`; **kein aktivierter Schreibpfad** |
| `pilot-media` | `pilot-media-verified-003` | `003_dji_pilot_media_verified.sql` | Pilot-Medienregistrierung; auf `rpi5` am 25.10.2026 als Voraussetzung der lesenden Bibliothek manuell migriert, Uploadpfad weiterhin nicht gemountet |
| `wpml-draft` | `wpml-library-draft-003` | `003_wpml_route_library_draft.sql` | **Gesperrt**; Rollen, Workspace-RLS und produktiver Migrationsplan fehlen |
| `wpml-draft` | `wpml-audit-draft-004` | `004_wpml_route_audit_draft.sql` | **Gesperrt**; unveränderliches WPML-Audit, nur isolierte Tests und abhängig vom WPML-Entwurf `003` |
| `pilot-media` | `pilot-media-http-004` | `004_dji_pilot_media_http.sql` | Medien-HTTP-Schema/Audit nach `pilot-media-verified-003`; auf `rpi5` manuell migriert, schreibende Callback-Routen weiterhin nicht gemountet |
| `pilot-media` | `pilot-media-library-005` | `005_dji_pilot_media_library.sql` | Lesende Medienbibliothek und unveränderliches Leseaudit nach `pilot-media-http-004`; auf `rpi5` am 25.10.2026 nach Dump-/Restore-Probe gemeinsam mit 003/004 produktiv angewandt. Keine automatische Migration auf anderen Installationen |

Die doppelt vergebenen Dateinummern `003` und `004` sind **keine globale Migrationsreihenfolge**: `pilot-media` und `wpml-draft` sind verschiedene Fachfamilien. Die bestehenden Dateinamen bleiben absichtlich unverändert, damit Git-Historie, Runbooks und bestehende Integrationstests nicht gebrochen werden. **Wichtig:** Ein zukünftiger generischer SQL-Runner, der nach numerischen Dateipräfixen sortiert, bleibt ausdrücklich **verboten**, auch wenn das Register die beiden Einträge unterscheidet.

`backend/db/schema.sql` ist die bestehende **separate Bootstrap-Datei** des PostGIS-Containers und gehört nicht zu diesen sieben nicht automatisch angewandten Fachmigrationen. Die SQL-Dateien unter `backend/db/offline/` gehören ebenfalls zu eigenständigen Offline-Verträgen und werden nicht vom Register freigegeben.

## Verbindliche Freigabeprüfung für weitere SQL-Rollouts

1. Eine neue Versionierung mit **global eindeutigen, unveränderlichen Migrations-IDs** und explizitem ausgeführtem Stand pro Datenbank erstellen. Die vorhandenen Nummern `001`–`005` dürfen nicht blind als global eindeutig interpretiert werden.
2. Für jede Migration Abhängigkeiten, verfügbare Tabellen, Datenbankrolle, Mandantentrennung, RLS/FORCE, Trigger, Schemaeigentum, Locking und Downgrade-/Restore-Szenario festhalten.
3. Isoliertes PostgreSQL-15/16-Verfahren mit bereits vorhandenem Schema, zweitem Lauf, Transaktionsrollback und echten SQL-Abnahmen durchführen. Bestehende erfolgreiche synthetische Tests allein belegen **keine** gefahrlose Produktivmigration.
4. Vor einem echten Raspberry-Pi-Eingriff den installierten Schema-/Image-Stand, Backup-Restore-Nachweis und separaten Freigabeprozess abschließen. Kein `docker compose down -v`, kein Auto-Apply, keine direkte SQL-Ausführung durch das Verzeichnisinventar.

## Reproduzierbare nur lesende Prüfungen

```bash
python3 scripts/audit_sql_migrations.py
python3 -m unittest discover -s tests -p 'test_sql_migration_inventory.py' -v
```

Diese Befehle prüfen ausschließlich Repository-Dateien beziehungsweise temporäre Testkopien. Die Tests nehmen keine Verbindung zum Raspberry Pi oder zu einer Datenbank auf.
