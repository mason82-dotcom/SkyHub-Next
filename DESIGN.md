---
version: alpha-light-1
name: SkyHub Next
description: Helle, kompakte und responsive DJI-Leitstellenoberfläche mit getrennten Offline-Editoren.
colors:
  background: "#f3f6fb"
  panel: "#ffffff"
  soft: "#f8faff"
  edge: "#d8e2ee"
  ink: "#1b2b42"
  muted: "#53657d"
  primary: "#2458d3"
  warning: "#855510"
  critical: "#b42328"
typography:
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif"
rounded:
  control: "10px"
  card: "16px"
spacing:
  base: "4px"
  navigation: "5px gap; 9px 12px link padding"
  panel: "16–22px"
components:
  map: {}
  device-card: {}
  button: {}
  status: {}
  navigation: {}
---

# SkyHub Next – UI-Designsystem (Light)

## Geltungsbereich und Stand

Dieses Dokument beschreibt den **Entwicklungsbranch** `feature/webui-light-redesign-20261024`, nicht die automatisch produktiv eingesetzte Version. Die ausgelieferten sechs HTML-Ansichten sind: Operations inklusive des getrennten TAK-/CoT-Tabs, Smart Farming, WPML-Wegpunkteditor, lokale Routenbibliothek, 2D-Survey und DJI-Pilot-2-Kopplung. Alle beziehen `frontend/public/skyhub-light.css` **nach** ihren bisherigen Inline-Styles.

Die echte Quelle der Farben, Abstände, Zustände und Breakpoints ist `frontend/public/skyhub-light.css`. Alte Inline-Styles dienen vorerst ausschließlich als strukturelle Kompatibilitätsschicht. Neue Farben und Komponenten sollen nicht mehr pro Seite fest verdrahtet werden. Für funktionale und sicherheitsrelevante Aussagen gilt weiterhin `UX-CONTRACT.md` und die jeweilige Fachdokumentation.

## Visuelle Leitidee

Eine ruhige, professionelle Leitstellenoberfläche: großflächige helle Karte, klar abgegrenzte weiße Informationskarten, kontraststarke dunkle Typografie, Blau für primäre Aktionen, Grün für bestätigte Zustände und Gelb/Rot für Warnungen. Der Benutzer muss relevante Live-Daten, Quellzeit-Frische, HMS-Ereignisse und den tatsächlichen Freigabestatus eindeutig unterscheiden können.

- **Canvas** `#f3f6fb`, **Surface** `#ffffff`, **Soft Surface** `#f8faff`
- **Ink** `#1b2b42`, **Muted** `#53657d`, **Border** `#d8e2ee`
- **Action** `#2458d3`, **Hover** `#1946b0`, **Selected** `#eaf0ff`
- **Success** `#08734c`, **Warning** `#855510`, **Critical** `#b42328`

Statusfarben sind nie die einzige Statusdarstellung. Experimentell, Offline-Entwurf, nicht kalibriert, nicht verbunden und keine Flugfreigabe bleiben als Text sichtbar. Ein UI-Skin schafft weder neue Backend-Funktionalität noch DJI-Kompatibilität.

## Layout und Navigation

Auf großen Displays belegt die Operations-Karte den Hauptraum; die rechte Geräteleiste nutzt etwa 360–415 Pixel. Die beiden internen Tabs „Operations“ und „TAK / CoT“ sind getrennt. Die Leiste besitzt eigene Statuskarten, Filter, HMS-, Datenpfad- und Geräteblöcke; sie darf unabhängig von der Karte scrollen.

Fünf operatorseitige Ansichten teilen dieselben Modul-Links: Übersicht, Missionen, Routen, Survey, Smart Farming. `aria-current="page"` bezeichnet genau die aktuelle Seite. Die Pilot-2-Webview bleibt bewusst ohne zusätzliche Operatornavigation und mit eigener kompakter Kopplung.

Breakpoints sind **1320**, **900** und **660 Pixel**. Unter 900 Pixeln steht die Karte oberhalb der Daten- und Editoransichten. Zwischen 661 und 900 Pixeln darf die Navigation horizontal scrollbar sein; bis einschließlich 660 Pixeln **umfließen alle fünf Operator-Links** auf zusätzliche Zeilen, sodass auch der aktive Bereich sichtbar bleibt. Es gibt keine abgeschnittenen primären Aktionen. Zielansichten für Tests: 320, 390, 834 und 1440 Pixel.

## Typografie, Komponenten und Zustände

Systemschrift ohne Netzabhängigkeit; Inter wird nur benutzt, falls lokal vorhanden. Zahlen verwenden tabellarische Ziffern, sofern fachlich sinnvoll. Gerätekennungen, HMS-Texte und Dateinamen dürfen umbrechen. Karten enthalten strukturierten Text und klare Einheiten.

Primärbuttons sind blau, sekundäre Aktionen dezent hellblau. Inputs/Selects sind weiß, fokussierte Controls besitzen einen deutlich sichtbaren dunkelblauen Ring. Mindesthöhe von Bedienelementen 42 Pixel, auf schmalen Displays 44 Pixel; abweichende kleine Status-Buttons bedürfen gesonderter Prüfung. Platzhalter sind keine Formlabels.

Karten sind weiß mit feinem Rand, 13–16-Pixel-Radius und zurückhaltendem Schatten. Warnungen erhalten sanfte Hintergründe und lesbare dunkle Statusfarben; kritische Daten sind nicht bloß rot. Deaktivierte Buttons müssen erkennbar bleiben, dürfen keine Aktion vortäuschen und erhalten nicht nur einen geänderten Cursor.

## Karten, WPML und Smart Farming

Leaflet nutzt weiterhin das bestehende externe Kartenmaterial. Falls Kartenkacheln fehlen, bleibt die textbasierte Geräteliste als Tastaturalternative. Das Map-Overlay darf weder Klicks noch Dragging blockieren. Zuletzt gemeldete Positionen dürfen nicht als aktuelle Live-Orte interpretiert werden.

Wegpunkteditor und Survey sind Offline-Vorschauen, keine Flugfreigabe. Die Routenbibliothek speichert nur nach expliziter Bestätigung lokale Daten. Smart Farming stellt ausschließlich experimentelle M3M-Metadaten ohne kalibrierte Vegetationskarten oder Ausbringempfehlungen dar. TAK bleibt ein nicht integrierter, schreibgeschützter Platzhalter.

## Direkte Tastaturnavigation

Alle sechs ausgelieferten Ansichten besitzen als **erstes fokussierbares Element** einen nur bei Tastaturfokus eingeblendeten Link „Zum Inhalt springen“. Er verweist auf das eindeutige `main#skyhubMain` mit `tabindex="-1"`. Das ermöglicht die direkte Bedienung ohne wiederholtes Tabben durch die fünf globalen Modul-Links, die Operations-Tabs oder die kompakten Pilot-2-Header-Elemente. Der Link nutzt den kontrastreichen gemeinsamen Light-Stil und benötigt weder JavaScript noch zusätzliche API-Rechte. Chromium testet Fokus, Sichtbarkeit und tatsächliche Ziel-Fokussierung.

## System-Kontrastmodus und reduzierte Bewegung

Die Light-UI bleibt der reguläre Darstellungsmodus. Für `(forced-colors: active)` werden Flächen, Texte und Links über die Systemfarben `Canvas`, `CanvasText`, `LinkText` und `Highlight` dargestellt. Der aktive Operatorbereich sowie der ausgewählte Workspace-Tab erhalten eine sichtbare Kontur; die Darstellung basiert nicht nur auf einem Farbhintergrund. Für `(prefers-reduced-motion: reduce)` werden CSS-Übergänge und Animationen deaktiviert. Die kompakte Pilot-2-Brandmarkierung bezieht ihre Akzentfarbe aus dem gemeinsamen Theme statt aus einem Inline-Attribut. Automatisierte Chromium-Suites emulieren beide Systemmodi ohne DJI-Verbindung.

## Formulare und Fehlerrückmeldung

Die gemeinsamen Formularfelder erhalten erst **nach einer ungültigen Benutzerinteraktion** über `:user-invalid` eine sichtbare Fehlerkontur mit inset-Markierung. Eine bereits vom Anwendungscode gesetzte `aria-invalid="true"`-Kennzeichnung nutzt denselben Stil. Unberührte Pflichtfelder sollen nicht beim Laden pauschal rot hervorgehoben werden. Die bestehende JS-Validierung von DJI-/WPML-Fachgrenzen und ihre textlichen Statusmeldungen bleiben die fachliche Quelle; CSS allein ist keine Freigabeprüfung. Ein Chromium-Test schreibt eine ungültige WPML-Steighöhe, prüft die sichtbare Kontur und bestätigt, dass die Markierung nach Korrektur verschwindet.

## Mobiler Schnellzugriff auf den Gerätestatus

In der Operations-Ansicht steht bei Viewports bis 900px zwischen Tabs und Karte ein 44px hoher Link **„Direkt zum Gerätestatus ↓“**. Dadurch lassen sich die Flotten-/Telemetriekennzahlen direkt erreichen, ohne durch die Kartenansicht zu scrollen. Das Sprungziel ist `aside#fleetPanel` mit `tabindex="-1"` und `aria-labelledby="fleetHeading"`; die Zielregion wird nach Tastatur- oder Touchaktivierung fokussiert. Im Desktoplayout ist der Zusatzlink vollständig ausgeblendet. Für den Link ist keine JavaScript-, API- oder DJI-Funktion erforderlich. Der echte Chromium-Test prüft Sichtbarkeit, Touch-Zielhöhe, URI-Fragment, fokussierte Region und unveränderten Gerätesnapshot.

## Barrierefreiheit und technische Überprüfung

Kontraste der semantischen Textfarben auf weißen Flächen werden automatisiert gegen **WCAG AA (4,5:1)** geprüft. Tastaturfokus, reduzierte Bewegung und native Formelemente sind beizubehalten. Daneben sind sichtbare Browserprüfungen von horizontalem Overflow, Tabs, Suchformular, Karteninteraktionen, Responsivität und DJI-Pilot-2-Webview erforderlich.

CI: `backend/test/webui-light-theme.test.js`, `scripts/tak-ui-browser-ci.js`, `tests/wpml_browser_smoke.py`. GitHub-Browser-Screenshots aus isolierten synthetischen Testumgebungen sind keine Abnahme echter Drohnenhardware. Pilot-2-Webview-Tests auf realer Hardware bleiben gesondert erforderlich.

## Nicht verhandelbar

- Keine aktive DJI-Flugsteuerung oder freigegebene Missionsausführung suggerieren.
- Ohne bestätigte Quellzeit keine Telemetrie-Frische vortäuschen.
- Keine Drohnen- oder GPS-Daten für die UI-Demonstration extern verschicken.
- Keine Secrets in Local Storage, URL, Diagnostik oder Screenshot-Artefakten.
- Keine vermeintlichen Sicherheitsprüfungen durch reine Farbgestaltung ersetzen.

### Mobile Karte und Sicherheitsinformationen

Im WPML-Missionseditor und in der Survey-Vorschau werden die erklärenden Sicherheitskarten bei Bildschirmbreiten bis einschließlich 660px **nicht mehr über der Leaflet-Karte** gerendert. Sie stehen stattdessen vollständig lesbar unter der Karte. Mindestens 300px nutzbare Kartenhöhe, die Zoom-Steuerung und alle Hinweise zur fehlenden DJI-Flugfreigabe bleiben erhalten. Desktop-/Tablet-Layouts bleiben unverändert.
