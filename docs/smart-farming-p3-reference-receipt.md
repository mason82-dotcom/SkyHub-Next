# SkyHub Smart Farming P3.5b – versionsgebundener privater Ergebnisbeleg

Stand 02.11.2026. Eigenständig aus historischem Draft #232 auf aktuellen `main` konsolidiert. Der Vierbandvergleich (#242), der Referenzindexvergleich (#243) und die Feldbeleg-/XMP-Prüfungen (#245/#246) liegen bereits in `main`. **Keine produktive Aktivierung auf dem Raspberry Pi oder in der SkyHub-HTTP-API.**

## Neuer Offline-Worker

backend/workers/m3m_private_reference_receipt.py kennt die Subcommands create und verify. Beide benötigen die vorher getrennt gepinnten SHA-256-Prüfsummen des originalen M3M-Bundle-Siegels und des Referenzmanifests. create führt den numerischen Vierbandvergleich erneut durch, bindet die vollständigen Metriken, Eingangs-Pins sowie SHA-256 der vier verwendeten Python-Prüfmodule an einen kanonischen JSON-Ergebnisbeleg. Ebenfalls gespeichert sind Python-Major-/Minor, NumPy-, Rasterio- und GDAL-Version. Das Ergebnis wird ausschließlich in eine neue Datei mit Modus 0600 in einem separaten privaten 0700-Verzeichnis geschrieben. Es wird nicht überschrieben.

Der create-Aufruf gibt die SHA-256-Summe des Ergebnisbelegs zurück. **Diese muss vom Operator als dritte, unabhängige Referenz außerhalb der Ergebnisdatei gesichert werden.** Ein selbst berechneter Hash aus der zu prüfenden Datei gilt nicht als unabhängige Prüfbasis.

verify benötigt alle drei extern gespeicherten SHA-256-Werte. Er prüft den Ergebnisbeleg als kanonisches JSON (keine doppelten Felder, keine gefälschten Freigabe-Flags), die Quell-/Referenzzuordnung und die Versionen des genutzten Prüfprogramms. Anschließend berechnet er die vier Spektralband-Metriken erneut gegen die **unveränderten, unabhängig gepinnten Original-TIFFs**. Nur bei bytegleicher kanonischer Metrik-Reproduktion wird freshIndependentReplayMatched=true geliefert.

Dieses Replay ist ein erneuter Lauf derselben versionsgebundenen Prüflogik und ausdrücklich **keine unabhängige wissenschaftliche Validierung durch eine zweite Messmethode**. SHA-256 bindet Inhalte an extern verwahrte Hashes, stellt aber keine digitale Signatur oder Quellechtheit dar.

## Isolierter Operator-Aufruf

~~~bash
python3 backend/workers/m3m_private_reference_receipt.py create \
  --bundle /privat/m3m-bundle \
  --seal /privat/bundle-siegel.json \
  --seal-sha256 EIGENSTAENDIG_GEHALTENER_QUELL_SHA256 \
  --reference-dir /privat/referenz \
  --reference-manifest-sha256 EIGENSTAENDIG_GEHALTENER_REFERENZ_SHA256 \
  --output-file /privat/ergebnisbelege/vergleich.json \
  --private-output-ok

python3 backend/workers/m3m_private_reference_receipt.py verify \
  --bundle /privat/m3m-bundle \
  --seal /privat/bundle-siegel.json \
  --seal-sha256 EIGENSTAENDIG_GEHALTENER_QUELL_SHA256 \
  --reference-dir /privat/referenz \
  --reference-manifest-sha256 EIGENSTAENDIG_GEHALTENER_REFERENZ_SHA256 \
  --receipt-file /privat/ergebnisbelege/vergleich.json \
  --receipt-sha256 EXTERN_GESPEICHERTER_ERGEBNIS_SHA256
~~~

Die großgeschriebenen Hash-Werte und Pfade sind Platzhalter. Bei geänderten Referenz- oder Quellartefakten, Versionen, Ergebnismetriken, manipulierten Hashes, Dateisymlinks, ungeschützten Ausgabeverzeichnissen und Zielkollisionen wird die Operation verweigert. Die CLI gibt keine GPS-Koordinaten, UUIDs oder absoluten Pfade aus. **Das Ergebnis-JSON enthält dennoch möglicherweise schützenswerte Prüfdaten und Eingangs-Hashes**; nicht in freie Webverzeichnisse, öffentliche S3-Buckets oder GitHub ablegen.

## Testabdeckung und verbleibende Freigabegates

Die synthetischen Rasterio-Tests prüfen Ergebnisdatei und Mode 0600, echten Hash, erfolgreiche Neuberechnung, falsche Eingangs-/Ergebnis-Pins, spätere Manipulation, geänderte Metriken trotz neuem Hash, manipulierte Freigabe, Worker-/GDAL-Versiondrift, nichtkanonisches JSON, Symlinks und unzulässige Pfade.

**Weder ein erfolgreicher Vergleich noch ein erfolgreiches Replay** bestätigt DJI-M3M-Herkunft, Panel-/DLS-Radiometrie, Bandregistrierung, Agronomie oder Einsatzbereitschaft. Entsprechende Flags bleiben false. Echte M3M-Originalaufnahmen, dokumentierte unabhängige Kalibrierreferenz, zweite wissenschaftliche Prüfmethode, QGIS-/GDAL-Reimport und Field-/Workspace-RBAC bleiben für spätere Freigaben offen.

Der Branch verändert keine produktiven Serverrouten, Flugmissionen, MQTT, MinIO, Container oder Raspberry-Pi-Dienste.

**Zusätzlicher Pfadschutz:** Nichtkanonische Quell-, Siegel-, Referenz- oder Receipt-Pfade sowie verschachtelte Symlink-Verzeichnisaliasse werden vor neuen Ausgaben und Replay-Aufrufen verweigert. Synthetische Negativtests prüfen alle drei Pfadklassen. Diese statische Kontrolle verhindert keine TOCTOU-Rennen bei parallelen Verzeichnisänderungen; sie ersetzt weder eine sichere Prozess-Sandbox noch externe Signaturen.
