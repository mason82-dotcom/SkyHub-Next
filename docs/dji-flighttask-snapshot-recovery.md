# DJI Cloud API 1.18 – Offline Flighttask Snapshot Recovery (P0/P1)

Stand: 2026-10-23 · **Nur isolierter Entwicklungsbranch, keine Pi-Installation und kein aktiver DJI-Steuerpfad.**

## Zweck und Abhängigkeiten

Die bestehende Pipeline trennt:
1. `services_reply`-Bestätigung einer `flighttask_execute`-Anfrage;
2. `flighttask_progress`-Statusereignis mit passender `flight_id`;
3. `reported_ok` als **lediglich berichteten** Erfolg.

Der neue Speicher ergänzt **durable, idempotente Wiederaufnahme** dieser
reinen Beobachtung. Basierend auf
[PR #74](https://github.com/mason82-dotcom/SkyHub/pull/74) und
[PR #78](https://github.com/mason82-dotcom/SkyHub/pull/78).
Kein anderer RPC-Branch wird unkontrolliert zusammengeführt.

## Schnittstelle

`backend/dji-flighttask-recovery-store.js`:
```js
const {randomBytes}=require('node:crypto');
const {beginFlighttaskObservation}=require('./backend/dji-flighttask-observation');
const {createOfflineFlighttaskRecoveryStore}=require('./backend/dji-flighttask-recovery-store');

// Nur Beispiel für einen isolierten TEST. Keine echten Gerätekennungen verwenden.
// Der Aufrufer muss das private, bereits existierende 0700-Testverzeichnis bereitstellen.
const key=randomBytes(32); // Im Ernstfall extern verwalteter, dauerhaft verfügbarer Schlüssel
const store=createOfflineFlighttaskRecoveryStore({directory:'/absolute/private/test-dir',key});
store.initialize(beginFlighttaskObservation({
  gatewaySn:'SYNTHETIC_GATEWAY',
  tid:'11111111-2222-4333-8444-555555555555',
  bid:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  flightId:'SYNTHETIC_MISSION',method:'flighttask_execute',
  sentAt:1792517991000
},{ttlMs:900000}));
const result=store.recover({now:1792518001000}); // KEINE neue DJI-Anfrage
console.log(result.summary); // Ohne SN, UUIDs, Positionsdaten oder Klartextpayload
```

Auf einer neuen **Prozessinstanz** kann derselbe Ordner nur mit demselben
externen 32-Byte-Schlüssel geöffnet werden. Ohne Schlüssel entsteht keine
Rekonstruktion und es erfolgt **kein** Fallback auf unverschlüsselte Daten.

Methoden: `initialize`, `inspect`, `recover`,
`observeServiceReply`, `observeProgressEvent`.
Die Observationsmethoden schreiben nur, wenn der bestehende
Korrelation-/Reducer-Vertrag den Übergang tatsächlich übernimmt.
Der Report enthält ausschließlich `revision`, `applied`, `reason`
und die redigierte `summary`. Im stabilen Datensatz stehen die
für die Korrelation nötigen Requestkennungen **nur verschlüsselt**.

## Dateien, Transaktionen und Schutz

- Ein Snapshot `flighttask-observation.enc.json`, Schema
  `skyhub-flighttask-recovery-v1`; **nur ein** Missionszustand pro
  Testverzeichnis, keine automatische Multi-Mission-Datenbank.
- AES-256-GCM, neuer 96-Bit-Nonce pro Commit, Authentifizierungstag,
  AAD an Versionsschema gebunden. Das **gesamte** State-Objekt
  inklusive IDs und Revisionsnummer liegt im authentifizierten Chiffrat.
- Explizit bereitgestelltes **absolutes**, selbst besessenes
  Verzeichnis mit Rechten `0700`; keine implizite Verzeichniserstellung.
  Snapshots/Locks/temporäre Dateien mit `0600`.
- Reproduzierbare Payload-Grenzen, strikte Schlüsselliste für
  State-Objekte und vollständige Strukturprüfung nach Entschlüsselung.
  Snapshots mit unbekanntem Schema oder manipuliertem Auth-Tag werden
  abgewiesen.
- Exklusives Prozesslock via `O_EXCL | O_NOFOLLOW`, zufällige
  temporäre Datei, `fsync`, atomisches `rename` und Directory-`fsync`.
  Überlappende Transaktionen werden nicht stillschweigend zusammengeführt.
- Ein **verwaistes Lock wird nicht automatisch entfernt**. Nach Crash
  ist kontrollierte Betreiberprüfung nötig, bevor das Lock gelöscht wird.
- Keine automatische Gerätekommunikation und **keine Retries von**
  `flighttask_execute`. Restarts führen ausschließlich
  `recover` / `clock` aus: abgelaufene unbestätigte Beobachtungen
  werden `expired_unverified`, nicht `failed`.
- Doppelte Service-Replies, doppelte Progress-Events oder falsche
  `gatewaySn`, `tid`, `bid`, `flight_id` und Methoden
  verursachen keine zusätzliche Revision.

## Testen

```sh
node --check backend/dji-flighttask-recovery-store.js
node --test backend/test/dji-flighttask-recovery-store.test.js
node --test backend/test/*.test.js
```

Die Tests legen mittels `mkdtemp` ausschließlich selbständige Verzeichnisse
im OS-Testtemporärpfad an und bereinigen sie am Ende. Es werden
ausschließlich fiktive Drohnen-/Missionskennungen benutzt.
Kein echte Fluggerät, kein MQTT und kein PostGIS-Bestand beteiligt.

## Grenzen – erforderlich vor jeder Integration

**Dieses Modul darf nicht ohne gesondertes Security-/Ops-Design als
Produktionsspeicher betrieben werden.**

- Nicht implementiert: externer Schlüsselmanager, Verschlüsselungsrotation,
  Lösch-/Backup-Konzept, Dateisystem-Namespace-Vertrauensgrenzen.
- Kein Schutz gegen vertrauenswürdige Prozesskompromittierung oder
  manipulierte **ältere, aber gültig signierte** Snapshots
  (Rollback benötigt eine externe monotone Revision).
- Ein Prozesslock verhindert lokale gleichzeitige Commits, ersetzt aber
  keine verteilte Fencing-/Leasing-Architektur und keine resilienten
  Zugriffskontrollen für mehrere SkyHub-Instanzen.
- Die verwendeten `fsync`-/`rename`-Eigenschaften setzen ein geeignetes
  lokales POSIX-Dateisystem voraus; keine NFS-/Cloud-Mount-Garantien.
- Es gibt noch keinen operator-verifizierten Neustart mit RC Plus 2 /
  Matrice 4T und keine geprüfte Flight-ID-Korrelation realer Firmware.
- Kein DJI `events_reply` bei `need_reply=1`. Eine spätere
  verbindliche ACK-Policy erfordert einen separaten, autorisierten
  und hardwarevalidierten Pfad.
- `operationVerified:false`, `hardwareVerified:false`,
  `flightReady:false` bleiben unverändert.

### Absichtliche Nichtänderungen

Kein Import in `backend/server.js`, keine Startup-Hooks, keine
Konfigurationsvariablen, keine Änderung an MQTT/EMQX, Docker Compose,
SkyHub-Datenbanken, Redis, Pi-Dateisystem, Credentials oder Flugkommandos.

## Nächste Integrationsgates

**P0:** Replay-/Rollback-Fencing und Zustandsinvarianten weiter härten,
Prozess-Crash während atomischer Writes simulieren, Operatorschnittstelle
zur manuellen Lock-/Key-Fehlerdiagnose ohne Rohdaten erstellen.

**P1:** Persistenz-Abstraktion für autorisierte produktive
PostGIS-/Redis-Backend-Transaktionen entwickeln; erst bei gesicherter
`workspace`-/Gatewaybindung, Key-Management und hardwarevalidierter
Korrelation die Integration in SkyHub prüfen.
