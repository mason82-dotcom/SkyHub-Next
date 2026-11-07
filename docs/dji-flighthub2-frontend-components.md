# DJI FlightHub 2 – Frontend-Komponenten als isolierte Referenz

**Stand: 23.10.2026 · Source of truth:** Offizielle DJI-Anleitung vom 16.10.2026, [Frontend Component Integration](https://fh.dji.com/user-manual/en/custom-development/frontend-components/component-introduction.html#tutorial), plus [DJI-Demorepository](https://github.com/dji-sdk/FlightHub-2-Frontend-Standalone-Component).

**Status: REFERENCE ONLY.** Auf SkyHub Next `main` und im hier vorgeschlagenen PR gibt es **keine** FlightHub-2-Runtime-Einbettung, keinen `paas.js`-Download, keinen Organisationstoken, keine Backend-Route, keinen Missionsversand und keine Flugsteuerung. Das Modul `frontend/public/fh2-reference-contract.js` ist reine, von Node und optional Browser lesbare Metadatenlogik. Es wird von keinem Dashboard geladen. Die Ergebnisse seiner Funktionen sind **keine Freigabe**.

## 1. Quellabgrenzung

- DJI dokumentiert die **Frontend Component Integration** für **FlightHub 2 On-Premises** und unterstützt HTML, React und Vue. `window.FH2` wird aus einer vom FlightHub-2-Server gelieferten `paas.js` bereitgestellt.
- Das Demo-GitHub-Repository [dji-sdk/FlightHub-2-Frontend-Standalone-Component](https://github.com/dji-sdk/FlightHub-2-Frontend-Standalone-Component) enthält HTML/CSS-Beispiele unter Apache-2.0. Diese Lizenz gilt **nicht automatisch für die proprietäre Runtime** von FlightHub 2 und ist keine Lizenzzusage für Installation/Distribution des Produkts.
- Alle Beispiele setzen einen betriebsbereiten On-Premises-Server, ein Projekt (`prjId`) und ein Organisationstoken (`projectToken`) voraus. `projectToken` wird von DJI als *organization key* unter FlightHub Sync beschrieben. Das ist keine SkyHub-View-Token-Alternative.
- **Hardware-/Produktgrenze (DJI-Herstellerangabe):** DJI listet die *Mavic 3 Enterprise Series* für FlightHub 2 On-Premises **ausdrücklich ohne DJI Mavic 3 Multispectral (M3M)**. Die *Matrice 4 Series* steht in der Kompatibilitätsliste; diese Familienangabe ersetzt keine Matrice-4T-Firmware-/Pilot-/Controller-Abnahme. Es handelt sich um die **FH2-On-Premises-Kompatibilität**, nicht um ein pauschales Urteil zur **DJI Cloud API 1.18** oder zu SkyHubs eigenem M3M-Workflow. Quelle: [DJI FlightHub 2 On-Premises Produktübersicht / Supported Devices, Fußnote 4](https://enterprise.dji.com/fh2-on-premises).
- Die On-Premises-Komponente ist von der **DJI Cloud API 1.18** und von SkyHubs eigener **WPML/KMZ-Dateiverarbeitung** zu unterscheiden. Kein direktes ID-, Berechtigungs- oder Routenkonvertierungsversprechen.

## 2. Dokumentiertes API-Inventar und Bedienrisiko

| SkyHub-Referenz | DJI-Aufruf | Zerstörung | DJI-Demo | Sicherheitsklasse |
| --- | --- | --- | --- | --- |
| routeCreation | `loadWaylineCreation(domId, props?)` | `destroyWaylineCreation()` | `demo/en/wayline-creaction.html` | Externes Speichern |
| routeEditor | `loadWayline(domId, {wayline_id})` | `destroyWayline(isEffect?)` | `demo/en/wayline.html` | Externes Speichern |
| projectMap | `loadProject(domId)` | `destroyProject()` | `demo/en/project.html` | Gemischtes Projekt-UI |
| flightPath | `loadFlightPath(domId, {flight_path_id})` | `destroyFlightPath()` | `demo/en/flight-path_en.html` | Externe Flugspuranzeige |
| virtualCockpit | `loadCockpit(domId, {gatewaySn,droneSn,map?})` | `destroyCockpit(isEffect?)` | `demo/en/cockpit.html` | Live-Flugsteuerung |

`initConfig({serverUrl,wssUrl,hostUrl,prjId,projectToken})` setzt die DJI-Runtime voraus. Das Dokument zeigt im Beispiel unverschlüsselte HTTP/WS-Adressen; **diese Platzhalter dürfen nicht unreflektiert in die SkyHub-TLS-Oberfläche gelangen**. DJI empfiehlt, die API erst nach dem Laden der Seite aufzurufen.

Die dokumentierten Subscribe-Ereignisse sind `wayline-save`, `wayline-cancel`, `wayline-back`, `wayline-creation-saved`, `wayline-creation-cancel`, `cesium-viewer-change` und `flight-path-back`. DJI liefert teils externe Routen-IDs an Event-Callbacks. `classifyEvent()` übernimmt **nur die bekannte Signalart**: keinerlei fremde ID, Token, Seriennummer, Position, Viewer-Objekt oder Event-Payload wird weitergereicht. `wayline-save` ist **keine** SkyHub-Autorisierung zum Synchronisieren, Publizieren oder Dispatchen.

### Quellinkonsistenzen und offene Prüfungen

- Die DJI-Methodentabelle beschreibt `loadProject.domId` als boolean, die offiziellen Demos übergeben aber eine String-DOM-ID. Bis zum echten Runtime-Test als Dokumentationsfehler **nicht** als stabilen Typvertrag behandeln.
- Die DJI-FAQ-TypeScript-Skizze verwendet abweichende `ICockpitParams`-/`loadWayline`-Signaturen gegenüber den unmittelbar vorhergehenden Tabellen/Demos. **Demos und echte Runtime** müssen vor einer aktiven Integration gegengeprüft werden.
- Für `subscribe` steht im Handbuch keine überprüfte Scope-/Unsubscribe-Vertragsgarantie. Keine Annahmen über Idempotenz, Abmeldung, Event-Reihenfolge oder Komponentenisolation treffen.
- Die DJI-Cesium-Viewer sind über `window.FH2.cesiumViewer` erreichbar; die dokumentierten Keys sind `global` und `wayline_editor_support`. Keine ungeprüften Seiteneffekte oder ungefilterten Datenübernahmen in die SkyHub-Leaflet-Karte.
- DJI warnt vor CSS-Nebenwirkungen am `body` und vor `transform`, `perspective`, `filter`, `will-change` und `contain: paint` an Elterncontainern. Vor UI-Einbettung echte Positions-/Overlay- und Touch-Tests durchführen.

## 3. Integration in SkyHub Next (nicht implementiert)

```text
SkyHub Next (Root-Stack)                  FlightHub 2 On-Premises
  Operations / separater Mission Planner     Hersteller-Runtime paas.js
  DJI Cloud-API/OSD + eigener WPML-Core     FH2 Projekt-/Wayline-IDs
  eigene Workspace-RBAC                    separate FH2-Anmeldedaten
             |                                        |
             +--- noch NICHT vorhanden: FH2-Adapter --+
```

- **Komponente als Referenz, nicht als Import:** Kein Vendoring proprietärer JS-Bundles; keine Nachbildung von DJI-Cockpit-Kommandos. SkyHub bleibt ohne FlightHub 2 nutzbar.
- **UI-Trennung:** Der noch offene WPML-Editor [#16](https://github.com/mason82-dotcom/SkyHub/pull/16), die Waylines-Referenz [#57](https://github.com/mason82-dotcom/SkyHub/pull/57), das Command Center und der unabhängige TAK-Tab [#58](https://github.com/mason82-dotcom/SkyHub/pull/58) dürfen nicht automatisch zu einem einzigen Runtime-Scope zusammengelegt werden.
- **Identität und Geheimnisse:** Vor dem Laden externer FH2-Skripte DJI-konformes, eng begrenztes Browser-Authentifizierungsmodell nachweisen. Falls nur der langfristige Organisation-Key an eine untrusted Browser-Session auslieferbar ist, **keine Einbettung**. Kein Server-Proxy, der pauschal den DJI-Org-Key an beliebige Clients weitergibt.
- **Netzwerk:** TLS (`https`/`wss`), explizite Origin-/CSP-Allowlist, Hostname-Prüfung und Drittanbieter-Skript-Herkunft dokumentieren. Nicht einfach die DJI-HTTP-Demo-Konfiguration übernehmen.
- **Berechtigungen:** Eigenes SkyHub-RBAC und DJI-FH2-Rollen getrennt verifizieren; niemals UI-Sichtbarkeit mit Server-Autorisierung gleichsetzen.
- **Flight Safety:** `loadCockpit` ist keine lesende Karte. Flugbefehle, RTH, Latenz, Verbindungsausfall, parallele Kontrollinstanzen und DJI-Controller-Konflikte verlangen Hardware-, Pilot- und Security-Freigaben.
- **Rollback:** Spätere Integration darf als opt-in Modul abschaltbar sein, ohne SkyHub-Pilot-Pairing, MQTT/EMQX, Caddy, MinIO, PostGIS oder Pi-Ports zu verändern.

## 4. Codevertrag und Regression

`frontend/public/fh2-reference-contract.js` enthält nur das dokumentierte Methoden-/Demo-Inventar, abgeleitete Review-Gates und einen Whitelist-Classifier für Ereignisnamen.

- `describeComponent(key)` liefert die statische Referenz, unbekannte Keys fail-closed als `null`.
- `reviewGates(key)` liefert **Review-Anforderungen**, keine Bestätigung, dass sie erfüllt wurden.
- `classifyEvent(name)` erstellt nur ein nicht vertrauenswürdiges, payloadfreies Signal; nie Flug-/Schreibrechte.
- `integrationStatus()` meldet unabhängig von Aufrufparametern unveränderlich `reference-only`, alle Integrations-/Hardware-/Kommandoflags `false`.
- Kein Token-Parameter, Fetch-/WSS-/MQTT-Aufruf oder Laufzeit-Loader. Die Datei ist von keinem HTML-Dokument eingebunden.

Offline prüfen (keine externe Verbindung):

~~~sh
node --check frontend/public/fh2-reference-contract.js
node --test backend/test/fh2-reference-contract.test.js
~~~

Die reguläre GitHub-CI prüft `frontend/public/*.js` und `backend/test/*.test.js` zusätzlich. Ein grüner Test ist **keine** On-Premises-, Browser-, Lizenz- oder Hardwareabnahme.

## 5. Freigabe-Gates vor einem gesonderten Implementierungs-PR

1. FH2-On-Premises-Version, Lizenz und Deployment-Anbindung belegbar; keine Annahme, dass FH2 direkt auf dem Pi 5 läuft.
2. Browser-Token- und Rollenmodell offiziell bestätigt und gegen Missbrauch getestet; keinerlei Org-Key in ausgelieferten statischen Dateien, URLs oder Logs.
3. Laufzeitvergleich der oben genannten DJI-Methoden/Events, sichere Komponentenzerstörung, Karten-/CSS-Tests und Browser-CSP.
4. Getrennte Workspace-/Routen- und Hardware-Tests mit synthetischen IDs, ohne reale Flugbefehle.
5. Explizit freigegebener, isolierter Folge-PR für eine zunächst nur lesende FH2-Anzeige; Cockpit und Speichern bleiben in eigenen Sicherheitsstufen.
6. Raspberry-Pi-Preflight, Backup, Rollback und Deployment-Freigabe **gesondert** durchführen.

**Keine Änderung am produktiven Raspberry Pi; keine Anmeldung bei DJI; keine Flugmission.**
