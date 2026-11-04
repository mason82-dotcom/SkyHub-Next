# Risikoanalyse: Missionsversand, NDVI, TAK/CloudTAK (04.11.2026)

**Gegenstand.** Drei Erweiterungen von SkyHub Next, Betrieb auf brix-node (Backend) hinter Caddy auf dem Pi, Geräte im Heimnetz:

1. **Missionsversand** an DJI Pilot 2 (RC Pro + Mavic 3M, RC Plus 2 + Matrice 4T). Die DJI Cloud API kennt ferngesteuerte
   Flugaufträge (`flighttask_prepare`/`flighttask_execute`) nur für das DJI Dock. Ohne Dock heißt Missionsversand: SkyHub stellt eine
   geprüfte Route in die Wayline-Bibliothek von Pilot 2, der Pilot lädt sie auf der Fernsteuerung, prüft sie dort und startet selbst.
   SkyHub löst keinen Start, kein Return-to-Home und keine Steuerbefehle aus.
2. **NDVI** aus Mavic-3M-Multispektralaufnahmen (G, R, RE, NIR) mit radiometrischer Kalibrierung.
3. **TAK/CloudTAK**: Drohnen- und Pilotpositionen als Cursor-on-Target (CoT) an einen TAK Server bzw. CloudTAK und an ATAK im LAN.

**Bewertungsmaßstab.** Wahrscheinlichkeit und Auswirkung je hoch/mittel/niedrig, Stufe nach der Matrix
(hoch×hoch = kritisch, hoch×mittel oder mittel×hoch = hoch, …). Verantwortlich ist überall die Betreiberin bzw. der Betreiber
(„Betrieb“) oder die Entwicklung („Entwicklung“); bei einer Ein-Personen-Organisation dieselbe Person, aber getrennte Rollen.

## Befund vor jeder Neuentwicklung

Die Wayline-Bibliothek für Pilot 2 ist auf brix-node aktiv (`SKYHUB_PILOT_WAYLINE_ENABLED=true`). `GET …/waylines` liefert **jede**
Route aus dem WPML-Speicher, obwohl jede als `flightReady: false` und `validationScope: "offline-partial"` markiert ist
(`backend/dji-wayline-http.js`, `backend/wpml-mission-store.js`). Ungeprüfte Entwürfe und frühere Revisionen sind damit für den
Piloten ladbar. Das ist Risiko M1 und wird als Erstes behoben.

## Risikoregister

| ID | Bereich | Risiko | W | A | Stufe | Maßnahme | Verantw. | Status |
|---|---|---|---|---|---|---|---|---|
| **M1** | Flugsicherheit | Pilot lädt einen ungeprüften Entwurf oder eine überholte Revision statt der freigegebenen Route (Bibliothek zeigt alle Revisionen, gleiche Namen) | hoch | hoch | **kritisch** | Pilot 2 sieht nur **ausdrücklich freigegebene** Routen. Freigabe ist ein eigener, protokollierter Schritt mit Passwort/Token, bindet an den SHA-256 der KMZ, gilt für genau eine Revision und läuft ab (Standard 72 h). Neue Revision ⇒ alte Freigabe erlischt. Name in der Bibliothek trägt Revision und Kurz-Hash | Entwicklung | offen → Phase 1 |
| **M2** | Flugsicherheit | Route verletzt Grenzen: Höhe über 120 m AGL (EU 2019/947 Kategorie „offen“), Geschwindigkeit, Abstand zwischen Wegpunkten, Entfernung vom Start | mittel | hoch | **hoch** | Freigabe nur nach **Pflichtprüfung**: Höhe ≤ konfigurierbares Maximum (Standard 120 m relativ zum Start), Geschwindigkeit ≤ DJI-Grenzen, Wegpunktabstand ≥ Mindestwert, Gesamtstrecke/Flugzeit-Schätzung gegen Akkureserve, Höhenmodus explizit. Fehler blockieren, Warnungen müssen einzeln bestätigt werden | Entwicklung | offen → Phase 1 |
| **M3** | Flugsicherheit/Recht | Route führt durch Geo-Zonen (Kontrollzonen, Naturschutz, Wohngebiet) | mittel | hoch | **hoch** | SkyHub ersetzt keine Luftraumprüfung. Freigabedialog verlangt Bestätigung „Luftraum geprüft (dipul/DFS)“ mit Datum. Pilot 2 und DJI-GEO-Zonen bleiben aktiv. Optional später: Abgleich gegen importierte Geo-Zonen (GeoJSON von dipul) | Betrieb | offen |
| **M4** | Flugsicherheit | Route ist für ein anderes Fluggerät/eine andere Nutzlast gebaut (M3M-Route auf M4T) | mittel | mittel | **mittel** | Freigabe nennt Zielgerät (drone/payload model key aus der KMZ); Bibliothek filtert schon nach Modell. Prüfung lehnt fehlende Modellangabe ab | Entwicklung | offen → Phase 1 |
| **M5** | Integrität | KMZ wird zwischen Freigabe und Download verändert (MinIO, Proxy) | niedrig | hoch | **mittel** | Objekte sind write-once (neue Revision = neues Objekt); Download-URL nur für freigegebene ID, SHA-256 aus der Freigabe wird beim Ausliefern gegen die Metadaten geprüft; MinIO-Zugang nur Backend | Entwicklung | teilweise vorhanden |
| **M6** | Zugriff | Jemand im LAN gibt Routen frei oder legt sie ab (Dashboard ist für das LAN ohne Token lesbar) | mittel | hoch | **hoch** | Freigeben und Zurückziehen nur mit Admin-Token (nicht LAN-Ansichtsrecht), nur über Caddy (HTTPS), CSRF/Origin-Prüfung, Auditprotokoll mit Quelle; Pilot 2 bleibt nur lesend | Entwicklung | offen → Phase 1 |
| **M7** | Betrieb | Missverständnis „SkyHub hat die Mission gestartet“; Pilot verlässt sich auf SkyHub-Prüfung | mittel | mittel | **mittel** | Klare Texte („nur bereitgestellt, Start und Prüfung auf der RC“), Checkliste im Freigabedialog, keine Statusanzeige „fliegt Mission“ ohne Telemetrienachweis | Betrieb | offen |
| **N1** | Datenqualität | NDVI ohne gültige Kalibrierung (fehlende Sonnenlicht-Sensorwerte, falsche Belichtung/Gain, Vignettierung) wird als Messwert gelesen | hoch | mittel | **hoch** | Kalibrierkette aus XMP (Irradiance, Gain, Belichtung, Vignettierungspolynom, Black Level) mit Pflichtfeld-Prüfung je Aufnahme; ohne vollständige Kette nur „relativer Index“, deutlich gekennzeichnet. Ergebnis trägt Kalibrierstatus und Herkunfts-Hash | Entwicklung | offen → Phase 2 |
| **N2** | Datenqualität | Bänder nicht deckungsgleich (Parallaxe zwischen den Kameras) ⇒ Randartefakte, falsche Werte an Kanten | hoch | mittel | **hoch** | Bandausrichtung (Registrierung) vor der Indexberechnung; Qualitätsmaß (Korrelation nach Ausrichtung) mit Schwelle, sonst Aufnahme verwerfen | Entwicklung | offen → Phase 2 |
| **N3** | Fehlentscheidung | NDVI-Karte wird ohne Bodenreferenz für Dünge-/Spritzentscheidungen genutzt | mittel | mittel | **mittel** | Ausgabe als Index-Vorschau, keine Ausbringkarte; Hinweis auf Referenzpanel/Bodenvergleich; Export enthält Kalibrierstatus | Betrieb | offen |
| **N4** | Betrieb | Rechenlast (große TIFF-Serien) blockiert Backend | mittel | niedrig | **niedrig** | Eigener Worker-Prozess/Container mit Speicherlimit und Warteschlange; Backend nur Auftrag und Status | Entwicklung | offen → Phase 2 |
| **T1** | Vertraulichkeit | Positionsdaten (Pilot, Drohne, Startpunkt = Wohnort) gehen unverschlüsselt ins Netz oder an Dritte | mittel | hoch | **hoch** | Standard aus. TAK-Server nur über TLS mit Client-Zertifikat (8089); Multicast-SA nur bewusst eingeschaltet und auf das Heimnetz begrenzt (TTL 1); Pilotposition optional abschaltbar | Entwicklung | offen → Phase 3 |
| **T2** | Integrität | Eingehende CoT-Nachrichten (vom TAK-Server) lösen in SkyHub etwas aus | niedrig | hoch | **mittel** | Nur ausgehend. Eingehende Daten werden nicht verarbeitet (kein Empfangspfad, kein Missionsauslöser aus TAK) | Entwicklung | offen → Phase 3 |
| **T3** | Betrieb | Veraltete Positionen erscheinen bei Partnern als aktuell (Verbindungsabbruch) | mittel | mittel | **mittel** | CoT `stale` = Zeit + kurzer Wert (Standard 15 s); nur Positionen mit frischer, verifizierter Quellzeit senden; 0/0-Positionen nie | Entwicklung | offen → Phase 3 |
| **T4** | Zugriff | Zertifikat/Schlüssel für den TAK-Server liegt lesbar im Repo oder in Logs | niedrig | hoch | **mittel** | Nur Dateipfade in der Konfiguration, Dateien 0600 außerhalb des Repos, Docker-Secrets; Logs ohne Zertifikatsinhalte | Betrieb | offen → Phase 3 |
| **B1** | Betrieb | Kein Backup der Missionsdaten und Medien auf brix-node (29 GB MinIO, PostGIS); Freigaben und Auditprotokoll liegen ebenfalls dort | hoch | hoch | **kritisch** | Vom Betrieb am 04.11.2026 bewusst **ohne Backup** entschieden. Folge: Geht die NVMe von brix-node verloren, sind Medien, Routen, Freigaben und Auditprotokoll weg. Die geladene Route bleibt auf der RC erhalten. Neu bewerten, sobald Daten nicht mehr reproduzierbar sind | Betrieb | akzeptiert |
| **B2** | Betrieb | Docker-Update startet alle Container während eines Fluges neu (Bibliothek, Telemetrie, TAK fallen kurz aus) | mittel | mittel | **mittel** | `live-restore` auf brix-node; Updates nicht während Einsätzen; Pilot 2 behält die geladene Route lokal | Betrieb | offen |

## Reihenfolge

1. **Phase 1 – Missionsversand mit Freigabe** (M1, M2, M4, M5, M6): zuerst das Ausliefern ungeprüfter Routen beenden, dann Prüfung und
   Freigabe. Ohne Phase 1 keine weiteren Funktionen produktiv.
2. **Phase 2 – NDVI** (N1–N4) als Worker mit Kalibrierstatus.
3. **Phase 3 – TAK/CloudTAK** (T1–T4), nur ausgehend, standardmäßig aus.
4. **Vor dem Produktivbetrieb:** B2 (`live-restore`) erledigen (B1 ist akzeptiert, siehe Register); Feldtest jeder Route zuerst auf der RC im Simulator
   (Pilot 2 bietet keine Simulation für alle Modelle; sonst kurzer Testflug mit wenigen Wegpunkten, Sichtflug, Notfallplan).

## Grenzen dieser Analyse

Keine Hardwareprüfung, kein Flug. DJI-Verhalten (Import in Pilot 2, Prüfungen auf der RC) stammt aus der Cloud-API-Dokumentation und
dem Demo-Code in `third_party/dji-cloud-api-demo`; es muss auf beiden Fernsteuerungen bestätigt werden. Rechtliche Bewertung
(Betriebskategorie, Kenntnisnachweis, Geo-Zonen) liegt beim Betrieb.
