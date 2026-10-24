# SkyHub-Next · SKY//PULSE GFX UI (experimenteller Branch)

Branch: `feature/hyperframes-gfx-ui-rework-20261024`

## Ziel
Die bestehende read-only Einsatzoberfläche erhält einen kontrastreichen, futuristischen Instrumenten-Look. Der Stil ist bewusst experimentell, aber **keine Simulation von DJI-Gerätezuständen oder Flugfreigaben**.

## Implementierung
- Kanonischer GFX-Stylesheet-Owner: `frontend/public/hyperframes-gfx.css`; wird **nach** dem Legacy-Stil der fünf HTML-Oberflächen geladen und ist auf `body.skyhub-gfx` begrenzt.
- Motion-Progressive-Enhancement: `frontend/public/hyperframes-gfx.js`, keine Cookies, keine Speicherung, keine Netzaufrufe, keine Tokenberührung.
- Animationen initial gemäß OS-Einstellung, zusätzlich manuell umschaltbar. `prefers-reduced-motion` erzwingt bei Bedarf die statische Darstellung; `forced-colors` reduziert Dekoration.
- Keine fremden Font-CDNs, kein Framework-/Build-Schritt, keine zusätzlichen Produktionsabhängigkeiten.
- Tokens: Deep `#07101c`; Panel `#101e30`; Signal Cyan `#67e8f9`; Ion Lime `#c9fa79` (Bedienauswahl); Warnfarbe `#ffc37c`. Warnstufen des Backends bleiben in ihrer bisherigen Bedeutung erhalten.
- Typografie: Bahnschrift für technische Anzeige, Segoe UI/System für Fließtext, Cascadia Code/Consolas für optionale Statusdetails.
- Das Kartenfenster erhält ein dekoratives, transparentes Koordinatennetz mit `pointer-events: none` und besitzt keine zusätzlichen Interaktionsflächen.
- Originale IDs, Formularfelder, API-Aufrufe, DJI-Livezustände, Authentifizierung, WPML-Erstelllogik und TAK/CoT Export-Sperren bleiben unverändert.
- Die lokale `DESIGN.md` im Motion-Ordner beschreibt bewusst **nur** die eigenständige HyperFrames-Animation; das bestehende projektweite `DESIGN.md` bleibt für den Standard-Branch kanonisch.

## Motion-Graphics
`motion/hyperframes/skyhub-gfx/index.html` ist eine eigenständige, deterministische HyperFrames-Komposition mit GSAP-Timeline (8 s, 1920×1080). Sie enthält **nur konzeptionelle Demo-Werte** und wird nicht ins produktive Dashboard eingebettet. Die HTML-Bildschirmoberfläche benötigt HyperFrames daher **nicht** zur Laufzeit.

## Prüfung vor Merge
1. `cd backend && npm test` (einschließlich `hyperframes-gfx-ui.test.js`)
2. Am Desktop und auf 320 px Smartphone die fünf Seiten mit Tastatur prüfen: Tab-Fokus, Motion-Schalter, Suche, Karten-Zoom, Marker, TAK-Tab, Formulare.
3. Besonders beachten: Kartennetz darf keine Marker/Leaflet-Attribution verdecken; Kartenaktionen bleiben auf 44px-Touch-Zielen erreichbar.
4. Bei realem DJI-Gerät verifizieren, dass Telemetrie- und Frische-Beschriftungen unverändert und keine animierten Status-Fälschungen sichtbar sind.
5. `cd motion/hyperframes/skyhub-gfx && npx hyperframes lint && npx hyperframes validate && npx hyperframes inspect` — diese Render- und Browserprüfungen sind erst nach lokaler Ausführung bestätigt.
6. Ein eigenständiger visueller Review des bestehenden hellen UI-Branches bleibt erforderlich. **Diesen experimentellen Branch nicht automatisch nach main mergen.**

## Sicherheitsgrenzen
Kein automatisierter Flug, kein neuer HTTP-Endpunkt, kein geänderter Docker-Stack. Smart Farming bleibt unkalibriert; TAK/CoT bleibt ohne Export; WPML weiterhin Offline-Entwurf. Animation ist eine rein visuelle Eigenschaft.

## Phase 2: Unified Command Rail und Karten-Fokus

Implementiert im selben experimentellen Branch:

- Das Modulmenü wird als semantisches `nav` mit fünf festen internen Links aufgebaut; der aktuelle Pfad wird mit `aria-current="page"` benannt. Die vorhandene HTML-Navigation bleibt ohne JavaScript sichtbar.
- Jede Seite bietet einen Tastatur-Sprunglink zum Hauptinhalt; der Zielcontainer ist mit `tabindex="-1"` programmatisch fokussierbar.
- Dashboard: Die verfügbare Desktop-Höhe wird über vier CSS-Grid-Zeilen aufgeteilt (Header, Modulmenü, Operations/TAK-Tabs, Hauptansicht). Das alte starre Pixel-Offset wird nicht mehr verwendet.
- Der zusätzliche Button `Karte priorisieren` verschmälert die weiter sichtbare Info-Spalte auf 314 px. Der Button hat `aria-pressed` und wird unter 961 px ausgeblendet. Die Kartenansicht wird nach der Änderung neu vermessen.
- Die Kartenbeschriftung unten links ist rein dekorativ/informativ, hat `aria-hidden` und `pointer-events: none`. Sie stellt keine Live-Verbindung oder Flugfreigabe dar.
- Mit der Tastaturtaste `/` wird bei aktivem Operations-Panel das vorhandene Suchfeld fokussiert. In Textfeldern, bei Modifier-Tasten und im TAK-Panel greift die Kurzform nicht.
- `prefers-reduced-motion` und `forced-colors` blockieren Animationen explizit; ein bisheriger manueller Ausschaltwunsch bleibt bis zum Seitenwechsel im Seitenspeicher.
- Alle fünf GFX-Seiten nutzen dasselbe lokale JavaScript und CSS. Authentifizierung, Geräte-Zeitstempel, DJI-Protokollpfad und Datenaustausch werden nicht verändert.

### Erweiterte Abnahme

- Desktop-Breite 1024/1440 und Höhe 600/900 prüfen, außerdem 320/375/768 px und tatsächliche Tastaturbedienung.
- Eine Seite einmal ohne JavaScript laden: die ursprünglichen Modullinks bleiben verfügbar.
- Leaflet-Marker, Attribution, Scrollen der Geräteliste und Wechsel Operations/TAK bei aktiviertem Karten-Fokus testen.
- Farbkontrast, Fokus und `forced-colors` kontrollieren. Motion darf keinen Datenstatus vortäuschen.
- Alle neuen Regressionstests sowie HyperFrames-`lint`, `validate`, `inspect` getrennt ausführen.


## Phase 3 · Field-provenance OSD-Cockpit

- Neuer Owner `frontend/public/gfx-cockpit.js`. Ausschließlich browserlokale Aufbereitung derselben Geräte-Snapshots, die bereits `index.html` rendert; **kein** separater Netzabruf und keine Kopie des View-Tokens.
- Enthält sechs Instrumente: Akku, relative Höhe, Horizontalgeschwindigkeit, Heading, Vertikalgeschwindigkeit und SDR-Funkqualität. Fehlende optionale DJI-Felder werden als „Nicht empfangen“ angezeigt; Nullwerte bleiben gültige Zahlen.
- `telemetry-freshness.js` liefert die per-Feld-Kategorien `current`, `unverified`, `stale`, `missing` und `unknown`. Aggregat-OSD-Zeit ist kein Ersatz für Einzelwert-Zeitpunkte.
- Füllstandsbalken sind **nur** bei aktuellem, zeitverifiziertem Einzelwert gefüllt; für alte, fehlende und unbestätigte Werte werden sie geleert. Balken sind dekorativ; Status bleibt Text.
- Die Geräteauswahl ist alphabetisch nach Serienkennung sortiert und wird bei unverändertem Bestand nicht neu aufgebaut. Nutzerwahl bleibt bei OSD-Updates bestehen. Eine bewusste Kartenmarker-Auswahl kann das Cockpitgerät wechseln.
- Der Button „Letzten Kartenstandort zeigen“ ist nur aktiv, wenn eine Karte existiert und eine gültige WGS84-Position inklusive Positionstimestamp vorliegt. `0/0` und explizit `positionUnavailable` sind ausgeschlossen. Dies ist eine reine Karten-Navigation.
- Der Instrumentenstatus ist ausdrücklich `Nur lesend`, ohne DJI-Befehl, Start-/Stopp- oder Missionsfreigabe.
- Regressionstests: `backend/test/gfx-cockpit.test.js` und die bisherigen Dashboard-/TAK-/WPML-Tests. GPU/GSAP ist für die Instrumente nicht erforderlich.

## Phase 4 · Isolierte Chromium-Abnahme (24.10.2026)

Der experimentelle Branch besitzt mit `.github/workflows/gfx-browser-acceptance.yml` einen dedizierten GitHub-Actions-Workflow, der bei relevanten Frontend- oder Teständerungen läuft und auch manuell ausgelöst werden kann.

`tests/gfx_browser_acceptance.py` nutzt echtes Chromium und Leaflet 1.9.4, aber ausschließlich synthetische DJI-Gerätesnapshots, lokal ausgelieferte 1×1-Kartenkacheln und einen simulierten Socket.IO-Client. Alle anderen Netzwerkadressen werden blockiert; es gibt keine Produktiv-API-, Raspberry-Pi- oder DJI-Verbindung.

**Abgedeckte Browserfälle:**
- Desktop 1365 × 850, Mobilansichten 375 × 812 und 320 × 640, horizontaler Dokumentüberlauf
- Feldfrische und Telemetriewerte inklusive veralteter Höhe, Nullwerten und inkrementellen OSD-Updates
- Manuelle Geräteauswahl, Karten-Fokus, Leaflet, Operations/TAK-Tabs und `/`-Tastaturkürzel
- Nur einmal vorhandene Modulnavigation und die No-JS-Headerlinks als Fallback
- `prefers-reduced-motion`, `forced-colors: active`, JavaScript-Laufzeitfehler und Netzwerksperre

Die drei Screenshots werden unter dem GitHub-Actions-Artefaktnamen `gfx-browser-synthetic-screenshots` mit einer ausdrücklichen SYNTHETIC-Kennzeichnung gespeichert. Sie enthalten keine echten DJI-Flüge und sind ausschließlich für eine separate visuelle Beurteilung gedacht.

**Lokale Reproduktion:** Playwright 1.56.0 und Chromium installieren, Leaflet 1.9.4 lokal bereitstellen, `SKYHUB_TEST_LEAFLET_DIST` auf dessen `dist`-Ordner setzen, dann `python tests/gfx_browser_acceptance.py` starten.

**Abnahmegrenzen:** Die CI prüft Chromium auf Ubuntu, nicht die echten Android-WebView-Versionen, keine Hardwareintegration, keinen HyperFrames-Render und keine Flugfreigabe. Ein grüner automatisierter Test ersetzt keinen manuellen visuellen Review.

## Phase 5 · Provenienzgebundene Kursrose (24.10.2026)

- In der Operations-Fluginstrumentenkarte besitzt das Heading-Feld eine rein dekorative, kleine Kursrose mit Nordmarke. Der dynamische Zeiger folgt ausschließlich dem tatsächlich im bestehenden Gerätesnapshot gemeldeten DJI-Wert. Die sichtbare Zahl bleibt die primäre barrierefreie Information.
- `frontend/public/gfx-cockpit.js` berechnet den Bearing via `bearingFor(device, SkyHubTelemetryFreshness, now)`. Ein Zeiger wird nur bei `kind=current` gezeigt – zeitverifiziert, jünger als 15 Sekunden, kein ausdrücklich getrenntes Fluggerät.
- Die akzeptierte Heading-Eingabe liegt im dokumentierten Rundlauf `[-360,360]`. Negative Winkel werden für die Darstellung modulo 360 normalisiert (z. B. −90° → 270°); 360° → 0°. Nichtfinite oder außerhalb liegende Werte erzeugen weder aktive Kursrose noch scheinbaren Kurs.
- Bei fehlendem, unbestätigtem, in der Zukunft datiertem oder veraltetem Wert wird `#gfxCockpitCompass` per `hidden` aus der visuellen Anzeige genommen. Das numerische Feld und sein vorhandener Frischehinweis bleiben getrennt sichtbar, auch wenn die Quelle veraltet ist.
- `aria-hidden=true` für die Grafik: keine doppelten Screenreader-Ansagen und kein behaupteter Flugmodus. Zeigerrotation hat ausdrücklich **keine CSS-Animation**, um Richtungswechsel und Datenalter nicht als simulierte Bewegung erscheinen zu lassen.
- `forced-colors` erzwingt klare Systemfarben für Kursrose, Zeiger und Nordmarkierung. Die grafische Anzeige fügt keine neue Datenquelle oder Netzwerkverbindung hinzu.
- Abnahme: `backend/test/gfx-cockpit.test.js` testet negative Heading-Werte, 360°-Wrap, veraltete/ungeprüfte und getrennte Verbindungen; `tests/gfx_browser_acceptance.py` prüft echten Renderingzustand und Zeigerwinkel im isolierten Chromium. CI 5/5 am Implementierungscommit `348945aef82a` bestanden.


## Phase 6 · Künstlicher Horizont mit zweifacher Einzelwert-Prüfung (24.10.2026)

- `frontend/public/gfx-cockpit.js` stellt zwei weitere tatsächliche DJI-Felder dar: `attitudePitch` (Nickwinkel) und `attitudeRoll` (Rollwinkel), mit unabhängigen Zeitangaben aus `telemetryFieldAt` und `telemetryFieldTimeVerified`.
- Die Grafik `#gfxCockpitAttitude` ist ausschließlich eine **schematische** Lagendarstellung und **kein** zertifiziertes Fluglageinstrument. Pitch ist auf ±90°, Roll auf ±180° begrenzt; die reine CSS-Geometrie verwendet `rotate(-roll)` und `translateY(pitch × 0.8 px)`.
- Der künstliche Horizont erscheint **nur dann**, wenn **beide** Felder den Status `current` aus `SkyHubTelemetryFreshness.evaluateField` erhalten. Fehlende, zeitlich ungeprüfte, veraltete, unzulässige oder von einem getrennten Fluggerät gemeldete Daten unterdrücken die Szene.
- Die numerischen Nick-/Rollwerte und ihre eigenständige Frischekennzeichnung bleiben unabhängig vom Szenenstatus sichtbar. Die Szene besitzt `aria-hidden="true"` und weder CSS-Animation noch Interpolation – keine künstliche Echtzeitbewegung.
- Ehemals doppelt verwendetes `gfxCockpitHeading` wurde eindeutig getrennt: `gfxCockpitTitle` bezeichnet den Instrumentenbereich, `gfxCockpitHeading` ausschließlich den numerischen Kurswert. Die Änderung verhindert falsches Überschreiben der Überschrift und verbessert die Screenreader-Beschriftung.
- Unit-Tests sichern gültige Winkel, Grenzen, fehlende Felder, unbestätigte Zeitpunkte und einseitige Veraltung ab. Der isolierte Chromium-Test verifiziert die gerenderte Lagegeometrie mit **synthetischen** Werten sowie das Ausblenden bei veraltetem Rollwert.
- DJI-Protokoll, Authentisierung, Datenspeicherung, Flugkommandos, TAK-Sperre und produktive Raspberry-Pi-Dienste bleiben unverändert.


## Phase 7 · Manuelle Screenshot-Abnahme und Mobile-Karten-Überlagerung

Die realen Chromium-Screenshots mit ausschließlich synthetischen DJI-Gerätedaten vom Commit `733fae8558d1` wurden visuell geprüft. Bei 320 und 375 Pixeln überlappten Leaflets Zoomtasten die Kartenwerkzeugleiste. Die GFX-CSS-Ansicht setzt auf Viewports bis 640px die Kartenwerkzeuge auf `top:96px` und trennt diese von Leaflet.

Der isolierte Browser-Test prüft die tatsächlichen `getBoundingClientRect()`-Rechtecke auf Überlappung. Zusätzlich werden Desktop- und Mobil-Screenshots eines nach Einzelwert-Zeitprüfung gültigen künstlichen Horizonts aufgenommen. Die bereits vorhandenen Screenshots des veralteten Rollwinkels bleiben erhalten, sodass beide Zustände beurteilt werden können. Alle Artefakte tragen ausdrücklich die Kennzeichnung `SYNTHETIC / OFFLINE BROWSER TEST`.

Kein produktiver Backend-, DJI- oder Raspberry-Pi-Test und keine Android-WebView-Hardwareabnahme.


## Phase 8 · Einzelwert-Datenqualitätsanzeige (24.10.2026)

Die SKY//PULSE-Cockpitkarte zeigt unter der ausgewählten Drohne einen **Textstatus für genau acht dargestellte Instrumentenfelder**: Akku, relative Höhe, horizontale Geschwindigkeit, Heading, vertikale Geschwindigkeit, Pitch, Roll und SDR-Funkqualität. Die Anzeige zählt `current`, `stale`, `unverified`, `unknown` und `missing` anhand **derselben** feldbezogenen DJI-Zeitprüfung wie die Einzelwerte. Bei invaliden, nichtfiniten oder außerhalb definierter Darstellungsgrenzen liegenden Messwerten zählt das Feld als nicht empfangen.

`qualityFor(device, freshness, now)` arbeitet rein lokal, fügt weder persistierte Nutzerdaten noch Netzwerkzugriffe hinzu und verwendet keinen aggregierten MQTT-, Flug- oder Positionsstatus. Die Summe der fünf Kategorien entspricht genau der Anzahl der acht Spezifikationen. Fehlt ein ausgewähltes Gerät, stehen Striche statt irreführender Nullen. Bei getrenntem Fluggerät wird kein gemessener Feldwert als `current` ausgewiesen. Die Zahlen sind eine **begrenzte Instrumentenprüfung**, ausdrücklich **kein DJI-Flugbereitschaftsscore**.

Die separate Datenqualitätstafel verwendet einfache Textzähler und läuft auch unter `forced-colors`. In der Chromium-Abnahme wird die Kategorisierung beim Gerätewechsel und nach inkrementellen Socket.IO-Snapshots sowie bei einem veralteten Rollwinkel geprüft. Weitere Unit-Tests decken fehlende, ungeprüfte, zeitlich unbekannte und ungültige Werte sowie die Summeninvariante ab.


## Phase 9 · Browserlokale Telemetrie-Beobachtungen (24.10.2026)

Der ausklappbare Abschnitt `Feldverlauf · lokale Beobachtungen` zeichnet **ausschließlich im aktuell geöffneten Browsertab** bis zu 24 erkannte Änderungen der acht im Cockpit sichtbaren Felder auf. Es werden weder historische DJI-Telemetrie noch Paketankünfte aus MQTT, WebSocket oder dem FlightHub-System rückwirkend behauptet. Der eigentliche Gerätesnapshot dient beim erstmaligen Öffnen und jedem Gerätewechsel nur als Baseline; es wird **kein Ereignis** für bloß erstmals vorhandene Daten erfunden.

`observeFields` extrahiert nur die pro Feld geprüfte Qualitätsklasse und den numerischen Quellzeitstempel sowie das Verifikationsflag. `timelineChanges` erzeugt beim nächsten normalen Dashboard-Update nur für tatsächliche UI-beobachtete Statuswechsel Ereignisse wie `Aktuell → Veraltet` oder für zeitlich fortgeschriebene **verifizierte** Einzelwert-Zeitstempel ohne gleichzeitigen Statuswechsel einen Marker `Verifizierter Feldzeitpunkt fortgeschrieben`. Ein bloßes erneutes Zeichnen mit identischem Stand erzeugt kein neues Ereignis. Vorwärtslaufender Feldzeitstempel ist ausdrücklich **kein Beweis** für ein einziges neues Paket; `Veraltet` oder Frischewechsel sind **kein Beweis** für einen Verbindungsausfall.

Die Zeit auf jedem Eintrag ist die **lokale Beobachtungszeit des Dashboards**, nicht DJI-Quellzeit und nicht der genaue Moment des Frischeübergangs. Der Abschnitt nimmt weder andere Felder noch GPS-Koordinaten, Werte, Tokens oder Seriennummern in den Verlauf auf. Die Ereignisliste wird beim Gerätewechsel sowie bei Verbindungsreset geleert, ist per Knopfdruck löschbar und wird niemals in Browser-Speicher, Server-API oder Download geschrieben. Der bestehende Fünf-Sekunden-Updatezyklus genügt; kein zusätzlicher Timer, Netzwerkzugang oder Flugsteuerpfad.


## Phase 10 · Diagnosezusammenfassung der beobachteten Frischewechsel (24.10.2026)

Unter dem bereits rein browserlokalen Feldverlauf werden die **maximal 24 tatsächlich gespeicherten UI-Beobachtungen** ausgewertet. `summarizeTimeline(entries)` zählt innerhalb genau dieses Fensters getrennt: 1) Statusübergänge **zu** `stale`, 2) fortgeschriebene und verifizierte Quellzeitstempel sowie 3) sonstige Statusübergänge. Für die maximal drei am häufigsten innerhalb dieses kleinen Fensters zu `stale` wechselnden Felder werden ihre Anzeigenamen und Anzahlen dargestellt. Gleichstände sind durch die feste Reihenfolge der acht bekannten Instrumente deterministisch.

Die Ereignisstruktur erhält intern einen ausschließlich whitelisted `key` (`battery`, `altitude`, `horizontalSpeed`, `heading`, `verticalSpeed`, `attitudePitch`, `attitudeRoll`, `linkQuality`); die UI rendert ausschließlich vertrauenswürdige Anzeigebezeichnungen und Ganzzahlen. Unbekannte Felder werden bei der Aggregation nicht gezählt. Kein Zugriff auf Rohwerte, GPS-Positionen, Gerätekennungen, Token oder Serverdaten; keine neue Datenquelle, kein Timer oder Archiv.

**Wichtige Grenzen:** Die Tabelle bezeichnet niemals eine Fehlerquote, eine Häufigkeit aller historischen DJI-Meldungen, eine tatsächliche Empfangslücke, einen Funkverbindungsabbruch oder Flugbereitschaft. Sie umfasst nur die 24 jüngsten bereits festgehaltenen Status-/Zeitstempel-Beobachtungen, nicht verstrichene Zeit oder DJI-Pakete. Beim Gerätewechsel oder expliziten Leeren wird die Zusammenfassung mit der Liste gleichzeitig zurückgesetzt. Ein initialer Gerätesnapshot erzeugt keine Ereignisse. Für die Abnahme existieren Node-Tests zu Whitelist, Fenstergrenze und deterministischem Ranking sowie Chromium-Tests für Zeitstempel-Fortschreibungen, zwei veraltende Felder, Löschfunktion und Gerätewechsel.
