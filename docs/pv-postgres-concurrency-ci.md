# SkyHub-Next – echte PV-Jobverwaltung auf PostgreSQL 16 testen

Stand: 23.10.2026. **Experimenteller Entwicklungsbranch**, keine Aktivierung von Serverrouten,
keine produktive SQL-Migration, keine Änderung am Pi oder an DJI Cloud API.

## Nachweis

GitHub Actions: https://github.com/mason82-dotcom/SkyHub/actions/runs/39929079986

**15/15 echte PostgreSQL-16-Tests erfolgreich** (6 SQL-Vertragstests und
9 neue Tests, die den tatsächlichen `createPvJobStore`-Code aus
`backend/experimental/pv_job_store.cjs` über die PostgreSQL-Verbindung aufrufen).

Getestet wurden:

1. `FOR UPDATE SKIP LOCKED` bei parallelen Verbindungen und Worker-Claims.
2. Identische Aufträge mit demselben Idempotenzschlüssel; Replay-Audit.
3. Zurückweisung von Cross-Asset-Replays mit separatem Denial-Audit.
4. Workspace- und Asset-Fremdschlüssel.
5. Audit-Rollback – ein fehlgeschlagener Audit-Insert darf die Job-Transition
   nicht committen.
6. Heartbeat-/Finish-Race, Lease-Verlust und verspätete Claim-Tokens.
7. Konkurrierende manuelle Recovery mit exakt einem Ablauf-Audit.
8. Append-only-Schutz der Job- und Denial-Audits.

## Implementierte Dateien

- `backend/experimental/pv_job_store.cjs`: eigentliche zustandsbehaftete
  Jobverwaltung mit `request`, `claimNext`, `heartbeat`, `finish`,
  `expireStale` und `lookup`. Speicherung nur von IDs, Status und
  SHA-256; keine Fotos, Temperaturpixel, Tokens oder S3-Objektpfade.
- `backend/experimental/pv_jobs_isolated.sql`: manuell anzuwendendes
  **experimentelles** Schema, in der CI nur innerhalb des Wegwerf-Schemas.
  **Nicht** unter `backend/db/migrations` und **nicht** von SkyHub ausgeführt.
- `backend/test/pv-postgres-concurrency.integration.cjs`: expliziter
  Integrationstest (nicht im `backend/test/*.test.js`-Standardglob).
- `.github/workflows/pv-postgres-concurrency.yml`: branchgebundener
  PostgreSQL-16-CI-Job mit ausschließlich `contents:read`.

## CI-Isolation

Der CI-Job verwendet ausschließlich einen kurzlebigen `postgres:16-alpine`-
Service auf Loopback `127.0.0.1:55439`, Datenbank `skyhub_pv_ci` und den
nicht privilegierten Benutzer `pv_ci`. Das Skript verweigert den Start
ohne explizite GitHub-Actions- und Disposable-Freigabe. Vor DDL erfolgen
Rollen- und Datenbankidentitätsprüfungen und eine Prüfung auf bereits vorhandene
Benutzerschemas und Relationen. Das zufällige Testschema wird nach dem Lauf
wieder gelöscht. Der Workflow ist durch `on.push.paths` und den Branch-Namen
auf diese Entwicklungsarbeit begrenzt.

Datenbank-Vorsorgeprüfungen allein sind keine vollständige Sandbox; die
entscheidende Isolation stammt aus dem separaten CI-Container, der keine
produktiven SkyHub-Verbindungsdaten erhält.

## Noch NICHT freigegeben

Die erfolgreiche Datenbankprüfung validiert **nicht**:

- den gesamten `pv_job_runner.cjs`, Medien-Staging, Decoder-Prozess und
  `pv_claim_supervisor.cjs` aus den früheren lokalen Paketen;
- Pilot-2-/MinIO-End-to-End-Verarbeitung und die Datenbank-Migration gegen
  das echte SkyHub-Schema;
- die radiometrische Qualität von DJI M4T/M3T R-JPEG-Bildern;
- automatische Flüge, Schadensdiagnosen oder produktive Freischaltung.

Nächster Schritt: den Offline-Runner kontrolliert mit dieser geprüften
Jobverwaltung kombinieren und seine Prozess-/Lease-Abbruchpfade unter
isolierten Bedingungen testen. Vor Produktion sind weiterhin Review,
Autorisierungsprüfung, Datenbank-Migrationsplanung und echte DJI-Medien nötig.

**Draft-PR #81 bleibt bewusst ungemergt.**
