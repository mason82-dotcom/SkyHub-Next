# Cloud API 2 V1.1.0 – P1: SkyHub-Read-only-Vertragsadapter

**Stand: 07.11.2026.** Ausgehend von `main` bei `ce8baf48f06701af0596b85dc75d813cf78ea2e7` (P0, PR #306 bereits gemergt). P1 wird separat als PR bereitgestellt und **nicht automatisch gemergt**.

## Funktionsumfang

Das Portal `/cloud-api2.html#contracts` bietet einen neuen Reiter **API-2-Vertragsprüfung**. Auf ausdrücklichen Klick erfolgt exakt ein vorhandener Aufruf:

```text
Browser (SkyHubReadOnlyContractAdapter)
    |
    +-- SkyHubDaaSClient.getCapabilities() -> GET /api/cloud-api2/capabilities
                                                   |
                                                   +-- bestehender /api Auth-Handler
                                                   +-- bestehende CloudApi2PortalRouter-Route
                                                   +-- statischer, P0-validierter Herstellerkatalog
```

Es werden **keine neuen API-Routen**, DJI-Accounts, SDK-Prozesse, Geräteabfragen, MQTT-Topics, Datenbankzugriffe oder Schreiboperationen eingeführt. Die vorhandene SkyHub-LAN-GET-Regel für `/cloud-api2/capabilities` bleibt bestehen und wird nicht erweitert. Außerhalb der berechtigten Umgebung liefert das Backend weiter die vorgesehene HTTP-401-Antwort.

### Implementierte Bausteine

| Datei | Zweck |
|---|---|
| `backend/cloud-api2-readonly-contract.js` | Prüft vor der Projektion den unveränderlichen P0-Vertragskatalog, exportiert nur öffentliche Felder |
| `backend/cloud-api2-portal.js` | Ergänzt **nur** die vorhandene `CAPABILITIES`-GET-Antwort um `contract`; keine neue Route |
| `frontend/public/cloud-api2-readonly-adapter.mjs` | Objektorientierter Same-Origin-GET-Adapter, prüft exakt die API-Antwort, verwirft unbekannte/freigeschaltete Felder |
| `frontend/public/cloud-api2.js` / `cloud-api2.html` | Manuelle Prüfung mit Fehlerzustand, versionsgebundener SDK- und Capability-Anzeige, 7 Geräteprofile |
| `backend/test/cloud-api2-p1-readonly.test.js` | Positive und negative Offline-Regressionen ohne Hardware |

Herstellerquelle: [DJI Cloud API 2 @ `705c73f`](https://github.com/dji-sdk/Cloud-API-2/tree/705c73f48a77bb5120b28d73436d73594d289359), Plattform V1.1.0. Die **SDK-Quellversion 3.4.0** und die **DevKit-JAR 3.3.7** bleiben ausdrücklich verschieden. P0-Vertrag: [Vertragskatalog](cloud-api2-v1.1.0-p0-contracts.md).

### Fail-closed-Sicherheitsmodell

- `readOnly=true`, `api2RuntimeVerified=false`, `hardwareVerified=false`, `flightReady=false`, `dispatchAllowed=false`, `accuracyVerified=false`, `validatedMissionExecution=false`.
- `deviceMission`, `missionMedia` und `deviceMedia` bleiben `not-established`.
- Mavic 3E, 3T, 3TA, 3M, Matrice 4T, RC Pro Enterprise und RC Plus 2 Enterprise bleiben **Referenzprofile**, keine Cloud-API-2-Hardwareabnahme.
- Flugkontrolle, Missionsdispatch und DJI MCP stehen stets auf `disabled`.
- Die Projektion enthält keine seriennummerngenauen Daten, Medien-Keys, Positionen, Firmwarewerte, Pairing-Codes oder Tokens.
- Browser akzeptiert nur exakte, vollständige Strukturen mit festem DJI-Commit und zwei getrennten SDK-Versionsangaben. Zusätzliche Felder, veränderte Berechtigungen, falsche Versionen, behauptete Hardwarefreigaben oder geänderte Controller-/Drohnenpaare lösen einen Fehler aus.
- Bei Netzwerkfehler, 401 oder Vertragsfehler: alte Ergebnisse werden unmittelbar verworfen, UI meldet **UNBEKANNT**. Kein automatisches Neuversuchen oder Fallback auf synthetische Werte.
- Display-Metadaten werden ausschließlich als `textContent` in DOM-Knoten eingebracht. Es werden keine herstellerseitigen Skripte nachgeladen.

**Abgrenzung:** Dieser Adapter ist kein natives DJI Cloud API 2 Java/JNI SDK und keine echte Cloud-API-2-Kommunikation. Er validiert die vorhandene SkyHub-Referenzschnittstelle gegen den P0-Katalog. Die Projektionsfähigkeit ist nicht gleichzusetzen mit Geräte- oder API-2-Runtime-Unterstützung.

## Offline-Verifikation

Mit Node.js 22 und unverändertem Repository:

```bash
npm ci --prefix backend --ignore-scripts --no-audit --no-fund
node --check backend/cloud-api2-readonly-contract.js
node --check frontend/public/cloud-api2-readonly-adapter.mjs
node --test backend/test/cloud-api2-p0-contracts.test.js backend/test/cloud-api2-p1-readonly.test.js
```

Der bestehende dedizierte Cloud-API-2-Actions-Workflow erhält den P1-Test; zusätzlich führt die allgemeine CI die Backend-Testdateien aus. **CI-PASS** ist ausdrücklich nur Offline-Codeabnahme, nicht Pi-Betriebs-/Hardwarezertifizierung.

## Offene technische Risiken / P2

1. **Kein echtes DJI-API-2-SDK:** Lizenz, unterstützte Host-Architektur, Versionsparität und herstellerspezifische Gerätekohorten sind gesondert nachzuweisen.
2. **Kein Geräte- zu Missionsausführungsbeleg:** Modellvergleich und lokale WPML-Speicher-IDs reichen nicht für echte Zuordnung.
3. **Keine radiometrische Messgenauigkeitsabnahme:** R-JPEG-/Thermal-SDK-Testresultate dürfen `accuracyVerified=false` nicht überschreiben.
4. **P2** sollte eigenständige, kryptografisch bindbare, anonyme Missions-/Medien-Provenienzbelege ergänzen, weiterhin nur lesend und mit klarer Workspace-Isolation.

Keine Änderung an Raspberry Pi, Broker, DJI-Geräten, Docker-Compose-Dateien, Umgebungsvariablen oder Produktivdeployment ist Bestandteil dieses PR.
