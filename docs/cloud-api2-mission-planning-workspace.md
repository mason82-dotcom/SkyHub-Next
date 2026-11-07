# Cloud API 2 Portal – Missionseditor & Routenplaner (P0)

## Zweck und Abgrenzung

Eine **gemeinsame, bedienbare Planungsansicht** `/cloud-api2.html#planning` in SkyHub-Next nutzt ausschließlich drei bereits vorhandene, unabhängig getestete SkyHub-WPML-Browserwerkzeuge. Das ist keine Portierung des DJI FlightHub-2-Missionseditors, kein proprietärer DJI PaaS-Wayline-Editor und keine neue DJI Cloud API 2 API. Die eigenständige DJI-Cloud-API-2-DevKit-Weboberfläche auf BRIX bleibt unverändert.

| Auswahl | Kanonische Implementierung | Darf sie durchführen? |
| --- | --- | --- |
| WPML-Missionseditor | `/wpml-editor.html` und `wpml-editor-core.js` | Koordinaten und Kamera-/Routenparameter im Browser ändern; lokale KMZ-Datei erstellen; vorhandene explizit autorisierte Speicherschritte |
| Flächen-/Routenplaner | `/wpml-survey-preview.html` / `wpml-survey-preview-core.js` / `wpml-planar-advanced-core.js` | Polygone, Scanrouten und DEM-Stichproben **zur Vorschau**; keine direkt ausführbaren Waylines |
| Routenbibliothek | `/wpml-route-library.html` / `wpml-route-library-core.js` | Entwurfsrevisionen und lokale Speicheraktionen; optionale bestehende MinIO-Synchronisierung ausschließlich nach eigenem Opt-in |

## UX-Vertrag und Kanonizität

- `frontend/public/cloud-api2-planning.mjs` **implementiert keinen zweiten Missionsgenerator**. Es verwaltet nur die Auswahl, den Wechsel und den Ladezustand der bestehenden Seiten.
- Kein eingebettetes Modul wird vor ausdrücklicher Auswahl geladen. Kein automatischer Flugauftrag oder neue AJAX-/MQTT-Abfrage.
- Nach Auswahl bleiben die anderen geladenen Frames montiert, sodass ein bloßer Werkzeugwechsel nicht die Browserbearbeitung verwirft. **Das ist keine Garantie persistenter Speicherung** und keine auftragsübergreifende Transaktion. Bei Reload, Abbruch, Navigationswechsel innerhalb des eingebetteten Moduls oder Browser-Schließung können ungespeicherte Eingaben verloren gehen.
- Der Fallback `separat öffnen` verlinkt ausschließlich die drei bekannten Same-Origin-Originalpfade. Er bleibt auch bei verweigerter iframe-Einbettung (z. B. `X-Frame-Options: DENY` oder CSP `frame-ancestors`) verfügbar.
- Der Ladezustand gilt nur bei geprüftem Same-Origin-Pfad und korrektem Seitentitel als **Oberfläche geladen** – nicht als erfolgreiches DJI-SDK, valide Mission oder Kartendienst-Verfügbarkeit. Unbekannte/fehlgeschlagene Einbettung zeigt **UNBEKANNT** statt PASS.
- Normale Tastenbedienung über echte Buttons mit `aria-pressed`, betitelte iframes, `role=status` und fokussierbare Direktlinks. Responsive Auswahl und eingebettete Editorflächen. Automatisierte Chromium-Prüfung für 320, 390, 834 und 1440 Pixel, Enter-Taste, Touch-Emulation, versteckte Navigationsfehler, CSP-Sperren und ungespeicherte Eingaben; echte Geräteeingabe bleibt gesondert zu prüfen.
- Die Kopfzeile darf nicht irrtümlich `READ ONLY` anzeigen, wenn der Planungsreiter geöffnet ist. Dort lautet sie `ENTWURF · MANUELLES SPEICHERN MÖGLICH`, in reinen Beobachtungsreitern wieder `READ ONLY`. Der Warnhinweis beschreibt auch bestehende explizite Lösch- und MinIO-Aktionen.
- Die bestehende Portal-Stilquelle `cloud-api2.css` wird nur durch `cloud-api2-planning.css` ergänzt. Die intern geladenen WPML-Tools behalten `skyhub-light.css` und ihre bisherigen Design-/Berechtigungsverträge.
- Es findet keine Datenübergabe über `postMessage`, Query-Parameter oder fremde Origins statt. Bereits existierende Same-Origin-LocalStorage- und Backend-Speichermechanismen in den Originalwerkzeugen bleiben bestehen.

## Sicherheitsgrenzen

Die **Portal-Integration selbst** löst keine Speichervorgänge aus; sie fügt weder API-Route noch DJI/MQTT-Publisher hinzu. Die **bestehenden Editor-/Bibliotheksseiten** können auf ausdrücklichen Benutzerklick lokale Entwürfe speichern/löschen oder nach bereits bestehender Authorisierung Mission-KMZ in MinIO speichern. Ein reines `read-only`-Label wäre daher für die gesamte eingebettete Oberfläche falsch. Diese bestehenden Aktionen brauchen weiterhin ihre Originalberechtigungen; der neue Planungsreiter erweitert diese nicht.

Das Labor und live genutzte Pilot-2-Kopplungen bleiben strikt getrennt. WPML-Wegpunkte, geometrische Scan-Kandidaten, DEM-Stichproben, 1.0.6-Referenz-KMZ und ein erfolgreicher Offline-Export begründen weder Terrain-/Hindernis-/Geozonenfreigabe noch `flightReady` oder `dispatchAllowed`. Keine neuen Flug-, Missionsversand-, Geräte-, Kamera- oder Aktuatorbefehle. Insbesondere werden durch Auswahl und Laden keine externen Flugaktionen ausgelöst; **die bestehenden Kartenmodule können jedoch beim Laden externe Kartenkacheln abrufen, und die DEM-Stichprobe kann nach einem separaten Klick Daten an den konfigurierten Höhendienst senden.**

## Nachweis und Freigabe

```bash
node --check frontend/public/cloud-api2-planning.mjs
node --test \
  backend/test/cloud-api2-planning.test.js \
  backend/test/wpml-editor.test.js \
  backend/test/wpml-survey-preview.test.js \
  backend/test/wpml-route-library-ui.test.js
```

Zusätzlich: Browsernachweis für navigierbare Auswahl, Touch/Keyboard, Fallback bei CSP/iframe-Sperre, Nutzbarkeit der eingebetteten Leaflet-Karten nach View-Wechsel, Verhalten bei offener unspeicherter Route, Route-Revisionsspeicherung und Fehlerzustand. CI-Syntax-/Unit-PASS reicht nicht für Flug- oder Hardwareabnahme.

Kein Deployment oder Merge ist Bestandteil des P0-Patches. BRIX-Docker und Raspberry-Pi-Compose bleiben unverändert; der SkyHub-Webserver benötigt eine separate kontrollierte Aktualisierung, bevor der neue Reiter erreichbar ist.

## Skills / Eigentümer

- `frontend-design` + `frontend-design-premium` (Design, Zustand, Barrierefreiheit und kanonische Module)
- `.agents/skills/skyhub-planar-wayline/SKILL.md` (Geometrie, Höhenbezug, Flugfreigabegrenzen)
- `.agents/skills/skyhub-cloudapi2-keyless/SKILL.md` (Cloud API 2 / SkyHub read-only Portal-Grenzen)
- `DESIGN.md`, `UX-CONTRACT.md` und bestehende WPML-Dokumentation bleiben maßgeblich.
