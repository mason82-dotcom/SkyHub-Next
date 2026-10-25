# SkyHub-Next: Hardwareabnahmen und offene Live-Gates (24.10.2026)

**Geprüfte GitHub-Basis:** `543a05ca308071a850f43a153abf464c45e13738` · **Typ:** datierter Evidence-Index, **keine neue Pi-Messung**. GitHub-Commits, synthetische Tests, reale Messungen aus früheren Pi-Sitzungen und tatsächliche Bereitstellung sind getrennte Aussagen. Ein neuer Commit verschiebt nicht das Datum oder den Umfang früherer Messungen.

## Nachtrag 24.10.2026 (UTC 02:14–02:52): RC Pro Enterprise + Mavic 3M über den dedizierten Broker 1884

**Evidenz:** Lesende Checks (`pi-rc-pro-m3m-check.js`, `pi-mqtt-osd-check.js`, `pi-telemetry-fields-check.js`, `/api/health`) wurden in dieser Sitzung **selbst auf dem Pi ausgeführt**, mit eingeschaltetem Flugzeug am Boden. Es wurden weder Rohpayloads noch Seriennummern, Koordinaten oder Zugangsdaten gespeichert. Zeiten sind UTC, weil die Pi-Ortszeit in den Ausgaben uneinheitlich erscheint.

**Ausgangslage:** Die RC zeigte „MQTT verbunden (DJI): nein“, obwohl Seite, JSBridge, Lizenz und Thing-Modul geladen waren. Ursache: Der ausgelieferte Pilot-MQTT-Endpunkt zeigte auf Port 1884, wo seit dem Entfernen von EMQX nichts mehr lauschte (Backend und Pilot-URL passten nicht zum tatsächlichen Broker). Behoben durch den opt-in Broker [`mosquitto-dedicated`](pi-mosquitto-migration.md) (PR #118) und erneutes Öffnen der Pilot-2-Seite. Das Konto `pilot2` wird allen gekoppelten Fernsteuerungen übergeben; ein zusätzliches RC-Pro-Konto war nicht nötig.

- **Handshake:** Erstes `update_topo` der RC um 02:16:55, zweites mit Flugzeug als Subgerät um 02:18:49. Topologie-Antworten gesendet: **2, Fehler 0**.
- **`pi-rc-pro-m3m-check.js`:** **Exit 0, 8 von 8 Kriterien bestätigt** (MQTT/Abos, RC erkannt, M3M erkannt, Zuordnung, frisches RC-OSD, frisches M3M-OSD, State-Daten beider Geräte). OSD-Alter 2 s, State-Alter 30 s (RC) bzw. 27 s (M3M).
- **M3M-Erweiterungspfade:** **6 von 6** typisiert übernommen und frisch (`distance_limit_status` mit drei Unterfeldern, `rth_altitude`, `rc_lost_action`). Das ist eine Beobachtung dieser Firmware zum Zeitpunkt, **keine** Aussage über die eingestellten Werte oder über RTH-/RC-Loss-Wirkungen.
- **Feldabdeckung:** RC Pro 22 von 55 dokumentierten Pfaden beobachtet (15 frisch); M3M 75 von 150 (64 frisch). Nicht beobachtet heißt nicht „nicht unterstützt“.
- **Durchsatz (Backend-Zähler 02:51 UTC):** 3.022 Nachrichten akzeptiert, 0 abgelehnt; 2.013 OSD (RC 1.044 und Flugzeug 987 in rund 34 min, je **0,5 Hz** ohne Lücken), 29 State (27 angenommen, 2 Duplikate verworfen), 978 HMS-Events im Takt des Flugzeug-OSD, 2 Status.
- **RC Plus 2 / Matrice 4T:** in dieser Sitzung weiterhin **nicht verbunden** (kein frisches OSD, kein Geräte-Token). Das deckt sich mit den Einträgen darunter; der Live-Transport bleibt offen.

**Bekannter Nebeneffekt (behoben in PR #123, noch nicht gemergt):** `pi-mosquitto-dedicated.js verify` veröffentlichte `services_reply` für die Pseudo-Seriennummer `SKYHUBPROBE`; das Backend registrierte dafür ein Gerät. Das Geisterobjekt verschwindet mit dem Backend-Neustart, der Redis-Schlüssel läuft nach einer Stunde ab.

**Entscheidung:** **RC Pro Enterprise + Mavic 3M über den dedizierten Broker = BESTÄTIGT für diesen Zeitpunkt und diese Firmware** (lesend, am Boden). Kein Flugtest, keine Schreib- oder Steueraktion, keine Aussage zu anderen Firmwareständen.

## Nachtrag 24.10.2026, 19:12–19:14 MESZ: Laufzeitmodule bereit, RC-Plus-2/M4T-Smoke unvollständig

**Evidenz:** Vom Betreiber übermittelte, anonymisierte Terminalausgabe des real laufenden Raspberry Pi 5. **Nicht selbst per SSH reproduziert.** Isoliertes Test-Worktree: `~/Projekte/SkyHub-RCPlus2-M4T-Test`, Checkout `57a8908`; produktive Compose-Laufzeit: `~/Projekte/SkyHub-Next`. Der Betreiber hat zuvor gezielt nur den Backend-Container neu erstellt und die alte Image-Version als Rückfalloption markiert; PostgreSQL und Redis meldeten sich weiter als healthy. **Image-Digest und vollständiger Laufzeit-Commit nicht gemessen.**

- `--runtime-check --json` um `2026-10-24T17:12:39.928Z`: `result=READY`, `evaluatorAvailable=true`, `evidenceAvailable=true`, **Exit 0**. Das vorher fehlende JSON-Evidence-Modul ist somit im *laufenden* Backend ladbar. Kein DJI-Gerätenachweis.
- `--preflight --json` um `2026-10-24T17:14:09.629Z`: **Exit 0**, `result=READY`; **8/8 true**: `healthApi`, `devicesApi`, `shapesApi`, `pairingsApi`, `mqttConnected`, `subscribed`, `topologyAckEnabled`, `topologyAckConnected`.
- `--json` (live-transport-smoke) um `2026-10-24T17:14:17.959Z`: **Exit 3**, `result=INCOMPLETE`, `transportPassed=false`. Allgemeiner MQTT-/ACK-Status true, aber **`linkedPairs=0`**. `rcPlus2Registered=false`, `rcPlus2RecentlyUsed=false`, `independentlyConfirmed=false`; Pairing-Übersicht selbst ist erreichbar.
- RC Plus 2: `seen=true`, `topologyOnline=true`, aber `osdFresh=false`, `osdAgeSeconds=null`, `staticFieldsObserved=0`, `staticFieldsFresh=0`. **Nicht als aktive RC-Sitzung interpretieren**: gespeicherte Topologie ist möglich.
- Matrice 4T: `seen=true`, `topologyOnline=false`, `aircraftConnected=false`, `osdFresh=false`, `osdAgeSeconds=null`, `staticFieldsObserved=0`, `dynamicGimbalTypesObserved=0`. Der Parser meldet 202 **vorläufig katalogisierte**, nicht 202 real beobachtete M4T-Felder; RC-Plus-2-Katalog 54, ebenfalls null beobachtet.
- Das JSON hat unverändert `hardwareAcceptanceComplete=false`, `flightReady=false`, `dispatchAllowed=false`. **Keine Flug-, Pairing-, Kamera- oder MQTT-Schreibaktion** ist aus diesen Belegen abzuleiten.

**Entscheidung:** **P0 Laufzeitmodule + Backend-Preflight = BESTÄTIGT. P0 RC Plus 2/M4T Live-Transport und separates SkyHub-Pairing = OFFEN.** Diese Messung beweist nicht, dass die Hardware beim Test eingeschaltet war, und belegt weder einen DJI-Fehler noch eine falsche MQTT-Konfiguration. Keine weitere Backend-Erstellung aus dem unvollständigen Smoke ableiten.

**Nächstes Gate:** Nur falls die echte RC Plus 2 und M4T vor Ort sicher am Boden eingeschaltet und über Pilot 2 mit der bestehenden SkyHub-Cloud-URL verbunden sind, Cloud-/SkyHub-Session und die getrennte Geräteautorisierung *vor Ort* kontrollieren; notwendiges Pairing ist ein gesonderter, ausdrücklich freizugebender Schreibvorgang. Danach den **gleichen lesenden** `--json`-Smoketest erneut ausführen und die OSD-Alter, `linkedPairs` und `pairing`-Booleschen prüfen. Ohne echte Hardware bleibt die Live-Abnahme offen, auch bei grüner GitHub-CI.

## Nachtrag 24.10.2026: tatsächlicher Raspberry-Pi-Backend-Preflight

**Evidenzquelle:** Vom Betreiber mitgeteilte Terminalausgabe eines **realen Raspberry Pi 5** am 24.10.2026, `2026-10-24T11:30:48.886Z` (**13:30:48 MESZ**). Diese Ausgabe wurde nicht selbst über SSH oder mit einem DJI-Gerät reproduziert. Prüfcode aus dem isolierten Worktree `~/Projekte/SkyHub-RCPlus2-M4T-Test`; laufender Compose-Stack im separaten `~/Projekte/SkyHub-Next`. **Laufender Container-Image-Commit weiterhin nicht separat bestätigt.**

- `node --test backend/test/rc-plus2-m4t-preflight.test.js backend/test/rc-plus2-m4t-evidence.test.js backend/test/rc-plus2-m4t-json-container.test.js`: **13 Tests, 13 bestanden, 0 fehlgeschlagen**. Diese drei Suiten sind synthetische Offline-Regressionen auf dem Pi.
- `SKYHUB_COMPOSE_DIR="$HOME/Projekte/SkyHub-Next" node scripts/pi-rc-plus2-m4t-check.js --preflight --json`: **Exit 0**, `result=READY`, **8/8 True** (`healthApi`, `devicesApi`, `shapesApi`, `pairingsApi`, `mqttConnected`, `subscribed`, `topologyAckEnabled`, `topologyAckConnected`). Die GET-Abfragen erfolgten gegen den **tatsächlich laufenden** Backend-Container.
- Die Ausgabe enthält keine Controller-Seriennummern, Tokens, Koordinaten oder Pilot-2-Pairing-Codes. `hardwareAcceptanceComplete=false`, `flightReady=false`, `dispatchAllowed=false`.

**Abnahmeentscheidung:** **P0 Pi-Backend-Voraussetzungen = BESTÄTIGT** zum angegebenen Zeitpunkt. **RC Plus 2 + Matrice 4T Live-Hardware-Transport-Smoketest = OFFEN**; keine bestätigte Modelltopologie, kein aktuelles Zielgeräte-OSD, keine unabhängige RC-Plus-2-Token-Verwendung und keine In-Container-Live-Evidence-Modulverfügbarkeit nachgewiesen. Dieser Nachtrag bestätigt weder ein DJI-Gerät noch eine Firmware oder den parallelen Controllerbetrieb.

**Nächstes Gate (read-only):** Vor dem Einschalten/Pairing zunächst im unveränderten **laufenden** Backend-Container prüfen, ob `./rc-plus2-m4t-hardware-validation` und `./rc-plus2-m4t-evidence` ladbar sind. Das vollständige, gerätebezogene `--json`-Smoketest-Protokoll darf bei fehlendem Modul kontrolliert scheitern; **kein automatischer Image-Rebuild oder Neustart**. Danach erst mit sicher am Boden stehender RC Plus 2/M4T die Live-Sitzung und den Parallelbetrieb getrennt prüfen.

## Nachweise und Grenzen

| Gerät/Funktion | Wirklich vorliegende Evidenz | Offen, nicht behaupten |
| --- | --- | --- |
| **RC Pro Enterprise (2:144:0) + Mavic 3M (0:77:2)** | Reale Pi-Sitzungen vom **21.10.2026** und eine direkt gelesene Sitzung am **24.10.2026** (dedizierter Broker 1884, 8/8, 6/6 M3M-Erweiterungspfade frisch; siehe Nachtrag oben): MQTT, Topologie, frisches OSD, 6/6 neue M3M-OSD-Erweiterungspfade typisiert angenommen. Letzter dokumentierter State-Nachtest: 29 empfangen / 24 akzeptiert, davon RC 13, M3M 11; fünf in dieser Messung nachvollziehbar als Duplikate verworfen. Feldgenau 7 RC- und 5 M3M-State-Pfade beobachtet; 27/27 lokale Tests | RTH-/RC-Loss-Wirkung, Sicherheits-/Flugsteuerbefehle, weitere Firmware, kontinuierliche State-Zustellung, vollständige 150-Feld-Abdeckung |
| **DJI-M3M-Dateien im vorhandenen MinIO** | **22.10.2026:** sechs unbekannt benannte TIFFs mit gültigen Header-/IFD-/XMP-Probes; anschließende gemeinsame begrenzte Untersuchung von **8 TIFFs** mit **8/8** XMP-Ergebnissen. Bandhinweise **Red=4, NIR=4, Green=0, RedEdge=0** aus einem ausgewählten Prefix. Anonyme Feldnamen u.a. `BandName`, `SensorGain`, `Irradiance`, `VignettingData` | Gleichheit einer Aufnahmegruppe via CaptureUUID, vier vollständige multispektrale Sets, echte Pixelintegrität, Sensor-/Capture-Provenienz, Reflektanzkalibrierung, NDVI/NDRE-Freigabe |
| **RC Plus 2 Enterprise (2:174:0) + Matrice 4T (0:99:1)** | Geräte- und Parallel-Pairing-Evaluatoren nach [PR #66](https://github.com/mason82-dotcom/SkyHub-Next/pull/66) in main. Synthetische Parser-, Reconnect-/Replay- und Privatsphäretests, einschließlich eindeutiger Zuordnung und Exitstatus. **54** RC-Plus-2-Feldpfade und **202 vorläufige generische M4T-Feldpfade plus 9 dynamische Gimbaltypen** als Testkatalog, **nicht** als echte M4T-Verfügbarkeit | **Kein dokumentierter Live-Hardwaretest.** Neue Controller-Kopplung, unabhängige RC-Tokens und Parallelbetrieb, aktuelle OSD-/State-Sitzung, M4T-Thermal-/Payload-Pfade, DJI-Pilot-2-/Firmwarekompatibilität |
| **WPML/Waylines** | Offline-KMZ-/Kamerakadenzprüfung, synthetische Browser-/Node-Regressionen | Echte Pilot-2-KMZ-Importprüfung mit Firmware, Kameraauslösung, Mission oder Flugfreigabe |

**Quellen:** [RC Pro / M3M Hardwarebericht](hardware-rc-pro-m3m.md), [M3M State-Detail](m3m-camera-gap-analysis.md), [M3M-MinIO-XMP-Livetests](smart-farming-m3m-s3-hardware-smoke.md), [RC Plus 2 / M4T Anleitung](hardware-rc-plus2-m4t.md), [DIAG-Synthetik](hardware-diagnostics-consolidation.md), [Pilot-2-KMZ-Vertrag](dji-pilot2-kmz-acceptance.md).

## Verlässliche nächste Abnahmereihenfolge

1. **P0 – M4T-/RC-Plus-2-Boden-Smoke**: regulär gestartete DJI-Hardware, vorhandene Pilot-2-Cloud-Sitzung, separate SkyHub-Pairing-Prüfung, aktuelles OSD beider Geräte und eindeutige Gateway-Kind-Topologie. Nur das lesende Diagnoseskript verwenden; kein Flug, keine Kameraaktion. `EXIT 0` bestätigt lediglich dessen enges Transport-/Parser-/Token-Gate, **keine vollständige Hardware-/Feldabnahme**.
2. **P0 – kontrollierter Parallelbetrieb**: RC Pro/M3M bleibt separat online; RC Plus 2/M4T verdrängt keine MQTT-Client-ID. Historische Topologie im Redis ist kein Ersatz für neue Live-Telemetrie. Broker-/Port-/ACL-Konfiguration nicht allein aus dem GitHub-`main` ableiten.
3. **P1 – M3M CaptureUUID-Gruppierung**: optionaler `--capture-groups-first-page`-Test nur nach ausdrücklicher Freigabe zum Lesen begrenzter XMP-Bytebereiche. Aggregierter UUID-Gleichheitsbefund ist noch **keine** Bandregistrierung oder Kalibrierung.
4. **P1/P2 – echter vollständiger M3M-Satz**: eigene Aufnahme mit vier G/R/RE/NIR-TIFFs, optionalem RGB, privater Referenz-/Panel-Dokumentation, unveränderten Original-Hashes und pixelbasierter unabhängiger QA. Synthetische Rasterio-Ergebnisse aus [PR #100](https://github.com/mason82-dotcom/SkyHub-Next/pull/100) und [PR #126](https://github.com/mason82-dotcom/SkyHub-Next/pull/126) dürfen keine realen Kalibrierungsflags setzen.

## Gefahrloser Einstieg für die RC-Plus-2-/M4T-Abnahme

Zuerst vor Ort im Raspberry-Pi-Terminal kontrollieren, ob das **existierende** Projekt und der laufende Backend-Container verfügbar sind. Die GitHub-Version ist nicht automatisch die Pi-Version. **Nicht** durch die Hardwareprüfung deployen oder Broker/Ports verändern.

~~~bash
cd ~/Projekte/SkyHub-Next || exit 1
git status --short --branch
git fetch origin
git worktree list
docker compose -p skyhub-next ps
~~~

Wenn das **Test-Worktree noch nicht existiert**, einen **zusätzlichen** Checkout des aktuellen Referenzcodes anlegen:

~~~bash
git worktree add --detach ~/Projekte/SkyHub-RCPlus2-M4T-Test origin/main
cd ~/Projekte/SkyHub-RCPlus2-M4T-Test || exit 1
node --test backend/test/rc-plus2-m4t-hardware-validation.test.js \
  backend/test/rc-plus2-parallel-pairing.test.js \
  backend/test/hardware-diagnostics-integration.test.js
node scripts/pi-rc-plus2-m4t-check.js --help
~~~

Falls der Worktree-Ordner bereits existiert: **nicht überschreiben**, zuerst dessen `git status` und `git worktree list` prüfen. `git fetch` und `git worktree add` ersetzen **nicht** den laufenden Pi-Backend-Container.

Wenn die RC Plus 2 und die M4T tatsächlich **am Boden eingeschaltet, in Pilot 2 verbunden und separat autorisiert** sind und die Pi-Backend-Version die vier GET-APIs unterstützt:

~~~bash
cd ~/Projekte/SkyHub-RCPlus2-M4T-Test || exit 1
SKYHUB_COMPOSE_DIR="$HOME/Projekte/SkyHub-Next" \
  node scripts/pi-rc-plus2-m4t-check.js
printf 'Exitstatus: %s\n' "$?"
~~~

Das Skript liest nur `/api/health`, `/api/devices`, `/api/diagnostics/mqtt-shapes`, `/api/pilot-admin/pairings` über den **bereits laufenden** Backend-Container. Es schreibt **nicht** in den Broker oder DJI. `0` = begrenzter Smoke bestanden, `3` = keine vollständige Evidenz, `1` = Docker/API nicht lesbar, `2` = Argumentfehler.

**Wichtig zur Kopplung:** `scripts/pi-pilot-pair.js <echter-code>` ist ein **separater, absichtlich schreibender Freigabeschritt**, kein Bestandteil der lesenden Prüfung. Seine Listenansicht kann private Codes oder Gerätekennungen zeigen: niemals deren rohe Ausgabe in öffentliche Issues/Chats kopieren. Keine neue DJI-Identität oder SkyHub-Kopplung erzwingen, wenn eine aktive, getrennte Kopplung schon besteht.

**MQTT-Drift:** Frühere Anleitungen nennen EMQX/1884; neuere Arbeiten Mosquitto/1883 beziehungsweise einen optionalen separaten Mosquitto-Pilot-Broker auf 1884 ([PR #118](https://github.com/mason82-dotcom/SkyHub-Next/pull/118)). Die tatsächlich aktive Pi-Konfiguration ist hier **nicht verifiziert**. Weder `docker compose up`, Broker-Restart, `.env`-Änderung, neues Pairing noch ACL-Eingriffe aus diesem Dokument ableiten.

## Bericht und Freigabeentscheidung

Nur **anonymisierte Status- und Zählerwerte** samt Testdatum, geprüfter Git-/Backend-Version, Gerätemodellen und Firmwareversions-*status* (nicht vertrauliche Kennungen) erfassen. **Keine** Seriennummern, GPS-Koordinaten, XMP-Originale, S3-Objektschlüssel, Tokens, Passwörter, Paarungscodes oder MQTT-Rohpakete teilen.

Die Evidenz bleibt `pilot2HardwareVerified:false`, `flightReady:false`, `dispatchAllowed:false`; M3M-Kalibrierung, operative Agronomie und Maschinenexport ebenfalls **nicht freigegeben**. Ein erfolgreiches GitHub-CI-Signal ist kein Live-DJI-Testergebnis.
