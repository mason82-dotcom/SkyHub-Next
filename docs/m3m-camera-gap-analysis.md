# Mavic 3M – Einordnung fehlender DJI Cloud API Kamera-/State-Feldpfade

**Historische Hardwarebeobachtungen:** 21.10.2026. **Code-Neuintegration:** 23.10.2026. Die alte Hardwareevidenz dokumentiert den damaligen Pi-Zustand; die aktuelle branch-basierte Diagnose wurde noch **nicht** neu auf dem Pi abgenommen. Kein Backend-Update, kein DJI-Befehl · DJI Cloud API 1.18.

## Hardwareevidenz

Der erste reale Raspberry-Pi-Hardwaretest nach der 150-Pfad-Erweiterung
verarbeitete 10/10 OSD-Pakete und zeigte 64 von 150 Feldern frisch.
Der **anschließende echte Pi-Folgetest** auf diesem Diagnose-Testbranch
lieferte 964/964 akzeptierte OSD-Pakete (backendweit) mit ca. 2 Sekunden
altem OSD beider realen Geräte und 66 von 150 auf M3M beobachteten
Feldpfaden (63 frisch, 3 historisch), darunter erneut alle sechs
typisiert angenommenen Generic-Aircraft-Erweiterungspfade.

**Offen im Folgetest:** 74 auswertbare Feldpfade nicht beobachtet,
8 absichtlich redigiert und 2 untypisierte Felder nicht inspectierbar.
Die 74 sind **keine 74 Gerätefehler**; die im Pi-Test bestätigte
Aufteilung wird unten dokumentiert.

## Warum das gemeinsame Kameraschema mehr Felder enthält

Die Mavic 3M besitzt eine 20-MP-RGB-Kamera und vier 5-MP-
**Multispektralkameras** (Grün, Rot, Red Edge, **NIR**).
Sie hat **keine thermische Temperaturmesskamera**. Das
M3-Series-Cloud-API-Schema enthält zugleich IR-Temperaturmessfelder
und Funktionen unterschiedlicher Mavic-3-Gerätevarianten.

**Wichtig:** NIR-Reflexionsbilder erfassen Licht im nahen Infrarot und
sind **keine Wärmebild-/Thermografie-Messung**. Fehlende
`cameras.ir_metering_point`, `ir_metering_area`,
`ir_metering_mode` oder `ir_zoom_factor` sollen deshalb in
der M3M-Abnahme als **nicht zur vorhandenen Thermografiehardware
passend** erklärt werden, nicht als ausgefallene Sensoren.

Referenzen:
- [DJI Mavic 3M – technische Spezifikationen](https://enterprise.dji.com/mavic-3-m/specs)
- [DJI Cloud-API-Doc – Mavic-3-Series Properties](https://github.com/dji-sdk/Cloud-API-Doc/blob/4ec6b0c7f9472aeb09a0a47949855d19c473ea07/docs/en/60.api-reference/10.pilot-to-cloud/00.mqtt/10.m3-series/00.properties.md)

## Neue Diagnoseklassen (ohne neue Telemetrie, keine DJI-Schreibbefehle)

`backend/m3m-gap-classifier.js` klassifiziert **ausschließlich
bekannte, nicht beobachtete M3M-Schema-Pfadnamen** in sechs Klassen:

| Klasse | Interpretation |
|---|---|
| Thermische IR-Mess-/Zoomfelder | M3M hat keine Wärmebildkamera; nicht als fehlende Temperaturmessung bewerten |
| Zoom-/FOV-Felder | Shared-Family-Funktionen, nicht automatisch für die M3M garantiert |
| RGB-/Wide-Belichtung | Potenziell optionale RGB-Kameraeinstellungen, noch nicht beobachtet |
| Andere Kamera-/Anzeigefelder | Bedingte Kamera-/UI-Funktionen |
| State-Felder | Bei Änderungen übertragen; nach Neustart ggf. noch keine Events |
| Sonstige OSD-Felder | Können bedingt oder firmwareabhängig sein; keine Vermutung über Fehler |

Die Auswertung **verändert keine der 150 Felddefinitionen** und
subtrahiert keine Klasse von der bisherigen Zahl `nicht beobachtet`.
Alle Gruppen zusammen ergeben stets die Anzahl klassifizierter
auswertbarer Lücken. Werte, Seriennummern, Payload-IDs, Positionen
und beliebige fremde Key-Namen werden nicht erfasst oder ausgegeben.

## Raspberry Pi: nur vorhandenes Backend lesen

Das neue Hardwarecheck-Skript aus dem **separaten Test-Worktree**
kann mit dem bestehenden produktiven Compose-Verzeichnis getestet
werden. **Kein Backend-Neustart, keine neue MQTT-Subscription,
kein DJI property/set und keine Änderung an Flight Control.**

```bash
git -C ~/Projekte/SkyHub-HW-Test fetch origin
git -C ~/Projekte/SkyHub-HW-Test switch --detach origin/test/m3m-camera-capability-gap-audit-20261021
cd ~/Projekte/SkyHub-HW-Test
node --test backend/test/m3m-gap-classifier.test.js backend/test/rc-pro-m3m-hardware-validation.test.js
SKYHUB_COMPOSE_DIR="$HOME/Projekte/SkyHub-Next" node scripts/pi-rc-pro-m3m-check.js
```

**Gesucht im Report:** `M3M-Feldluecken nach Kamerafunktion und
MQTT-Kanal` samt sechs Summen; ältere Backends melden
`NICHT PRUEFBAR` statt Nullwerten. Die reale Pi-Ausgabe wird
separat als Hardwareevidenz ausgewertet, bevor Änderungen in
Produktiv-`main` übernommen werden.

## Reale Feldluecken-Klassifizierung: Pi-Test am 21.10.2026

Der Benutzer hat den isolierten Hardware-Testbranch
`fd1a5ce` auf dem Raspberry Pi getestet. **22 von 22 lokalen
Node-Tests bestanden**, dazu OSD-Live-Telemetrie ohne Neustart
oder Änderungen an den produktiven Containern.

| Funktion/Kanal | Nicht beobachtete Feldpfade |
|---|---:|
| Thermische IR-Mess-/Zoomfelder | **20** |
| Zoom/FOV der gemeinsamen M3-Kamerafamilie | **17** |
| RGB-/Wide-Belichtung | **4** |
| Sonstige Kamera-/Anzeigefunktionen | **1** |
| Ereignisgesteuerte State-Felder | **27** |
| Andere OSD-Felder | **5** |
| **Summe** | **74** |

Zusätzlich waren **14 vollständige Rootfelder** nicht beobachtet,
43 Unterpfade trotz beobachteter Rootstruktur und 17 Unterpfade
unter fehlenden Roots. Diese Rootstruktur-Gruppen betrachten
dieselben 74 Pfade aus einer **anderen Perspektive**; ihre Zahlen
dürfen nicht zusätzlich zu den obigen 74 addiert werden.

**State-Befund:** Trotz 964 OSD-Paketen wurden auf dem Backend
`mqttObservedChannelCounts.state=0` und 0 State/Status-Meldungen
seit dem letzten Backendstart gemessen. Die Subscription
`thing/product/+/state` ist im Quellcode vorhanden und wird
zusammen mit insgesamt fünf Themen geprüft. Der beobachtete
State-Zähler wird *vor* Parsing und Property-Filterung erhöht;
ein fehlerhafter M3M-Sanitizer erklärt 0 Zustellungen also nicht.
State ist ereignisgesteuert – anhaltendes Ausbleiben verlangt
vor Schlussfolgerungen eine gesonderte MQTT-/Pilot2-Beobachtung.

### Weitere ausschließlich lesende State-Kanalanalyse

Der Hardwareprüfer zeigt jetzt zusätzlich drei Ebenen an:
(1) `mqttObservedChannelCounts.state` (Topic empfangen, auch vor
Filterung), (2) `mqttChannelCounts.state` (nach Guard/Registry
angenommen), (3) modellbezogene RC-/M3M-State-Zähler aus der
validierten MQTT-Shape-Erfassung, soweit verfügbar. Diese Ebenen
sind voneinander zu unterscheiden und werden niemals aus einem
`osd`-Zähler abgeleitet.

Ein Gerät kann ein State-Paket erhalten, ohne darin einen
bekannten typisierten Eigenschaftswert zu besitzen. Deswegen
wird die individuelle Eigenschaftsannahme zusätzlich separat
ausgewiesen. Die Auswertung zeigt **ausschließlich Zähler und
fest definierte Statuswörter**, keine SN, GPS-Werte, Settings,
Tokens oder unbearbeiteten Payload-Keys. Sie wird im Test-Worktree
gegen das bereits laufende Pi-Backend ohne erneutes Deployment
ausgeführt.

## State-Nachtest: kein Topic-Empfang trotz OSD-Telemetrie

Im anschließenden echten Pi-Test mit Commit `41d6d64`
(`scripts/pi-rc-pro-m3m-check.js` aus dem Test-Worktree) wurde
folgende Zustandskette **direkt aus den bestehenden Backend-APIs** gelesen:

| Ebene | Live-Nachweis |
|---|---:|
| MQTT-State-Topic empfangen (`mqttObservedChannelCounts.state`) | **0** |
| Nach Guard und Registry akzeptiert (`mqttChannelCounts.state`) | **0** |
| State-Nachrichten dem RC-Modell zugeordnet | **0** |
| State-Nachrichten der M3M zugeordnet | **0** |
| Typisierte RC-/M3M-State-Felder seit Prozessstart | **nein / nein** |

Das OSD wurde zuvor **964/964** mal empfangen, übernommen und als
verwertbare Telemetrie gezählt, mit ungefähr zwei Sekunden
OSD-Frische an beiden Geräten. Der Transport für OSD ist deshalb
bestätigt, das **State-Topic blieb dagegen unbeobachtet**. Der
Beobachtungszähler wird am Anfang von `onMessage()` vor Parsing,
Guard und Feldfilter erhöht; es handelt sich **nicht** um
Parserablehnungen. Die DJI-Dokumentation spezifiziert für
`pushMode=1` State-Übertragung bei Änderung, **nicht zyklisch**.

Offizielle DJI-Referenz:
https://developer.dji.com/doc/cloud-api-tutorial/en/overview/basic-concept/thing-model.html

### Nächste risikofreie Prüfung am Pi

Nur die bestehenden, lesenden Backend-Healthdaten abfragen:

```bash
curl -fsS http://127.0.0.1:4001/api/health | python3 -c '
import json,sys
h=json.load(sys.stdin)
for k in ("mqtt","subscribed","topologyRestoredDevices",
          "mqttLastConnectedAt","mqttLastMessageAt",
          "mqttLastOsdAt","mqttObservedChannelCounts",
          "mqttChannelCounts"):
    print(f"{k}: {h.get(k)}")
'
```

Es werden keine Geräte-IDs oder Telemetriewerte angezeigt.
Die Abfrage **sendet keine MQTT-Nachricht**.
Beobachtung nach einer normalen Pilot-2-/Cloud-Verbindung bei
am Boden stehenden Geräten ist möglich, aber eine Cloud-Neuverbindung
muss **nicht** zwingend State-Nachrichten auslösen.
Bei weiterhin ausbleibenden State-Topics sollten zuerst
Publisher-/Broker-Zeitpunkt und Topic-Sichtbarkeit geklärt werden;
keine `property/set`-Aufrufe, Flight Controls, Kameraaktionen
oder Netzwerkkonfigurationsänderungen sind für diesen Test zulässig.
## Fortgesetzte Live-Diagnose: MQTT-Verbindung seit 19:33 Uhr

Ein weiteres vom Benutzer direkt auf dem Pi abgefragtes
`GET /api/health` bestätigte am **21.10.2026** folgende
**backendprozessbezogene** Werte:

| Kriterium | Beobachtung |
|---|---|
| MQTT verbunden / fünf Subscriptions bestätigt | true / true |
| MQTT-Verbindungszeit | 19:33:31 MESZ (`1792604011174` ms) |
| Letzte MQTT-Nachricht | 20:02:42 MESZ (`1792605762029` ms) |
| Letztes OSD | 20:02:42 MESZ |
| Wiederhergestellte Geräte aus Redis-Topologie | 2 |
| OSD empfangen / angenommen | 1752 / 1752 |
| Events empfangen / angenommen | 876 / 876 |
| State empfangen / angenommen | **0 / 0** |
| Status empfangen / angenommen | **0 / 0** |
| Service-Reply empfangen / angenommen | 0 / 0 |

Der erfolgreiche OSD-/Event-Verkehr über einen Zeitraum von rund
29 Minuten nach MQTT-Connect beweist, dass **kein genereller
MQTT-Verbindungsverlust** besteht. Der Subscriber hat im aktuellen
Prozess seit dem Verbindungszeitpunkt jedoch **keine** neuen
`thing/product/+/state` oder `sys/product/+/status`
Nachrichten gesehen. Die Zwei-Geräte-Topologie stammt aus
einem **Redis-Restore** und ersetzt keinen neuen Topologie-Handshake.

DJI beschreibt `state` als **bei Änderung ausgelöst** und `osd`
als periodischen Kanal; `update_topo` wird in der offiziellen
Pilot-to-Cloud-Statusdokumentation als Online-/Offline-Ereignis
beschrieben. Deshalb erklärt eine laufende, unveränderte
Pilot-2-Sitzung die Kombination als **plausible Hypothese**,
aber noch nicht als gesicherte Ursache.

Nachprüfung **ohne MQTT-Payloads oder DJI-Kommandos**:

1. SkyHub-Backend und MQTT-Subscription verbunden lassen.
2. Nur bei am Boden stehenden Geräten nach normalem Aus-/Einschalten
   von Pilot 2 bzw. regulärer Cloud-Neuverbindung erneut passiv lesen.
   **Keine Flug- oder RTH-Einstellungen verändern.** Eine
   Neuverbindung garantiert keine `state`-Nachricht.
3. `mqttObservedChannelCounts.status/state` erneut prüfen und mit
   `mqttChannelCounts.status/state` und
   `topologyReplySent` vergleichen. Falls sie weiter bei null
   bleiben, zuerst den Publisher-/Broker-Nachrichtenpfad
   und den Zeitpunkt der Registrierung verifizieren, statt den
   feldtypisierten Parser anzupassen.

**Nicht erforderlich:** Pi-/EMQX-Neustart, Pairing-Reset,
Broker-ACL-Änderungen, `property/set` oder Flugtest.

## Erfolgreicher DJI-State-/Topologie-Nachtest nach regulärer Cloud-Neuverbindung

Die anschließende Live-Abfrage des Nutzers vom 21.10.2026 liefert **für
denselben Backend-Prozess** folgende neue kumulative Metriken:

| MQTT-Kanal | Eingegangen | Akzeptiert | Noch offen |
|---|---:|---:|---|
| Status | 2 | 2 | keine im Kanal sichtbar |
| State | 18 | 13 | **5 eingegangene, nicht akzeptierte** |
| OSD | 2052 | 2052 | keine |
| Events | 1026 | 1026 | keine |

**Zwei Topologie-Antworten wurden gesendet** (0 vorher), weiterhin
**zwei aus Redis restaurierte Topologiedatensätze**. Die RC Pro/M3M
haben sich erneut mit Pilot 2/Cloud verbunden, ohne dass SkyHub,
EMQX, Pairings, Flug- oder RTH-Einstellungen verändert wurden.

**Abnahme:** MQTT-State- und Status-Transport plus Topologie-Antworten
sind nun nachgewiesen. Es ist mit hoher Plausibilität bestätigt,
dass das vorherige Ausbleiben an der bereits laufenden Pilot-2-Sitzung
bzw. fehlenden State-/Online-Ereignissen seit dem Backend-Neustart lag.
Eine spezifische Aussage über die technische Publisher-Implementierung
ist daraus nicht ableitbar.

**Ungeklärt:** Die Differenz `18 - 13 = 5` betrifft **noch
nicht angenommene State-Nachrichten**. Aus dem bloßen Differenzwert
geht nicht hervor, welche Prüfregel verantwortlich war.
`mqttDroppedByReason` ist aktuell nur ein **backendweiter**
Ablehnungszähler, **nicht pro State-Kanal**. Auch im Parser nicht
erkennbare Meldungen können als beobachtet, aber nicht angenommen
gezählt werden, ohne unter einem bestimmten Drop-Grund aufzutauchen.
Die Gründe dürfen daher nicht ohne zusätzliche kanalbezogene
Evidenz den fünf State-Paketen zugeordnet werden.

Zur Vertiefung ohne Payload-, ID- oder Konfigurationsausgabe:

```bash
cd ~/Projekte/SkyHub-HW-Test
SKYHUB_COMPOSE_DIR="$HOME/Projekte/SkyHub-Next" \
  node scripts/pi-rc-pro-m3m-check.js \
  | sed -n '/^--- DJI State-Kanalanalyse/,/^--- M3M-Feldluecken/p'

curl -fsS http://127.0.0.1:4001/api/health | python3 -c '
import json,sys
h=json.load(sys.stdin)
for k in ("mqttObservedChannelCounts","mqttChannelCounts",
          "mqttRejectedMessages","mqttDroppedByReason"):
    print(k, ":", h.get(k))
'
```

Erst wenn die **modellbezogenen State-Zähler und die wirklich
akzeptierten State-Feldnamen** vorliegen, können die 27 zuvor
fehlenden State-Pfade neu bewertet werden.

## Erfolgreiche Pilot-2-Neuverbindung: Status und State jetzt empfangen

Nach einer regulären Neuverbindung am **21.10.2026** hat der
Raspberry Pi folgende Health-Zähler geliefert:

| MQTT-Kanal | Beobachtet | Akzeptiert | Nicht akzeptiert |
|---|---:|---:|---:|
| `status` | **2** | **2** | 0 |
| `state` | **18** | **13** | **5** |
| `osd` | **2052** | **2052** | 0 |
| `events` | **1026** | **1026** | 0 |
| `services_reply` | 0 | 0 | 0 |

Auch `topologyReplySent=2` ist bestätigt.
`topologyRestoredDevices=2` bleibt der frühere Redis-Restore-Zähler
und darf **nicht** zu den zwei frischen Statuspaketen addiert werden.

**Interpretation:** Beide vormals fehlenden MQTT-Kanäle
(`thing/product/+/state` und `sys/product/+/status`) funktionieren
nach der normalen Pilot-2-Neuverbindung. Es liegt **kein Nachweis
eines generellen MQTT- oder Property-Parser-Ausfalls** vor.
Dass die Neuverbindung der Auslöser war, ist anhand der
Vorher-/Nachher-Messungen plausibel; welcher Pilot-2-Mechanismus
die 18 State-Nachrichten generiert hat, ist nicht aus den
Zählerständen allein bestimmbar.

Die Differenz von fünf nicht angenommenen State-Paketen belegt
**noch keine** fünf Fehler. Der Guard verwirft beispielsweise
veraltete oder duplizierte Pakete absichtlich. Die genaue Ursache
wurde im Pi-Bericht nicht mitgeliefert.

### Neue reine Health-Auswertung der Ablehnungsgründe

Die bereits vorhandenen Metriken `mqttRejectedMessages` und
`mqttDroppedByReason` sind **backendweit**, nicht pro Gerät oder
MQTT-Kanal. Der aktualisierte Hardwareprüfer zeigt diese
Ablehnungsgründe nur als bekannte Schlüssel und numerische Zähler.
Er schreibt sie **nur dann** State zu, wenn die gesamte Bilanz
aus allen fünf Kanälen vollständig ist, exakt aufgeht und alle
anderen beobachteten Kanäle vollständig angenommen wurden.
Andernfalls: **NEIN / nicht eindeutig zuordenbar**.
So werden Gründe nie aus einer bloßen Differenz erfunden.

**Read-only Pi-Nachtest ohne Backend-Deployment:**

```bash
git -C ~/Projekte/SkyHub-HW-Test fetch origin
git -C ~/Projekte/SkyHub-HW-Test switch --detach origin/test/m3m-camera-capability-gap-audit-20261021
SKYHUB_COMPOSE_DIR="$HOME/Projekte/SkyHub-Next" \
  node ~/Projekte/SkyHub-HW-Test/scripts/pi-rc-pro-m3m-check.js \
  | sed -n '/^--- DJI State-Kanalanalyse/,/^--- M3M-Feldluecken/p'
```

Es werden weder DJI-Kommandos noch weitere MQTT-Abonnements
ausgeführt, und keine Rohwerte, Koordinaten, Seriennummern oder
Zugangsdaten ausgegeben.

## Hardwareabnahme: State-Transport, Modellzuordnung und Duplikatschutz

**Neuer realer Raspberry-Pi-Nachtest nach Pilot-2-Wiederverbindung,
21.10.2026:**

| Stufe | Empfangen | Akzeptiert |
|---|---:|---:|
| State-Topic (backendweit) | **29** | **24** |
| RC-Pro-State (modellbezogen akzeptiert) | – | **13** |
| M3M-State (modellbezogen akzeptiert) | – | **11** |
| Backendweit verworfene MQTT-Nachrichten, `duplicate` | – | **5** |

Die **5 nicht angenommenen State-Pakete** können in dieser konkreten
Messung dem vorhandenen `duplicate`-Ablehnungsgrund zugeordnet
werden: `29 - 24 = 5`, `mqttDroppedByReason.duplicate=5`;
alle anderen beobachteten MQTT-Kanäle wurden vollständig angenommen.
Die RC- und M3M-Zuordnung ergibt `13 + 11 = 24`.
SkyHub verarbeitet zudem **typisierte State-Property-Felder für beide
Geräte**, was der frühere Zustand mit 0/0 nicht beweisen konnte.

Die vorhandene `backend/message-guard.js` verwirft nicht selbst
Duplikate; die Ablehnung wird gegebenenfalls nach `registry.ingest`
als `result.dropReason` an die MQTT-Statistik übergeben.
Die Messung beweist damit die **Ablehnung wegen Duplikaten**, nicht
die semantische Wirkung einzelner DJI-Zustandsänderungen.
Die fünf identifizierten Wiederholungen sind kein Hinweis auf fünf
verlorene unterschiedliche Werte.

### Neue feldgenaue State-Abnahme

Der lokale Hardwareprüfer aus dem Test-Worktree zeigt zusätzlich
nur katalogisierte `state:`-Feldpfade pro Gerät, deren Frische,
historische Beobachtung, fehlende Rootnamen sowie Redaktionen und
nicht interpretierbare Felder. **Keine Werte oder Gerätekennungen**
werden ausgegeben.

```bash
git -C ~/Projekte/SkyHub-HW-Test fetch origin
git -C ~/Projekte/SkyHub-HW-Test \
  switch --detach origin/test/m3m-camera-capability-gap-audit-20261021
cd ~/Projekte/SkyHub-HW-Test
node --test backend/test/rc-pro-m3m-hardware-validation.test.js
set -o pipefail
SKYHUB_COMPOSE_DIR="$HOME/Projekte/SkyHub-Next" \
  node scripts/pi-rc-pro-m3m-check.js \
  | sed -n '/^--- DJI State-Feldabdeckung/,/^--- M3M-Feldluecken/p'
```

Damit kann aus den ursprünglich **27 nicht beobachteten
M3M-State-Pfaden** nun eine konkrete, zeitbezogene Abnahmeliste
abgeleitet werden. Frühere Nullwerte für State dürfen nach der
Neuverbindung nicht einfach als aktuelle Feldabdeckung ausgegeben
werden. Der Check selbst ändert weder MQTT-Abonnements noch
Backend-Prozesse oder DJI-Einstellungen.

## Abschluss des feldgenauen RC-/M3M-State-Hardwaretests (21.10.2026)

Der Benutzer hat den Test-Worktree `bde2416` auf dem realen Pi mit
`node --test backend/test/rc-pro-m3m-hardware-validation.test.js` und
`node scripts/pi-rc-pro-m3m-check.js` ausgeführt. **27/27
Node-Tests erfolgreich.** Sämtliche folgenden Informationen stammen
aus dem vom Prüfer ausgegebenen **wertfreien** Live-Bericht.

| State-Feldabdeckung | RC Pro Enterprise | Mavic 3M |
|---|---:|---:|
| Dokumentierte Pfade | **37** | **33** |
| Vom Parser akzeptiert und beobachtet | **7** | **5** |
| Innerhalb von 15 s frisch | **0** | **0** |
| Historisch gültig beobachtet | **7** | **5** |
| Nicht beobachtet (auswertbar) | **24** | **22** |
| Aus Datenschutzgründen redigiert | **6** | **6** |
| Nicht typisiert | 0 | 0 |

Beobachtete **RC-Pro-State-Feldnamen**:

- `state:live_capacity`
- `state:live_capacity.available_video_number`
- `state:live_capacity.coexist_video_number_max`
- `state:live_capacity.device_list`
- `state:live_capacity.device_list.available_video_number`
- `state:live_capacity.device_list.coexist_video_number_max`
- `state:firmware_version`

Beobachtete **M3M-State-Feldnamen**:

- `state:mode_code_reason`
- `state:serious_low_battery_warning_threshold`
- `state:low_battery_warning_threshold`
- `state:home_latitude`
- `state:home_longitude`

Kein tatsächlicher Akku-Schwellenwert, Homepoint-Koordinaten,
Firmwarewert, Streamzustand, Identifikator oder Schlüssel wurde
ausgegeben. **Historisch** ist hier ein normaler Berichtswert:
`pushMode=1` erfordert keinen periodischen Neusend.
Die frühere M3M-Lücke von **27 nicht beobachteten State-Pfaden**
sank nach Pilot-2-Neuverbindung auf **22**; diese Beobachtung
beweist keine Abdeckung aller möglichen M3M-Firmwarezustände.

Der erneut ausgegebene MQTT-Befund war **29 State empfangen,
24 akzeptiert, modellbezogen RC 13 / M3M 11 und 5 Duplikate
verworfen**. Bei vollständiger kanalübergreifender
Zählerbilanz wurden diese fünf tatsächlich dem State-Kanal
zugeordnet; sie sind damit **kein unbehandelter Parserverlust**.

Noch nicht beobachtete RC-Pro-State-Rootfelder:
`dongle_infos`, `live_status`.
Noch nicht beobachtete M3M-State-Rootfelder:
`dongle_infos`, `firmware_upgrade_status`,
`compatible_status`, `firmware_version`,
`camera_watermark_settings`.

**Abnahmegrenze:** Die RC-/M3M-State-Datenübertragung,
Gerätezuordnung, Typannahme und die Duplikatabwehr sind
hardwarebestätigt. Die **22 fehlenden auswertbaren M3M-State-Pfade**
sind weiterhin funktions- und firmwareabhängig; sie sind kein
Nachweis defekter Hardware.

## Unveränderte Grenzen

Es werden weder Multispektralbilddateien noch DJI SmartFarm-Indices
über MQTT behauptet. Die spätere Multispektral-Auswertung muss
RGB-/G-/R-/RE-/NIR-Mediendateien, Kalibrierungsmetadaten und
die DJI-Medien-API **separat** prüfen.
