# DJI Flight-Area-Synchronisationsmonitor – Offline-Entwicklungsstufe

**Stand:** 24.10.2026. **Konsolidierung:** Main-basierte Übernahme der rein lokalen, gestapelten Offline-Komponenten aus [#70](https://github.com/mason82-dotcom/SkyHub-Next/pull/70) und [#75](https://github.com/mason82-dotcom/SkyHub-Next/pull/75). Kein automatischer Pi-Rollout oder Flight-Area-Dispatch.
Das Modul ist rein lokal und wird von keinem Backend-Entry-Point importiert.

## Zweck und Architektur

`backend/dji-flight-area-sync-monitor.js` stellt
`createFlightAreaSyncMonitor({expectedGatewaySn,timeoutMs})` bereit.
Ein Monitor verwaltet **genau ein vertrauenswürdig gebundenes Gateway**.
Die Zielrevision (`configureTarget({revision,sha256,at})`) ist ein
**lokal konfigurierter Prüfauftrag**, kein abgesendeter DJI-Steuerbefehl.

`observe({topic,payload,packet,at})` verwendet ausschließlich den
bereits getesteten passiven Inspektor aus PR #70. Es löst
**keinen** MQTT-Publish, `flight_areas_update`, `flight_areas_get`,
`events_reply`, Job, Missionsupload, Socket.IO-Event oder API-Write aus.
Auch die bestehende `backend/server.js` bleibt unangetastet.

Die einzige Änderung am Inspektor ist das optionale vertrauenswürdige
`expectedFileChecksum`: Er gibt bei Synchronisationsmeldungen das zusätzliche
**Boolean** `reportedTargetChecksumMatch` zurück, niemals Rohhash,
Dateiname, Signatur-URL oder Inhalt. Ohne diese Option bleibt das bisherige
PR-#70-Ausgabeformat unverändert.

## Zustandsmodell

| Zustand | Aussage |
| --- | --- |
| `no_target` | Keine lokal konfigurierte Gebietsrevision |
| `target_configured` | Revision und SHA-256 als Sollwerte gesetzt; **kein** Nachweis eines übertragenen Befehls |
| `device_waiting` | Gerät meldet `wait_sync` |
| `device_syncing` | Gerät meldet `synchronizing` |
| `device_reported_target` | Gerät meldet `synchronized` und Reason 0 sowie **selbst gemeldeten** passenden Datei-SHA-256 |
| `device_reported_unmatched` | Gerät meldet `synchronized`, aber ohne passende gemeldete Dateiprüfsumme |
| `device_failed` | Gerät meldet Fehler oder einen Fehlercode ungleich 0 |
| `timed_out` | Fixes konfiguriertes Zeitfenster überschritten; spätere Events beleben die Revision nicht wieder |

**`device_reported_target` bedeutet NICHT verifizierte Synchronisation.**
Alle Snapshots setzen `revisionVerified=false`,
`syncVerified=false`, `flightReady=false` und
`hardwareVerified=false`. Eine verifizierte Soll-/Ist-Revision erfordert
später einen eigenen, unabhängig beglaubigten Backend-Nachweis
(z. B. hardwareseitiger Dateireadback oder nachweislich bestätigtes
Gerätemanifest mit eindeutiger Bindung an Gateway/Firmware/Revision),
der in diesem PR **bewusst nicht implementiert** ist.

## Fehler- und Sicherheitsregeln

- Nur in einem authentifizierten Workspace-Kontext bestimmtes Gateway
  zulässig; **kein** Benutzer- oder MQTT-Headerwert als Quelle für
  `expectedGatewaySn`. Dieser Baustein implementiert selbst **keine Auth**.
- Jede Revision ist eine positive sichere Ganzzahl, SHA-256 besteht aus
  64 Hexziffern. Derselbe Zielstand ist idempotent und startet **nicht**
  erneut; niedrigere Revisionen und gleicher Revisionswert mit
  anderem Hash werden abgelehnt.
- Quell-Zeitstempel müssen neuer als der Start der Zielrevision sein und
  danach streng steigen. Gleiche Zeitstempel sind Duplikate, ältere
  Ereignisse Replay/Out-of-order. Bei neuem Zielstand wird der
  bisherige Status vollständig zurückgesetzt.
- Standard-Timeout 300 Sekunden, einstellbar von 10 Sekunden bis
  60 Minuten. Der Ablauf hängt **nicht** von einem JS-Timer ab, sondern
  von explizit übergebenen Zeitpunkten. Ereignisse verlängern die Frist
  nicht. Zeitstempel-Freshness und MQTT-`retain` werden zusätzlich
  vom bestehenden `message-guard.js` und dem Inspektor geprüft.
- Terminale Geräteberichte (`synchronized`, `fail`,
  `switch_fail`) oder Timeout können nicht von einem späteren Paket
  derselben Revision überschrieben werden. Es braucht einen explizit
  **höheren** lokalen Zielstand.
- Keine Seriennummer, kein Rohhash, keine URL und kein Passwort gelangen
  über `snapshot()` oder `observe()` zum Aufrufer.
- `flight_areas_drone_location` ist für diesen spezifischen Monitor
  **keine** Synchronisationsmeldung und verändert daher nicht den Zustand.
- Das Modul hat **keine** persistierte History, Prozess-Neustart-Recovery,
  Deduplizierung via `bid`/`tid`, Device-Attestation oder
  Multi-Workspace-Verwaltung. Diese Punkte erfordern gesonderte Reviews.

## Prüfung

```sh
node --check backend/dji-flight-area-sync-monitor.js
node --check backend/dji-flight-area-events.js
node --test backend/test/dji-flight-area-events.test.js backend/test/dji-flight-area-sync-monitor.test.js
npm test --prefix backend
```

Die vorhandene CI umfasst alle `backend/test/*.test.js` ohne Geräte,
MQTT-Broker oder MinIO.

## Nächste kontrollierte Ausbaustufe

1. Verifizierbaren Geräte-/Dateibeleg mit unabhängiger attestierter
   Quelle spezifizieren und an streng autorisierte Workspace-Bindung koppeln.
2. Historisierung, gefilterte Diagnosemetriken und Neustart-Recovery
   mit getrenntem Datenbank- und Datenschutzreview planen.
3. Erst anschließend lesende API und UI-Statusanzeige; keine
   implizite Freischaltung von DJI-Flight-Area-Publish-Methoden.
4. Reale DJI-Dock-Firmware anhand Cloud API 1.18 und
   hardwaregebundener Prüffälle separat abnehmen.

Siehe auch [Basisvertrag](dji-flight-area-integration.md),
[Merge-Gates](integration-priorities-2026-10-23.md) und
[DJI Cloud API Kompatibilität](dji-cloud-api-compatibility.md).
