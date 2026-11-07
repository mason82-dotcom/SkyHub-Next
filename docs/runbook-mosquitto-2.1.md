# Runbook: Mosquitto 2.0.22 → 2.1.2 (brix-node)

**Zweck:** Broker `skyhub-next-mosquitto-1` auf die aktuelle Hauptversion heben. Er trägt die Pilot-2-Kopplung
beider Fernsteuerungen (RC Pro, RC Plus 2), die DRC-Konten und das Mitlesen von FlightHub Keyless.
**Auswirkung:** Beim Neustart trennen sich alle MQTT-Verbindungen für wenige Sekunden. **Nicht während eines Flugs.**
**Dauer:** ca. 10 Minuten inkl. Prüfung. **Rückweg:** 2 Minuten (Abschnitt 5).

## 1. Vorab geprüft (07.11.2026)
- Image `eclipse-mosquitto:2.1.2-alpine` startet mit unveränderter `ops/brix/mosquitto/{mosquitto.conf,passwd,acl}`
  und denselben Härtungen wie im Compose-File (`--user 1000:1000 --read-only --cap-drop ALL --security-opt no-new-privileges`).
- Lesekonto von FlightHub verbindet sich, Abos auf `sys/product/+/status`, `thing/product/+/{osd,state,events}` werden angenommen.
- **Noch nicht geprüft:** echte Pilot-2-Verbindung (RC Pro/RC Plus 2), DRC-Konten `skyhub_commander`/`skyhub_drc_link`.

## 2. Voraussetzungen
- Beide Fluggeräte am Boden, kein laufender Missions-/Flugbefehl, **keine** aktive Cloud-/DRC-Steuerung. Für spätere DRC-Benchtests Propeller entfernen und eigene Freigabe erteilen; der reine MQTT-Reconnect-Test führt keine Flug- oder DRC-Aktionen aus.
- Mindestens eine Fernsteuerung eingeschaltet und in Pilot 2 an SkyHub gekoppelt (zum Prüfen).
- Branch `chore/mosquitto-2.1.2` gemergt bzw. ausgecheckt in `/srv/stacks/skyhub-next`.

## 3. Umstellen
```bash
cd /srv/stacks/skyhub-next
docker pull eclipse-mosquitto:2.1.2-alpine
bash scripts/brix-compose.sh up -d mosquitto
docker exec skyhub-next-mosquitto-1 mosquitto -h | head -1      # erwartet: mosquitto version 2.1.2
docker logs --since 2m skyhub-next-mosquitto-1 2>&1 | grep -iE "error|warn" || echo "keine Fehler"
```

## 4. Prüfen (alle Punkte müssen passen)
| Prüfung | Erwartung | Wo |
|---|---|---|
| Broker läuft | `Up`, kein Neustart-Loop | `docker ps --filter name=skyhub-next-mosquitto-1` |
| Pilot 2 verbindet neu | „MQTT verbunden (DJI): ja“ innerhalb ~30 s, sonst Kopplungsseite neu laden | Pilot-2-Seite auf der RC |
| Topologie/Telemetrie | Gerät `live` in SkyHub und FlightHub (`http://192.168.178.50:3003`, Flotte) | Weboberflächen |
| SkyHub-Backend | Log ohne `mqtt`-Fehler | `docker logs --since 5m skyhub-next-backend-1 \| grep -i mqtt` |
| DRC-Oberfläche (nur lesend) | `drc.html` zeigt Status, aber **kein** Klick auf „Freigabe anfragen“, „DRC betreten“, Takeoff oder Nutzlastaktionen | SkyHub `drc.html` |
| DRC-Konten und ACL | Statusanzeige allein ist **kein** Authentifizierungs-/ACL-Beleg. Nur mit getrennt freigegebenem, isoliertem Broker- bzw. späterem Benchtest nachweisen | Separates DRC-Testprotokoll |

## 4a. Hardware-Abnahmeprotokoll (vor Merge verbindlich)

Der Zustand **online** ist kein Nachweis, dass nach dem Brokerwechsel beide
Fernsteuerungen erneut erfolgreich MQTT verbunden haben. Baseline vor dem
Upgrade und frische Daten **nach** dem Broker-Neustart getrennt dokumentieren:

| Nachweis | RC Plus 2 / M4T | RC Pro Enterprise / M3M |
|---|---|---|
| Fernsteuerung und Fluggerät am Boden, keine aktive DRC-Sitzung | UNBEKANNT | UNBEKANNT |
| Pilot 2 meldet MQTT-Verbindung **nach** Neustart | UNBEKANNT | UNBEKANNT |
| Frische OSD/State-Updates, nicht nur gespeicherte Topologie | UNBEKANNT | UNBEKANNT |
| SkyHub zeigt RC **und** Fluggerät neu online | UNBEKANNT | UNBEKANNT |
| FlightHub zeigt neue Gerätedaten nach Reconnect | UNBEKANNT | UNBEKANNT |

Die Messwerte werden vom Betreiber mit Zeitpunkt und beobachtetem Ergebnis
(PASS/FAIL/UNBEKANNT) ergänzt. Den **Brokerneustart nicht während eines Flugs**
durchführen. Bei nur einem verfügbaren System bleibt der andere Systemtest
UNBEKANNT. Ohne frische Daten kein PASS.

Read-only-Prüfungen auf `brix-node` vor/nach dem Upgrade (kein Restart, keine
Konfigurationsänderung):

```bash
cd /srv/stacks/skyhub-next
git status --short
bash scripts/brix-compose.sh ps
docker inspect skyhub-next-mosquitto-1 \
  --format 'Image={{.Config.Image}} Running={{.State.Running}} Restarts={{.RestartCount}}'
docker inspect skyhub-next-backend-1 \
  --format 'BackendRunning={{.State.Running}} BackendRestarts={{.RestartCount}}'
docker exec skyhub-next-mosquitto-1 mosquitto -h 2>&1 | head -n 1
```

Keine privaten `.env`-Werte, MQTT-Zugangsdaten, Gerätese-riennummern, GPS-Koordinaten
oder ungefilterten Logs in den PR kopieren. Ein vollständiger DRC-Kontentest
erfordert eine gesonderte, kontrollierte Abnahme; ein UI-Status allein genügt nicht.

## 5. Rückweg
```bash
cd /srv/stacks/skyhub-next
sed -i 's#eclipse-mosquitto:2.1.2-alpine#eclipse-mosquitto:2.0.22#' docker-compose.brix.yml   # oder: git revert <commit>
bash scripts/brix-compose.sh up -d mosquitto
```
Danach Pilot-2-Seite auf der RC neu laden. Die Konfigurationsdateien werden nicht verändert, ein Rückweg ist jederzeit möglich.

## 6. Abbruchkriterien
- Broker startet nicht oder startet ständig neu → sofort Rückweg.
- Pilot 2 verbindet nach Neuladen der Kopplungsseite nicht → Rückweg, Logauszug sichern (`docker logs skyhub-next-mosquitto-1`).
