# SkyHub Next UI-Vertrag

## Quellen und Geltung

- Produkt- und Zugriffsgrenzen: [Sicherheitsmodell](docs/security.md), `backend/lan-access.js` und `backend/server.js`.
- DJI-Fachreferenz und geplante Adapter: [DJI-Referenz-Roadmap](docs/dji-reference-roadmap.md).
- Gilt für das ausgelieferte statische Dashboard `frontend/public/index.html`; die Pilot-2-Webview hat einen getrennten Kopplungsfluss.

## Kartenworkflow

1. Nach erfolgreichem lesendem Geräteabruf zeigt die Liste alle bekannten Geräte. Die Karte zeigt nur endliche, gültige WGS84-Koordinaten mit einem vorhandenen Positionszeitpunkt; `(0, 0)` ist kein nutzbarer Gerätestandort. Eine folgende 0/0-Meldung setzt `positionUnavailable=true`, lässt den letzten echten Fix samt Zeitpunkt unverändert und zählt nicht als aktuelle Position. Reguläre GNSS-Koordinaten benötigen keinen RTK-Fix.
2. „Letzte Position auf Karte zeigen“ zentriert die Karte auf genau dieses Gerät. „Alle Positionen zeigen“ passt alle verfügbaren Positionen ein. Diese Aktionen ändern keine Daten und lösen keine DJI-Befehle aus.
3. Eine Markerwahl markiert die zugehörige Gerätekarte und scrollt die Geräteliste zum Eintrag. Der Button in jeder passenden Gerätekarte bietet dieselbe Kartenfunktion per Tastatur.
4. Fehlende Karte, fehlende Positionen und getrennte Live-Verbindung werden als Text angezeigt. Die Liste bleibt bei Kartenfehlern nutzbar. Historische Spurpunkte mit `(0, 0)` bleiben unsichtbar.
5. Der Kartenhinweis zählt gültige Positionen getrennt nach aktuell (unter 15 Sekunden, verifizierte Quellzeit), zeitlich ungeprüft und älter. So bleiben ältere Marker sichtbar, ohne sie als live darzustellen.
6. Der Kartenhinweis ergänzt die Zahl sichtbarer gespeicherter Flugspuren. Wenn keine gültige Gerätestandortposition vorliegt, aber eine historische Flugspur sichtbar ist, benennt er die Flugspur statt einen leeren Kartenstand zu suggerieren.
7. Der Token bleibt nur im Seitenspeicher; keine URL-, Local-Storage- oder Log-Ausgabe. Der Heimnetz-Zugang ist laut Backend nur lesend.
8. Bei überlappenden Verbindungsversuchen gilt nur der neueste Versuch; verspätete Antworten und Socket-Ereignisse älterer Versuche dürfen Anzeige und Status nicht überschreiben.
9. Der Flugspur-Schalter zeigt direkt darunter den Zustand des lesenden 60-Minuten-Abrufs: Laden, sichtbare Spuren, keine gespeicherte Spur oder Abruffehler. Eine sichtbare Linie benötigt mindestens zwei gültige Punkte. Nach einem Fehler bleiben vorhandene Linien sichtbar und „Erneut laden“ bietet einen direkten Wiederholungsweg.
10. Ausschalten und ein neuer Verbindungsversuch brechen laufende Spurabrufe ab und entfernen bisherige Linien. Verspätete Antworten dürfen weder Linien noch Status eines neueren Abrufs überschreiben. Der regelmäßige Abruf aktualisiert den Status bei Erfolg oder Fehler, ohne jeden Zwischenabruf anzukündigen.

## Datenpfad-Diagnose

- Der zugeklappte Block „Datenpfad“ nutzt ausschließlich den öffentlichen, aggregierten Health-Endpunkt. Seine Kurzzeile und die Details unterscheiden MQTT-Verbindung, Abonnement, beobachtete DJI-OSD-Pakete und tatsächlich übernommene Messwerte. Eine MQTT-Verbindung allein meldet keine aktive Telemetrie.
- Der Spurspeicher nennt getrennt „nicht konfiguriert“, „Datenbank noch nicht bereit“, den letzten fehlgeschlagenen Schreibversuch oder bestätigte Spurpunkte seit Backend-Start. „Bereit“ ohne bestätigten Punkt ist kein Nachweis einer gespeicherten Flugspur.
- Der Abruf läuft beim Laden und alle 30 Sekunden; „Jetzt prüfen“ wiederholt ihn manuell. Bei Abruffehlern werden frühere Erfolgsmeldungen durch „Diagnose nicht erreichbar“ und unbekannte Detailwerte ersetzt. Zeiten sind relativ und beziehen sich auf Backend-Ereignisse, nicht auf die DJI-Quellzeit.

## Geräteereignisse

- Die eingeklappte Ereignisliste nutzt `GET /api/events` nach erfolgreicher Verbindung und ergänzt den Verlauf über `device_event`. Sie zeigt höchstens acht der letzten Ereignisse mit Kennung, verständlicher Kategorie und Empfangsalter; Rohmeldungen und Payloads bleiben verborgen.
- Erlaubte Kanäle sind `events`, `status` und `services_reply`. Doppelte Ereignisse werden zusammengeführt, der Seitenspeicher bleibt bei höchstens 100 Einträgen. Verbindungswechsel leeren den Verlauf; ein fehlgeschlagener Aktualisierungsabruf löscht bereits sichtbare Ereignisse nicht und kennzeichnet den Fehler.
- HMS- und Topologie-Ereignisse sind Hinweise auf gemeldete Zustandsänderungen. Sie ersetzen nicht den separat angezeigten Telemetrie- oder Positionszeitpunkt.
- DJI sendet die vollständige HMS-Liste etwa alle zwei Sekunden und AirSense-Warnungen etwa jede Sekunde. Das Backend erzeugt daraus nur dann ein Ereignis, wenn sich die Menge der Meldungen (Code, Stufe, Komponenten- und Sensorindex) ändert oder die höchste AirSense-Warnstufe wechselt (auch beim Wegfall des Verkehrs). Sonst würden die 100 Speicherplätze nach rund einer Minute nur noch Wiederholungen enthalten und echte Ereignisse verdrängen.
- AirSense (ADS-B-Warnung vor bemannten Luftfahrzeugen) erscheint in der Gerätekarte als Zusammenfassung: Anzahl, höchste Stufe und kleinster Abstand, ab Stufe 3 mit dem Hinweis „Ausweichen empfohlen“ (DJI empfiehlt ab Stufe 3 auszuweichen). Kennung (ICAO), Position und Kurs fremder Luftfahrzeuge werden weder gespeichert noch an den Browser gesendet. Die Anzeige verschwindet, wenn die letzte Meldung älter als 15 Sekunden ist.

## Geräteliste

- Jede Karte zeigt zuerst Modell, Kennung, OSD-Zustand, Akku, relative Höhe, Position und die höchste aktive HMS-Warnung. Die aufklappbare Ansicht zeigt außerdem empfangene DJI-Felder für Heading/Kurs, Vertikalgeschwindigkeit, Nick-/Rollwinkel und Positionsqualitätscode. Optionale Felder ohne beobachteten Wert werden ausgeblendet; numerische Nullwerte bleiben sichtbar. Der RTK-Fix-Code ist kein Hinweis darauf, ob RTK manuell eingeschaltet ist. Zusätzliche DJI-OSD-Felder für Windgeschwindigkeit, Windrichtungssektor (Code 1–8), kumulierte Flugzeit/-strecke sowie SDR-/4G-Linkzustände werden nur bei tatsächlich geparsten Werten angezeigt; fehlende oder ungültige Werte werden nicht geschätzt. Jedes tatsächlich beobachtete normalisierte OSD-Feld besitzt seinen eigenen letzten Zeitstempel (verifizierte DJI-Zeit oder Empfangszeit) und das Quellzeit-Verifikationsbit. Die Oberfläche markiert Werte einzeln als „aktuell“ (unter 15 s mit verifizierter Zeit), „Zeit ungeprüft“, „veraltet“, „nicht empfangen“ bzw. „Zeitpunkt nicht bekannt“. Eine neue 0/0-Meldung aktualisiert die Zeit des letzten gültigen Breiten-/Längengrads nicht und markiert den Fix historisch. Feldalter werden regelmäßig ohne Neuaufbau der Gerätekarten aktualisiert. Der Aufklappzustand bleibt bei Live-Updates erhalten.
- Die lokale Suche gleicht Modell, Geräte- und Gateway-Kennung sowie Rolle ab. Der native Statusfilter wirkt nur auf die Liste; Marker und „Alle Positionen zeigen“ bleiben eine Gesamtsicht. Eine Markerwahl setzt verdeckende Filter zurück und zeigt das gewählte Gerät.
- „Aktive HMS-Warnungen“ umfasst Stufen 1 und 2, solange die HMS-Meldung frisch ist. „OSD unter 15 Sekunden“ verlangt frische OSD-Telemetrie und ein nicht getrenntes Fluggerät. Ohne Treffer werden Suche und Filter mit einem Button zurückgesetzt.
- Such- und Filterwerte bleiben während Live-Updates im Seitenspeicher erhalten. Sie werden wegen möglicher Gerätekennungen nicht in URL oder Browser-Speicher geschrieben. Der native Filter nutzt die Popup- und Tastaturbedienung des Browsers.

## Canonical UI Map

| Capability | Canonical owner | Source of truth | Allowed variants | Verification |
| --- | --- | --- | --- | --- |
| Form | `frontend/public/pilot-login.html` für Pilot-Kopplung; Dashboard-Token in `index.html` | `backend/pilot-pairing.js`, `backend/server.js` | Pilot-Kopplung / lesendes Dashboard | Pilot- und HTTP-Zugriffstests |
| Select/Listbox | Nativer `<select id="deviceFilter">` in `frontend/public/index.html` | Gerätelisten-Vertrag oben | Einzelauswahl für lokalen Statusfilter | Browser: Tastatur, schmale Ansicht, Popup |

Weitere Standardkomponenten entstehen erst mit einem tatsächlichen zweiten Workflow. Neue Schreibaktionen benötigen vor der UI-Umsetzung einen expliziten Rollen-, Fehler- und Bestätigungsvertrag; die lesende Karte definiert dafür keine Freigabe.


## Experimenteller GFX-Branch: SKY//PULSE

Diese Ergänzung gilt ausschließlich für `feature/hyperframes-gfx-ui-rework-20261024`. Auf `main` sind unverändert das bisherige Dashboard-Layout und dessen primäre Bedienung maßgeblich.

- Die Modulnavigation verlinkt ausschließlich vorhandene interne Seiten. `aria-current` bezeichnet den gerade geöffneten Pfad. Die ursprüngliche Header-Navigation bleibt ohne JavaScript als HTML-Fallback nutzbar; nach erfolgreicher GFX-Navigationseinfügung wird sie aus dem DOM entfernt, damit Links und Tastaturziele nicht doppelt auftreten.
- Der Karten-Fokusmodus ist eine **reine Layoutänderung**. Geräteauswahl, Positionsfrische, Filterstatus, Karten-Layer, Token, Socket.IO und Flugspurabruf bleiben unverändert. Die Info-Spalte wird nie ausgeblendet.
- Der Tastaturbefehl `/` fokussiert ausschließlich die Suche auf dem sichtbaren Operations-Panel und greift nicht bei aktiven Eingaben oder im TAK-Tab.
- Die visuelle Animation ist temporär und stets abschaltbar. Betriebssystemseitige Einstellungen für reduzierte Bewegung oder erzwungene Farben haben Vorrang.
- Warnstufen, „aktuell“-Kennzeichnungen und Frischegrenzen stammen unverändert aus den fachlichen Komponenten. Dekorative Radarflächen sind keine Telemetriequellen.
- Relevante automatisierte Tests: `backend/test/hyperframes-gfx-ui.test.js` und die etablierten Dashboard-/TAK-/WPML-Tests.


## SKY//PULSE · Fluginstrumente (Branch-spezifisch)

Im GFX-Branch dürfen Instrumente nur reale, normalisierte Werte aus dem bestehenden Gerätesnapshot darstellen. Jedes Instrument verwendet denselben `SkyHubTelemetryFreshness.evaluateField`-Status wie die Original-Gerätekarte. Null gilt als gemeldene Zahl, fehlende/ungültige Werte als „Nicht empfangen“. Die optionale Instrumenten-Geräteauswahl bleibt bei laufenden OSD-Updates stabil. Ein verringertes Balkendiagramm darf nie als Live-Nachweis gelten: Nur `current` erzeugt eine Füllung. Kein Instrument ist Flugsteuerung, Missionsfreigabe oder Vorhersage.

## SKY//PULSE · Kursrose (experimenteller Branch)

Die Kursrose im Heading-Instrument ist ein sekundäres grafisches Hilfsmittel. Sie darf nur nach bestätigter, einzelwertbezogener DJI-Zeitprüfung `current` sichtbar sein. Ein stale/unverified/missing/unknown Heading darf keinen dynamischen Zeiger anzeigen. Die Richtung wird aus dem gemeldeten Winkel normalisiert, nicht aus letzter Kartenbewegung, angenommener Flugrichtung oder anderen Feldern geschätzt. Die numerische Heading-Anzeige und ihr Feldalter bleiben unabhängig davon zugänglich. Die Richtungsnadel bleibt dekorativ (Screenreader ignorieren sie); sie besitzt keine Animation oder Übergangsinterpolation.


## SKY//PULSE · Künstlicher Horizont (experimenteller Branch)

Die Nick-/Rollanzeige übernimmt ausschließlich die normalisierten `attitudePitch`- und `attitudeRoll`-Felder aus der bestehenden Datenquelle. Das grafische Element ist nicht sicherheitskritisch und besitzt keine zertifizierte Fluglage-Geometrie; die Winkelskala ist schematisch. Die Szene wird nur sichtbar, wenn **beide** Feldwerte aktuell, zeitverifiziert und plausibel sind. Die numerischen Einzelwerte und deren Alter bleiben auch bei nur teilweise verfügbaren Daten zugänglich. Kein Wechsel des Flugstatus oder der Bedienrechte lässt sich aus der optischen Szene ableiten. Der Titel `gfxCockpitTitle` ist eindeutig vom Heading-Wert `gfxCockpitHeading` getrennt.


## SKY//PULSE · Instrumentenfeldqualität

Die Qualitätstafel ist auf die acht visuell im Cockpit vorhandenen Felder begrenzt. Ausschließlich `current` bedeutet „aktuell und zeitverifiziert“; fehlende/ungültige Felder, feldbezogene Veraltung, unbestätigte sowie nicht bekannte Einzelzeitpunkte müssen eigenständig gezählt und textlich erläutert werden. Aggregat-OSD-Frische, verbundene Topologie oder eine positive Qualitätssumme sind **weder** eine Flugfreigabe **noch** ein Gerätelink- oder Sicherheitsnachweis. Die Qualitätstafel darf keine vom Nutzer veränderbaren Schwellwerte zur künstlichen Statusaufwertung enthalten.


## SKY//PULSE · Lokale Diagnosezeitleiste

Der Feldverlauf ist ein flüchtiger, auf 24 Einträge begrenzter Browser-UI-Beobachtungsspeicher ausschließlich für das aktuell ausgewählte Gerät. Statusänderungen und vorwärtslaufende verifizierte Einzelzeitstempel dürfen angezeigt werden, **nicht** aber als DJI-Ereignislog, Empfangsmitschnitt oder beweisfähige Verbindungs-/Paketverluststatistik bezeichnet werden. Anfangszustand und Gerätewechsel erzeugen keine synthetischen Ereignisse; nur beobachtete Folgezustände sind sichtbar. Keine Werte, Koordinaten, Seriennummern, Zugangstokens, Server-Nachrichten oder persistierten Logs im Diagnoseverlauf. Beobachtungszeit ist von DJI-Feldzeit klar getrennt. Die reine Beobachtung verändert weder die Instrumenten-Qualitätskategorien noch Freigabezustände.


## SKY//PULSE · Begrenzte Frischewechsel-Diagnose

Die Diagnosezusammenfassung berechnet ausschließlich Häufigkeiten unter den **maximal 24 zuletzt gespeicherten lokalen UI-Beobachtungen**. Sie muss beobachtete Übergänge zu „Veraltet“ von verifiziert fortgeschriebenen Feldzeitstempeln und sonstigen Statuswechseln trennen. Ein Ranking darf sich nur auf genau dieses Fenster beziehen und darf niemals als langfristige Fehlerhäufigkeit, Empfangslücke, Paketverlustquote, Hardwarediagnose oder Flugfreigabe beschriftet sein. Ein Feld ohne erfassten Wechsel erhält keinen Rang; bei Gleichstand ist die feste Reihenfolge der acht Instrumente ausschlaggebend. Löschen und Gerätewechsel setzen Liste und Zähler atomar zurück.
