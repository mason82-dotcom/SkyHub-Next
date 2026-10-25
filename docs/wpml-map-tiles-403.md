# SkyHub Next – WPML-Karten: OSM-403-Diagnose (25.10.2026)

## Befund und Änderung

Die Hauptseite zeigte Kartentiles, aber die eigenständigen Seiten `/wpml-editor.html` und `/wpml-survey-preview.html` wurden vom Betreiber als 403 meldend beschrieben. Im Backend war global `Referrer-Policy: no-referrer` gesetzt; beide HTML-Seiten hatten zusätzlich `<meta name="referrer" content="no-referrer">`. OpenStreetMap verlangt bei Browser-Tile-Aufrufen einen HTTP-Referer. Die Leaflet-Kachelebenen hatten bereits `referrerPolicy:'strict-origin-when-cross-origin'`, die Dokumente und Serverantworten widersprachen dem jedoch.

Der Fix setzt den **Dokument-Referrer ausschließlich für beide öffentlichen WPML-Kartenseiten** auf `strict-origin-when-cross-origin`, wodurch für HTTPS-Kartentiles nur Schema/Host/Port und **keine URL-Pfade, Query-Parameter, Tokens oder Waypoint-Daten** übertragen werden. Die bestehende Leaflet-Tile-Option und Copyright-Attribution bleiben erhalten. Alle anderen Routen (Pilot 2, API, Medien, Dashboard) behalten die globalen `no-referrer`-Header. **DJI-Kartenelement-API 403** wegen fehlender Rollen-/Workspace-Berechtigung wird dadurch absichtlich **nicht** umgangen.

## Browser-Praxischeck nach separatem Deployment

1. Auf `/wpml-editor.html` und `/wpml-survey-preview.html` Karten öffnen; in den Entwicklerwerkzeugen beim Tile-Request (nur `tile.openstreetmap.org`) prüfen, ob die Karten statt Blockbildern laden.
2. Im Netzwerktab sicherstellen, dass der Request-Referer ausschließlich die Seitenorigin enthält und **keinen vollständigen Missionspfad oder Zugangstoken**.
3. Im `/api/...`-Antwortheader muss weiterhin `Referrer-Policy: no-referrer` stehen.
4. Falls ein **DJI-Workspace-Kartenelement-Endpunkt** mit 403 antwortet, die Rollen- und Workspace-Prüfung laut `docs/dji-map-access.md` durchführen – niemals alle 403 pauschal in HTTP 200 verwandeln.

Der Fix ist Code/Dokumentation, **kein automatisches Pi-Deployment**. Während Live-DJI-Sitzungen keine Container-Neustarts. Für ein endgültiges 403-Closed ist der echte Browser-Netzwerk-Check nötig. Externe OSMF-Kacheln sind kein Offline-Geodatenbestand und unterliegen der [OSMF Tile Policy](https://operations.osmfoundation.org/policies/tiles/).
