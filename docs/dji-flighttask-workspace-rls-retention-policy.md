# DJI Flighttask: Workspace-RLS und kontrollierte Aufbewahrung (Offline-Labor)

**Stand: 24.10.2026 · [SkyHub-Next](https://github.com/mason82-dotcom/SkyHub-Next)**

> Nur isolierte Entwicklung, synthetische Datensätze und Datenbanktests. Keine
> produktive Migration, kein Raspberry-Pi-Deployment, kein DJI-/MQTT-Publisher.

## Warum zwei Autorisierungsebenen?

Die vorhandene [Workspace-Hülle](dji-flighttask-journal-access.md) schützt
`start/read/apply/recover/summary` durch injizierte serverseitige
Berechtigungsentscheidungen. Der [Multi-Missions-Router](dji-flighttask-multimission-router.md)
bindet Kandidatensuche bereits an `workspace_id`. Das ersetzt keine
**Datenbank-RLS**: Eine falsch zusammengesetzte SQL-Abfrage oder eine
andere Backend-Komponente könnte ohne zusätzliche RLS trotzdem fremde
Workspace-Zeilen lesen.

**Offizielle Grundlage:**
- [PostgreSQL Row Security](https://www.postgresql.org/docs/17/ddl-rowsecurity.html):
  RLS ist zusätzlich zu gewöhnlichen Grants erforderlich; Eigentümer
  umgehen RLS ohne `FORCE ROW LEVEL SECURITY`, Superuser/`BYPASSRLS`
  bleiben privilegiert.
- [CREATE POLICY](https://www.postgresql.org/docs/current/sql-createpolicy.html):
  `USING` begrenzt zugängliche alte Zeilen, `WITH CHECK` überprüft
  `INSERT` und `UPDATE`. Fehlende erlaubende Policies = Default-Deny.
- [SET ROLE](https://www.postgresql.org/docs/current/sql-set-role.html):
  `SET LOCAL ROLE` ist auf die Transaktion beschränkt.
- [PostgreSQL SELECT: SKIP LOCKED](https://www.postgresql.org/docs/18/sql-select.html):
  begrenzte konkurrierende Batch-Verarbeitung, keine Garantie eines
  vollständigen Scans unter Sperrkonflikten.
- [DSGVO / Verordnung (EU) 2016/679, Art. 5, 17, 25, 32](https://eur-lex.europa.eu/eli/reg/2016/679/oj):
  Datenminimierung, Speicherbegrenzung, Löschung unter Voraussetzungen,
  Datenschutz durch Technikgestaltung und Informationssicherheit.

## Datenbank: isolierte RLS-Policy

`backend/db/offline/dji-flighttask-workspace-rls.sql` setzt auf dem
bestehenden **Test-Schema** `ENABLE ROW LEVEL SECURITY` plus
`FORCE ROW LEVEL SECURITY`. Zugriff wird per
`workspace_id::text = NULLIF(current_setting('skyhub.workspace_id',true),'')`
gefiltert. Die Workspace-Bedingung ist ausdrücklich **RESTRICTIVE** (`AND`) und wird mit einer erforderlichen permissiven Basisregel kombiniert: Eine künftig zusätzliche permissive Policy kann den Workspace-Filter nicht einfach per `OR` aufheben. Für veränderte bzw. neue Zeilen gelten sowohl `USING`
als auch `WITH CHECK`. Nicht gesetzter Workspace = keine sichtbaren
Zeilen; `INSERT`/fremde Änderungen scheitern.

**Wichtig:** Die freie PostgreSQL-Sessionvariable ist **kein Beleg für
Identität**. Clients, die selbst SQL oder `set_config` ausführen können,
dürfen diesen Mechanismus nicht direkt nutzen. Der SQL-Prototyp
vergibt *keine* produktiven Privilegien. Nur eine kontrollierte
Backend-Transaktion, die vorher den Benutzer-/Workspace-Bezug authentifiziert,
darf eine Workspace-Variable setzen.

`createFlighttaskWorkspaceTransactions(pool,{authorize,dbRole})`
verwendet eine einzige gebundene PostgreSQL-Connection mit
`BEGIN`, `SET LOCAL ROLE`, expliziter Prüfung auf
`rolsuper:false` und `rolbypassrls:false`,
`set_config(...,true)` und abschließend `COMMIT` oder `ROLLBACK`.
Die feste Datenbankrolle wird beim Konstruktor vorgegeben und ist kein
Nutzereingabefeld. Der Code ist absichtlich **nicht** am aktiven
Postgres-Pool, an einer Route oder an `backend/server.js` verdrahtet.

In der Testdatenbank wird eine **zufällige temporäre Nicht-Superuser-Rolle**
angelegt, mit Schema-`USAGE` und DML-`GRANT` auf **nur eine**
Test-Tabelle. Der Test prüft negative Zugriffe in einem fremden Workspace,
ungültige `INSERT`-/`UPDATE`-Operationen, fehlenden GUC-Kontext und
Scope-Reset nach der Transaktion. Tests als PostgreSQL-Superuser **ohne
gezielten Rollenwechsel** wären kein RLS-Nachweis.

## Aufbewahrung: Richtlinie statt Caller-Parameter

Die ältere, isolierte `createFlighttaskRetention`-Funktion akzeptiert
technisch `retentionDays` und `now` als Parameter. Das eignet sich
für Offline-Tests, aber **nicht als direkter produktiver Endpoint**:
Ein Aufrufer könnte damit die Frist verkürzen oder die Zeit nach vorne
setzen. Die neue Schicht
`createPolicyBoundFlighttaskRetention(db,{authorize,resolvePolicy,clock})`
zieht deshalb `retentionDays`, `maxBatch` und den Legal-Hold-Status
**ausschließlich aus einer vertrauenswürdig injizierten Policy**.
Die Uhr kommt nur von `clock()`, nicht aus dem Aufruf.

Jede Bereinigung fordert eine erneut autorisierte **Admin-Identität**
mit passendem Workspace und der Aktionsberechtigung `prune`. Die
Policy muss exakt `enabled:true`, `legalHold:false`,
eine gültige ganze Frist (1–3650 Tage) und eine Batchgröße (1–500)
enthalten. Jede fehlende Angabe, ein Hold, ein Rollenfehler oder eine
uneindeutige Policy sperrt die Ausführung. Ohne `execute:true`
erfolgt garantiert **keine** Löschung; die Rückgabe enthält
keine Datensatzanzahlsschätzung und ist **kein** Vorschau-Zähler.

Die unveränderte SQL-Bereinigung löscht ausschließlich **ältere terminale
Snapshots** dieses Workspace und begrenzt den Batch mit
`FOR UPDATE SKIP LOCKED`. Aktive und unbekannte Phasen bleiben bestehen.
Ein nach TTL abgelaufener, aber noch aktiver Snapshot wird nicht
automatisch zur Löschung umgedeutet. Erforderliche
`recover`-Zustandsübergänge erfolgen separat, nie durch diesen Worker.

**Keine allgemeingültige 30-Tage-Datenschutzregel:** Zweck, Rechtsgrundlage,
Dokumentationspflichten und Frist müssen der Verantwortliche bzw.
Datenschutzbeauftragte je Datenkategorie festlegen. Eine
`legalHold:true`-Policy sperrt derzeit den **gesamten Workspace**;
per-Mission-Holds sind noch nicht implementiert. Personenbezug kann
durch Gateway-SN/Flight-ID auch ohne Standortdaten entstehen.

## Tests

```sh
node --test backend/test/dji-flighttask-workspace-transaction.test.js
node --test backend/test/dji-flighttask-retention-policy.test.js
# Nur im dedizierten PostgreSQL-Testlabor (Loopback /skyhub_test):
node --test backend/test/dji-flighttask-workspace-rls.integration.test.js
```

Die GitHub-CI führt den Echttest nur mit
`SKYHUB_TEST_DATABASE_URL=postgresql://...@127.0.0.1:<CI_PORT>/skyhub_test`
aus. Der Test legt ein zufälliges Schema und eine kurzlebige Rolle an
und räumt beides wieder ab; keine produktive Migration und kein Pi-Update.

## Vor jeder produktiven Aktivierung zwingend

1. Produktive Benutzeridentität, Rollen-, Geräte- und Workspace-Grants
   aus einer **unabhängig geprüften** Identity-Quelle; nachweisbare
   serverseitige Autorisierungsentscheidungen, Widerruf und Audit.
2. Eigener `NOSUPERUSER NOBYPASSRLS`-DB-Login, geprüfte
   Nicht-Eigentümerschaft oder FORCE-RLS, minimale Grants und
   sichere Pool-Transaktionen; **keine** freien SQL-Endpoints, keine
   `SECURITY DEFINER`-Bypasses und kein `BYPASSRLS`.
3. Governance für Aufbewahrungsfristen, Legal Holds
   **pro betroffener Mission/Person**, Bereinigungsprotokoll,
   fehlgeschlagene Batches und echte kontrollierte Wiederholung.
4. Löschkonzept für WAL, Datenbank-Backups, Replikate, Dumps und
   Wiederherstellung; datenschutzrechtliche Prüfung inklusive
   Ausnahmen bei gesetzlichen Aufbewahrungspflichten.
5. Separater Migrations-/Rollback-Plan mit Indizes,
   beobachtbarer DB-Last sowie Labortest mit realistisch großen,
   vollständig anonymisierten Beständen.
6. Kein Live-DJI-Status, Missionsversand, Pilot-2-`events_reply` und
   **keine Flugfreigabe** durch diese Umsetzung.

Die Tests beweisen ein **Offline-Sicherheitsmuster**, keine
produktive DSGVO-Konformität, Pi-Bereitstellung oder Hardwarevalidierung.
