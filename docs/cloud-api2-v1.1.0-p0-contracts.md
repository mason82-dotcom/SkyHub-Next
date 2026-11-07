# DJI Cloud API 2 V1.1.0 – P0 Vertrags- und Capability-Baseline

Status: **statische Referenz / Offline-Vertrag**, 07.11.2026. **Keine neue Runtime, kein DJI-Key, kein Deployment und keine Freigabe von DJI-Flugfunktionen.**

## Reproduzierbare Versionen

| Quelle | Festgehaltener Stand |
| --- | --- |
| Offizielle DJI-Cloud-API-2-Plattform | V1.1.0, veröffentlicht am 05.11.2026 |
| DJI-Upstream-Commit | [`705c73f48a77bb5120b28d73436d73594d289359`](https://github.com/dji-sdk/Cloud-API-2/tree/705c73f48a77bb5120b28d73436d73594d289359) |
| Native SDK-Quellcodeversion | 3.4.0 (`sdk/VERSION` im DJI-Commit) |
| Gebündelte DevKit-Java-JAR | 3.3.7 (`devkit/libs/`) – **nicht** ungeprüft gleichwertig zu 3.4.0 |
| SkyHub-Next-Basis | `main` bei `a17b8b487ef27906c75badf713bef67dbe741087` |
| SkyHub-Katalog | `skyhub.dji.cloudapi2.contract-catalog.v1`, Katalog `1.0.0` |

Maschinenlesbare Quelle: [`backend/data/dji-cloud-api2-v1.1.0-p0.json`](../backend/data/dji-cloud-api2-v1.1.0-p0.json), inklusive commitgebundener Links auf DJI-Releasenotes, SDK-Architektur, Demo, MQTT-Bridge, Kompatibilitätsvergleich, Geräteanbindung und Frontend.

Die Hersteller-Demo ist **keine produktionsfertige Plattform**. DJI Cloud API 2 V1.1.0 ist **keine rückwärtskompatible Versionsnummer von Cloud API 1.20**. Quelle ist das [DJI-Repository](https://github.com/dji-sdk/Cloud-API-2/tree/705c73f48a77bb5120b28d73436d73594d289359).

## Architektur- und Implementierungsbefund

Der aktuelle SkyHub-Root-Stack verwendet Node.js/Express, MQTT, PostGIS und Redis. Die vorhandene API-2-Referenzoberfläche `/cloud-api2.html` nutzt **SkyHub-eigene GET-Projektionen** der Cloud-API-1.x-Registry, keinen DJI-API-2-SDK-Prozess:

- `backend/cloud-api2-portal.js`: anonyme, redigierte Gerätesnapshots und Capability-Flags
- `backend/cloud-api2-linkage.js`: Modellübereinstimmungen nur als Kandidaten, keine nachgewiesene Mission
- `backend/cloud-api2-evidence.js`: explizite, begrenzte Zählwertabfragen ohne identifizierende Details
- `backend/cloud-api2-hardware.js`: ausdrücklich angeforderte und begrenzte RC-Plus-2/M4T-Diagnose
- `frontend/public/cloud-api2-sdk.mjs`: Same-Origin-GET-Client mit fest definierter Ressourcenliste
- `frontend/public/cloud-api2-lab.mjs`: isolierter synthetischer Offline-Simulator

Die zentralen `/api/cloud-api2/*`-Router sind nach `app.use('/api',auth)` registriert. Nur `status`, `devices`, `capabilities` und `linkage` fallen in SkyHubs konfigurierte vertrauenswürdige Heimnetz-GET-Lesefreigabe. `evidence` und `hardware/rc-plus2-m4t` verlangen die normale View-Token-Authentifizierung. Der Browser fragt keinen Token selbst ab und dieser P0 fügt **keine** neue Live-Route oder LAN-Ausnahme hinzu.

## DJI-API-2-Vertrags- und Risiko-Matrix

| Fähigkeit | DJI SDK / Frontend | SkyHub vor P0 | Freigabe |
| --- | --- | --- | --- |
| Geräteinventar | `DeviceManageModule` | Cloud-1.x-Registry-Projektion | Lesend, kein API-2-Nachweis |
| Drohnen-OSD | `DroneOsdModule` | Vorhandene Cloud-1.x-Telemetrie | Lesend, frisch/nicht-fresh unterscheiden |
| Dock-OSD | `DockOsdModule` | Nur Herstellerreferenz | Keine API-2-Laufzeit |
| HMS | `HMSModule` | SkyHub-HMS-Beobachtungen | Keine neue Abonnement-/Firmwareaktion |
| Wayline-Bibliothek | `WaylineManageModule` | WPML/KMZ-Entwurf und Metadaten | Kein Missionsversand |
| Flight Task | `FlightTaskModule` | Referenz, keine API-2-Ausführung | Flight-Task-Execute gesperrt |
| Medien | `MediaServiceModule` | Eigener S3-/MinIO-Inventarnachweis | Kein Herkunftsnachweis durch Dateinamen |
| Terra-Rekonstruktion | `TerraBuildModule` | Separate eigene Thermal-/GIS-Pipeline | Kein DJI-Terra-Dienst |
| Kartenansicht | `MapView` | Eigene SkyHub-Karte | Keine DJI-Komponentenruntime |
| Video/SEI | `LiveModule` | Unabhängige lokale SkyHub-Funktionen | Kein API-2-SDK-Nachweis |
| MCP-KI-Tools | `devkit/mcp` | Nicht aktiviert | Kein Werkzeugzugriff auf Fluggeräte |
| Flugkontrolle | `FlightControlModule` | Deaktiviert | Kein DRC / keine Kontrollübernahme |

`vendorDocumented=true` ist **kein** Synonym für `api2RuntimeVerified=true`. Gerätefähigkeiten, SDK-Operationen und die Betriebsfreigabe sind getrennte Dimensionen. Der Katalog enthält 13 Einträge mit expliziter Quelle, Betriebsmodus und fehlender Freigabe.

## Geräte- und Controller-Verträge

| Produkt | Hersteller-Beleglage für API 2 V1.1.0 | SkyHub-Interpretation |
| --- | --- | --- |
| Mavic 3E / Mavic 3T | Mavic-3-Enterprise-Produktfamilie aufgeführt | Familiennennung, kein Firmware-/Controller-E2E-Beleg |
| Mavic 3T Advanced | Nicht einzeln in den geprüften Herstellerlisten belegt | Eigenes Profil, API-2-Unterstützung unbekannt |
| Mavic 3M | Nicht einzeln als Multispectral-Modell belegt | Eigene Modellfamilie; Cloud-1.x-Tests sind keine API-2-Zulassung |
| Matrice 4T | Im SDK-Einführungskapitel einzeln aufgeführt | API-2-Modellreferenz, keine konkrete Hardwareabnahme |
| RC Pro Enterprise / RC Plus 2 Enterprise | SDK bietet `RemoteController`-Abstraktion | Keine konkreten Pairing-/Firmwarefreigaben ableitbar |

**Kombinationen:** RC Pro Enterprise + Mavic 3M sowie RC Plus 2 Enterprise + Matrice 4T behalten aus bisherigen SkyHub-Tests lediglich die Klassifikation `previous-smoke-observation`. Weder eine neue API-2-SDK-Verbindung noch vollständige Hardwareabnahme, Flugfreigabe oder radiometrische Genauigkeit ist damit belegt.

## P0-Sicherheitsinvarianten

1. Das P0-Modul ist **rein lokal**: kein Netzwerkzugriff, kein HTTP-Handler, kein DJI-/MQTT-/S3-Client und keine Datenbank.
2. Sechs existierende Portalressourcen sind auf `GET` und Same-Origin beschränkt; `POST/PUT/PATCH/DELETE` sind nicht erlaubt.
3. Privilegierte Nachweisanfragen sind ausdrücklich manuell auszulösen; kein Polling und keine automatische Geräteaktion.
4. `hardwareVerified=false`, `flightReady=false`, `dispatchAllowed=false`, `accuracyVerified=false`, `validatedMissionExecution=false`.
5. `deviceMission`, `missionMedia`, `deviceMedia` bleiben `not-established`. Gleicher Gerätetyp, Zeitnähe, Dateiname, XMP oder STS-Upload reichen nicht.
6. Mock- und Labdaten bleiben `synthetic=true` und dürfen nicht als Live-Evidence erscheinen.
7. Keine Veränderungen an Pi, Docker, Broker, RC, Drohne, Gerätebindung, Firmware oder Produktionsdeployments.

## Automatisierte Offline-Abnahme

Aus Repository-Root, Node.js 22:

```bash
npm ci --prefix backend --ignore-scripts --no-audit --no-fund
node --check backend/cloud-api2-contracts.js
node --test backend/test/cloud-api2-p0-contracts.test.js
```

Der separate Workflow [`.github/workflows/cloud-api2-p0-contracts.yml`](../.github/workflows/cloud-api2-p0-contracts.yml) startet zusätzlich die bereits vorhandenen SkyHub-Portal-/Evidence-/Linkage-/Hardware-Unit-Tests. Er fordert keine DJI-Credentials an und startet keine Geräteverbindung, keinen Broker und kein Deployment. Die allgemeine CI testet zusätzlich alle Backend-Tests.

**Grenzen:** GitHub-CI-PASS belegt nur den versionierten, synthetisch geprüften Vertragszustand. Es ist keine aktuelle Pi-, MQTT-, SDK- oder Hardwareabnahme. Ein neues DJI-Release, eine geänderte Java-JAR, eine neue Geräte-Firmware oder ein erweitertes Schreibrecht erfordert eine neue Katalogversion und erneute Sicherheitsprüfung.

## Nächster Schritt (nicht Bestandteil von P0)

P1 darf aus diesem Katalog einen isolierten *read-only* SDK-Adapter ableiten, **nur** nachdem Schlüssel-/Lizenz-/Versionssituation und Host-Kompatibilität gesondert geklärt und eine hardwareunabhängige, fail-closed Testumgebung abgenommen wurden. DJI MCP-L1/L2/L3 und Flugkontrolle bleiben separat untersagt.
