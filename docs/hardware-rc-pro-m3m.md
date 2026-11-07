# Hardwareabnahme: RC Pro Enterprise + Mavic 3M

> **Einordnung vom 23.10.2026:** Dies ist ein datierter Hardware-Abnahmebericht. Die am **21.10.2026** beobachtete erfolgreiche typisierte Übernahme von **6/6 M3M-OSD-Erweiterungspfaden** aus [#21](https://github.com/mason82-dotcom/SkyHub-Next/pull/21) ist seit [#66](https://github.com/mason82-dotcom/SkyHub-Next/pull/66) in der Main-Provenienz und Offline-Diagnostik erfasst. Diese Beobachtung verifiziert **weder** die konkreten Einstellungen, RTH-/RC-Loss-Wirkungen, andere Firmwarestände noch eine erneute Hardwareabnahme nach dem Merge. Der Raspberry Pi wurde durch #66 nicht aktualisiert. [Aktuelle Integrationsübersicht](projektstand-2026-10-23.md).

**Stand:** 21.10.2026. Dies ist eine **Leseprüfung**, kein Flugtest und kein Deployment.

## Voraussetzungen

- RC Pro Enterprise mit DJI Pilot 2 und bereits konfiguriertem SkyHub-Workspace.
- Mavic 3M sicher am Boden eingeschaltet und mit der RC verbunden. Kein Flug erforderlich.
- Laufender SkyHub-Next-Backend-Container bietet GET /api/health, GET /api/devices und GET /api/diagnostics/mqtt-shapes an. Intern ist Port 4000 zu verwenden.
- Compose-Projektname: skyhub-next. Bestehende .env, EMQX, Caddy, Redis und PostGIS unverändert lassen.
- Kein MQTT- oder API-Token ist auf der Host-Shell einzugeben. Das Skript nutzt den vorhandenen Backend-View-Token ausschließlich im Container.

## 1. Isolierten Diagnose-Checkout vorbereiten

Einmalig im Pi-Terminal:

~~~bash
cd ~/Projekte/SkyHub-Next
git status --short --branch
git fetch origin
git worktree add --detach ~/Projekte/SkyHub-HW-Test origin/test/rc-pro-m3m-hardware-validation
~~~

Falls das Test-Worktree schon existiert, nicht überschreiben, sondern zunächst seinen Status prüfen. Der Befehl erstellt einen **separaten** Quellcode-Checkout und startet oder stoppt keine Dienste. Kein git switch im laufenden Projekt, kein Compose-Up, kein Restart.

Die Diagnosedateien liegen im Test-Worktree. SKYHUB_COMPOSE_DIR zeigt auf den bestehenden produktiven Compose-Projektordner und übernimmt dessen lokale Konfiguration, ohne diese zu verändern.

## 2. Bei eingeschalteter RC und Mavic 3M

Pilot 2 wie bisher mit SkyHub verbinden, den Workspace-/MQTT-Handshake abwarten und dann im Pi-Terminal:

~~~bash
cd ~/Projekte/SkyHub-HW-Test
node scripts/pi-rc-pro-m3m-check.js --help
SKYHUB_COMPOSE_DIR="$HOME/Projekte/SkyHub-Next" node scripts/pi-rc-pro-m3m-check.js
~~~

Das Skript führt nur docker compose exec -T backend node -e aus und ruft drei bestehende GET-APIs ab. Kein MQTT-Publish, kein Flugkommando, keine neue Kopplung, keine Containeränderung. Die geschützten API-Antworten bleiben im lokalen, vom Hostprozess abgefangenen Speicher-/Pipe-Kanal. Terminalausgabe: **ausschließlich** Modellnamen, Zustände, Zähler und dokumentierte Feldnamen.

**Exitcodes:** 0 = beide Gerätetypen, Verknüpfung und frische OSD-Telemetrie bestätigt; 3 = Hardwareabnahme unvollständig; 1 = lokale Docker-/API-Prüfung fehlgeschlagen; 2 = Parameterfehler. Exitcode 0 belegt **keine vollständige DJI-1.18-Feldkonformität**.

## 3. Abnahmekriterien

| Bereich | Erwartung | Einschränkung |
|---|---|---|
| MQTT | Verbunden und Subscriptions bestätigt | Broker-Verbindung allein beweist kein OSD |
| RC | Typ 2:144:0, Gateway, Topologie online | Keine Seriennummer ausgeben |
| Aircraft | Typ 0:77:2, Subdevice, Topologie online | M3M nutzt vorläufiges Mavic-3-Profil |
| Zuordnung | M3M als Kind der erkannten RC | Zuordnung ausschließlich intern |
| RC OSD | Letzte gültige Telemetrie unter 15 Sekunden alt | State-Felder können fehlen |
| M3M OSD | Explizit verbunden, letzte gültige Telemetrie unter 15 Sekunden alt | Kein GNSS-Fix am Boden erforderlich |
| State | Beobachtete und frische Feldpfade getrennt | Abwesenheit ist kein Beweis fehlender DJI-Unterstützung |
| DJI-Feldinventar | Dokumentierte/beobachtete/frische/fehlende Feldnamen | Geschützte und nicht typisierte Felder separat |

**Achtung:** Globale MQTT-Zähler und Payload-Shapes enthalten Ereignisse aller SkyHub-Geräte und beweisen für sich alleine keine RC/M3M-Verbindung. Der Test prüft die Verknüpfung separat anhand der Registry-Topologie.

## 4. Interpretation des ersten echten RC/M3M-Tests (21.10.2026)

Beim realen Pilot-2-Test wurden beide Geräte erkannt und verbunden:
2.464 OSD-Pakete empfangen und übernommen, 1.599 verwertbare
Telemetrie-Updates; die Geräte-OSD-Zeit lag jeweils bei ca. einer Sekunde.
Die Zuordnung RC Pro Enterprise zu Mavic 3M war ausdrücklich bestätigt.

Die ursprüngliche Skriptversion zeigte dennoch 0/48 RC- bzw. 0/144
M3M-Eigenschaftspfade sowie fehlende State-Zeitstempel. Bei fehlender
`deviceProperties`-/`propertyProfile`-/`propertyFieldObservedAt`-
Schnittstelle des **laufenden Pi-Backends** ist dies kein DJI-Hardwarebefund.
Ab der folgenden Skriptversion steht dafür **NICHT PRÜFBAR**.
Die globalen 60 State-Meldungen im ursprünglichen Report belegen
State-Traffic, nicht dessen Zuordnung zu einem bestimmten Gerät.

Die nächsten Schritte sind ausschließlich: prüfen, ob das Pi-Backend den
gemergten Parser bereits enthält; erst dann kann man dessen Feldwerte
und Feldzeitstempel sinnvoll mit der realen Firmware vergleichen.
Ein `git fetch` oder `git worktree add` installiert kein neues Backend.

### Rein lesende Versionsprüfung

~~~bash
cd ~/Projekte/SkyHub-Next
git status --short --branch
git log -1 --oneline
git rev-parse --short origin/main
~~~

Falls ein kontrolliertes Backend-Update später beauftragt wird, existiert
`scripts/pi-update-backend.sh --apply` im Repository: Es setzt ein sauberes,
synchronisiertes `main`, erfolgreiches Pi-Preflight und den laufenden
Compose-Stack voraus. Es erstellt private Konfigurations- und PostGIS-Backups
und aktualisiert **nur** das Backend, verursacht dabei aber einen
kurzen Backend-Neustart. Es darf nicht automatisch durch eine
Hardware-Diagnose ausgeführt werden.

## 5. Echter Hardwaretest nach Backend-Update (21.10.2026)

Der Pi hat nach dem **kontrollierten** Backend-Update die neuen
`deviceProperties`-, `propertyProfile`- und
`propertyFieldObservedAt`-Schnittstellen zur Verfügung gestellt.
Das Update-Skript bestätigte den Neuaufbau **ausschließlich** des Backends;
PostGIS, Redis, EMQX und Caddy wurden nicht neu erstellt. Der private
Konfigurations-/PostGIS-Backupordner wurde in der Pi-Ausgabe ausgewiesen.

### Bestätigte Beobachtungen, ohne Gerätekennungen oder Messwerte

| Signal | RC Pro Enterprise | Mavic 3M |
|---|---:|---:|
| Topologie und Zuordnung | bestätigt | bestätigt |
| Aktuelles OSD | 0 s (gerundet) | 0 s (gerundet) |
| Dokumentierte statische Feldpfade | 48 | 144 |
| Beobachtete auswertbare Feldpfade | **17** | **72** |
| Zuletzt frisch (<15 s) | 10 | 58 |
| Früher beobachtet, nicht frisch | 7 | 14 |
| Noch nicht beobachtet | 25 | 62 |
| Redigiert oder nicht typisiert (Differenz) | 6 | 10 |
| Letzte State-Beobachtung | vor 16 s | vor 16 s |

Beim Messzeitpunkt lagen backendweit 48 von 48 beobachteten OSD-Paketen
auch als angenommen vor, 48 gültige Telemetrie-Updates, zwei
Status-Pakete und 22 State-Pakete. Die Zähler gelten für das
**gesamte Backend**, nicht separat je Gerät. Der Topologie-ACK
war aktiviert, zwei Antworten erfolgreich, null Fehler.

RC Pro Enterprise: Live-OSD enthielt unter anderem Batteriekapazität,
Höhe, GPS-Koordinaten und strukturierten Funklink-Status; State
enthielt Streaming-Fähigkeiten und Firmwareversion.

Mavic 3M: Live-OSD enthielt unter anderem Flugzustand, Kamera-Array,
Hinderniserkennung, Position/RTK-Zustand, Akku/Batterie-Array,
Speicherstatus, Wind, Höhe und Geschwindigkeit. State-Felder enthielten
u. a. Home-Koordinaten, Akkuschwellwerte und mode_code_reason.

Die reale Mavic-3M-Beobachtung bestätigt damit die **Teilkompatibilität
des Cloud-API-Feldprofils**. Weder alle 144 Feldpfade noch multispektrale
Bilddaten/NDVI-Verarbeitung wurden durch diesen Telemetrietest
nachgewiesen.

### Warum 16 Sekunden alte State-Daten nicht fehlerhaft sind

Die offizielle DJI-Property-Definition unterscheidet
`pushMode=0` (OSD in stabiler Frequenz, angegeben mit 0,5 Hz)
und `pushMode=1` (State nur **bei Zustandsänderung**).
Der vorherige Hardwarecheck legte fälschlich die für OSD sinnvolle
15-Sekunden-Grenze auch als Bestehensgrenze für State an.
Die neue Auswertung bestätigt ein **historisch empfangenes** State-Paket
unabhängig von dessen Alter. Die letzten Beobachtungszeiten bleiben
sichtbar; sie dürfen nicht als aktuelle Messwerte ausgegeben werden.

Quelle: [DJI Pilot-to-Cloud Aircraft Property Reference](https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/pilot-to-cloud/mqtt/aircraft/properties.html)
und [RC Plus 2 Property Reference](https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/pilot-to-cloud/mqtt/dji-rc-plus-2/properties.html).

**Abnahmestatus:** Transport, Topologie und M3M/RC-Live-OSD sind an
echter Hardware bestätigt; dokumentierte Property-Auswertung ist
nachgewiesen, die feldweise Vollständigkeit sowie RTK/Multispektral-
Medienfunktionen bleiben offen.

## 6. Tiefere Ursachenanalyse der noch nicht beobachteten M3M-Felder

Die **vierte Live-Sitzung** (laufendes Backend, zweite Abnahme nach Update)
bestätigte erneut beide Gerätetypen, Zuordnung und aktuellen OSD-Verkehr
mit ca. zwei Sekunden Alter je Gerät. Backendweit: 700/700 OSD-Pakete
übernommen, 700 verwertbare Updates. Die RC lieferte 17/48 auswertbare
Feldpfade (10 frisch, 7 historisch). Für die M3M waren es inzwischen
**75/144** (58 frisch, 17 historisch), während **59** auswertbare
Definitionen nicht beobachtet wurden. Redigierte und untypisierte Pfade
(8+2 bei M3M) sind davon separat zu zählen.

Die neue, ausschließlich lokale Diagnose gruppiert die nicht
beobachteten Feldpfade:

1. **Root komplett unobserviert:** beispielweise ein nicht auftauchendes
   Top-Level-Statusobjekt. Das ist kein Nachweis mangelnder
   Geräteunterstützung; manche Rootfelder werden nur unter besonderen
   Bedingungen übertragen.
2. **Kind nicht vorhanden trotz beobachtetem Root:** zum Beispiel
   optionale Kamera-/Akkuattribute innerhalb eines aktiv gesendeten
   Arrays oder Objekts. Die fehlende Kind-Eigenschaft darf nicht als
   komplett fehlende Kamera interpretiert werden.
3. **Kind unter einem nicht beobachteten Root:** Dieses Unterfeld kann
   während der Beobachtung definitionsgemäß ebenfalls nicht auftreten.
   Die Zahlen sind keine weiteren eigenständigen Fehlermeldungen.

Außerdem wertet der Diagnosebericht **fünf nur generisch dokumentierte
DJI-Aircraft-Erweiterungs-Rootfelder** separat aus:
`distance_limit_status`, `rth_altitude`, `rc_lost_action`,
`payloads`, `wpmz_version`. Sie sind in den globalen
MQTT-Shape-Sammlungen sichtbar, jedoch **noch nicht einem konkreten
Sender zugeordnet**. Sie dürfen deswegen **nicht** nachträglich zum
M3M-Modellprofil hinzugefügt werden, nur weil sie backendweit auftreten.

Zunächst das Test-Worktree aktualisieren (keine Änderung an
`~/Projekte/SkyHub-Next` und keine Neustarts):

~~~bash
git -C ~/Projekte/SkyHub-HW-Test fetch origin
git -C ~/Projekte/SkyHub-HW-Test switch --detach origin/test/rc-pro-m3m-hardware-validation
SKYHUB_COMPOSE_DIR="$HOME/Projekte/SkyHub-Next" \
  node ~/Projekte/SkyHub-HW-Test/scripts/pi-rc-pro-m3m-check.js
~~~

Die neuen Zeilen `Nicht beobachtete Rootfelder`,
`Nicht beobachtete Unterfelder trotz beobachtetem Root` und
`Generische Aircraft-Erweiterungen in MQTT-Shapes` enthalten
ausschließlich offizielle Feldnamen, niemals SNs oder Messwerte.

## 7. Modellbezogene Zuordnung der generischen Aircraft-Rootfelder

Der fünfte echte Hardwaretest bestätigt eine stabile RC-Pro-/M3M-Topologie:
1.072/1.072 OSD-Pakete übernommen; beide Geräte mit ca. 2 Sekunden altem OSD.
Die M3M meldete 75/144 beobachtete auswertbare Feldpfade. Die verbleibenden
59 Pfade verteilen sich auf **7 fehlende Rootfelder**, **42 optionale Unterfelder
trotz vorhandener Rootstruktur** (überwiegend IR-/Zoom-/Belichtung-/Fokusattribute)
und **10 Unterfelder unter nicht beobachteten Rootstrukturen**.
RC Pro: 25 auswertbare Lücken = 3 Rootfelder, 8 optionale Unterfelder,
14 Nachfahren nicht beobachteter Rootfelder.

Das bisherige MQTT-Shape-Inventar ist backendweit und erlaubt **keine**
Absenderzuordnung. Die fünf generischen Aircraft-Rootfelder
`distance_limit_status`, `rth_altitude`, `rc_lost_action`,
`payloads` und `wpmz_version` sind daher noch keine M3M-Nachweise.

### Datenschutzsichere modellbezogene Erfassung (neuer Backend-Code)

Die neue Funktion `createModelShapeCatalog()` speichert ausschließlich die
festen Modellkennungen `2:144:0` und `0:77:2` aus der vertrauenswürdigen
SkyHub-Registry, Kanal `osd` oder `state`, offiziell dokumentierte Rootnamen,
Anzahl und Zeitstempel. Die Erfassung läuft **erst nach** MQTT-Guard
und erfolgreicher Registry-Verarbeitung. Disconnected-Aircraft-Replays,
unbekannte Modelle, unerkannte Feldnamen sowie freie Werte und IDs werden
verworfen. Keine neuen Subscriptions, DJI-Kommandos oder Pairing-Aktionen.

Die neue lesende Route `GET /api/diagnostics/mqtt-model-shapes` ist über
den regulären View-Token geschützt und enthält keine Seriennummern oder
Koordinaten. Die bestehende Pi-Diagnose verwendet sie optional. Ist sie
noch nicht im Backend vorhanden, erscheint **NICHT VERFÜGBAR**.

**Wichtig:** Diese Änderung ist aktuell ausschließlich im PR-Testbranch.
Eine neue Backend-Version wird erst nach Review, Merge und einem separat
kontrollierten Pi-Update verfügbar. Bis dahin keine modellbezogene
Zuordnung der zusätzlichen fünf Aircraft-Feldnamen behaupten.

## Folgetest des neuen M3M-150-Feldparsers (21.10.2026)

Nach dem kontrollierten Backend-Update wurde der Pi-Check erneut auf
echter **RC Pro Enterprise + Mavic 3M (0:77:2)** ausgeführt:

- **10/10 OSD-Pakete** backendweit verarbeitet; beide OSD-Zeitstempel
  ungefähr eine Sekunde alt; RC und M3M erkannt/zugeordnet.
- **M3M: 64/150** auswertbare Property-Pfade beobachtet und frisch.
  Weitere 76 auswertbare Pfade nicht beobachtet, 8 redigiert und
  2 untypisierte Arrays.
- **RC Pro: 10/48** beobachtet und frisch; 32 nicht beobachtet,
  6 absichtlich redigiert.
- **M3M-Erweiterung: alle 6 von 6 Pfaden** im neuen typisierten Parser
  mit akzeptiertem Feldwert und gültigem Beobachtungszeitstempel als
  `FRISCH` markiert: `distance_limit_status`, dessen drei Kinder
  `state`, `distance_limit`, `is_near_distance_limit`,
  sowie `rth_altitude` und `rc_lost_action`.

Dies ist ein hardwarebestätigter Parser-Annahme-Test **für Datentypen,
generische Wertebereichs- und Enum-Filter**. Er beweist weder den
konkreten Wert einer Flugkonfiguration noch RTH-/RC-Loss-Verhalten.
Der Bericht gibt aus Sicherheits- und Datenschutzgründen ausschließlich
Namen und Status, **keine Werte**, Kennungen oder Koordinaten, aus.

`status=0`, `state=0` und `topologyReplySent=0` seit dem sehr
frischen Backend-Neustart belegen **keinen Verbindungsfehler**.
Die Zuordnung kann aus persistierter Topologie stammen, während
die zeitnahe OSD-Telemetrie aktuell ist. Spätere State-Nachrichten
werden ereignisgetrieben gesammelt.

**Keine erneute DJI-Konfiguration, kein Flugtest und kein Backend-
Neustart für diese Dokumentation.** Die sechs Feldpfade sind ein
positiver, eng abgegrenzter Hardware-Abnahmebefund.

## 8. Falls die Verbindung fehlt

Für die bestehende Diagnose ohne Änderung am laufenden System:

~~~bash
cd ~/Projekte/SkyHub-Next
node scripts/pi-mqtt-osd-check.js 4001
node scripts/pi-telemetry-fields-check.js
~~~

Ein Merge auf GitHub installiert keine neue Backend-Version auf dem Pi. Veraltete lokale Container können die neueren Feldmetadaten noch nicht liefern. Ein Produktionsupdate ist ein **separater** Schritt.

Bitte nur den sanitisierten Bericht aus dem Hardwarecheck teilen, **keine** MQTT-Rohpayloads, Geräteseriennummern, GPS-Koordinaten, Tokens oder .env-Inhalte.

## 9. Grenzen

Die Prüfung löst weder property/set noch Flugsteuerung, Missionen, Medienaufnahmen, neue MQTT-Abos oder Pairing aus. Erst die Ausführung auf realer, eingeschalteter Hardware und die Auswertung des Ergebnisses ermöglichen eine belastbare Abnahme. GitHub-CI prüft lediglich synthetische RC-/M3M-Snapshots und die CLI-Argumentverarbeitung.
