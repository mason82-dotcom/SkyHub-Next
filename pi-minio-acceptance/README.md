# SkyHub MinIO – ausführbare Backup-/Restore-Anleitung

Stand: 22.10.2026, Europe/Berlin. **Vorbereitet, nicht auf dem Pi ausgeführt.**

Dieses Paket ist eine Anleitung mit überprüfbaren Skripten. Zunächst waren nur
lesende Pi-Checks und die Vorbereitung erlaubt. Der Nutzer hat anschließend
einen Backup-Lauf mit MinIO-Unterbrechung freigegeben; dieser Lauf ist abgebrochen.
Die neue Startvariante wurde noch nicht ausgeführt. Restore, Formatierung und
Neustarttests sind weiterhin nicht freigegeben. Nicht das gesamte Dokument
als Shell-Skript ausführen. Keine automatische Ausführung beim Entpacken.

## 1. Gesicherter Ausgangspunkt und Grenzen

Aus den vom Nutzer übermittelten Terminalausgaben:

| Merkmal | Tatsächlicher Zustand |
|---|---|
| Projekt | `/home/mason/Projekte/SkyHub-Next` |
| Git | `feature/m3m-minio-integration-20261021`, zuletzt gemeldet `bbd0ea6d838afde9a863ab4f8a5dff76846b3969` |
| MinIO | `skyhub-next-minio-1`, Compose-Projekt `skyhub-next` |
| Compose | `docker-compose.yml` und lokale `docker-compose.minio.yml` |
| Lokales Overlay | Modus 0600, durch `.git/info/exclude` ausgeschlossen |
| Image-ID | `sha256:117cf7edd050e6acd4a2d06be79b15eaecd5af76ad73e8927a4bf67528f19d10`, Linux/ARM64 |
| Daten | `/mnt/hc4backup/skyhub-next/minio`, ext4 auf `/dev/nvme0n1p1` |
| Daten-UUID | `ad583d3f-9bfe-4792-829c-1cc2b6738358` |
| Netzwerk | `skyhub-next_default`, MinIO-Alias `minio`, keine Host-Portbindungen |
| Autostart | `unless-stopped`; Docker wartet nur auf die andere NVMe unter `/mnt/data` |
| Backend-IAM | Aktiver Service-Account des Root-Kontos mit eigener Policy; ListBucket/GetObject auf fünf Buckets, keine Prefix-Begrenzung |
| Buckets der bestätigten Policy | `basemaps`, `dji-cloud`, `farming`, `mapping-results`, `pv-inspections` |
| Aktuelle Größe | logisch 32.773.347.410 Byte, belegt 32.991.449.088 Byte |
| Historischer Mirror | 292 Dateien, 377.266.971 logische Byte; Erfolgsmarker 15.10.2026 03:15:03 +02:00; gleiche NVMe wie Original |
| Sicherungsziel | `/mnt/benz`, NTFS/fuseblk, `/dev/nvme1n1p1`, zuletzt 110.410.846.208 Byte frei |

PR #19 ist nicht identisch mit diesem laufenden Aufbau. Der dortige alternative
Container `skyhub-shared-minio` wird hier nicht angelegt. Kein `move`, kein
PR-19-`up`, kein `apply`, kein `adopt`, kein `attach`. AeroNexus und
AeroNexusAdvanced wurden laut Nutzer entfernt; die abschließende Containerliste
zeigt nur den aktiven SkyHub-MinIO. Falls historische MinIO-Container noch
vorhanden sind, müssen sie gestoppt sein; entfernte Container sind zulässig. PostgreSQL, Redis, EMQX, Nextcloud und Immich werden nicht gestoppt.

Dies ist eine Storage-Sicherung, kein vollständiger SkyHub-Disaster-Recovery-Test:
PostgreSQL-Dumps, Backend-Image und komplette Host-/Docker-Konfiguration sind
nicht vollständig enthalten. Die gemeinsame Anwendungskonsistenz mit der
Datenbank bleibt eine spätere, separate Aufgabe.

## 2. Platz- und Schutzkonzept

1. Verschlüsselte Daten- und Image-Archive auf `/mnt/benz`.
2. 48-GiB-LUKS2-Datei auf derselben Zielpartition; darin ein ext4-Dateisystem
   ausschließlich für den Restore-Test. Das wahrt Linux-Metadaten und schützt
   auch die entpackte Kopie mit IAM-Daten/Secrets auf NTFS.
3. Mindestens 10 GiB Restreserve. Die Skripte nehmen keine Kompressionsersparnis
   an und brechen bei unzureichender Kapazität ab.

Original und Sicherung liegen auf unterschiedlichen physischen NVMe-Geräten,
aber im selben Pi. Das schützt nicht gegen gemeinsamen Verlust, Diebstahl,
Hostkompromittierung oder mehrere gleichzeitig beschädigte Laufwerke.

`cryptsetup` und `cryptsetup-bin` wurden mit Version `2:2.7.5-2` auf dem Pi
als installiert bestätigt. Dieses Paket installiert keine Software. Auch das Erstellen
eines LUKS-/ext4-Abbilds auf diesem konkreten NTFS-Mount ist noch nicht praktisch
getestet; ein nicht unterstütztes `fallocate` führt zum Abbruch.

## 3. Paket und bereits erfolgte Prüfung

| Datei | Funktion |
|---|---|
| `preflight.sh` | Nur lesende Prüfung auf dem Pi |
| `legacy_guard.py` | Fehlende Legacy-Container zulassen; laufende oder unklare Zustände ablehnen |
| `launch_backup.py` | Bestätigung/Passphrase entgegennehmen und SSH-unabhängigen systemd-Auftrag starten |
| `backup.sh` | Nur interner systemd-Worker für verschlüsseltes Offline-Backup |
| `recover_backup.py` | Getrennte ExecStopPost-Wiederanlaufprüfung mit UUID-/Container-ID-Schutz |
| `restore.sh` | Späterer Restore in neues verschlüsseltes Testabbild mit isoliertem MinIO |
| `manifest.py` | Vollständiger Dateisatz, SHA-256, Größen, numerische Eigentümer, Modi und xattr-Digests |
| `restore_probe.py` | Lesende IAM-/LIST-/GET-Prüfung gegen die Restore-Kopie |
| `VALIDIERUNG.md` | Lokal ausgeführte Prüfungen und verbleibende Grenzen |

Es wird keine dauerhafte Pi-Unit und kein Timer installiert. Der Backup-Launcher
erstellt nur bei ausdrücklichem Start eine transiente systemd-Unit.
`launch_backup.py` und `restore.sh` verlangen ein ausdrückliches Ausführungsargument
und eine zusätzliche Eingabe am Terminal. `backup.sh` verweigert direkte Aufrufe;
der Worker startet ausschließlich im vorbereiteten systemd-Auftrag. Keine Passphrase in der Shell-History,
in Argumenten oder in Dateien speichern; die Skripte verwenden einen privaten
Dateideskriptor für GPG/cryptsetup. Keine Ausführung mit `bash -x`/Debug-Logging.

Die Skripte werden als root ausgeführt und müssen vorab lesbar geprüft werden.
Paket an einen frei gewählten lokalen Arbeitsort entpacken, dann in diesen
Ordner wechseln. Das verändert bei einer späteren Durchführung nur die
Anleitungsdateien; es wechselt keinen Git-Branch.

## 4. Phase A – lesende Freigabevorbereitung

```bash
bash preflight.sh
```

Vor Backup-Ausführung müssen alle folgenden Punkte erfüllt sein:

- Aktueller Datenpfad, UUID, Image und Container stimmen weiterhin.
- Alte AeroNexus-MinIO-Server sind entfernt oder, falls noch vorhanden, gestoppt.
  Eine fehlgeschlagene Docker-Inventur wird nicht als fehlender Container gewertet.
- S3-Nutzer und direkte Dateischreiber sind ermittelt. Die gemeinsame
  Netzwerkmitgliedschaft allein ist keine vollständige Clientinventur.
- Keine laufenden Uploads, Verarbeitungsläufe oder IAM-Änderungen im Wartungsfenster.
- S3-Unterbrechung ist ausdrücklich freigegeben. Ein Offline-Lauf liest den
  Bestand mehrfach; seine Dauer ist noch nicht gemessen. Keine kurze Ausfallzeit
  versprechen. Das Backend läuft weiter, S3-Abfragen können währenddessen scheitern.
- Starke Archivpassphrase ist verfügbar und getrennt vom Pi sicher hinterlegt.
- Mountabsicherung ist weiterhin offen; während dieses Ablaufs weder Pi noch
  Docker neu starten und keine Datenträger abziehen.

Die Backup-Prüfung erkennt andere laufende Docker-Container mit überlappendem
schreibbarem Bind-Mount, aber nicht alle Hostprozesse, entfernten Clients oder
zukünftigen Containerstarts. Die Wartungskoordination bleibt erforderlich.

## 5. Phase B – späteres konsistentes Offline-Backup

**Schreibend und mit MinIO-Unterbrechung. Der erste vom Nutzer freigegebene
Lauf ist nach einer SSH-Trennung abgebrochen; ein vollständiges Datenbackup
ist nicht nachgewiesen. Diese gehärtete Startvariante ist noch nicht auf dem Pi
ausgeführt. Vor Wiederholung aktualisierten Preflight prüfen.**

```bash
sudo python3 launch_backup.py --execute-backup
```

Der Launcher nimmt Bestätigung und Passphrase entgegen, kopiert die Worker-Dateien
in einen privaten root-eigenen tmpfs-Ordner und startet einen transienten
Systemdienst `skyhub-minio-backup.service`. Er verwendet weder `--pty`, `--pipe`
noch `--scope`. Nach erfolgreicher Übergabe darf die SSH-Sitzung abbrechen, ohne
den Worker zu beenden. Eine laufübergreifende flock-Sperre verhindert parallele
Backup-Worker. Die Passphrase wird als systemd-Credential übergeben; sie steht
nicht in Argumenten, Environment oder Journal. Der kurzzeitig nötige Quelldatensatz
unter `/run` wird nach bestätigter Übergabe entfernt. Bei unklarer Übergabe zuerst
die Unit prüfen, nicht blind erneut starten.

Der Worker:

1. Prüft Quellmount, Ziel, Image, Container, Kapazität und überlappende
   schreibbare Container-Mounts. Erwartet bestehende reguläre Konfigurationsdateien.
2. Legt ein neues, eindeutiges Sicherungsverzeichnis auf `/mnt/benz` an.
3. Sichert Docker-Laufzeitdaten, MinIO-Env, Compose-Dateien, Projekt-`.env` und
   private `minio-shared.env` zunächst ausschließlich in einem privaten
   tmpfs-Verzeichnis unter `/run`. **Diese Dateien enthalten Secrets.**
4. Exportiert das exakte MinIO-Image verschlüsselt und prüft das Image-Archiv.
5. Stoppt ausschließlich den vorhandenen MinIO mit 120 Sekunden Frist.
   Ein nicht sauberer Exit führt zum Abbruch statt zur Datensicherung.
6. Erstellt das private SHA-256-/Metadatenmanifest bei gestopptem MinIO.
7. Archiviert den gesamten MinIO-Datenpfad einschließlich `.minio.sys` sowie
   die Laufzeitkonfiguration mit GNU tar (PAX, ACLs, xattrs, numerische Eigentümer).
8. Komprimiert mit einem zstd-Thread und verschlüsselt ohne Klartextarchiv auf NTFS.
9. Entschlüsselt das Archiv zur vollständigen Archiv-Leseprüfung und prüft den
   unveränderten Quellbestand erneut gegen das Manifest.
10. Schreibt SHA256SUMS, synchronisiert die Archive und startet denselben
    vorhandenen Container nach erfolgreicher Recovery-Prüfung.

Ein privater Restart-Marker wird vor dem Stop geschrieben. Signal-/EXIT-Handler
versuchen den Wiederanlauf. Zusätzlich führt systemd nach Beendigung des Workers
und seiner Prozessgruppe eine getrennte `ExecStopPost`-Prüfung aus. Diese prüft
UUID, Datenmount, ursprüngliche Container-ID, Image sowie konkurrierende
Speicherprozesse und startet ausschließlich denselben vorhandenen Container.
Bei fehlendem Quellmount oder geänderter Identität wird der Start verweigert.
Stromausfall, Host-/Docker-Ausfall oder ein Fehler der Recovery selbst bleiben
Grenzen dieser Absicherung. Keine neuen Container als Ersatz erstellen.

Erwartete Ausgabe: neues Verzeichnis `/mnt/benz/skyhub-backup-...` mit:

- `data.tar.zst.gpg`
- `image.tar.zst.gpg`
- `SHA256SUMS`
- `ARCHIVE-COMPLETE.txt`

Eine `.partial`-Datei oder ein fehlender Abschlussmarker bedeutet **nicht
abgeschlossen**. Einen fehlgeschlagenen Lauf nicht als Sicherungsnachweis zählen.
Keine Teilarchive automatisch löschen; zuerst Ursache und freien Platz klären.

Die Sicherung speichert auch die bisher aktive MinIO-IAM-Konfiguration; erst
der Restore-Test zeigt, ob sie tatsächlich wieder verwendet werden kann.

### Wiederanlauf aus dem bestehenden Backend prüfen

```bash
docker exec skyhub-next-backend-1 node -e '
fetch("http://minio:9000/minio/health/ready", {
  signal: AbortSignal.timeout(5000)
}).then(r => {
  console.log("MinIO readiness HTTP:", r.status);
  process.exit(r.ok ? 0 : 1);
}).catch(() => {
  console.error("MinIO readiness failed"); process.exit(1);
});'
```

Bei Fehlern keine Compose-Neuerstellung auslösen. Zuerst Mount und Status
des bestehenden MinIO prüfen. HTTP 200 allein ersetzt keine S3-Abnahme.

## 6. Phase C – isolierter Restore

**Schreibend: neues LUKS-/ext4-Testabbild, temporäres Docker-Netz und Testcontainer.
Noch nicht freigegeben/ausgeführt.**

Den vom Backup ausgegebenen tatsächlichen Pfad einsetzen; den Platzhalter
nicht unverändert ausführen:

```bash
sudo bash restore.sh --execute-restore /mnt/benz/skyhub-backup-TATSAECHLICHER-LAUF
```

Das Skript verlangt die Archivpassphrase und eine neue Testabbild-Passphrase.
Beide getrennt aufbewahren. Es erstellt ausschließlich eine neue Datei mit
zufälligem Namen. Physische NVMe-Partitionen werden niemals formatiert.

Ablauf:

1. SHA-256 beider verschlüsselten Archive prüfen; mindestens 58 GiB freie
   Kapazität für das 48-GiB-Abbild und Reserve verlangen.
2. Neue 48-GiB-Datei anlegen, LUKS2 einrichten, eigenes Mapper-Gerät öffnen
   und **nur dieses** mit ext4 formatieren. `nodev,nosuid,noexec` mounten.
3. Daten und Konfiguration ausschließlich dort entpacken. Nie auf den aktiven
   Originalpfad zurückspielen.
4. Vor dem ersten MinIO-Start vollständigen Dateisatz, SHA-256, Größen,
   Eigentümer, Modi und xattrs gegen das Offline-Manifest vergleichen.
5. Dasselbe vorhandene lokale MinIO-Image verwenden; kein Pull, kein Upgrade.
   Das Image-Archiv wird in diesem Test nicht geladen. Dessen Wiederimport auf
   einem frischen Host bleibt ein separater Portabilitätstest.
6. Eindeutiges internes Docker-Testnetz und Testcontainer ohne Host-Ports,
   ohne Restart-Policy und ohne produktive Netzwerkverbindungen anlegen.
   Nur die Restore-Kopie wird schreibbar eingebunden. MinIO selbst darf dabei
   Verwaltungsmetadaten der Testkopie verändern.
7. Readiness, aktiven Service-Account, Root-Elternkonto und die bestätigte
   ListBucket/GetObject-Policy für genau die fünf bekannten Buckets prüfen.
8. Mit den gesicherten Backend-Credentials LIST je Bucket und, sofern vorhanden,
   GET eines Objekts bis 16 MiB je Bucket durchführen. Keine Inhalte ausgeben.
   Ohne geeignetes Objekt bleibt der jeweilige GET-Punkt ausdrücklich offen.
9. Testcontainer und Testnetz entfernen, Testdateisystem aushängen und Mapper
   schließen. Das verschlüsselte Testabbild bleibt erhalten.

Der SHA-256-Abgleich prüft alle gesicherten Dateien, nicht nur GET-Stichproben.
Die GET-Stichprobe bestätigt S3-Lesefunktion und Größe, ist aber kein zusätzlicher
Vergleich jedes S3-Objekts mit einer unabhängigen fachlichen Referenz.
Prüfsummen und GPG-Integrität bestätigen nicht, dass der Originalbestand bereits
vor der Sicherung fachlich unbeschädigt war.

Kein PUT, DELETE, Bucket-Anlegen oder IAM-Schreibaufruf gegen Produktiv- oder
Test-S3. Damit ist insbesondere eine tatsächliche Schreibverweigerung weiterhin
nicht praktisch getestet. Das temporäre MinIO schreibt selbst nur in die Testkopie.

### Fehler und Rückbau

- Bei Manifestfehlern **kein Test-MinIO-Start**. Quelle und Sicherung erhalten.
- Wenn Testcontainer nicht entfernt werden kann: Mapping und Mount erhalten;
  niemals darunter aushängen oder das Abbild löschen. Skript nennt Testnamen.
- Wenn Aushängen fehlschlägt: Mapper nicht schließen. Keine erzwungenen
  Unmounts, kein `docker prune`, keine Löschung aktiver Images/Volumes.
- Nach Erfolg das erhaltene verschlüsselte Abbild vorerst behalten. Das Paket
  löscht keine Sicherungen und keine Testabbilder automatisch.
- Testfehler erfordern keine Wiederherstellung auf den Produktivpfad, da dieser
  durch den Restore nicht verändert wird.

## 7. Danach verbleibende Abnahme

| Punkt | Durch dieses Paket geschlossen? |
|---|---|
| Unabhängiges Archiv auf zweiter NVMe | Erst nach erfolgreichem Backup-Lauf |
| Dateiintegrität nach Restore | Erst nach erfolgreichem Manifestabgleich |
| IAM und S3-Lesen aus Restore | Erst nach erfolgreichen Restore-Probes |
| Image-Wiederimport auf neuem Host | Nein |
| Mountabhängiger produktiver Autostart | Nein |
| Container-Recreate-/Reboot-Persistenz | Nein |
| Negative IAM-Tests / isolierter S3-Schreibtest | Nein |
| Vollständige SkyHub-/Datenbank-Wiederherstellung | Nein |

Die Startsicherung separat entwerfen: `restart: unless-stopped` darf eine
Mountprüfung nicht umgehen. Eine nur an ein Compose-Startskript gekoppelte
systemd-Unit reicht nicht, solange Docker den Container selbstständig starten
kann. Benötigt werden ein konsistenter Startverantwortlicher, eine tatsächliche
Mount-/UUID-Prüfung und `create_host_path: false` als ergänzender Schutz.
Eine globale Docker-Mountabhängigkeit würde andere Anwendungen betreffen und
ist deshalb nicht Teil dieses Pakets.

## 8. Protokoll für die spätere Durchführung

| Nachweis | Eintrag bei Ausführung |
|---|---|
| Wartungsfreigabe / bekannte S3-Nutzer | Offen |
| Beginn/Ende MinIO-Unterbrechung | Offen |
| Archivverzeichnis und SHA256SUMS | Offen |
| Sauberer MinIO-Exit / Wiederanlauf | Offen |
| Backend-Readiness nach Backup | Offen |
| Vollständiger Restore-Manifestabgleich | Offen |
| Restore-IAM / LIST / GET je Bucket | Offen |
| Erfolgreicher Test-Rückbau | Offen |
| Startsicherheit / Persistenz | Offen |

## Referenzen

- PR #19: https://github.com/mason82-dotcom/SkyHub/pull/19
- Zuletzt geprüfter PR-Head: `c5a77feb2dfcb52afb10a99ab0710ebf7c03ded1`;
  keine Behauptung, dass dieser nach der Erstellung unverändert aktuell bleibt.
- Verwendeter mc-Quellcode: https://github.com/minio/mc/tree/RELEASE.2025-08-13T08-35-41Z
- GNU tar: https://www.gnu.org/software/tar/manual/
- cryptsetup: https://gitlab.com/cryptsetup/cryptsetup

## GitHub und bestehende SSH-Sitzung

Diese Anleitung liegt im separaten Branch
`ops/minio-backup-restore-runbook-20261022`. PR #19 und der aktive
M3M-Integrationsbranch werden nicht verändert.

In einer bereits vorhandenen Pi-Terminalsitzung kann ein separater Worktree
angelegt werden. Diese Vorbereitung schreibt nur Git-Metadaten und Quelltext,
startet aber keine Dienste und verändert keine Nutzdaten:

```bash
git -C "$HOME/Projekte/SkyHub-Next" fetch origin ops/minio-backup-restore-runbook-20261022
git -C "$HOME/Projekte/SkyHub-Next" worktree add --detach \
  "$HOME/Projekte/SkyHub-Minio-Abnahme" \
  origin/ops/minio-backup-restore-runbook-20261022
cd "$HOME/Projekte/SkyHub-Minio-Abnahme/pi-minio-acceptance"
bash preflight.sh
```

Bei bereits vorhandenem Ziel-Worktree nicht löschen oder überschreiben, sondern
mit `git worktree list` und dessen Commit zuerst den Zustand prüfen. Kein
Branchwechsel im aktiven SkyHub-Projekt. Die Backup-/Restore-Ausführungsargumente
aus den späteren Phasen gehören ausdrücklich nicht zum Preflight.

## Aktualisierung nach Entfernung von AeroNexus

Am 22.10.2026 bestätigte der Nutzer die Entfernung von AeroNexus und
AeroNexusAdvanced. Die jüngste Containerliste zeigt `skyhub-next-minio-1`
und `skyhub-next-backend-1`; der Datenpfad liegt weiter auf der erwarteten NVMe
und `.minio.sys` ist vorhanden. Die zuvor aktivierte Medien-Sync-Unit ist
unter Benutzer `mason` nicht mehr geladen, ihre Datei fehlt.

Der Legacy-Guard erlaubt daher entfernte historische Container. Vorhandene
laufende, pausierte, neu startende oder unklar erkannte Legacy-Server werden
weiterhin abgelehnt. Docker-Fehler führen zum Abbruch. Die zusätzliche Prüfung
überlappender schreibbarer Mounts bleibt erhalten.

Diese Befunde ersetzen keine Wartungsfreigabe und schließen externe oder
zeitversetzte S3-Nutzer nicht aus. Backup/Restore bleiben ungestartet.

## SSH-Abbruch des ersten Laufs und neuer Startweg

Der erste Lauf wurde per SSH gestartet. Nach der Trennung fehlten Backup-Shell
und Manifestprozess; nur das Image-Archiv war vorhanden, kein Datenarchiv und
kein Abschlussmarker. Ein unvollständiges Manifest blieb in privatem tmpfs zurück.
MinIO wurde anschließend nach Mount-/Image-Prüfung manuell wieder gestartet;
Backend-Readiness HTTP 200 wurde durch den Nutzer bestätigt. Das erklärt nicht
abschließend, welches Signal oder Ereignis den ursprünglichen Lauf beendete.

Die früher ausgegebene ZIP-Anleitung und der direkte `backup.sh`-Startweg sind
für eine Wiederholung überholt. Nur den aktualisierten GitHub-Stand verwenden.
Alte Teilbestände nicht als Backup zählen und in diesem Schritt nicht löschen.
Die neu hinzugefügte systemd-/Recovery-Funktion ist lokal getestet, aber noch
nicht mit dem Pi-Systemmanager, dessen Credentials oder einem echten Abbruch
unter laufendem Backup praktisch abgenommen.

Nach einem ausdrücklich gestarteten neuen Auftrag ausschließlich lesend beobachten:

```bash
systemctl --no-pager --full show skyhub-minio-backup.service \
  -p LoadState -p ActiveState -p SubState -p Result -p MainPID
sudo journalctl -u skyhub-minio-backup.service --no-pager -n 40
```

Nach Wiederverbindung zuerst diesen Status prüfen; den Launcher nicht erneut
starten. Eine erfolgreich beendete transiente Unit kann nach Abschluss wieder
entladen sein. Journal, Archiv-Abschlussmarker und Readiness gemeinsam prüfen.
`systemctl reset-failed` ist kein Wiederherstellungsverfahren und wird hier nicht
automatisiert. Bei fehlgeschlagenem Auftrag vor einem neuen Start die Ursache
und den bestehenden MinIO-Zustand klären.
