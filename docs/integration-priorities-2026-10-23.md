# Integrationsstrategie und Merge-Gates für SkyHub Next

> **Korrektur 24.10.2026:** [#24](https://github.com/mason82-dotcom/SkyHub-Next/pull/24) wurde am 23.10.2026 um 11:19 UTC als `aa459bf` nach `main` gemergt. Aussagen unten, die #24 als offen, „zu zerlegen“ oder als P2-Kandidat beschreiben, sind überholt und die geplante Zerlegung ist hinfällig. Die tabellarische Messung der übrigen offenen PRs gegen den heutigen `main` steht in der [PR-Triage vom 24.10.2026](pr-triage-2026-10-24.md). Der historische Text darunter wurde bewusst nicht rückwirkend umgeschrieben.

> **Fortschreibung zum PR-#24-Integrationskandidaten:** Der zuvor empfohlene Verzicht auf einen Direktmerge bezog sich auf den **unbereinigten** 96-Commit-Branch. Inzwischen wurde ein eigener Merge-Kandidat mit dem neueren `main` erstellt und der DJI-Feldkatalog samt Hardwaretests, S3-Cursorschutz, Auth- und Sicherheitsdokumentation konsolidiert. Ein Merge ist erst nach **erneut vollständig grüner CI des exakt geprüften Git-Trees und unveränderter Main-Basis** zulässig. Die ältere Prioritätstabelle ist als historische Risikoanalyse zu lesen; weder STS/Upload noch Pi-Deployment werden dadurch freigegeben.

**Repository-Abgleich:** 23.10.2026 (GitHub-Prüfung). **Codebasis (fortgeschrieben am 23.10.2026):** `main` @ `64e427c3d9488da80a391cd43d0308771f480955`. Die PR-Stände sind eine datierte Momentaufnahme, keine automatische Live-Synchronisierung. [Projektstatus](projektstand-2026-10-23.md) · [API-Vertrag](api-reference.md) · [Sicherheitsmodell](security.md).

## 1. Verbindliche Entscheidung

**Keine Massenmerges und kein automatisches Raspberry-Pi-Deployment.** Mehrere PRs basieren auf **anderen offenen PR-Branches**. Bei einem GitHub-Merge von gestapelten PRs kann die Basishistorie mehr Dateien enthalten als der einzelne PR-Diff. Die Basis muss vor jedem Merge anhand des exakten Commits und aller abhängigen PRs erneut kontrolliert werden.

Unterscheiden:

1. **Main integriert:** Änderungen wurden nach `main` gemergt, nicht notwendigerweise auf dem Pi bereitgestellt.
2. **Entwicklungs-PR, Base = main:** nur ein Kandidat für einen isolierten Review; noch keine Betriebsfreigabe.
3. **Gestapelter PR:** nur der eigene Diff ist als Featureabgrenzung aussagekräftig; der Parent-Branch kann umfangreichen ungemergten Code enthalten.
4. **In `develop/skyhub-integrated-readonly-20261022` gemergt:** Teil dieser **nicht nach Main gemergten** Integrationslinie.
5. **CI-/Simulator-Abnahme:** Beweis für *genau die geprüfte Revision und Prüfbedingungen*, nicht für echte DJI-1.18-Hardware, Kalibrierung, Sicherheit im Einsatz oder Flugfreigabe.

## 2. Priorisierte Reihenfolge

| Stufe | Kandidat | Quellstatus / Umfang | Aufnahmebedingung | Empfehlung |
| --- | --- | --- | --- | --- |
| **Erledigt** | [#61 – DJI-Feld-Diagnose-Regex](https://github.com/mason82-dotcom/SkyHub-Next/pull/61) | Aus altem [#26](https://github.com/mason82-dotcom/SkyHub-Next/pull/26) isoliert, inzwischen in Main gemergt | Alle sechs Modellkennungen, 400/404 und View-Token-/LAN-Negativtests über CI abgenommen | Kein Pi-Deployment; alter #26 darf **nicht** zusätzlich blind gemergt werden |
| **Erledigt** | [#47 – DJI 1.18 Offline-Protokollabgleich](https://github.com/mason82-dotcom/SkyHub-Next/pull/47) | Fünf isolierte Dateien in Main gemergt; 16 synthetische Fixtures | Pinned SDK-Referenz, kein Live-MQTT, CI erfolgreich | **Nur Offline-Regressionsnachweis**, keine echte DJI-1.18-Gerätezertifizierung |
| **Erledigt (Offline)** | [#66 – konsolidierte Hardwarediagnostik](https://github.com/mason82-dotcom/SkyHub-Next/pull/66) | Aus #18/#21/#22/#27 auf Main nach #61/#47/#63 **selektiv portiert**; 18-Datei-Diff, keine Änderung an `server.js`, HTTP-Tokenregeln oder Compose | [CI 3/3 grün](https://github.com/mason82-dotcom/SkyHub-Next/actions/runs/39899832234); M3M-Kamera-/State-Gaps und RC-Plus-2/M4T read-only Prüfer | **Noch kein** echter RC-Plus-2/M4T-Test; altes #27 darf nicht pauschal gemergt werden |
| **P1-Lab** | [#46 – HiveMind-Pilot/Dock/Wayline/HMS](https://github.com/mason82-dotcom/SkyHub-Next/pull/46) | Direkter Main-PR; eigenständiges Simulationslabor, separate CI und Compose | Isolationsnetz, private Wegwerf-Credentials, AGPL-Kompatibilität, keine produktiven Broker-/Volumes. Simulator basiert auf DJI-SDK **1.16.1.3** | Als **separate opt-in Laborreferenz**, nicht als Betriebsfeature |
| **Erledigt (Offline)** | [#68 – lokale M3M-Dateinamens-Inventur](https://github.com/mason82-dotcom/SkyHub-Next/pull/68) | Aus [#23](https://github.com/mason82-dotcom/SkyHub-Next/pull/23) ohne API/MinIO selektiv übernommen; zehn Node-Tests und [CI 3/3](https://github.com/mason82-dotcom/SkyHub-Next/actions/runs/39914481308) | Keine echte TIFF-/RGB-, XMP-, Kalibrierungs- oder S3-Abnahme; alle Reflexions-/NDVI-Freigaben `false` | **Auf Main, nicht automatisch auf Pi** |
| **Erledigt (Offline)** | [#73 – scoped S3-ListObjectsV2-Vertrag](https://github.com/mason82-dotcom/SkyHub-Next/pull/73) | Aus #24 nur rein injizierter, prefixgebundener List-Adapter + M3M-Name-Aggregation; [CI 3/3](https://github.com/mason82-dotcom/SkyHub-Next/actions/runs/39915922005) | **Kein AWS-SDK, kein realer MinIO-Zugriff, keine HTTP-Route, keine Credentials** | Auf Main als Offline-Vertrag; Live-Storage-Gates noch offen |
| **P2** | [#24 – MinIO/M3M-Funktionslinie](https://github.com/mason82-dotcom/SkyHub-Next/pull/24) | Direkter Main-PR, **über 100 geänderte Dateien**, darunter Backend, Auth, MQTT, Registry, Compose, Frontend und Medien | Nach Funktionsgrenzen zerlegen; authentifizierte read-only Medieninventur, S3-ACL/Prefix, bestehende Pi-Speicher-/Token-Verträge und Migrationen getrennt abnehmen | **Kein Direktmerge** |
| **P2** | [#28](https://github.com/mason82-dotcom/SkyHub-Next/pull/28) → [#29](https://github.com/mason82-dotcom/SkyHub-Next/pull/29) → [#30](https://github.com/mason82-dotcom/SkyHub-Next/pull/30) | TSA-Proxy/Replay → integrierte WPML-/Diagnostik-/MinIO-Tools → opt-in-KMZ-Inspektion | Vorfahren zuerst reviewen; unkontrollierte Schreibpfade, Trusted-Proxy-Vertrauen, WPML `flightReady=false` und Eingabelimits nachweisen | In isolierten Integrationsbranch konsolidieren |
| **P2-UI** | [#31](https://github.com/mason82-dotcom/SkyHub-Next/pull/31), [#32](https://github.com/mason82-dotcom/SkyHub-Next/pull/32), [#35](https://github.com/mason82-dotcom/SkyHub-Next/pull/35), danach [#41](https://github.com/mason82-dotcom/SkyHub-Next/pull/41) → [#42](https://github.com/mason82-dotcom/SkyHub-Next/pull/42) | #31/#32/#35 sind **nur im Integrationsbranch** gemergt; #41/#42 separate UI-Stack-Kette | Auth, Live-Frische, Token-Leaks, Karten-Zustand, MinIO-GET-only und fehlende Backend-Montage korrekt markieren | UI-Pfade ohne neue Backend-Rechte reviewen |
| **P3** | Pilot-2-Medien STS/Bibliothek ([#33–#40](https://github.com/mason82-dotcom/SkyHub-Next/pull/33)) | Gestapelte HTTPS, STS, PostgreSQL, HEAD- und TIFF-/XMP-Komponenten | Separate Identität, MinIO-Aktionen, Redis-Quoten, CSP/TLS, Audit, Datenbank-Backup/Restore und Medien-Parser-Sandbox; **kein** voreiliges Mounten | Nur nach erfolgreicher P2-Basis |
| **P3** | Smart Farming / Vision / Thermal | Gestapelte Offline-Experimente, teils auf Medien-Branch | Lizenz, reale Datenherkunft, DN→Reflexion, Bandregistrierung, Georeferenz, Ground-Truth, Kalibrierung und Privacy; keine operativen Bereitschaftsflags | Forschung/Labor getrennt von Main-Runtime |

### Quervergleiche vor dem Merge

- [#19](https://github.com/mason82-dotcom/SkyHub-Next/pull/19), [#23](https://github.com/mason82-dotcom/SkyHub-Next/pull/23), [#25](https://github.com/mason82-dotcom/SkyHub-Next/pull/25) und #24 enthalten überlappende MinIO-/Inventur-/Backup-Themen. **Nur eine konsolidierte Implementierung pro Verantwortung.**
- [#16](https://github.com/mason82-dotcom/SkyHub-Next/pull/16) (WPML) und [#44](https://github.com/mason82-dotcom/SkyHub-Next/pull/44) (Drittanbieter-Referenz) sind offline; keine Wayline-/Kameraaktionen live ausführen.
- [#21](https://github.com/mason82-dotcom/SkyHub-Next/pull/21), [#22](https://github.com/mason82-dotcom/SkyHub-Next/pull/22) und [#18](https://github.com/mason82-dotcom/SkyHub-Next/pull/18) dokumentieren spezifische Gerätebefunde oder Diagnoseprototypen; nicht unbesehen auf #27 addieren.
- [#1](https://github.com/mason82-dotcom/SkyHub-Next/pull/1) ist eine ältere, noch offene historische Entwicklungsbasis. Sie darf nicht als neuer Integrations-Root gelten.

## 3. Konkreter Abhängigkeitsgraph

```text
main (496a1f84…)
 ├─ #61  Regex + HTTP-Tests                     [MERGED]
 ├─ #47  Offline DJI 1.18 Paritätsaudit         [MERGED; nur synthetisch]
 ├─ #66  Hardwarediagnostik aus #18/#21/#22/#27 [MERGED; rein offline]
 ├─ #46  Isoliertes HiveMind-Labor              [eigenständig]
 └─ #24  Große MinIO/M3M/TSA-Basis              [ZERLEGEN, nicht direkt mergen]
      ├─ #28  TSA-Proxy-Schutz
      │    └─ #29  WPML + UI + Diagnostik       [develop-Integrationsbasis]
      │         ├─ #30  KMZ-Inspect-API         [Draft]
      │         └─ #31 + #32 + #35              [nur in develop gemergt]
      └─ #33  Passive service-reply Vertragsprüfung
           └─ #34  Pilot-Media-STS-Guard
                └─ #36  MinIO STS Issuer
                     └─ #37  verifizierte Registrierung
                          └─ #38  Pilot-Media HTTPS
                               └─ #39  verifizierte Lesebibliothek
                                    └─ #40  eng begrenzte S3-XMP-Probe
                                         ├─ #48  Offline Indexraster
                                         │    └─ #51  TIFF-Payload-Audit
                                         │         └─ #55  DEDAL/ODM-Ortho-Handoff
                                         │         └─ #59  DEDAL-ZIP-/M3M-Preflight (ohne Ausführung)
                                         └─ #43  RGB YOLO11
                                              └─ #45  Thermal Pixel→GPS
                                                   └─ #49  lokale HMAC-Provenienz
                                                        └─ #50  manuell gepinntes Kameraprofil
                                                             └─ #52  JPEG/XMP-Präsenzmarker
                                                                  └─ #54  MP4/MOV + SRT-Zeitstruktur
                                                                       └─ #56  relative MP4 DTS/PTS-Samples

Separate UI-Kette: feature/dashboard-next-ui → #41 → #42
Separater WPML-Referenzzweig: #16 → #44 sowie #16 → #57
Unabhängiges UI-Draft: main → #58 (TAK-/CoT-Platzhalter; keine Backend-Integration)
```

Der Graph bezeichnet **Branch-Bases**, nicht automatisch verschmelzbare Codeänderungen. #41 liegt auf `feature/dashboard-next-ui`, nicht schlicht auf `main`. Jede Kette kann weitere nicht dokumentierte Vorfahren enthalten; Git-Baum-/Merge-Base prüfen.

## 4. Neue Forschungs-PRs #54–#56 (23.10.2026)

| PR | Tatsächliche Aussage | Noch nicht nachgewiesen |
| --- | --- | --- |
| [#54](https://github.com/mason82-dotcom/SkyHub-Next/pull/54) | Eng begrenzte **offline** MP4/MOV-Zeitstruktur und separat gepinnte SRT-Cues, nach HMAC-/Capture-Prüfung | Kein GPS-/UTC-Abgleich, kein Video-Frame-Decoding, keine M4T/M3T-Sensorfreigabe |
| [#55](https://github.com/mason82-dotcom/SkyHub-Next/pull/55) | Experimente mit extern bereits erzeugten DEDAL/ODM-Fünfband-Orthomosaiken: DN-Skalierung in Float-Reflexion bei strenger Raster-/Maskenprüfung | **Keine** validierte DJI-DN→Reflexion-Kalibrierung; externes `accepted` nur manuelle Behauptung, kein Agronomie-/NDVI-Betriebsnachweis |
| [#56](https://github.com/mason82-dotcom/SkyHub-Next/pull/56) | Offline-Validierung relativer MP4-Decode-/Presentation-Zeitachsen (DTS/PTS), synthetische Prüfungen | Kein absoluter Frame-Zeitpunkt, kein DJI-OSD-/RTK-Abgleich und keine SAR-/Personen-Lokalisierungsfreigabe |

**Es existiert damit weiterhin kein belastbarer automatischer Datenweg von rohen DJI-M3M-/M4T-Medien über kalibrierte/registrierte Messwerte zu einsatzfähigen Karten oder Personenstandorten.**

## 5. Ergänzungen aus den PRs #57–#59

| PR | Base / technischer Umfang | Abnahmegrenze |
| --- | --- | --- |
| [#57 – Motecshine Waylines](https://github.com/mason82-dotcom/SkyHub-Next/pull/57) | **Gestapelt auf #16**, nicht auf Main. Lokaler JSON→WPML-Editorimport, keine DJI-API-Schreibrechte | Lizenz-/Go-Modulpfad prüfen; fremde RC-Loss-/SubEnum-Defaults **nicht** unbemerkt übernehmen; keine M3M-/Hardware-/Flugfreigabe |
| [#58 – TAK-/CoT-Zweittab](https://github.com/mason82-dotcom/SkyHub-Next/pull/58) | **Direkt auf Main**, reines Dashboard-UI mit ARIA-/Tastaturbedienung und fail-closed Platzhalter | UI-Tests, Fokus-/Karten-Rückwechsel, keine CoT-Netzwerk-/Backend-Rechte. Separat reviewbar ohne die gestapelte Medienkette |
| [#59 – DEDAL-Preflight](https://github.com/mason82-dotcom/SkyHub-Next/pull/59) | **Gestapelt auf #55**; rein lokaler ZIP-/TIFF-Dateinamen-/Panelzertifikats-Check mit SHA-256-Pinning, **keine** DEDAL-Ausführung | Kein echtes ZIP inspiziert, keine echte Kalibrierung, keine DJI-Fünfband-Orthomosaik-Verifikation; private Manifeste bleiben lokal |

## 6. Verbindliche Merge-Gates

| Gate | Nachweis für jeden Integrationskandidaten |
| --- | --- |
| **G0 – Provenienz** | PR-Head-SHA, Base-SHA, Branch-Base, Lizenz, ausschließlich bekannte/prüfbare Quellen; keine fremden Gewichte oder unklaren DJI-Binaries |
| **G1 – Diff-Scope** | Vollständige Dateiliste gegen *aktuelle* Main-Basis und gestapelte Base. Keine Nebenänderung an `.env`, Produktiv-Compose, Caddy/EMQX oder bestehenden Volumes |
| **G2 – Sicherheit** | Allowlist, Auth/Workspace, HTTPS, Broker ACL, keine Secrets/Koordinaten in Logs, klare No-write-/Offline-Grenze, keine untrusted Parsers im Backend ohne Sandbox |
| **G3 – CI** | Zielcommit mit grünem Node-/Python-/SQL-/Compose-Test, isolierte PostGIS-/MinIO-/Simulator-Abnahmen nach Bedarf; Tests für negative Fälle |
| **G4 – Datenmodell** | Migrationsplan für existierende PostGIS-Volumes, echte Sicherung + isolierter Restore; keine automatische destruktive Schemaänderung |
| **G5 – Hardware** | DJI-Gerätemodell + Pilot-Firmware + Cloud-API-Version + beobachtete Nachrichten/Medien-/GPS-Qualität, reproduzierbare zeitlich datierte Abnahme |
| **G6 – Betrieb** | Separater Pi-Preflight, planbarer Rollback, explizite Freigabe für Dienständerungen; GitHub-Merge **nicht** als Deployment ausgeben |
| **G7 – Dokumentation** | README, Architektur, API/Compose-Referenz, Funktions-/Modulstatus und PR-Abhängigkeiten auf neuen Main-SHA aktualisieren; historische Evidenz unverändert datieren |

## Integrationszwischenschritt: S3-Lesevertrag (23.10.2026)

Aus PR #24 wurde ein **isolierter, transportinjektierter S3-ListObjectsV2-Vertrag**
für M3M-Namensinventur vorbereitet. Er erzwingt separaten `allowedPrefix`,
Bucket `dji-cloud`, höchstens 101 Seiten/20.000 unmittelbare Objektnamen,
strikte Cursor-/Objektschlüsselregeln und zählt keine Medieninhalte.
Er montiert **keine** Media-API, installiert **keinen** S3-SDK-Client und
liest **keinen** realen Pi-/MinIO-Bucket. Details und Abnahmestufen in
[dem S3-Vertragsdokument](m3m-s3-read-contract.md).

Die nächsten Sicherheitsgates bleiben: eigener S3-List-Only-IAM-Account,
S3-Client mit geprüfter TLS-/Endpointbindung, isolierter MinIO-Live-Test,
authentifizierte HTTP-Rolle, Snapshot-/Stabilitätsnachweis und eigener
expliziter Pi-Deploy-Freigabe.

## 7. Nächste technisch kleine Arbeitspakete

1. **Erledigt – #61:** Modell-Diagnose-Regex isoliert behoben und real über HTTP-Tests abgesichert. Kein Pi-Update.
2. **Erledigt – #47:** synthetischen, strikt lokalen Paritätsaudit aufgenommen; keine Live-Geräteabnahme.
3. **Erledigt – #66:** Offline-Hardwarediagnostik und Geräte-/State-Feldlücken auf Main konsolidiert. Reale RC-Plus-2/M4T-Hardwareabnahme bleibt **separater, offener Betriebsschritt**.
4. **P2-Fortsetzung nach #68/#73 – echter, separater S3-LIST-Transport:** Der Dateinamenszähler und die prefixgebundene ListObjectsV2-Aggregation sind in Main, aber noch **ohne** Netzwerk-/SDK-Anbindung. Als Nächstes gepinnten read-only SDK-Client, TLS/Endpoint, eng begrenzte MinIO-ACL inkl. WRITE-Denial und isolierte S3-Tests unabhängig von der HTTP-API prüfen. #24 weiterhin nicht pauschal mergen.
5. **P3-Forschungszweige**: bestehende Offline-Experimente unverändert isoliert halten, bis Herkunfts-/Kalibrierungs-/Lizenz-/Privacy-Gates belegt sind.

**Stop-Bedingung:** Jede unerwartete Änderung an Pilot-Pairing, Caddy/EMQX-Rechten, Container-Ports, PostGIS-Schema, MinIO-Policies oder realen DJI-Missionspfaden stoppt die Konsolidierung bis zu einer gesonderten Betriebsfreigabe. Kein automatischer Merge von Draft-PRs und keine realen Flugbefehle zum Testen.
