# Validierung der vorbereiteten Anleitung

Datum: 22.10.2026. Ausschließlich im separaten Arbeitsverzeichnis des Assistenten.
Keine Verbindung zum Pi, kein Zugriff auf dessen Daten, keine Pi-Ausführung.

## Durchgeführt

- Python-Syntaxprüfung von `manifest.py` und `restore_probe.py` erfolgreich.
- Shell-Syntaxprüfung aller drei Shell-Dateien erfolgreich.
- 14 lokale Tests mit temporären Testdateien erfolgreich:
  - Kopie mit unveränderten Inhalten und Metadaten stimmt überein.
  - Manipulierte Inhalte werden erkannt.
  - Zusätzliche Dateien werden erkannt.
  - Geänderte Dateimodi werden erkannt.
  - Symlinks werden abgelehnt.
  - Fehlendes Quellverzeichnis wird abgelehnt.
  - Backup/Restore ohne ausdrückliches Ausführungsargument brechen vor Aktionen ab.
  - Alle Shell-Dateien sind syntaktisch gültig.
- Manueller Review der festen Quellpfade, Image-ID, Restore-Isolation,
  Fehlerbehandlung und Ausgabeunterdrückung für Zugangsdaten.

## Nicht durchgeführt

- Kein Backup des echten MinIO, keine Unterbrechung und kein Wiederanlauf.
- Keine LUKS-/ext4-Erstellung oder Mountoperation auf dem Pi.
- Keine NTFS-/fallocate-Kompatibilitätsprüfung.
- Kein End-to-End-Test der Pipelines mit den echten etwa 30,5 GiB.
- Kein Test des MinIO-Image-Archivs durch Laden auf einem frischen Host.
- Kein echter Restore, keine tatsächlichen S3-/IAM-Probes aus der Restore-Kopie.
- Keine Mountabsicherung oder Restart-Policy geändert.
- Keine Ausfallzeit gemessen; kein Benchmark und kein Persistenznachweis.
- Shellcheck ist in der lokalen Prüfungsumgebung nicht vorhanden.

Die Skripte sind vorbereitet und lokal geprüft, **nicht hardwareabgenommen**.
Insbesondere kann eine erfolgreiche Syntaxprüfung keine Pi-Ausführung ersetzen.
Vor einer späteren Durchführung alle Preflight-Ergebnisse und den aktuellen
Live-Zustand erneut bewerten. Geänderte Zustände dürfen nicht durch Abschalten
der Schutzprüfungen passend gemacht werden.

## Ergänzung: entfernte Legacy-Container

Sechs weitere lokale Tests mit Fixture-Daten bestätigen: beide Legacy-Container
fehlen; beide sind gestoppt; einer fehlt und einer ist gestoppt; ein laufender
Legacy-Container wird abgelehnt; ein unbekannter Status wird abgelehnt; eine
fehlgeschlagene Docker-Inventur gilt nicht als Abwesenheit. Insgesamt 14 Tests
bestanden. Kein echter Docker-Aufruf in diesen zusätzlichen Tests, kein Pi-Zugriff.

## Ergänzung: entkoppelter Backup-Auftrag und Recovery

24 lokale Tests erfolgreich. Ergänzend geprüft: direkter alter Startweg wird
abgelehnt; Worker ohne systemd-Credential-Kontext wird abgelehnt; Launcher ohne
Ausführungsargument startet keinen Auftrag; erzeugter systemd-Aufruf verwendet
Typ exec, control-group, LoadCredential und ExecStopPost ohne Terminalbindung;
Recovery startet nur die ursprüngliche Container-ID; laufender Container wird
nicht erneut gestartet; falsche UUID, geänderte Container-ID und konkurrierender
MinIO führen zum Abbruch; ohne Restart-Marker erfolgt kein Docker-Zugriff.

Diese Tests verwenden Mock-Daten. Kein echter systemd-/Docker-Auftrag, keine
Credential-Übergabe an einen echten Systemmanager und kein SIGKILL-/SSH-Abbruchtest
auf dem Pi wurden durchgeführt. Die Skripte ersetzen keine Absicherung gegen
Host-/Stromausfall. Der erste tatsächliche Lauf hatte kein vollständiges
Datenbackup geliefert; MinIO-Readiness HTTP 200 ist nach manuellem Wiederanlauf
bestätigt.

Primärquellen für die Ablaufgestaltung:
- https://www.freedesktop.org/software/systemd/man/latest/systemd-run.html
- https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html
