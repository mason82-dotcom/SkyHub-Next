# P3.6f – Bindung von M3M-Versuchspaaren an unabhängig gepinnte Originaldaten

Stand 02.11.2026. Neues **read-only Offline-Labor**; keine produktive SkyHub-HTTP-Route, kein Raspberry-Pi-/MinIO-/DJI-Deployment, keine automatische Freigabe. Baut auf den bereits in main integrierten P3.6d (#253: TIFF-Kohortenvergleich) und P3.6e (#254: Operator-Störfaktorenplan) auf.

## Warum die Bindung notwendig ist

P3.6d kontrolliert echte lokale TIFF-Dateien gegen unabhängige Quell-/Evidenz-SHA-256-Belege, die dazugehörige anonymisierte A/B-Kohorte und die **Bytes** einer operatorseitigen Firmware-Belegdatei. P3.6e prüft dagegen deklarierte Belichtungs-, Gain-, Einstrahlungs-, Höhen- und Zeitparameter mit operatorseitigen Toleranzen; P3.6e validiert die Byteexistenz seiner referenzierten DLS-/Panel-Hashes bewusst nicht.

**P3.6f schließt exakt diese Datenverknüpfungslücke.** Der neue Offline-Worker backend/workers/m3m_private_paired_source_binding.py nimmt beide getrennt extern gepinnten privaten Manifestdateien entgegen und überprüft ihre gegenseitige Konsistenz.

## Exakter Prüfvertrag

- P3.6d: 2–8 anonymisierte Capture-Kandidaten in A/B; P3.6e: 1–4 A/B-Paare mit exakt je einer eigenständigen Aufnahme pro Gruppe. Alle Capture-Receipts und alle im Paarplan benannten SHA-256-Werte müssen eine **1:1-Zuordnung** ergeben. Zusätzliche, fehlende oder mehrfach verwendete Capture-Belege sind ein Fehler.
- Die Firmwarebeleg-SHA-256 jedes Paars muss exakt dem gesondert geprüften Firmwarebeleg der dazugehörigen Originalaufnahme aus P3.6d entsprechen. Vertauschte A/B-Zuordnungen oder falsch deklarierte Belege sind verboten. Unterschiedliche Firmwarebelege **beweisen keine tatsächlichen Firmwarestände**.
- DLS-Evidenz muss – sofern vorhanden – zur tatsächlich gehashten Datei sunlight-sensor-evidence.bin im separat gesiegelten P3.6a-Feldmanifest passen. Panelfoto-Evidenz muss – sofern vorhanden – zur tatsächlich gehashten Datei panel-image-evidence.bin passen. Der Fall fehlender Deklaration und fehlenden tatsächlichen Belegs wird korrekt als fehlend behandelt; eine falsche oder verschleierte Deklaration wird zurückgewiesen.
- Vollständiger erneuter Durchlauf von P3.6d (Original-TIFFs, private Evidenz, XMP-Struktur) und P3.6e (operatorseitige Störfaktoren), anschließend erneute SHA-256-Prüfung beider Manifestdateien. Ausnahmen privater Belegprüfungen werden vor der CLI-Ausgabe sanitisiert.
- Rückgabe ausschließlich von Paaranzahl, erneut geprüfter TIFF-Anzahl, Anzahl Paaren mit beidseitigem DLS-/Panelfoto-Evidenzbeleg und den **aggregierten** Abweichungszahlen aus P3.6e. Kein Pfad, kein Hash, kein Rohmesswert, kein Firmwarestring, keine Position, UUID oder unbekannter XMP-Feldname im JSON-Output.

**Wichtige Grenze:** SHA-256 beweist Integrität gegen einen bereits vertrauenswürdig verwahrten Hash, nicht unabhängige Capture-Provenienz, Firmwareauthentizität, Messwertgenauigkeit oder DLS-/Panelkalibrierung. Auch das Vorhandensein einer DLS-/Panelfoto-Datei bestätigt keinerlei physikalische Qualität. Firmware und Messparameter aus dem Versuchsplan bleiben Betreiberangaben.

## Offline-Anwendung

Die zwei Pins müssen **vor dem Aufruf getrennt und unabhängig** gesichert sein; folgende Werte sind Platzhalter:

~~~bash
python3 backend/workers/m3m_private_paired_source_binding.py \
  --cohort-manifest /privat/m3m/cohort-originale.json \
  --cohort-manifest-sha256 EXTERN_ARCHIVIERTER_COHORT_SHA256 \
  --pairing-plan /privat/m3m/field-pairing-plan.json \
  --pairing-plan-sha256 EXTERN_ARCHIVIERTER_PLAN_SHA256
~~~

Das Quellmanifest und das Paarmanifest verwenden unverändert ihre zuvor dokumentierten strengen kanonischen JSON-Schemas; das Tool erzeugt, editiert oder ersetzt keine Belegdateien.

## Tests, Wissenschafts- und Betriebsgrenzen

Synthetische, tatsächlich als 16-bit-TIFF geschriebene vierbandige M3M-Testbilder (keine DJI-Hardwareaufnahmen), getrennte Eingangs-/Firmwarebelege, Manipulationsprüfungen, falsche A/B-Zuordnungen und getrennte DLS-/Panel-Asset-Prüfungen: tests/test_m3m_private_paired_source_binding.py.

Sämtliche Freigaben für Firmwareversion, Kalibrierung, quantitative Reflektanz, NDVI/NDRE, Agronomie, Mission und Betrieb bleiben **false**. Keine echte Hardwareabnahme, keine DJI-Kalibrierkonstanten, keine Radiometrie- oder DLS-Korrekturen, kein unabhängiges wissenschaftliches Messverfahren und keine Produktivfreigabe. Die nächste reale Abnahme verlangt korrekt archivierte Original-TIFFs, Firmwarebelege, Panel-/DLS-Messung und Feldreferenzen.
