# P1 – Persistente HMS-Ereignischronik (Opt-in, unabhängig)

Quelle: AeroNexusAdvanced `hms_history.py`. Hier eigenständige PostgreSQL-Implementierung, keine Kopie der SQLite-Datenbank.

## Sicherheit
- Standardmäßig deaktiviert. `SKYHUB_HMS_HISTORY_ENABLED=false`.
- Nur validierte, akzeptierte, nicht-retained DJI-HMS-Listen aus `mqtt-ingest`, **nach** Registry-Replay-Schutz.
- Sequentielle Writes und Postgres-Advisory-Transaktionssperre; bei DB-Fehler bleibt MQTT unverändert.
- Keine Kamera-, GPS-, Raw-Payload-, Token- oder HMS-Freitextspeicherung.
- Maximal 3000 Übergänge, 20 aktive Alarme pro Snapshot, 64 wartende DB-Operationen.
- API `GET /api/diagnostics/hms-history?device=...&limit=50&offset=0`: View-Bearer **oder** (seit 02.11.2026) die tokenfreie, nur lesende LAN-Ansicht (`SKYHUB_LAN_VIEW_CIDR`, nur GET/HEAD). Begründung: Das Dashboard im Heimnetz zeigt aktive HMS-Meldungen und Geräteereignisse bereits ohne Token; der Verlauf enthält keine weiteren Datenarten (keine Position, kein Freitext, keine Rohdaten). Außerhalb des LAN bleibt `401`.
- Antwort: `{enabled:true,items,limit,offset,hasMore}`; jeder Eintrag zusätzlich mit `modelName` und `text` (`de`/`en`), die erst beim Lesen aus dem mitgelieferten DJI-HMS-Katalog ermittelt werden; gespeichert wird weiterhin kein Text. Deaktiviert: `503 {error:'HMS history disabled',enabled:false}`. `/api/health` meldet `hmsHistoryEnabled`.
- `timeVerified=false` bleibt sichtbar, wenn die DJI-Quellzeit nicht verifiziert wurde. Leerer Initialzustand produziert keinen künstlichen Alarm.

## Dashboard-Oberfläche

Im Dashboard (Seitenleiste, Block **„HMS-Verlauf“**, unter „Geräteereignisse“):
- lädt erst beim Aufklappen, 20 Einträge je Seite, „Ältere laden“, Filter nach Gerät;
- zeigt Stufe (Hinweis/Achtung/Warnung), Klartext, Gerät, HMS-Code, Übergang (**Neu**, **Stufe geändert**, **Behoben**) und Alter; nicht verifizierte Quellzeit als „Zeit ungeprüft“;
- aktualisiert sich bei geöffnetem Block, wenn live eine geänderte HMS-Liste eintrifft;
- ist der Verlauf auf dem Server aus, steht dort ein Hinweis auf `SKYHUB_HMS_HISTORY_ENABLED`.
Nur lesend: keine Quittierung, kein Befehl an Fluggerät oder RC. Code: `frontend/public/hms-history-panel.js`.

## Aktivierung / Rollback
1. Datenbank sichern und die Migration `backend/db/migrations/006_hms_transition_history.sql` **manuell** nach Review ausführen.
2. `SKYHUB_HMS_HISTORY_ENABLED=true` setzen, Backend kontrolliert neu erstellen; nur danach wird der Pfad aktiviert.
3. HTTP GET mit View-Bearer, Altalarme/Leerlisten/Severity-Wechsel und DB-Neustart prüfen.
4. Bei Fehler Feature-Flag zurück auf false. Migration ist additiv, Daten bleiben erhalten.

**Keine automatische Pi-Ausführung oder Produktivabnahme mit diesem PR.**

**Pi-Betriebsstand 02.11.2026:** Migration 006 nach `pg_dump` manuell in einer Transaktion eingespielt, `SKYHUB_HMS_HISTORY_ENABLED=true`, Backend über `scripts/pi-update-backend.sh` aktualisiert (`main` `1fa72d4`). Geprüft: `/api/health` meldet `hmsHistoryEnabled:true`, LAN-Abruf liefert `enabled:true` mit leerer Liste, ungültiges `limit` → `400`, Schreib-/Leserechte des Backend-Benutzers vorhanden, Dashboard-Block lädt ohne Seitenfehler. Eine echte HMS-Meldung von RC/Fluggerät wurde danach noch nicht beobachtet.
