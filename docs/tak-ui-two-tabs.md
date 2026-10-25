# SkyHub Next – zwei Haupttabs (isolierter UI-Branch)

**Konsolidierung:** `feature/tak-tab-mainbase-20261023`; historische Vorarbeit: PR #58. Rebasierter Code ohne Altbranch-Historie.

Die Bedienoberfläche trennt die bisherige rein lesende Operations-Leitstelle von der TAK-/CoT-Interoperabilität. Die Trennung ist **eine echte Browser-Tab-Navigation**, aber **keine TAK-Backend-Integration**.

## Tab 01 · Operations

Enthält unverändert den bisherigen Karten-, Geräte-, Telemetrie-, HMS-, PostGIS-Flugspur- und Systemdiagnosebereich. Die vorhandenen Authentifizierungs-, Socket.IO-, DJI-MQTT- und Kartenzustände werden bei einem Tabwechsel nicht neu aufgebaut. Beim Zurückwechseln wird nur Leaflets sichtbare Kartengröße korrigiert.

## Tab 02 · TAK / CoT

Eigene, standardmäßig verborgene Hauptansicht mit ausschließlich statischen, nicht vertraulichen Statusfeldern: Export aus, Ziel nicht konfiguriert, keine Workspace- oder Gerätefreigabe und kein angeschlossenes TAK-Audit. Es gibt **keinen aktiven Netzwerkaufruf, Exportbutton, Backend-Endpunkt oder Schreibpfad**. Die im Verlauf entwickelten Stage-1–4-Pakete wurden nicht in den GitHub-Hauptbranch integriert und dürfen durch die UI nicht als aktiv dargestellt werden.

Beide Panels befinden sich innerhalb eines **gemeinsamen semantischen `<main>`-Landmarks**; die zuvor vom `role=tabpanel` überlagerte native `<main>`-Semantik wurde dadurch korrigiert. Der Operations-Rasterstil gilt ausschließlich für `#operationsPanel` und bleibt beim Umschalten erhalten.

Die zwei Schaltflächen verwenden `role=tablist/tab`, `aria-selected`, `aria-controls`, `role=tabpanel`, roving `tabindex` und Pfeiltasten sowie Home/End. Der Tabzustand verbleibt nur im Browserseitenspeicher (keine Kennung in URL, LocalStorage oder Telemetrie).

## Sicherheitsgrenzen

- Kein DJI-Flugkommando, kein MQTT-Publish, kein zusätzlicher Broker und keine Änderung von Pi-, Caddy- oder Broker-Konfigurationen.
- Keine TAK-Token-Eingabe oder Veröffentlichung von Seriennummern und Koordinaten über das neue Panel.
- Die TAK-Ansicht zeigt explizit „nicht integriert“, bis reale, gesondert geprüfte serverseitige Berechtigungen und sichere Netzwerkverbindungen vorhanden sind.
- Die Navigation ist rein clientseitig, **kein** Ersatz für serverseitige Rechteprüfung.

## Prüfkommandos

```sh
node --test backend/test/workspace-tabs.test.js
node --test backend/test/*.test.js
node scripts/check-dashboard-inline.js frontend/public/index.html
```

Tests prüfen die Panel-Zuordnung, Klick/Pfeiltasten/Home/End, Rückkehr zur Karte, Fehler bei unvollständigem DOM und den nicht sendenden TAK-Platzhalter. Browser-QA auf Desktop, Smartphone und DJI Pilot 2 ist zusätzlich erforderlich. Der hier geprüfte GitHub-Branch wurde nicht automatisch auf den Raspberry Pi übertragen oder produktiv gestartet.

## Responsive Abnahme und Browser-Fixture (23.10.2026)

Die eigenständige TAK-Statusansicht nutzt ein kompaktes responsives Raster:

- unter 600 px: eine Spalte,
- 600 bis einschließlich 1100 px: zwei Spalten,
- über 1100 px: drei Spalten.

Ein **lokaler Chromium/Playwright-Layouttest mit nachgebauter UI-Fixture** hat 320, 360, 390, 599, 600, 601, 768, 834, 850, 851, 1024, 1100, 1101 und 1440 px gegen horizontalen Überlauf geprüft. Darüber hinaus wurden Klick, ArrowRight-Fokuswechsel und Rückkehr zum Operations-Panel geprüft. Die Test-Fansicht nutzt die Tab-Markup-/CSS-Struktur und statusbezogene Inhalte dieses PR, aber **nicht die vollständige SkyHub-Laufzeit**. Sie bestätigt deshalb weder Leaflet-Rendering noch Socket.IO/MQTT-Zustände, Browserkompatibilität auf Pilot-2-Hardware oder einen echten TAK-API-Vertrag.

Hinweis auf den weiterhin nötigen Freigabetest: Der angepasste Backend-Hook darf erst nach gesonderter Hardware-, Security- und Browser-Abnahme einen TAK-Netzwerkpfad erhalten. Dieser Branch ändert keine produktiven Export-Flags.

## Zusätzliche Landmark-Abnahme

Mit dem korrigierten `<main>`-Layout wurde die isolierte Chromium/Playwright-Fixture erneut bei 320, 390, 834 und 1440 px ausgeführt. Alle vier Bildschirmgrößen: **kein horizontaler Überlauf**, Tabwechsel und Tastatur-Rückkehr erfolgreich. Ein zusätzlicher Node-Test erzwingt genau ein `<main>` mit beiden Tabpanels. Dies bleibt eine **synthetische Browserprüfung**; ein vollständiger SkyHub-Staginglauf mit Leaflet und Pilot-2-WebView ist weiterhin offen.

## Browser-Integration mit tatsächlichem Frontend (23.10.2026)

Abseits der zuvor dokumentierten, nachgebauten UI-Fixture gibt es jetzt den dedizierten Workflow
[`SkyHub TAK UI browser acceptance`](../.github/workflows/tak-ui-browser.yml).

- Führt die **unveränderte** `frontend/public/index.html` und die tatsächlichen
  `telemetry-freshness.js`/`workspace-tabs.js` aus.
- Verwendet echtes **Leaflet 1.9.4**, einen echten **Socket.IO 4.8.1** Testserver und
  **Playwright Chromium 1.56.1**. Browser-Abhängigkeiten werden nur im temporären
  GitHub-Runner-Verzeichnis installiert; `backend/package.json` bleibt unverändert.
- HTTP-API, Gerätedaten und WebSocket-Snapshot sind **synthetisch** und laufen
  ausschließlich über `127.0.0.1`. CDN-Dateien und Kartenkacheln werden
  lokal abgefangen; der Browser baut keine DJI-, Pi-, CloudTAK- oder
  externen OSM-Verbindungen auf.
- Prüft bei 320, 390, 834 und 1440 px: Navigation, Sichtbarkeit, dynamisches
  Leaflet-Layout, kein horizontaler Overflow und sichere TAK-Statusanzeige.
- Prüft die Tastaturbedienung, den Fortbestand des Geräteeintrags und der Leaflet-Panes,
  unveränderte Socket.IO-Sitzung beim Tabwechsel, abgetrennte Socket-Verbindung,
  abgelehnten API-Zugriff und das Ausbleiben von TAK-API-Aufrufen.
- Der Workflow speichert ein maschinenlesbares `report.json` und Screenshots
  als 14 Tage aufbewahrtes GitHub-Actions-Artefakt. Diese enthalten
  ausschließlich synthetische Daten und keine echten Gerätekennungen.

**Erster vollständig grüner Browser-Test:**
[GitHub Actions Lauf 39915332639](https://github.com/mason82-dotcom/SkyHub/actions/runs/39915332639).
Das aktuell erweiterte Testszenario muss nach jedem neuen Commit erneut grün laufen.

**Nicht durch diesen Test belegt:** Start der vollständigen Backend-/Redis-/PostGIS-
Anwendung, DJI-MQTT-Hardwareverkehr, realer Pilot-2-WebView-Test,
manueller Screenreader-Test, Hardwareautorisierung und CloudTAK-Kompatibilität.
Diese bleiben separate Freigabesperren. **Kein automatischer Merge oder Pi-Rollout.**

Lokale Ausführung mit separatem Dependency-Verzeichnis und Chromium:

```sh
mkdir -p /tmp/skyhub-browser-deps
npm install --prefix /tmp/skyhub-browser-deps --ignore-scripts --no-save \
  playwright@1.56.1 leaflet@1.9.4 socket.io@4.8.1
/tmp/skyhub-browser-deps/node_modules/.bin/playwright install chromium
SKYHUB_BROWSER_DEPS=/tmp/skyhub-browser-deps/node_modules \
  SKYHUB_BROWSER_ARTIFACTS=/tmp/skyhub-browser-report \
  node scripts/tak-ui-browser-ci.js
```
