# Projektstand und Integrationsregister – 23.10.2026

> **Korrektur 24.10.2026:** [#24](https://github.com/mason82-dotcom/SkyHub-Next/pull/24) wurde am 23.10.2026 um 11:19 UTC als `aa459bf` nach `main` gemergt. Aussagen unten, die #24 als offen, „zu zerlegen“ oder als P2-Kandidat beschreiben, sind überholt und die geplante Zerlegung ist hinfällig. Die tabellarische Messung der übrigen offenen PRs gegen den heutigen `main` steht in der [PR-Triage vom 24.10.2026](pr-triage-2026-10-24.md). Der historische Text darunter wurde bewusst nicht rückwirkend umgeschrieben.

> **Historischer Stichtagsbericht:** Die nachfolgende ursprüngliche PR-Bestandsaufnahme beschreibt den 23.10.2026 vor der späteren Main-Konsolidierung. **WPML PR #57** wurde in den alten WPML-Entwicklungsbranch gemergt; der isolierte [Main-Integrations-PR #89](https://github.com/mason82-dotcom/SkyHub-Next/pull/89) ist inzwischen ebenfalls **gemergt**. Dies macht die WPML-Funktionen **nicht flugbereit**. Für den heutigen Code-/Laufzeitstatus siehe [WPML-Main-Integration](wpml-main-integration.md) und den aktuellen [README](../README.md). Die historischen Tabellen und Aussagen unterhalb dieses Hinweises wurden absichtlich nicht rückwirkend umgeschrieben.

> **Integrationsstand PR #24 (23.10.2026):** Die optionale, geschützte MinIO-Medien-Leseimplementierung ist nach Zusammenführung der historischen PR-Branch-Funktionen mit den aktuelleren DJI-/S3-Schutzprüfungen **im geprüften Integrationsbaum vorhanden**. Sie wird im Root-Compose weiterhin **nicht automatisch aktiviert**; es fehlen dort die expliziten S3-/Media-Environment-Zuordnungen. Die folgenden älteren PR-/Main-Tabellen sind datierte Ausgangsstände, **kein aktueller Gegenbeweis** dieser Integration. Separate Pilot-2-Medien-STS-/Upload-Bibliotheken, reale Kalibrierung und Pi-Hardwarebetrieb bleiben ungeprüft. Eine GitHub-CI ersetzt weder Sicherheitsfreigabe noch Deployment.

> **Integrationsnachtrag 23.10.2026 (nach dem unten datierten Basis-Audit):** Das kanonische Repository ist [mason82-dotcom/SkyHub-Next](https://github.com/mason82-dotcom/SkyHub-Next). Die PRs [#74](https://github.com/mason82-dotcom/SkyHub-Next/pull/74), [#78](https://github.com/mason82-dotcom/SkyHub-Next/pull/78) und [#83](https://github.com/mason82-dotcom/SkyHub-Next/pull/83) wurden nach grüner CI sequenziell in `main` übernommen (letzter Merge-Commit `ea39bbb9536c2e18cf5fae297604cdede137c393`). Sie ergänzen ausschließlich eine **offline lesende** Flugmissionszustandslogik, eine strenge `services_reply`-/Event-Korrelation und ein opt-in, **nicht produktiv migriertes** PostgreSQL-CAS-Journal. Der ältere Referenzstand `64e427…` im folgenden Dokument ist eine historische Momentaufnahme und zählt diese drei Module noch nicht auf. **Kein Flugcommand-Publisher, keine Pi-Bereitstellung, keine Hardwareabnahme.**

> **Aktualisiert:** 23.10.2026. **Verifizierte Main-Basis:** [`64e427c3d9488da80a391cd43d0308771f480955`](https://github.com/mason82-dotcom/SkyHub-Next/commit/64e427c3d9488da80a391cd43d0308771f480955), mit [#61](https://github.com/mason82-dotcom/SkyHub-Next/pull/61) (DJI-HTTP-Modellvalidierung), [#47](https://github.com/mason82-dotcom/SkyHub-Next/pull/47) (synthetischer Protokoll-Paritätsaudit) und [#66](https://github.com/mason82-dotcom/SkyHub-Next/pull/66) (isolierte RC-Pro/M3M- und RC-Plus-2/M4T-Diagnostik). Diese GitHub-Basis ist **keine Pi-Laufzeitabnahme**; gestapelte offene Feature-Branches bleiben getrennt.

## Statusbegriffe (verbindlich)

- **Main / integriert:** Datei oder Verhalten ist im obigen Main-Commit vorhanden. Das bestätigt weder Deployment noch Hardwarekompatibilität.
- **Im Entwicklungsbranch:** Code liegt in einem GitHub-Branch/PR, **nicht** im Main-Commit. Bei gestapelten PRs darf ein Merge nicht ohne Prüfung der gesamten Basiskette erfolgen.
- **Auf Integrationsbranch gemergt:** PR wurde in `develop/skyhub-integrated-readonly-20261022` übernommen, **nicht** nach `main`.
- **Offline-/CI-validiert:** Synthetische Tests oder isolierte CI können bestanden sein; das ersetzt weder reale DJI-Geräte noch die Überprüfung des Pi-Stacks.
- **Hardwarebeobachtung:** Zeitbezogener Mess-/Protokollbefund; niemals allgemeine Unterstützung für alle Firmwarestände.
- **Freigegeben:** Erst nach Sicherheitsreview, CI, migrationssicherer Abnahme und expliziter Hardware-/Betriebsfreigabe. Für neue Medien-/Analyse-/Flugfunktionen derzeit **nicht** gegeben.

## 1. Was tatsächlich in `main` enthalten ist

| Bereich | Implementierungsstand | Grenzen |
| --- | --- | --- |
| Backend | Node.js 22 in CI, Express 4, Socket.IO, MQTT 5, Redis 7, PostgreSQL/PostGIS; Root-Stack `skyhub-next` | Kein automatischer Pi-Cutover; keine zweite EMQX-Instanz im Root-Compose |
| DJI-Pilot-to-Cloud | Validierte passive `status`-, `osd`-, `state`-, `events`- und `services_reply`-Eingänge; Registry/Topologie; typisierte DJI-1.18-Feldkataloge und M3M-Overlay | Keine vollständige DJI-1.18-Protokollabnahme; fehlende Daten bleiben fehlend |
| Topologie | Optionaler `update_topo` → `status_reply`-Antwortkanal mit **separatem** MQTT-Publisher und ACL; Redis-Topologie-Cache | Standard `SKYHUB_TOPOLOGY_ACK_ENABLED=false`; keine Flugsteuerung |
| Live-Oberfläche | Statisches `frontend/public/index.html` mit Karten-, Geräte-, HMS- und OSD-Frischeanzeige; `pilot-login.html` für HTTPS-Pairing | **Kein** `command-center.html` in Main; UI benötigt für die Karte externe Leaflet-/OSM-Ressourcen |
| REST / Socket.IO | Health; geschützte Geräte, Topologie, Ereignisse, MQTT-/Feld-Diagnose und Telemetrie; historische Tracks; geschützter Pilot-Bootstrap und Pairing; `snapshot` / `device_update` / `device_event` | `POST /api/mission/create` antwortet **501**; keine live gemountete WPML-/Medien-/STS-/KI-API |
| PostGIS | Lesende Track-Historie und schema-gebundene Map-Element-Modelle; isolierte SQL- und Migrations-/Mutations-Tests | Neue Track-Punkte **aus** per `SKYHUB_TRACK_RECORDING_ENABLED=false`; interne Kartenmutationsengine **nicht** gemountet |
| MinIO | Optionales Compose-Profil `media` und persistentes Datenvolumen | In Main **kein** MinIO-Client, keine Medien-HTTP-Endpunkte, kein Pilot-2-Medienupload |
| M3M-Dateinamen-Inventur | [#68](https://github.com/mason82-dotcom/SkyHub-Next/pull/68) **in Main**: lokaler RGB/G/R/RE/NIR-Namenszähler und opt-in CLI; keine Bild-, Metadaten- oder S3-Abfrage | Nur Filename-Heuristik und synthetische Tests; `ndviReady=false`, `reflectanceReady=false`, keine reale Medien- oder Hardwarefreigabe |
| M3M-S3-Vertrag | [#73](https://github.com/mason82-dotcom/SkyHub-Next/pull/73) **in Main**: explizit prefixgebundene, injizierte `ListObjectsV2`-Schnittstelle und streng begrenzte M3M-Name-Aggregation, synthetische CI 3/3 | **Nicht gemountet, kein S3-SDK, keine Credentials und kein echter Bucket-Scan**; MinIO-IAM-/HTTP-/Pi-Abnahme offen |
| Python-Worker | Beispiel-/Demonstrationsdateien für Thermal, M3M und M3E | Keine validierte Radiometrie, Orthomosaikberechnung, Vegetationsindexpipeline oder operative Bildanalyse |

**Wichtige Konfigurationsfalle:** `.env.example` nennt `SKYHUB_DJI_MAP_ELEMENTS_ENABLED=false` und `backend/server.js` besitzt eine optional gemountete GET-Route. `docker-compose.yml` auf dieser Main-Basis reicht die Variable **nicht** an den Backend-Container weiter. Ein bloßes Ändern von `.env` aktiviert die Route daher im Root-Compose **nicht**. Keine produktive Freischaltung ohne eigene überprüfte Konfigurationsänderung, erforderliche Datenbankmigration und Autorisierungsprüfung.

**MQTT-Grenze:** Root-Compose erwartet einen **bereits betriebenen** Pi-Broker auf Host-Port **1884**; Backend-Host-Port ist standardmäßig **127.0.0.1:4001**. Weder Compose noch ein GitHub-PR ersetzen den Legacy-Dienst auf Port 4000 automatisch.

## 2. Entwicklung außerhalb von Main (GitHub-PR-Register)

Die Referenzen nennen **PR-Nummern**, nicht Produktreleases. Details/Tests/Lizenzen sind jeweils in PR und Branch-Dokumentation zu prüfen. Status bei Prüfung: `open`, soweit nicht ausdrücklich anders angegeben.

### 2.1 Integrationskette und UI

| PR | Stand | Inhalt / Abhängigkeit |
| --- | --- | --- |
| [#24](https://github.com/mason82-dotcom/SkyHub-Next/pull/24) | offen, **direkt auf Main** | Geschützte lesende MinIO-M3M-Inventur; keine Kalibrierung oder Upload-Pipeline |
| [#28](https://github.com/mason82-dotcom/SkyHub-Next/pull/28) | Draft, auf #24 | TSA/Proxy-Vertrauen und Reconnect-Korrekturen |
| [#29](https://github.com/mason82-dotcom/SkyHub-Next/pull/29) | Draft, auf #28 | `develop/skyhub-integrated-readonly-20261022`: WPML offline, MinIO-Abnahme, RC Plus 2/M4T-Diagnostik |
| [#30](https://github.com/mason82-dotcom/SkyHub-Next/pull/30) | Draft, auf Integrationsbranch | Opt-in-KMZ-Inspektion, **offline**, keine Missionsausführung |
| [#31](https://github.com/mason82-dotcom/SkyHub-Next/pull/31), [#32](https://github.com/mason82-dotcom/SkyHub-Next/pull/32), [#35](https://github.com/mason82-dotcom/SkyHub-Next/pull/35) | **in Integrationsbranch gemergt** | Command Center; Medienseiten-Härtung; isolierte Loopback-Staging-Vorschau. **Nicht in Main** |
| [#41](https://github.com/mason82-dotcom/SkyHub-Next/pull/41), [#42](https://github.com/mason82-dotcom/SkyHub-Next/pull/42) | Drafts, UI-Branch-Kette | Lesende MinIO-Objektansicht und vorläufige Pilot-2-Medienbibliothek, gestapelt auf Command-Center-Entwicklung |

**Integrationsreihenfolge:** Für #29 muss die Vorfahrenkette #24 → #28 → #29 überprüft werden. #30 und UI-PRs hängen von diesem Stand ab. In #31/#32/#35 „merged“ heißt **Merge in den Entwicklungszweig**, nicht automatisch Freigabe für den Raspberry Pi.

### 2.2 Pilot-2-Medien, STS, XMP und Multispektral

| PR | Stand / technische Aussage |
| --- | --- |
| [#68](https://github.com/mason82-dotcom/SkyHub-Next/pull/68) | **In Main**: die isolierte, nur lokale M3M-Dateinamen-Inventur aus #23; kein vollständiger Medien-/S3-Reader und keine Bildinhaltsprüfung |
| [#73](https://github.com/mason82-dotcom/SkyHub-Next/pull/73) | **In Main**: nur offline/injiziert nutzbarer S3-ListObjectsV2-Aggregator (kein Live-Client); Rest von #24 bleibt offen und reviewpflichtig |
| [#19](https://github.com/mason82-dotcom/SkyHub-Next/pull/19), [#23](https://github.com/mason82-dotcom/SkyHub-Next/pull/23), [#25](https://github.com/mason82-dotcom/SkyHub-Next/pull/25) | Offene, teilweise überlappende MinIO-/M3M-/Backup-Themen. Vor Integration Duplikate gegen #24 und #29 abgleichen |
| [#33](https://github.com/mason82-dotcom/SkyHub-Next/pull/33) | Geprüfter passiver `services_reply`-Vertrag im Entwicklungsbranch; nicht Main |
| [#34](https://github.com/mason82-dotcom/SkyHub-Next/pull/34) → [#36](https://github.com/mason82-dotcom/SkyHub-Next/pull/36) → [#37](https://github.com/mason82-dotcom/SkyHub-Next/pull/37) → [#38](https://github.com/mason82-dotcom/SkyHub-Next/pull/38) | Gestapelte **Drafts**: HTTPS-Pilot-STS-Vertrag, begrenzter MinIO-STS-Issuer, HEAD-geprüfte Registrierung und getrennte Pilot-2-HTTPS-Medien-API. Keine produktive Router-Montage/Deployment-Freigabe |
| [#39](https://github.com/mason82-dotcom/SkyHub-Next/pull/39) | Draft auf #38: workspacegebundene, auditierbare lesende Medienbibliothek; Dateinamen-Gruppierung ≠ radiometrischer Nachweis |
| [#40](https://github.com/mason82-dotcom/SkyHub-Next/pull/40) | Draft auf #39: eng begrenzte bedingte TIFF-/XMP-Range-Leseproben. XMP-Werte sind **nicht** durch Kalibrierung bestätigt; keine sichere allgemeine Bildparser-Sandbox |
| [#48](https://github.com/mason82-dotcom/SkyHub-Next/pull/48) | Draft auf #40: experimentelle **offline**-Rasterindizes (NDVI, NDRE, GNDVI, OSAVI) aus **bereits extern kalibrierten und exakt registrierten** Float-Reflexionsrastern; kein DN→Reflexion, keine freigegebene M3M-Produktionspipeline |
| [#51](https://github.com/mason82-dotcom/SkyHub-Next/pull/51) | Draft auf #48: streng begrenzter **offline**-TIFF-Pixel-/XMP-Capture-Audit an lokalen uint16-Bildern; nur aggregierte Zähler, keine echte M3M-Datei geprüft, keine Bandkalibrierung/Registrierung oder Indexbereitschaft |

**DJI-Mediendatenfluss:** Pilot 2 verwendet die **HTTPS-/STS- und S3-Speicherstrecke**, nicht die MQTT-OSD-Subscription als Dateiübertragungsweg. Kein Entwurf darf Filename-Zählungen, HEAD/ETag, TIFF/XMP-Hinweise oder synthetische Indextests als belegte Reflexionskalibrierung, Bandregistrierung oder realweltlich geprüfte NDVI-/NDRE-Karte ausgeben.

### 2.3 DJI-Geräte, WPML, externe Referenzen und KI

| PR | Stand / technische Aussage |
| --- | --- |
| [#66](https://github.com/mason82-dotcom/SkyHub-Next/pull/66) | **In Main gemergt:** aus #18/#21/#22/#27 selektiv portierte, rein lesende M3M-Gap-/State-/RC-Plus-2/M4T-Offline-Diagnose mit Unit-/Integrationstests und manuellem Pi-Leseprüfer. **Keine** echte RC-Plus-2/M4T-Hardwareabnahme oder neue DJI-Kommandos |
| [#16](https://github.com/mason82-dotcom/SkyHub-Next/pull/16), [#44](https://github.com/mason82-dotcom/SkyHub-Next/pull/44) | Gestapelte WPML-/KMZ-Offline-Tests und externe DJI-Referenzanalyse; kein produktives Wayline-Deployment |
| [#43](https://github.com/mason82-dotcom/SkyHub-Next/pull/43) | Draft auf #40: Opt-in-**RGB**-YOLO11-Worker für lokale Bilder und kontrollierte Modelle; kein Livestream, keine DJI-Cloud-API-Integration |
| [#45](https://github.com/mason82-dotcom/SkyHub-Next/pull/45) → [#49](https://github.com/mason82-dotcom/SkyHub-Next/pull/49) | Gestapelte Drafts auf #43: Offline-Thermal-Pixel→GPS-*Kandidaten* und lokale HMAC-Provenienz; ohne verifizierte Kamera-/Geländekalibrierung, Personenbestätigung oder SAR-Einsatzfreigabe |
| [#50](https://github.com/mason82-dotcom/SkyHub-Next/pull/50) → [#52](https://github.com/mason82-dotcom/SkyHub-Next/pull/52) | Drafts auf #49: manuell gepinntes M3T/M4T-Kalibrierungsprofil und zweifach HMAC-gebundene Offline-Quellmedien; nur begrenzte **JPEG/XMP-Feldpräsenz**, keine Metadatenwerte, DJI-Sensorherkunft, Gimbal-/AGL-Verifikation oder GPS-Eignung |
| [#46](https://github.com/mason82-dotcom/SkyHub-Next/pull/46) | Draft direkt auf Main: getrenntes HiveMind-Simulationslabor; **synthetische** Pilot- und Dock-MQTT-E2E-Läufe in isolierter GitHub-CI bestanden ([Runtime #39894401436](https://github.com/mason82-dotcom/SkyHub-Next/actions/runs/39894401436)); Dock-RPCs nur per Lab-Mock. Upstream SDK 1.16.1.3, daher **kein** Beweis für DJI Cloud API 1.18 oder echte DJI-Hardware |
| [#47](https://github.com/mason82-dotcom/SkyHub-Next/pull/47) | **In Main gemergt**: 16 synthetische, offline geprüfte Cloud-API-1.18-Status-/Service-Reply-Fälle gegen gepinnte SDK-Referenz; kein echter Geräte-/Dock-/Pilot-2-End-to-End-Test, keine MQTT-Publishes |

**Zusatz:** Die drei in Main gemergten Grundlagen [#15](https://github.com/mason82-dotcom/SkyHub-Next/pull/15) (DJI-Feldkatalog), [#17](https://github.com/mason82-dotcom/SkyHub-Next/pull/17) (RC Pro/M3M-Diagnose) und [#20](https://github.com/mason82-dotcom/SkyHub-Next/pull/20) (modellbezogene M3M-OSD-Erweiterung) sind von den oben genannten offenen Ergänzungen zu unterscheiden.

## 3. Behobene Main-Fehler und verbleibende Lücken

- **Behoben mit [PR #61](https://github.com/mason82-dotcom/SkyHub-Next/pull/61):** Die Modell-Diagnose `GET /api/diagnostics/dji-fields?model=0:77:2` akzeptiert nach Korrektur des regulären Ausdrucks gültige numerische IDs. Reale HTTP-Regressionsprüfungen für sechs bekannte Modelle, unbekannte/ungültige Kennungen und View-Token-/LAN-Grenzen bestanden. **Noch nicht durch ein produktives Pi-Deployment bestätigt.**
- **DJI-Kartengruppen-Flag:** `.env.example` nennt die Flag, Root-Compose reicht sie
  jedoch nicht durch; dies ist kein dokumentierter sofort aktivierbarer API-Schalter.
- **Gesamtintegration:** Offene gestapelte Medien-/Analyse-PRs haben teilweise
  eigene Backend-Router und Worker. **Existenz einer Datei in einem PR ist
  kein Nachweis einer Runtime-Montage oder einer erfolgreichen Hardwareabnahme.**

## 4. Hardware- und Testevidenz

- **20.–21.10.2026, RC Pro Enterprise + Mavic 3M:** MQTT-Topologie/OSD und modellbezogene Aircraft-Rootfelder wurden am echten Gerät beobachtet; Einzelheiten in [Hardwareabnahme](hardware-rc-pro-m3m.md). Die M3M-Overlay-Definitionen sind teilweise vorläufig. „Nicht beobachtet“ bedeutet nicht „Hardware defekt“; Kamerafunktionen und nicht passende Aircraft-Feldpfade dürfen nicht zusammengezählt werden.
- **RC Plus 2 + Matrice 4T:** die Offline-Hardwareprüfer und synthetischen Regressionen sind mit [#66](https://github.com/mason82-dotcom/SkyHub-Next/pull/66) nun in Main. **Eine reale DJI-Pilot-2-/RC-Plus-2-/M4T-Abnahme ist weiterhin offen**; die historischen Testvorbereitungen in [#18](https://github.com/mason82-dotcom/SkyHub-Next/pull/18) belegen keine Cloud-API-1.18-Gesamtkompatibilität.
- **GitHub Actions:** Die Main-Konfiguration definiert Node-/Python-Prüfungen sowie isolierte PostGIS-Integration und isolierten Dump-/Restore-Test. Grün gemeldete CI einzelner PR-Commits betrifft **genau diese Commits**; nach Änderungen ist der jeweilige neue Head erneut zu prüfen.
- **Standort / Zeit:** `telemetryFieldAt` und `telemetryFieldTimeVerified` sind nur Live-Snapshot-Metadaten; sie werden nicht in den Redis-Gerätecache kopiert. Ein gültiges Koordinatenpaar benötigt denselben OSD-Eingang; `(0,0)` begründet keinen gültigen Standort.
- **Flug-/Agrarfunktionen:** Keine Test-/CI-Meldung ist eine Fluggenehmigung, agronomische Diagnose, thermische Personenerkennung oder Kalibrierungszertifizierung.

## 5. Freigabegates und nächste sichere Integrationsschritte

1. **Baseline festhalten:** `git status`, `git rev-parse HEAD` und tatsächliche Pi-Container/Ports separat aufnehmen. Branch-Komponenten nicht als Main-Funktionen dokumentieren.
2. **Offene Ketten konsolidieren:** #24/#28/#29, danach nur benötigte UI-/WPML- und Pilot-Medien-Teilzweige. Doppelte MinIO-/M3M-Implementierungen in #19/#23/#25 vorab auflösen. Keine gestapelten PRs wahllos nach Main mergen.
3. **Vertrags- und Security-Abnahme:** Auth, HTTPS-Proxy-Vertrauen, Publisher-ACL, Workspace-/STS-Trennung, Token-/Audit-Redaktion, S3-Get-only/Put-Grenzen, No-write-Flugschutz und rückwärtskompatible Migrationen prüfen.
4. **CI pro finalem Integrationscommit:** Node-Tests, Python-Tests, PostgreSQL-Migration/Restore und nur isolierte MinIO-/Simulator-Labs; reproduzierbare Ergebnisse auf GitHub verlinken.
5. **Separate Pi-Abnahme:** Sicherung, Preflight, expliziter Rollbackpfad, nur freigegebenes Backend-Update; **kein** Docker-`down -v`, kein unkontrollierter Legacy-Stack-Start, kein reales MinIO-Restore als Test.
6. **M3M-Messwertgüte vor Smart Farming:** reale vollständige 5-Band-Aufnahmen, Herkunft/Metadaten, DN→Reflexion, Kalibrierung, Bandregistrierung, Maskierung, geographischer Bezug, Referenzflächen, QA und nachvollziehbarer Export. Erst danach operationelle NDVI-/NDRE-Karten oder Agronomie-Funktionen erwägen.
7. **Thermal / YOLO / WPML:** Lizenzen, Modellherkunft, reale Kamera- und Gimbalmetadaten, Ground-Truth, sichere Offline-Prozesse und getrennte DJI-1.18-End-to-End-Abnahmen vor Live-Integration.

## 6. Nachtrag zur Konsolidierung (23.10.2026)

Seit dieser ersten Momentaufnahme sind weitere offene Drafts hinzugekommen:
[#54](https://github.com/mason82-dotcom/SkyHub-Next/pull/54) (offline MP4/MOV-/SRT-Zeitstrukturen),
[#55](https://github.com/mason82-dotcom/SkyHub-Next/pull/55) (extern vorbereitetes DEDAL/ODM-Orthomosaik-Handoff)
und [#56](https://github.com/mason82-dotcom/SkyHub-Next/pull/56) (relative MP4-Sample-DTS/PTS).
Außerdem: [#57](https://github.com/mason82-dotcom/SkyHub-Next/pull/57)
(Motecshine-Waylines-Editorreferenz auf #16),
[#58](https://github.com/mason82-dotcom/SkyHub-Next/pull/58)
(eigenständiger, nicht mit CoT-Backend verbundener TAK-Zweittab auf Main)
und [#59](https://github.com/mason82-dotcom/SkyHub-Next/pull/59)
(auf #55 gestapelter DEDAL-Datei-/Kalibrierungs-Preflight ohne Ausführung).
Alle bleiben reviewpflichtige, nicht freigegebene Entwicklungsarbeiten.

**Keines** ist in Main oder auf dem Pi integriert; die Versuche beweisen keine
reale DJI-Video-/UTC-Synchronisation, Reflexionskalibrierung oder operative
Karten-/SAR-Bereitschaft.

Die vollständige **Merge-Reihenfolge, Basiskette und Review-Gates** stehen im
[priorisierten Integrationsplan](integration-priorities-2026-10-23.md).
Insbesondere ist der sehr umfangreiche [#24](https://github.com/mason82-dotcom/SkyHub-Next/pull/24)
kein sicherer pauschaler Merge-Kandidat.

## 7. Nützliche Dokumente und verbindliche Trennlinien

- [README](../README.md) – Startpunkt und Root-/Legacy-Grenze
- [Architektur](architecture.md) und [Sicherheitsmodell](security.md) – **nur Main** als Runtime-Vertrag
- [Konfigurationsreferenz](config-reference.md) und [API-Vertrag](api-reference.md) – Env-/Compose-Weitergabe, Endpunkt-/Token-/LAN-Grenzen
- [Betrieb](ops.md), [Skriptwirkungen](scripts.md), [Legacy-Takeover](skyhub-legacy-takeover.md) – keine stillen Änderungen am Pi
- [DJI-Feldprüfung](dji-118-field-audit.md), [Hardware RC Pro/M3M](hardware-rc-pro-m3m.md), [DJI-Kompatibilität](dji-cloud-api-compatibility.md)
- [Historischer Entwicklungsplan vom 20.10.2026](entwicklungsplan-2026-10-20.md) – **historischer Ausgangspunkt**, keine Live-Roadmap für alle offenen PRs

**Aktualisierungsregel:** Bei Merge nach Main diese Übersicht anhand eines **neuen Main-SHA** und des tatsächlichen Dateibaums neu bewerten. Ein GitHub-PR-Merge ändert weder automatisch laufende Container noch die Pi-Hardwareabnahme.