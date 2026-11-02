# AeroNexusAdvanced → SkyHub-Next: P0 Integrations- und Sicherheitsmatrix

Stand: 2026-11-02. Nur Repository-Analyse, kein Deployment und keine DJI-Hardwarefreigabe.

## Festgeschriebene Basis

- AeroNexusAdvanced `main`: `535e26a1718d87d1629ee0b7ab42d16baae618d0`.
- SkyHub-Next `main`: `7d9f52a5260bd9d5f0528eafa16e59fd142f33dd`.
- SkyHub-Next PR #265 (`feat/thermal-dji-tsdk-integration-20261102`): Thermal-SDK-Service bereits in Bearbeitung. Nicht parallel reimplementieren.

## Entscheidungsmatrix

| Bereich | AeroNexusAdvanced-Code | SkyHub-Next-Basis | Entscheidung / Abnahmegrenze |
|---|---|---|---|
| MQTT/OSD | `cloud_api_mqtt.py`, `cloud_api_osd.py` | `mqtt-ingest.js`, `registry.js` | Nicht übernehmen. Bewährte SKYHUB-1.18-Pfade erhalten. |
| HMS-Verlauf | `hms_history.py` | `hms-catalog.js`, flüchtige Ereignisse | P1: separater, opt-in PostgreSQL-Verlauf; DB-Bereitstellung separat. |
| Thermische PV-Auswertung | `pv_inspection.py`, `thermal_geo.py`, `thermal_flights.py` | `thermal.js`, PR #265 | P2: reine Analysekernfunktion unabhängig von Thermal-PR; nur verifizierte SDK-Raster für PV-Freigabe. |
| FlightHub 2 V2 | `providers.py`, `read_only_transport.py`, `flighthub_*.py` | lokale Pilot-2-/DJI-Cloud-API, kein entsprechender FH2-Poller | P3: getrenntes GET-only Provider-Modul; kein automatisches Geräte-Merging. |
| Mavic 3M Rohbandsignal | `multispectral.py`, `m3m_stack.py` | offline `m3m_*` Raster-Labore | P4: vorgeschaltete lokale DN-Qualitäts-/Rechenstufe; keine radiometrische Validierung behaupten. |
| Metashape/Ergebnisviewer | `metashape_bridge.py`, `metashape_worker.py`, `raster_results.py` | Medienkatalog, COG-Prüfworker | P5: privater Offline-Auftragsexport und Rastervorschau getrennt von Produktions-S3/HTTP. |
| WPML / Route Editor | `wpml_export.py`, `pilot2_wayline_*.py` | WPML Editor, Offline-/Quellen-Audit | Nur validierte Testvektoren übernehmen; keine zweite Mission Engine. |
| Medien / MinIO | `minio_media_index.py`, `media_sync.py` | gemeinsames MinIO, S3-Read-Policy, Galerie | Keine zweite MinIO-Instanz oder Kopie der Originale. |
| UI | `studio_page.py`, `status_cockpit.py` | SkyHub Light UI | Keine zweite FastAPI-Oberfläche; nur separate Fachkomponenten. |

## Unabhängigkeitsvertrag P0–P5

Jeder Entwicklungsbranch startet **direkt** vom obigen SkyHub-Main-Commit. Kein P-Branch darf einen anderen P-Branch als Parent benutzen oder dessen Code als stillschweigende Voraussetzung voraussetzen. PRs müssen getrennt geprüft und nacheinander auf jeweils frischem Main abgenommen werden. Insbesondere P2 enthält keinen eigenen Thermal-SDK-Treiber: die tatsächliche Anbindung an #265 erfolgt ausschließlich später per separatem Integrations-Gate.

## Gemeinsame Freigabegrenzen

1. Keine neue DJI-MQTT-Publikation, kein Pilot-2-Upload/Flugstart, keine Änderung am produktiven Pi.
2. Keine im Git-Repository gespeicherten DJI-/FlightHub-Zugangsdaten, Seriennummern, GPS-Positionen oder MinIO-Originale.
3. Fachliche Berechnungen unterscheiden **Quellenintegrität**, **mathematische Konsistenz** und **wissenschaftlich verifizierte Kalibrierung**. Ein bestandener Unit-Test ist keine Feldabnahme.
4. Produktionspfade für PostgreSQL, MinIO und Docker werden nicht blind überschrieben. SQL-Migrationen bleiben ausdrücklich manuell und opt-in.
5. Fremdcode und Lizenzhinweise aus AeroNexus `NOTICE` (u.a. Apache-2.0, MIT, DJI SDK, Agisoft) vor produktiver Portierung prüfen.
6. Jeder PR enthält Testfälle für positive, negative und Ressourcen-/Zustandsgrenzen. Gegen reale Hardware/Originaldaten sind zusätzliche Abnahmen erforderlich.

## PR-Fortsetzung

P1 = HMS-Transitionsspeicher, P2 = pure PV-Inspektionsmathematik, P3 = FlightHub-GET-Transport,
P4 = isoliertes M3M-Rohband-Rechenlabor, P5 = private Geospatial-/Metashape-Handoff-Labore.
Dies sind **getrennte fachliche Entwicklungsstränge**, nicht eine einzige große Branch-Kette.
