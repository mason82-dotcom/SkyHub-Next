# P1 – Persistente HMS-Ereignischronik (Opt-in, unabhängig)

Quelle: AeroNexusAdvanced `hms_history.py`. Hier eigenständige PostgreSQL-Implementierung, keine Kopie der SQLite-Datenbank.

## Sicherheit
- Standardmäßig deaktiviert. `SKYHUB_HMS_HISTORY_ENABLED=false`.
- Nur validierte, akzeptierte, nicht-retained DJI-HMS-Listen aus `mqtt-ingest`, **nach** Registry-Replay-Schutz.
- Sequentielle Writes und Postgres-Advisory-Transaktionssperre; bei DB-Fehler bleibt MQTT unverändert.
- Keine Kamera-, GPS-, Raw-Payload-, Token- oder HMS-Freitextspeicherung.
- Maximal 3000 Übergänge, 20 aktive Alarme pro Snapshot, 64 wartende DB-Operationen.
- API `GET /api/diagnostics/hms-history?device=...&limit=50&offset=0`: View-Bearer erforderlich; keine tokenfreie LAN-Allowlist.
- `timeVerified=false` bleibt sichtbar, wenn die DJI-Quellzeit nicht verifiziert wurde. Leerer Initialzustand produziert keinen künstlichen Alarm.

## Aktivierung / Rollback
1. Datenbank sichern und die Migration `backend/db/migrations/006_hms_transition_history.sql` **manuell** nach Review ausführen.
2. `SKYHUB_HMS_HISTORY_ENABLED=true` setzen, Backend kontrolliert neu erstellen; nur danach wird der Pfad aktiviert.
3. HTTP GET mit View-Bearer, Altalarme/Leerlisten/Severity-Wechsel und DB-Neustart prüfen.
4. Bei Fehler Feature-Flag zurück auf false. Migration ist additiv, Daten bleiben erhalten.

**Keine automatische Pi-Ausführung oder Produktivabnahme mit diesem PR.**
