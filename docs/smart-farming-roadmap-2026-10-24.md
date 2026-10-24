# SkyHub Smart Farming – technische Roadmap 2.1

**Stand:** 24.10.2026 · **Repository:** mason82-dotcom/SkyHub-Next · **Reviewbasis:** main bei bb73341d04c8c8fc044c1a46caf944e0acdf773f · **Status:** Planung, keine Betriebsfreigabe.

## 1. Ziel und maßgebliche Architekturentscheidung

SkyHub Smart Farming wird als eigenständiger, wissenschaftlich überprüfbarer Analysebereich für DJI Mavic 3 Multispectral (M3M) entwickelt. Primäre Datenbasis sind unveränderte Originaldateien, kalibrierungsrelevante Metadaten und numerische, nachvollziehbare Rasterprodukte. Kolorierte NDVI-/NDRE-Karten sind **abgeleitete Ansichten**, keine ersatzfähige Messdatenquelle. DJI SmartFarm dient als Funktions- und Agras-Workflow-Referenz; DJI Terra und OpenDroneMap/QGIS als technische Referenzen für Rasterprodukte. Der SmartFarm-Export numerischer Einzelbänder oder Indexraster bleibt **ungeklärt**, bis eine authentifizierte Version mit Testdatensatz geprüft ist.

**Nicht zulässig:** Aus unverifizierten TIFF-/XMP-Metadaten, bloßer Namensgruppierung, synthetischen Rastertests oder kolorierten Kartenausgaben eine Reflektanz-/Agronomie-/Flugfreigabe ableiten. Keine automatische Dünge- oder Pflanzenschutzdosis allein aus NDVI.

## 2. Tatsächlicher Ausgangsstand – nicht mit einem Release verwechseln

| Bestandteil | Stand am Review-SHA | Einschränkung |
| --- | --- | --- |
| M3M-Dateinamens-Inventur und CLI | In main, offline/read-only | Nur Namensheuristik; keine Bildinhalts- oder Sensorverifikation |
| Begrenztes TIFF-/XMP-/S3-Inventar | Separate Module und synthetische Tests in main | Kein Nachweis radiometrischer Kalibrierung oder Live-S3-Freigabe |
| Pilot-2-Medien-/MinIO-Grundlage | Sicherheits-/Mediencode teilweise vorhanden | Tatsächliche Pi-Aktivierung, IAM/STS, Speicher- und Hardwareabnahme gesondert |
| Legacy-M3M-Agrarworker | backend/workers/m3m_agri_processor.py vorhanden | Nutzt synthetisch erzeugte Zufallsbilder, nicht übergebene M3M-Dateien; enthält fest kodierte N-Dosen und Demo-ISOXML. **Nicht für reale Ausgaben aufrufen.** |
| Experimentelle Rasterpipeline | In offenem Draft-PR #104 konsolidiert | Erwartet bereits extern korrigiertes/orthorektifiziertes Fünfbandprodukt, führt nicht selbst die M3M-Rohkalibrierung aus |
| NDVI/NDRE/GNDVI/OSAVI, pixelweise QA und Integritätsbelege | Entwurf in Draft-PR #104 | Synthetische Evidenz; keine reale M3M-/Panel-/Georeferenzierungsabnahme |
| Authentifizierter Read-only-Katalog + eigene Smart-Farming-Seite | Entwurf in Draft-PR #104 | Feature-Flag aus; nur Metadaten, keine GIS-Tiles und keine operativen Freigaben |
| DEDAL-/ODM-Referenzadapter | Experimentell in Draft-PR #104 | Originalarchiv, Lizenz, reproduzierbare Ausführung und Hardware-Qualität noch nicht abgenommen |
| CI für den Konsolidierungs-PR | Blockiert: fehlgeschlagene Workflows mit 0 ausgeführten Jobs | Kein erfolgreicher Raster-Testlauf daraus ableitbar |

**PR-Koordination:** Der Draft-PR #104 (https://github.com/mason82-dotcom/SkyHub-Next/pull/104) ist die bevorzugte Konsolidierungslinie; die älteren gestapelten M3M-PRs #48/#51/#55/#59/#64/#72/#77/#79/#82/#84/#86 nicht zusätzlich blind mergen. Die folgende Roadmap setzt **keinen Merge** voraus. Gegen aktuellen main rebasen/vergleichen, CI-Ausfallursache ermitteln, Sicherheitsdiff und Abnahmekriterien prüfen; bis dahin Draft lassen.

## 3. Zielarchitektur und Verantwortungen

Datenweg: **M3M Originale (SD oder autorisierter Pilot-2-Upload) → schreibgeschützter Ingest → unveränderliche Objektablage → Metadaten-/Kalibrierungsprüfung → externer Photogrammetrie-Worker → quantitativer GeoTIFF/COG-Speicher → Index-Worker + unabhängige QA → GIS-Katalog → geschützte Smart-Farming-UI → freigegebene GIS-Exporte → separat genehmigte Applikationsplanung.**

- **Pi 5 / Root-Backend:** Authentisierung, Workspace-Grenzen, Jobplanung, Metadaten, Uploadstatus, katalogisierte Artefakte, Audit, API. Keine großflächige GPU-Photogrammetrie auf dem Pi voraussetzen.
- **S3-kompatibler Speicher:** unveränderte Originalobjekte, versionierte Rasterprodukte, SHA-256, getrennte Buckets/Prefixe, minimale IAM-Rechte. Vor Nutzung SSD-Belegung, Versionierung, Backup und Restore prüfen. MinIO-Root-Account niemals als Pilot-Credential.
- **PostgreSQL/PostGIS:** Felder, Geometrien, Befliegungen, Captures, Rasterkatalog-Metadaten, Qualitätsberichte, Zeitreihen und Zonenrevisionen. Große Raster als Objekte, nicht in JSONB oder unkontrolliert als DB-Blobs.
- **Isolierter Python-/GDAL-/Rasterio-Worker:** deterministische numerische Verarbeitung, rasterbasierte Masken und Export. Worker erhält nur scoped, zeitlich begrenzte Leserechte auf Eingaben und Schreibrechte auf neue Ergebnis-Prefixe.
- **Externer ODM-/alternativer Photogrammetrie-Worker:** bandgetreue Rekonstruktion, Orthorektifizierung und Georeferenzierung. Prozessgrenzen, Ressourcenlimits, Bildquellen, Versions-/Lizenznachweise.
- **Frontend:** eigene Smart-Farming-Navigation mit unabhängigen Kontexten für Luftfahrtelemetrie, Karten, Analysen und Applikationsplanung; keine implizite Flug-/Agras-Steuerung.

## 4. Nachweisstufen, die der gesamte Stack durchsetzen muss

| Gate | Klasse | Nachweis | Was noch verboten bleibt |
| --- | --- | --- | --- |
| G0 | filename_candidate | Nur plausibler RGB/G/R/RE/NIR-Dateinamenverbund | Rohdatenfreigabe, Reflektanz, Indizes |
| G1 | source_verified | TIFF-IFD/Pixelzugriff, XMP/EXIF, sichere Band- und Capture-Zuordnung, Hash, Herkunft | Kalibrierte Reflektanz und quantitative Vegetationsdiagnose |
| G2 | spatial_verified | Geometrische Bandregistrierung, CRS, GSD, NoData, Orthomosaik-QA | Annahme radiometrischer Genauigkeit |
| G3 | radiometric_processed | Dokumentierte Black-Level-, Gain-, Exposure-, Vignettierungs- und DLS-Verarbeitung mit Versions-/Parameternachweis | Bezeichnung „absolute Reflektanz“ ohne Referenz-/Unsicherheitsnachweis |
| G4 | quantitative_validated | Unabhängige Pixelmathematik, Referenzdaten/Panel oder begründetes relatives Kalibrierungsverfahren, Unsicherheits- und Vergleichsbericht | Automatische Dünge-/Spritzdosierung |
| G5 | agronomy_reviewed | Vor-Ort-Scouting, Kultur-/Entwicklungsstufe, Boden-/Witterungsdaten, menschliche Interpretation | Maschinenexport ohne separate Freigabe |
| G6 | machine_export_approved | Format-/Koordinaten-/Flächen-/Dosenvalidierung, Zielgeräte-/Firmwaretest, Vier-Augen-Freigabe | Unbestätigte Flug-/Applikationsausführung |

Die Gates sind **keine automatische einzige Statusleiter**: G2 und G3 können getrennte Teilnachweise besitzen. Freigaben werden als unabhängig verifizierte, widerrufbare Attribute geführt, nicht aus einem einzelnen Zähler oder aus „success“ des Jobs abgeleitet. Auf Produktebene unterscheiden: digital_number, normalized_signal, relative_reflectance, absolute_reflectance und index. Fehlende Einheit/Kalibrierung sperrt höhere Analyseansprüche.

## 5. Implementierungsphasen

### P0 – Sofort: Review- und Wissenschaftsschutz

**SF-000: Hauptbranch- und Draft-PR-Abgleich.** Exakte Main-/Head-SHAs, geänderte Dateien, Merge-Base und laufende CI überprüfen. Fehlgeschlagene Actions-Runs mit 0 Jobs als Infrastruktur-/Workflowproblem diagnostizieren, nicht als gescheiterte Pixeltests; reproduzierbare Offline-Tests isoliert ausführen. Draft-PR #104 erst nach wirklichem grünem Jobstatus und getrennten Reviews für Backend, UI und Worker neu bewerten.

**SF-001: Demo-Worker stilllegen/kennzeichnen.** Synthetische Zufallsdaten und feste 180/140/100-kg-N/ha-Dosen dürfen in keinem realen UI-/Exportpfad erscheinen. Den bestehenden Worker nicht heimlich als M3M-Analyse verwenden; alternativ nur als expliziten Testfixture-Prozessor umstellen, dessen Ergebnisse unauslöschlich als synthetic markiert sind. ISOXML-Demo ist kein gültiger Maschinenexportnachweis.

**SF-002: Daten-/Sicherheitsvertrag.** Workspace-Identitäten, Rollen (Viewer, Analyst, Agronomy Reviewer, Export Approver, Administrator), Asset-Metadaten, privates Objekt-Pinning, Fehler ohne EXIF-/GPS-Leaks, strikte Limits für TIFF-Kompression, Tiling, Pixelzahl, Dateigröße, XMP/XML und Uploads. Allseitig fail-closed.

**Abnahme P0:** 0 produktive Routen oder DJI-Publisher freigeschaltet; Runtime- und UI-Negativtests verhindern synthetische Empfehlungen und nicht verifizierte „ready“-Flags; Merge-Review dokumentiert.

### P1 – Authentifizierter M3M-Ingest und Datenherkunft

**SF-110: Lokaler Batchimport.** Five-capture-Import von SD/Upload: Originalbytes unverändert, SHA-256, sichere Dateipfade, Quarantäne bei Teil-/Doppelsets, unveränderliche Batch-ID und Manifest, stabile Pagination.

**SF-120: Format-/Metadatenvalidierung.** G/R/RE/NIR-TIFF mit Pixeltyp, BitsPerSample, Kompression, XMP BandName, CaptureUUID bzw. geprüfter Gruppierung; RGB-JPEG getrennt. Exposure/Gain/BlackLevel/Vignetting/DLS, Gimbal, RTK/GNSS, UTC und Kameramodell erfassen; Originalwerte nur in geschütztem Provenienzspeicher.

**SF-130: DJI-Medienadapter.** Pilot-2-HTTPS-Upload mit Fast Upload, Tiny Fingerprints, zeitlich begrenzten Credentials, serverseitigem HEAD-/Hash-Nachweis und authentifiziertem Callback. Datei existiert nicht allein wegen eines Upload-Callbacks. Vorher isolierte MinIO-IAM-/STS- und Backupprüfung.

**SF-140: Qualitätsbericht.** Vollständigkeit je Band, Duplikate, TIFF-Payload tatsächlich gelesen, XMP-Konsistenz, Kamera-/Bandverwechslung, RTK-Status und fehlerhafte Datensätze; keine vertraulichen Werte in Standardreports.

**Abnahme P1:** Reale anonymisierte M3M-Fixture mit vollständigem Fünfersatz, Teilset, Duplikat, korruptem TIFF und fehlerhaftem XMP; Positive-/Negativtests; rekonstruierbare Hashmanifest-Identität; keine Upload- oder Statusannahme ohne Speicherbeleg.

### P2 – Radiometrie, Geometrie und quantitative Rastersicherheit

**SF-210: Kalibrierungsprofile.** Versioniertes, quellbelegtes M3M-Kameraprofil; DJI-Bildverarbeitungsleitfaden nur als Ausgangspunkt; Black-Level/Gain/Exposure/Vignettierung/DLS und optional Referenzpanel inklusive Panel-Reflektanzwerten, Sonnenstand, Messbedingungen und Unsicherheitsklasse. Kein ungedeckter DN→absolute-reflectance-Cast.

**SF-220: Bild-/Bandregistrierung.** Entzerrung, Kamera-/Bandzuordnung, Co-Registrierungsfehler, Feature-Tie-Points bzw. Kameramodell, Bildschärfe/Überbelichtung/Bewegung prüfen. DJI- und ODM-Ausgaben an klar dokumentierten Prüfdatensätzen vergleichen.

**SF-230: Orthomosaik-Worker.** Reproduzierbarer externer ODM-Job (Version/Digest/Flags gepinnt); getrennte Artefakte für RGB-Vorschau und G/R/RE/NIR; korrekte Bandreihenfolge, CRS, Pixelgröße und NoData-Masken. Ein „fünftes Band“ darf nicht stillschweigend als zusätzliche quantitativ kalibrierte sichtbare Wellenlänge ausgegeben werden.

**SF-240: Rasterkern.** Nur auf explizit kompatiblen, ausgerichteten numerischen Bändern Indizes berechnen: NDVI=(NIR-R)/(NIR+R), NDRE=(NIR-RE)/(NIR+RE), GNDVI=(NIR-G)/(NIR+G), OSAVI=1.16(NIR-R)/(NIR+R+0.16). Additive Konstanten wie in OSAVI setzen eine physikalisch geeignete Reflektanzskala voraus; auf DN oder willkürlich skalierten Signalen ist das unzulässig. Keine EVI-Standardformel ohne multispektralen Blaukanal. NoData, NaN, Divisionsnullen, Sättigung und negative/über-1-kalibrierte Werte kennzeichnen statt heimlich abschneiden.

**SF-250: Unabhängige QA.** Stichproben-Pixelprüfung durch zweite Implementierung; GeoTIFF-Block-/Grid-Identität, CRS/GSD, Valid-Pixel-Anteil, Verteilung/Histogramm, Cloud-/Shadow-/Bare-Soil-Masken, Indexrange, räumliche Offset-Toleranzen. Qualitätsgrenzen aus Referenzdatensätzen ableiten, nicht auf gut Glück festlegen.

**Abnahme P2:** 1 bis 2 reale, nachvollziehbare M3M-Flüge einschließlich Referenzpanel bzw. dokumentierter begrenzter relativer Verarbeitung; numerischer Diff gegen manuell gerechnete Pixel und DJI-Terra-Vergleich; Ergebnisse transparent als relativ oder absolut kalibriert ausweisen. Keine agronomische Freigabe durch reinen Raster-„Pass“.

### P3 – Kartenoberfläche und offene GIS-Produkte

**SF-310: Datensatzkatalog.** Importlisten, Felder, Kampagnen, Flüge, Bandsets, Qualitätsgate, Algorithmus-/Worker-Version, räumliche BBox und Assetherkunft; experimenteller #104-Katalog nur nach Review integrieren.

**SF-320: GIS-Darstellung.** Numerische NDVI/NDRE/GNDVI/OSAVI-Raster über separat abgesicherte COG-/Tile-Pipeline, festgelegte und benutzerdefinierte Paletten, persistente Legenden und Histogramme, NoData-/Boden-/Schatten-Kennzeichnung. Farbe ist niemals Quelle numerischer Messwerte.

**SF-330: Punkt- und Polygonanalyse.** Map-Click zeigt reale G/R/RE/NIR-Werte, Indizes, Einheit/Kalibrierung, räumlichen Rasterbezug und QA. Polygone liefern pixelgewichtet Fläche, Median, Mittel, Standardabweichung, Perzentile und Anteil maskierter Fläche. Interaktive Flächenauswahl nur bei freigegebenem Workspace.

**SF-340: Offene Exporte.** GeoTIFF/COG Float32 für numerische Band-/Indexraster, PNG/JPEG nur als farbige Vorschau, GeoJSON/GeoPackage für Zonen, CSV/JSON für zonale Zahlenwerte und maschinenlesbare Provenienz (STAC Item/Collection als Zielstandard). Export manifestiert CRS, Einheit, NoData, Modellrevision, Validierung und SHA-256.

**Abnahme P3:** Re-import in QGIS/GDAL mit identischen numerischen Pixelwerten; kontrollierte räumliche Point-/Polygon-Abfragen; keine Raster-URL- oder GPS-Leaks an unberechtigte Nutzer; mobile Nutzung getestet.

### P4 – Landwirtschaftliche Analytik und zeitliche Vergleiche

**SF-410: Feldbibliothek.** Mehrere Felder, Kulturart, Schlaggrenzen/Geometrieversion, Fruchtfolgejahr, Kampagne und Befliegungen; präziser Flächenbezug statt „mission_id als Feld“.

**SF-420: Statistiken und Masken.** Vegetationsbedeckung, Flächenanteile, Perzentile, Verteilungen, NDVI-/NDRE-Bin-Statistik. Bodenmaskierung nicht mit der schlechtesten Vitalitätsklasse gleichsetzen.

**SF-430: Zeitreihen.** Gleiche Felder/Geometrien, passende Kulturstadien, vergleichbarer GSD/CRS, Radiometriestatus, Tageszeit/Sonnenbedingungen und NoData. Unvergleichbare Missionen markieren; keine irreführende automatische Differenzkarte.

**SF-440: Anomalien/Scouting.** Relative Feldabweichungen, Zonenmarker, Feldbegehungsaufgaben, manuelle Beobachtung inklusive Foto und Zeitstempel. Ursachenklassifikation (Wasser, Nährstoff, Schädlinge) bleibt Hypothese, bis Zusatzdaten oder Feldmessung vorliegen.

**Abnahme P4:** Konsistente Zonenzahlen, deterministische Replay-Analysen; Vergleich verweigert inkompatible Kalibrierung/Geometrie; Feldbeobachtungen getrennt von Messwerten gespeichert.

### P5 – SmartFarm-Parität und Interoperabilität

**SF-510: SmartFarm-Audit.** Authentifizierte UI-Version/Region/Tarif, mit identischem M3M-Batch in SmartFarm prüfen: Vegetationsindex-Optionen, Detailansicht, Zonate und Site-Specific, Exportdialoge, numerische GeoTIFFs oder kolorierte Karten, Agras-/djitile-Export. „Nicht dokumentiert“ ist **kein** negatives Messergebnis.

**SF-520: DJI-Terra-Parität.** Band- und Indexraster aus Terra unabhängig lesen und dokumentieren; numerisches index_map gegenüber index_map_color prüfen, Pixelvergleich bei gleichem Bezug und Toleranzbudget.

**SF-530: Standardisierte Importadapter.** SkyHub akzeptiert zusätzliche externe, georeferenzierte GeoTIFFs/COGs und Vektorprodukte mit strengem Datentyp-/CRS-/Provenienzvertrag, ohne ihnen automatisch die Qualität selbst kalibrierter Daten zuzuschreiben.

**Abnahme P5:** Reproduzierbare Kompatibilitätsmatrix mit konkreten Exportdateien, Formaten, Versionen und Prüfsummen. Proprietäre djitile-Datei erst in isoliertem Leseexperiment untersuchen, nie als bestätigten wissenschaftlichen Rasterexport darstellen.

### P6 – Managementzonen und freigegebene Applikationskarten

**SF-610: Zonenentwürfe.** Zwei- bis fünfklassige Zonation, feldbezogene Quantile/Schwellen, flächengrößengeprüfte Polygone, Hindernisse und Ausschlussflächen. Versionierung, Audit, menschliche Bearbeitung und „Entwurf“-Status.

**SF-620: Agronomischer Review.** Nährstoff-/Pflanzenschutzmaßnahme, Kultur, BBCH, Bodenprobe, Betriebsdaten, rechtliche/geografische Grenzen, zulässige Produkt- und Dosisbandbreiten, Reviewer und Freigabe dokumentieren. NDVI allein bestimmt keine Ausbringmenge.

**SF-630: Maschinenexport.** GeoJSON/GeoPackage als Datenexport zuerst; erst danach kontrollierte proprietäre Agras-Karte bzw. ISO 11783 TaskData entsprechend gültiger Geräte-/Implement-Spezifikation und Feldtest. Separate Rechte und Review für Applikations- vs. Flugfreigabe.

**Abnahme P6:** Geometrie, CRS, Dosen/Einheiten, Höchst-/Mindestwerte, Maschinenraster und Negativtests, akzeptiertes Testformat an realem Zielsystem, Audit-Trail und explizite Freigabe vor operativer Verwendung. Keine Ausführung von WPML oder DJI-Services durch den Kartenexport selbst.

### P7 – Forschung und Erweiterungen (nicht MVP)

Ertragsschätzung nur mit Feld-Ground-Truth; ML-basierte Pflanzen-/Unkrauterkennung getrennt nach Modell und Sensor; kulturartspezifische Stressmodelle; externe Wetter-, Boden-, Satelliten- und Sensorzeitreihen; zonale Empfehlungen mit dokumentierten Unsicherheiten; Multi-Sensor-Vergleich. Keine ungetesteten KI-Schätzungen als Messwerte oder Fachanweisung ausgeben.

## 6. Datenmodell – additive Tabellen, keine Änderung historischer Flugdaten

Vorgeschlagene Beziehungen und Pflichtfelder (detaillierte DDL erst nach Schema- und Restore-Test):

- **sf_fields**: id, workspace_id, name, crop, season, geom (MultiPolygon, SRID 4326), geometry_revision, created_at.
- **sf_surveys**: id, field_id, capture_window, platform, aircraft_model, source_collection_id, geometry/crs, method, status.
- **sf_capture_sets**: id, survey_id, capture_uuid_or_verified_key, expected_bands, observed_bands, validation_state, duplicate_policy.
- **sf_assets**: id, capture_id, band_key, immutable_object_ref, sha256, media_type, dimensions, pixel_type, private_original_metadata_ref.
- **sf_calibration_profiles**: id, camera_model, profile_version, reference_documents, correction_parameters_digest, panel_reference, status, reviewer.
- **sf_processing_jobs**: id, survey_id, pipeline_version, image_digest, input_manifest_digest, parameters_digest, runtime_digest, status, diagnostics_ref.
- **sf_raster_products**: id, job_id, kind (band/index/visualization/mask), band_index, quantity_semantics, calibration_class, object_ref, sha256, crs, gsd, nodata, unit, qa_id.
- **sf_qa_reports**: id, product_id, validator_digest, reviewed_at, metrics JSONB whitelist, failure_codes, independent_review_digest.
- **sf_analysis_regions**: id, field_id, geometry_revision, survey_id, stats, method/version, masks_policy.
- **sf_zones**: id, field_id, source_raster_id, geometry, class_definition, area, editable_revision, interpretation_status.
- **sf_prescription_drafts**: id, zone_revision_id, treatment, controlled_rates, unit, agronomist_decision, machine_target, approval_state, export_revision.

Bereits vorhandene Tabellen **media_assets** und **agrar_management_zones** dürfen nicht blind überformt werden. Insbesondere **recommended_n_dose** darf nicht aus NDVI automatisch befüllt werden. Migrationsänderungen nur additiv und zunächst im isolierten PostGIS-Test; RLS/Workspace-Rechte, Indizes, Revisionskontrolle, Backup/Restore und Aufbewahrung nachweisen.

## 7. API-Zielbild (nicht als aktuell verfügbar interpretieren)

| Pfadentwurf | Methode | Zweck | Schutz |
| --- | --- | --- | --- |
| /api/smart-farming/fields | GET/POST | Felder lesen/anlegen | Workspace, Geometrie- und Schreibrechte |
| /api/smart-farming/surveys | GET/POST | Kampagnen, Flüge, Aufnahme-Batches | Auth, idempotente Upload-ID |
| /api/smart-farming/surveys/:id/assets | GET | validierte Bandsets und Importstatus | keine Roh-EXIF-Ausgabe |
| /api/smart-farming/jobs | GET/POST | Workerstatus, Analyseauftrag | limitierte Queue/Quota |
| /api/smart-farming/rasters/:id | GET | Produktmetadaten, QA, Kalibrierung | Zugriffsentscheidung vor URL-Ausgabe |
| /api/smart-farming/rasters/:id/sample | POST | Pixel-/Koordinatenabfrage | Bounds, Rate-Limit, gültiges CRS |
| /api/smart-farming/fields/:id/statistics | POST | zonale Statistik | autorisierte Geometrie, Flächenlimits |
| /api/smart-farming/fields/:id/timeseries | GET | vergleichbare Aufnahmen | explizite Qualitätsfilter |
| /api/smart-farming/exports | POST | Downloadpaket mit Manifest | dokumentierter Freigabezustand |
| /api/smart-farming/prescriptions | POST | **Entwurf**, nicht Maschinenbefehl | Agronomy Reviewer |
| /api/smart-farming/prescriptions/:id/approve | POST | getrennte Maschinenexportfreigabe | Vier-Augen-Prinzip, revisionsgebunden |

Statusübergänge: discovered → verified_source → processed_candidate → qa_passed → analyst_reviewed → published. Parallel dazu bleiben calibration_class, spatial_verified und operational_approval eigene, nie automatisch optimistisch gesetzte Felder. Beim Fehlschlag bleibt die letzte gültige Version unverändert und es wird keine partielle „grüne“ Statistik ausgegeben.

## 8. Frontend-Informationsarchitektur

Eigenständiger Bereich **Smart Farming** (nicht der TAK-Tab):

1. **Übersicht:** Felder, letzte Befliegung, ausstehende Importe, QA-/Kalibrierungswarnungen.
2. **Datensätze:** Fünfkanal-Captures, Dateistatus, private Metadatenansicht, Importfehler.
3. **Vegetationskarte:** Layer RGB/G/R/RE/NIR, NDVI/NDRE/GNDVI/OSAVI, Maßstab, Palette, Masken, Konfidenz.
4. **Analyse:** Map-Click auf numerische Pixel, Histogramm, ROI/Polygon, Statistik, Flächenanteile.
5. **Zeitvergleich:** synchronisierte Karten, Kurven, vergleichbare Aufnahmen und Qualitätswarnung.
6. **Scouting:** manuelle Befunde und Außendienstaufgaben.
7. **Managementzonen:** editierbare Zonen als Planungsvorschlag, nicht Behandlungsempfehlung.
8. **Export und Freigabe:** GeoTIFF/COG, CSV/GeoJSON/GeoPackage sowie separater, gesperrter Maschinenworkflow.
9. **Verarbeitung/Diagnostik:** laufende Jobs, Versionen, Kalibrierung, QA, Rechte, Speicherlast.

Feste Darstellungsregel: Statistik und Pixelwerte **aus numerischem Raster**, nie aus PNG-Farben rekonstruieren. Ein Layer ohne G4 trägt einen deutlich sichtbaren Experimentierhinweis und darf nicht als agronomisch validiert erscheinen.

## 9. Qualität, Betrieb und Sicherheitsgates

- **Wissenschaft:** synthetische Unit-Tests + echte anonymisierte M3M-Originaldateien + unabhängiger Pixel-/GIS-Vergleich; Panel-/DLS-Metadaten und Unsicherheiten dokumentieren.
- **Integrität:** SHA-256 von Originalen/Produkten, gepinnte Images/Abhängigkeiten, atomare Ergebnisveröffentlichung nach vollständiger QA, unveränderliche Prüfreports.
- **Sicherheit:** private Buckets, kein clientseitiger direkter Objektzugriff ohne scoped und kurzlebige Berechtigung, Schutz vor ZIP-/TIFF-Bombs, path traversal, symlinks, metadata injection, große ROI-Anfragen; Workspace-Trennung und keine pauschal lesbaren URLs.
- **Performance:** Pi bleibt Orchestrator. Ressourcenbudgets, Parallelitätsbegrenzung und Cancel-/Retry-Verhalten für externe Workers; Tile-/COG-Cache erst nach Sicherheitsprüfung.
- **Betrieb:** Live-MQTT/OSD, Cloud-API-Replies, Flugmissionen und historischer PostgreSQL-Bestand unberührt; keine neue Compose-Startabhängigkeit für SkyHub-Backend, kein unkontrolliertes Datenbankmigrationstool beim App-Start.
- **Observability:** Verarbeitungslaufzeit, Fehlerquote, Speicherverbrauch, Valid-Pixel-Anteil, Registry-Audit; keine Passwörter/GPS-/EXIF-Rohdaten im Standardlog.
- **Release:** zuerst CI und Offline-Worktree, dann isolierte Staging-DB/S3, danach hardwarebestätigte Feldprobe. Backup+Restore demonstrieren, bevor Live-Daten eingeführt werden. Ein GitHub-Merge ist kein Pi-Deployment.

## 10. Priorisiertes Backlog und Abhängigkeiten

| Reihenfolge | Tickets | Voraussetzung | Lieferumfang |
| --- | --- | --- | --- |
| Sofort | SF-000 bis SF-002 | aktuelles main und PR #104 prüfen | überprüfbare Wissenschafts-/Berechtigungsgrenzen |
| Danach | SF-110, SF-120, SF-140 | G0 und gesicherte Originalfixtures | realer Dateiinhalts-/Capture-Nachweis |
| Parallel isoliert | SF-130 | MinIO IAM/STS, Restore und Pilot-2-Hardware | sicherer Medienupload ohne Arbeitsdatenverlust |
| Danach | SF-210, SF-220 | G1 + DJI-Kamerakalibrierung | geprüfte Band-/Radiometrievorbereitung |
| Danach | SF-230, SF-240, SF-250 | G2/G3, externes Worker-Labor | reproduzierbare quantitative GeoTIFFs |
| Danach | SF-310 bis SF-340 | G4 für wissenschaftlichen Nutzwert | interaktive Karten, Stats, offene GIS-Exporte |
| Danach | SF-410 bis SF-440 | mehrere vergleichbare Surveys | Kultur-/Feldhistorie, Zeitreihen, Scouting |
| Unabhängiger Vergleich | SF-510 bis SF-530 | reale SmartFarm-/Terra-Datensätze | exportverifizierte Herstellerparität |
| Später | SF-610 bis SF-630 | G4/G5 und Maschinenvertrag | geprüfte Applikationsentwürfe |
| Forschung | P7 | Feld-Ground-Truth | ML/Ertrag/Kulturmodelle |

### Erstes verbindliches MVP

Ein importierter echter M3M-Datensatz lässt sich mit nachvollziehbarer fünfteiliger Capture-Identität öffnen. Es gibt einen vollständigen QA-Bericht, eine getrennte RGB-Vorschau, vier numerische multispektrale Bänder, einen **als relativ oder absolut korrekt qualifizierten** NDVI-/NDRE-Layer, Pixel-/Polygonwerte und einen offenen GeoTIFF-Export mit Manifest. Auf einem separaten Linux-Worker wird die Rekonstruktion reproduziert, während der Pi seine DJI-Telemetrie unverändert weiter verarbeitet. Kein automatischer Düngeexport und keine Flug-/Sprühsteuerung.

## 11. Externe Primärquellen / Grenzen

- DJI Mavic 3M Image Processing Guide (offizieller Kalibrierungsleitfaden): https://dl.djicdn.com/downloads/DJI_Mavic_3_Enterprise/20230829/Mavic_3M_Image_Processing_Guide_EN.pdf
- DJI Cloud API – Pilot Media Management (Upload-Vertrag, temporäre S3-Credentials): https://developer.dji.com/doc/cloud-api-tutorial/en/feature-set/pilot-feature-set/pilot-media-management.html
- DJI Terra – Unterschied index_map vs. index_map_color: https://repair.dji.com/help/content?customId=01700004997&lang=en&paperDocType=ARTICLE&re=US&spaceId=17
- OpenDroneMap – Multispectral (M3M-Unterstützung ab ODM 3.5.3): https://docs.opendronemap.org/multispectral/
- OpenDroneMap – Radiometric calibration (camera+sun experimentell): https://docs.opendronemap.org/arguments/
- SkyHub-Integrationskandidat: https://github.com/mason82-dotcom/SkyHub-Next/pull/104

**Dokumentationsstatus:** Dieses Dokument ist ein Entwicklungsauftrag, kein implementierter Funktionsnachweis. Jeder Meilenstein erhält beim Abschluss den exakten Code-SHA, Test-/Geräte-Evidenz, offene Unsicherheit, Rechtefreigabe und gegebenenfalls das tatsächlich installierte Pi-Image.
