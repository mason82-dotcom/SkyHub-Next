# Telemetrie-Cockpit (Operations)

Stand: 25.10.2026. Das Cockpit zeigt für **ein ausgewähltes Gerät** acht DJI-OSD-Einzelwerte im hellen SkyHub-Interface: Akku, relative Höhe, Horizontal- und Vertikaltempo, Kurs, Nick- und Rollwinkel, SDR-Funkqualität. Es ist rein lesend, ohne eigene Netzwerk-, Speicher- oder Token-Zugriffe.

Herkunft: Die Logik stammt aus dem experimentellen Entwurf [#127](https://github.com/mason82-dotcom/SkyHub-Next/pull/127) (SKY//PULSE). Übernommen wurde nur das Cockpit mit der Einzelwertprüfung, im Stil von [#120](https://github.com/mason82-dotcom/SkyHub-Next/pull/120). Zeitleiste, Diagnosezusammenfassung, Feld-Inspektor und das Dunkeldesign wurden bewusst nicht übernommen.

## Dateien

| Datei | Aufgabe |
| --- | --- |
| `frontend/public/telemetry-cockpit.js` | Reine Funktionen (`valueFor`, `bearingFor`, `attitudeFor`, `qualityFor`, `validPosition`) und `mount`. Global `SkyHubCockpit`. |
| `frontend/public/skyhub-cockpit.css` | Darstellung mit den gemeinsamen `--sky-*`-Tokens aus `skyhub-light.css`. |
| `frontend/public/index.html` | Abschnitt `#cockpit` im Gerätestatus-Panel; `update()` ruft `cockpit.render(...)`. |
| `backend/test/telemetry-cockpit.test.js` | Tests der Prüflogik und der Einbindung. |

## Regeln

- **Je Feld, nicht je Paket.** Jeder Wert wird mit `telemetry-freshness.js` (`evaluateField`, 15-s-Grenze, Feldzeitpunkt, `telemetryFieldTimeVerified`, `aircraftConnected`) bewertet. Eine frische Gesamt-OSD macht kein einzelnes Feld aktuell.
- **Nur „Aktuell“ füllt Balken.** Akku und Funkqualität zeigen ihren Balken nur bei aktuell geprüftem Wert.
- **Kein Zeichnen ohne Nachweis.** Die Kursrose braucht einen aktuellen, zeitverifizierten Kurs in −360 … 360°. Der schematische Horizont braucht Nick (±90°) und Roll (±180°), beide aktuell und verifiziert. Sonst sind sie ausgeblendet.
- **Null ist ein Wert.** Ein gemeldetes `0` erscheint als `0`, fehlende oder unplausible Werte als „—“ / „Nicht empfangen“.
- **Kartenaktion.** „Letzten Kartenstandort zeigen“ ist nur bei gültiger WGS84-Position mit Zeitstempel aktiv; `(0, 0)` zählt nicht.
- **Einzelwert-Qualität** zählt ausschließlich die acht angezeigten Felder. Sie ist **kein** Gerätestatus und keine Flugfreigabe.

## Grenzen

Browser-Prüfung mit synthetischen Daten (Chromium, 1440 und 390 px). Nicht geprüft: echte Pilot-2-Webview auf der RC, Android-WebView-Versionen, Live-Daten von RC Pro und Mavic 3M. Ein Pi-Prüfwerkzeug für die Feldstatus (wie in #127 entworfen) ist nicht Teil dieser Änderung.
