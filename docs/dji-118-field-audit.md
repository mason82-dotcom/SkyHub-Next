# DJI Cloud API 1.18 – gerätespezifischer Feldabgleich (read-only)

Stand: 2026-10-21. Zielversion des SkyHub-Projekts: DJI Cloud API 1.18.

## Referenz und Abdeckungsstatus

Die drei ursprünglichen, quellseitig überprüfbaren MQTT-Property-Tabellen wurden aus
[`dji-sdk/Cloud-API-Doc`](https://github.com/dji-sdk/Cloud-API-Doc)
mit festem Commit `4ec6b0c7f9472aeb09a0a47949855d19c473ea07` extrahiert.
Daraus stammt der maschinenlesbare Katalog
[`backend/data/dji-cloud-api-118-fields.json`](../backend/data/dji-cloud-api-118-fields.json).
Die offiziellen *aktuellen* Modellkennungen werden separat mit
[DJI Product Support](https://developer.dji.com/doc/cloud-api-tutorial/en/overview/product-support.html)
abgeglichen.

**Wichtig:** Die GitHub-Referenztabellen enthalten nicht alle gerätespezifischen
Erweiterungen, die DJI in der Webdokumentation später veröffentlicht hat.
Der Katalog ist damit **kein Nachweis einer vollständigen 1.18-Feldabdeckung**.
Es werden insbesondere keine angeblichen, aber nicht belegten Matrice-4T-
oder RC-Plus-2-Sonderfelder erfunden.

| Gerät | DJI domain/type/sub_type | Feldprofil | Quellenstatus |
|---|---|---|---|
| Mavic 3E | `0/77/0` | `mavic3`, 144 Pfade | offizielle Mavic-3-Familientabelle |
| Mavic 3T | `0/77/1` | `mavic3`, 144 Pfade | offizielle Mavic-3-Familientabelle |
| Mavic 3M | `0/77/2` | `mavic3`, 144 Pfade | **vorläufiges** Familienprofil; ID am 20.10.2026 am echten Gerät beobachtet, nicht in der DJI-Cloud-Produktliste |
| Matrice 4T | `0/99/1` | `matrice4T`, 202 statische + 9 dynamische Gimbal-Feldtypen | **vorläufig**: 162 archivierte Aircraft-Pfade + 37 dokumentierte generische Ergänzungen + 3 Pfade der offiziellen M4-Serien-Seite; am 22.10.2026 am echten Gerät beobachtet (siehe Hardwarebeobachtung), Verfügbarkeit weiter nicht vollständig verifiziert |
| RC Pro Enterprise | `2/144/0` | `rcPro`, 55 Pfade | offizielle RC-Pro-Feldtabelle; am 22.10.2026 um sieben Pfade der aktuellen Webseite ergänzt |
| RC Plus 2 Enterprise | `2/174/0` | `rcPlus2`, 54 Pfade | eigenes, gegen die DJI-Webdefinition vom 03.09.2025 abgeglichenes RC-Plus-2-Profil; am 22.10.2026 am echten Gerät beobachtet (siehe Hardwarebeobachtung), Abnahme mit Livestream und SIM ausstehend |
| DJI Dock | `3/1/0` | `dock1`, 117 Pfade | offizielle Dock-to-Cloud-Webreferenz; nicht an Hardware beobachtet |
| DJI Dock 2 | `3/2/0` | `dock2`, 144 Pfade | wie oben |
| DJI Dock 3 | `3/3/0` | `dock3`, 152 Pfade | wie oben |
| Matrice 3D / 3TD | `0/91/0`, `0/91/1` | `matrice3D`, 201 Pfade | Dock-Flugzeug laut Dock-to-Cloud-Webreferenz; nicht an Hardware beobachtet |
| Matrice 4D / 4TD | `0/100/0`, `0/100/1` | `matrice4D`, 208 Pfade | wie oben |

Die Felderzahlen enthalten verschachtelte `struct`- und `array`-Pfade,
also keine Garantie für ebenso viele gleichzeitig sendende Messwerte.
Die vollständigen Quellreferenzen samt Datei-SHA befinden sich im Katalog.
Das zusätzliche RC-Plus-2-Profil stammt aus der offiziellen
[DJI RC Plus 2 Property-Referenz](https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/pilot-to-cloud/mqtt/dji-rc-plus-2/properties.html)
mit Seitenstand 03.09.2025 (am 21.10.2026 überprüft). Anders als die drei archivierten
GitHub-Profile ist die Webreferenz nicht auf einen Git-Blob gepinnt. Die neu
abgeglichenen Felder sind `wireless_link.4g_link_state`,
`wireless_link.4g_quality`, `wireless_link.4g_uav_quality`,
`wireless_link.4g_gnd_quality`, `wireless_link.4g_freq_band`,
`cloud_control_auth` (absichtlich redigiert) und `drc_state`.
Das im älteren RC-Pro-Profil enthaltene `country` fehlt in dieser
RC-Plus-2-Seite und wurde nicht ungeprüft übernommen.

Das Matrice-4T-Profil erweitert die allgemeine Aircraft-Tabelle um sechs
belegbare Pfade aus der [DJI Pilot-to-Cloud Aircraft Property-Referenz](https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/pilot-to-cloud/mqtt/aircraft/properties.html)
(Seitenstand 28.06.2024): `distance_limit_status` samt drei Unterfeldern,
`rth_altitude` und `rc_lost_action`. Diese Referenz erschien **vor** der
Matrice 4T und ist keine gerätespezifische Unterstützungsgarantie. Die Werte
werden nur gelesen, niemals als `property/set` oder Flugkommando gesendet.
Hinzu kommen elf generische Aircraft-Pfade für `payloads` (verschachtelte
Payload-Statusinformationen), `rid_state`, `wpmz_version`,
`current_rth_mode` und die dokumentierten Commander-Statusfelder.
Diese sind **nicht als M4T-validierte Features ausgewiesen**; die Feldwerte
werden erst verarbeitet, wenn die reale DJI-Firmware sie liefert. Das
dynamisch benannte DJI-OSD-Objekt `{type-subtype-gimbalindex}` wird
mit höchstens acht Gimbal-Einträgen und neun numerischen Statusfeldern
unter `deviceProperties.osd.payload_gimbals` abgelegt. Nur passende
Geräteprofilkennungen dürfen es verwenden; keine SNs, freien Strings
oder unbekannten Payload-Attribute werden übernommen. Laser-Zielkoordinaten
werden nur als vollständiges, gültiges WGS84-Paar akzeptiert.

Zusätzlich sind aus derselben offiziellen allgemeinen Aircraft-Referenz
**20 PSDK-Feldpfade** als vorläufige Kandidaten importiert:
`psdk_ui_resource` (Geräteindex/Bereitschaft) und
`psdk_widget_values` (numerische Widgetwerte und Lautsprecherstatus).
Zustände und Lautstärke werden anhand der dokumentierten DJI-Codes und
Zahlenbereiche geprüft. Namen, Seriennummern, Versionstexte, OSS-Objektschlüssel,
Dateinamen und Prüfsummen sind absichtlich redigiert. Arrays bleiben auf
maximal acht Elemente je Ebene begrenzt. Diese PSDK-Strukturen sind **nicht**
als für die Matrice 4T freigegeben oder hardwarebestätigt zu betrachten.

Die dokumentierten Laserzustände 1 (TOO_CLOSE), 2 (TOO_FAR) und 3 (NO_SIGNAL)
unterdrücken jetzt auch eventuell mitgesendete Laser-Zielkoordinaten,
Zielhöhe und Distanz. Zustand 0 (NORMAL) gestattet gültige Koordinatenpaare.
Diese Schutzregel gilt ausschließlich für die neu integrierten generischen
Gimbal-Felder. Ein GPS-Trackpunkt wird daraus niemals erzeugt.
Dokumentierte Enumerationen werden auf bekannte Codes begrenzt; neue Codes
müssen nach DJI-Schema-Abgleich ausdrücklich ergänzt werden.

## Implementierte Verarbeitung

- `backend/dji-properties.js` verarbeitet die typisierten, verschachtelten Felder nach der referenzierten Definition, ohne frei unbekannte DJI-Keys durchzureichen.
- Pro Kanal wird der bei DJI **am Rootfeld** definierte `pushMode` verwendet: `osd` (0) und `state` (1). Verschachtelte Unterfelder erben den Rootkanal.
- Zahlen, Integer, Boolesche Werte und wenige strikt validierte kurze Geräte- beziehungsweise Firmwarekennungen werden angenommen. Andere Texte, etwa IMEI, EID, Akku-SN, Geräte-SN, Streaming-URL, freie Zeichenketten und `control_source`, bleiben **absichtlich redigiert**.
- Array-Größe ist auf acht Elemente beschränkt; dynamische und unbekannte Eigenschaften werden verworfen. Keine MQTT-Rohpayloads oder Gerätesecrets gelangen in Socket.IO, API, Redis oder Logs.
- `backend/registry.js` stellt `deviceProperties.osd` und `deviceProperties.state` mit getrennten Kanalzeitstempeln (`propertyObservedAt`) und für jeden bereinigten Feldpfad eigenständigen Beobachtungszeiten (`propertyFieldObservedAt`) bereit. Ein frisches Windfeld macht dadurch ältere Kamera-/Akkuwerte **nicht** ebenfalls frisch. Der ursprüngliche normalisierte Telemetrieadapter bleibt unverändert.
- Die für [DJI RC Plus 2 Enterprise dokumentierten](https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/pilot-to-cloud/mqtt/dji-rc-plus-2/properties.html) Streamfelder `video_index`, `video_type` und `switchable_video_types` werden nun als validierte Kurzindizes und feste Kameratyp-Bezeichnungen verarbeitet. `video_id` und `sn` bleiben aus Datenschutzgründen redigiert.
- Für `latitude`/`longitude` gilt WGS84 (-90..90 und -180..180). Die maschinenlesbaren älteren DJI-Tabellen verwenden teilweise ungeeignete Float-Mindestwerte (`-1.4E-45`); diese dürfen **gültige westliche/südliche Koordinaten nicht verhindern**. DJI-Nullposition (`0,0`) und partielle Koordinatenpaare überschreiben kein zuvor geprüftes Positionspaar, auch nicht im Raw-Properties-Snapshot.
- Ein Aircraft-OSD **ohne `mode_code`** markiert ein zuvor getrenntes Fluggerät nicht automatisch wieder als verbunden. Erst eine neue explizite Zustandsmeldung darf die Replay-Sperre aufheben.
- Meldungen mit `mode_code=14` (Fluggerät nicht verbunden) dürfen weiterhin keinen angeblich frischen OSD-Wert erzeugen.
- Die registrierte Topologie entscheidet das verwendete Modellprofil; zuvor empfangene oder unbekannte Daten werden nicht blind einem Gerätetyp zugeordnet.
- `GET /api/diagnostics/dji-fields?model=0:77:2` liefert die Wert-freien Definitionen nach regulärer View-Token-Authentifizierung. Dieselbe API unterstützt alle sechs genannten DJI-Typen. Beim erweiterten M4T-Profil enthält die Antwort **getrennte Quellangaben** für die fest gepinnte GitHub-Basistabelle (`source`) und die dokumentierten generischen DJI-Web-Erweiterungen (`extensionSource`, `extensionSourceEdition`, `extensionVerifiedAt`). Das Vertrauensniveau bleibt ausdrücklich `shared-aircraft-with-web-extensions-unverified`.
- `node scripts/pi-telemetry-fields-check.js` zeigt zusätzlich dokumentierte Pfadzahlen und beobachtete Feldnamen pro Gerät an; kein Rohwert oder Seriennummer wird ausgegeben. **Aktuell** bedeutet je Feld eine letzte validierte Beobachtung innerhalb von 15 Sekunden, nicht lediglich eine neue Meldung auf dem betreffenden MQTT-Kanal. Historisch beobachtete Werte werden separat gezählt. Die Diagnose zählt **auswertbare**, absichtlich **redigierte** und wegen untypisierter Arrays **nicht unterstützte** Felder getrennt. Absichtlich aus Datenschutzgründen verworfene Kennungen gelten nicht als `nicht beobachtet`.

## Hardwarevalidierte Mavic-3M-Erweiterung (21.10.2026)

Der echte RC-Pro-Enterprise-/Mavic-3M-Hardwaretest nach dem kontrollierten
SkyHub-Backend-Update bestätigte die Gerätezuordnung in der live
akzeptierten MQTT-Topologie (M3M: `0:77:2`). Im neuen
**modellbezogenen**, ausschließlich lesenden MQTT-Feldkatalog wurden
drei zusätzliche Aircraft-Rootfelder konkret in Mavic-3M-OSD beobachtet:

- `distance_limit_status` – Distanzbegrenzungsstatus, dokumentierter
  verschachtelter `struct`;
- `rth_altitude` – eingestellte Rückkehrhöhe (RTH);
- `rc_lost_action` – konfigurierte Aktion bei Verbindungsverlust zur RC.

**Nachweisgrenze der ersten Sitzung:** Zunächst waren ausschließlich
die drei Root**namen** modellbezogen nachgewiesen. Erst der spätere,
hier separat dokumentierte Hardwaretest bestätigte, dass der SkyHub-
Parser typisierte Feldwerte für alle sechs Erweiterungspfade akzeptiert.
Die Datentypen und Grenzen stammen aus der generischen
[DJI Aircraft Property Reference](https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/pilot-to-cloud/mqtt/aircraft/properties.html),
Editionsstand 2024-06-28. Aus der Parser-Annahme allein dürfen **keine**
Aussagen über die tatsächlichen sicherheitskritischen RTH- oder
Verbindungsverlust-Einstellungen oder deren Wirkung abgeleitet werden.

Die Schemaabbildung `mavic3m` enthält **nur sechs zusätzliche
Felddefinitionen** (3 Roots plus 3 Kinder unter
`distance_limit_status`) und erbt alle 144 fest gepinnten Mavic-3-Felder.
Dadurch lautet das vorläufige inventarisierte Profil **150 Pfade**.
Die Mavic 3E und 3T behalten unverändert ihre 144 Definitionen.
`confidence`, `extensionEvidence` und `extensionStatus` trennen den
hardwarebestätigten Rootnamen-/Typ-Annahme-Nachweis von der noch
offenen unabhängigen Interpretation konkreter Werte, Grenzfälle und
Funktionen.

Die neuen Definitionen werden ausschließlich gelesen und mit
DJI-Typ-/Wertebereich-Prüfungen akzeptiert; die generischen
`access: rw`-Metadaten autorisieren **keine** DJI-`property/set`-
Nachrichten. Keine Flugsteuerung, keine RTH-Änderung und keine
Geräte-Konfigurationsänderung.

Bei vorläufiger M3M-OSD-Feldprüfung sind mindestens zu unterscheiden:
`osd`-Nachricht angenommen, dokumentierter Rootname beobachtet,
einzelnes Unterfeld/Enum-Wert tatsächlich validiert und schließlich
hardwarebestätigte Funktion. Jede Stufe benötigt gesonderte Evidenz.

### Realer Nachtest nach M3M-150-Backend-Update (21.10.2026)

**Quelle:** vom Benutzer auf dem Raspberry Pi ausgeführter
`node scripts/pi-rc-pro-m3m-check.js` gegen die tatsächlich verbundene
RC Pro Enterprise und Mavic 3M. Das Update-Skript hat nur den
Backend-Container neu erstellt; PostGIS, Redis, EMQX und Caddy blieben
unverändert.

| Prüfmerkmal | Echte Beobachtung |
|---|---|
| MQTT verbunden/abonniert | ja / ja |
| RC Pro und M3M in Topologie zugeordnet | ja |
| OSD-Feldfrische je Gerät | ungefähr 1 s |
| OSD-Pakete backendweit | 10 empfangen / 10 übernommen / 10 verwertbare Updates |
| M3M-Feldprofil | 150 Definitionen |
| M3M-Property-Pfade | 64 gültig beobachtet, 64 frisch |
| M3M-Erweiterung | **6/6 neue Feldpfade frisch und vom typisierten Parser übernommen** |
| RC-Pro-Property-Pfade | 10/48 beobachtet, 10 frisch |
| Status-/State-Pakete seit Backend-Neustart | 0 / 0 |
| Topologie-ACK seit Neustart | 0 gesendet, 0 Fehler |

**Sechs auf echter M3M vom Parser angenommene Feldpfade:**
`osd:distance_limit_status`,
`osd:distance_limit_status.state`,
`osd:distance_limit_status.distance_limit`,
`osd:distance_limit_status.is_near_distance_limit`,
`osd:rth_altitude`, `osd:rc_lost_action`.

Die Werte erfüllten die in SkyHub hinterlegten **generischen DJI-
Datentyp-, Bereichs- und Enum-Bedingungen**. Der Testbericht enthielt
absichtlich **keine Zahlenwerte, IDs, Koordinaten oder Secrets**.
Deshalb sind konkrete Semantik, unabhängige Werte-/Grenzfallkontrolle,
historische Firmwarevarianten und das korrekte Verhalten im Flug **nicht
nachgewiesen**. Kein DJI-`property/set`-, RTH- oder RC-Loss-Test nötig.

Die State-/Status-Zähler wurden **unmittelbar nach dem Backend-Neustart**
beobachtet; es gab keine frischen State-Ereignisse seit dessen Start.
Die Topologie konnte aus bereits persistierten Daten wiederhergestellt
werden. OSD der beiden real verbundenen Geräte war dagegen frisch.
Topologie-ACK `0` ist hier kein Fehlernachweis.

**Abnahmestatus:** Typisierte, rein lesende Telemetrieaufnahme dieser
sechs Felder **an echter M3M bestätigt**; vollständige DJI-1.18-
Geräteabdeckung und Flugsemantik bleiben ausdrücklich offen.

### Rein lesende Hardwareabnahme der sechs M3M-Erweiterungspfade

Die Ergänzung `backend/hardware-validation.js` zeigt künftig getrennt
vom modellbezogenen **Rootnamen-Nachweis** die tatsächlich vom neuen
`mavic3m`-Parser angenommenen **typisierten** Feldpfade an. Erfasst
werden die Roots `distance_limit_status`, `rth_altitude` und
`rc_lost_action` sowie die drei Kinder von `distance_limit_status`.

Der Bericht zeigt pro fest codiertem Pfad nur `FRISCH`, `HISTORISCH`
oder `NICHT BEOBACHTET` sowie Summen. Keine Zahlenwerte von RTH-
Höhen, Distanzbegrenzungen oder Flugsteuer-Konfigurationen werden
ausgegeben. Der Status setzt einen durch den Parser übernommenen
Wert **und** den zugehörigen gültigen per-Field-Zeitstempel voraus.

Wird noch das vorherige Pi-Backend mit `propertyProfile.name=mavic3`
verwendet, lautet der Status explizit `M3M-150-Feldparser: NICHT AKTIV`;
die nicht geladene Profil-Erweiterung wird nicht als fehlende DJI-Hardware
fehlinterpretiert. `NICHT BEOBACHTET` kann außerdem Abwesenheit,
ungültigen Eingabedatentyp oder eine Sanitizer-Ablehnung bedeuten.
Für die endgültige Gerätevalidierung sind diese Ursachen zu trennen;
eine akzeptierte Eigenschaft ist insbesondere **keine Bestätigung**
ihrer sicherheitsrelevanten Wirkung oder korrekten DJI-Firmwaresemantik.

Auf dem Pi wird ausschließlich die vorhandene Diagnoseschnittstelle
gelesen; das Prüfsystem publiziert keine MQTT-Nachricht, verändert
keine Einstellung und löst keine Flug- oder Kameraaktion aus.
## Absichtlich nicht umgesetzt

Keine DJI-`property/set`-Aufrufe, Flight Control, Missionsstarts, Kameraaktionen
oder Broker-ACL-Änderungen. Die bisherigen DJI-Topics, EMQX-Port 1884,
Postgres/Redis/Compose, Caddy und Pilot-2-Pairing bleiben unangetastet.
DJI SmartFarm-Multispektralprodukte wie NDVI/NDRE sind **Medienprodukte**,
keine automatisch verfügbaren MQTT-OSD-Eigenschaften, und werden nicht
als ausgedachte Telemetriefelder eingeführt.

## Hardwarebeobachtung vom 22.10.2026 (RC Plus 2 Enterprise, Matrice 4T)

Quelle: `node scripts/pi-telemetry-fields-check.js` auf dem Pi, rein lesend.
Ausgewertet wurden nur Feldnamen; keine Kennungen, Koordinaten oder Rohwerte.
Die RC Plus 2 war am selben Tag über die Pilot-2-Kopplung angebunden worden.

| Gerät | OSD frisch | Aktuell gemeldete Felder | Beobachtet / auswertbar |
|---|---|---|---|
| RC Plus 2 Enterprise (`2/174/0`) | ja | 14 | 21 / 47 |
| Matrice 4T (`0/99/1`) | ja | 91 | 91 / 178 |

RC Plus 2: Beobachtet sind `capacity_percent`, `height`, `wireless_link`
mit SDR- und 4G-Unterfeldern, `drc_state`, `state:live_capacity` und
`state:firmware_version`. Das stützt das Profil `rcPlus2`. Nicht beobachtet
sind `live_status`, `dongle_infos` und die Kameraliste in `live_capacity`;
diese Felder hängen vermutlich an einem laufenden Livestream bzw. einer
SIM/eSIM, was in diesem Test nicht gegeben war und hier nicht belegt ist.

Matrice 4T: 91 dokumentierte Felder und 5 von 9 dynamischen Gimbal-Feldtypen
(`gimbal_pitch`, `gimbal_roll`, `gimbal_yaw`, `measure_target_error_state`,
`zoom_factor`) waren aktuell. Das Profil bleibt vorläufig, weil 87
auswertbare Felder (u. a. `dongle_infos`, IR-Messbereich) nicht beobachtet wurden.

Grenzen: Bei keinem Gerät war ein GNSS-Fix verfügbar; `latitude` und
`longitude` fehlen, die Nullposition wird bewusst nicht als Position genutzt.
Fehlende Felder belegen keine fehlende Geräteunterstützung. Ein einzelner
Snapshot belegt weder Feldwerte noch deren Plausibilität.

### Nachtrag 22.10.2026: GPS- und RTK-Fix

Zweiter Lauf von `node scripts/pi-telemetry-fields-check.js` mit GPS- und
RTK-Fix an den Geräten (nur Feldnamen und Zählwerte, keine Koordinaten oder
Kennungen):

| Gerät | Typische Felder | Aktuell gemeldete Felder | Position |
|---|---|---|---|
| RC Plus 2 Enterprise | 5/5 inkl. `latitude`, `longitude` | 16 | frisch, zeitverifiziert |
| Matrice 4T | 16/16 | 94 | frisch, zeitverifiziert |

Matrice 4T: Alle 9 dynamischen Gimbal-Feldtypen waren aktuell, neu gegenüber
dem ersten Lauf `measure_target_longitude`, `measure_target_latitude`,
`measure_target_altitude` und `measure_target_distance`. Beobachtete Zählwerte:
17 GPS-Satelliten, 17 RTK-Satelliten, `rtkFixState` 2, `positionQuality` 5.
Die RC Plus 2 meldet keine Satelliten- oder RTK-Felder; sie gehören zum
Fluggerät.

Einordnung: `rtkFixState` 2 entspricht laut DJI-Webreferenz
(`position_state.is_fixed`) „Fixing successful“; `positionQuality` 5 ist dort
„Gear 5“ (Satellitenstufe), nicht „RTK fixed“ (das ist Wert 10, siehe Abschnitt
„Abgleich mit der DJI-Webreferenz“). Ein Zählwert belegt weder Dauer noch
Positionsgenauigkeit. Mavic 3M und RC Pro Enterprise sendeten zu diesem
Zeitpunkt nicht und bleiben bei der Nullposition. Ein Snapshot belegt weder
Dauerhaftigkeit noch Positionsgenauigkeit. Offen bleibt die Prüfung mit
Livestream und SIM/eSIM.

## Abgleich mit der DJI-Webreferenz (22.10.2026)

Quelle: alle 116 englischen `api-reference`-Unterseiten von
`developer.dji.com/doc/cloud-api-tutorial/en/`. Die Seite ist eine
VuePress-App; die Seiteninhalte liegen als JavaScript-Chunks vor, deren
Routentabelle in `app.js` steht. Aus den Property-Tabellen wurden Pfad, Typ,
Constraint, `accessMode` und `pushMode` ausgelesen und mit den Katalogprofilen
verglichen. Die Webseite nennt keine Cloud-API-Version; sie wurde deshalb
nicht als „1.18“ belegt, sondern als aktueller Seitenstand behandelt.

| Katalogprofil | Webseite | Katalog | Seite | Ergebnis |
|---|---|---|---|---|
| `mavic3` | `m3-series` | 144 | 143 | 1 Pfad nur im Katalog (`cameras.payload_index`) |
| `aircraftCommon` | `others/aircraft` | 162 | 160 | 2 Pfade nur im Katalog (`*.payload_index`) |
| `matrice4T` | `m4-series` | 202 | 104 | alle 98 Seitenpfade im Katalog; 104 Katalogpfade stammen weiter aus der generischen Aircraft-Tabelle |
| `rcPro` | `rc-pro` | 55 | 55 | deckungsgleich nach Ergänzung |
| `rcPlus2` | `dji-rc-plus-2` | 54 | 54 | deckungsgleich |

**Korrigiert (Katalog und Tests angepasst):**

- `rcPro`: sieben Pfade ergänzt, die die RC-Pro-Seite führt und die mit der
  RC-Plus-2-Definition identisch sind: `drc_state`, `cloud_control_auth`
  (redigiert) und fünf `wireless_link.4g_*`-Felder.
- `matrice4T`: `position_state.quality` kennt auf der M4-Seite zusätzlich 10
  („RTK fixed“), `mode_code` zusätzlich 19 („Dock site evaluation in progress“).
  Ohne diese Werte hätte der Parser einen echten RTK-Fix dieser Felder
  verworfen. Neu aufgenommen: `commander_flight_mode`, `rth_mode`,
  `offline_map_enable`.
- `mavic3`, `aircraftCommon`: `total_flight_time` steht dort als `float`
  (Katalog: `int`). Der Parser verwirft `int`-Felder mit Nachkommastellen.
  Die M4-Seite nennt `int`; dieser Typ bleibt bei `matrice4T`.
- Modellbezogene Live-Feldübersicht (`/api/diagnostics/mqtt-model-shapes`) um
  RC Plus 2 (`2/174/0`) und Matrice 4T (`0/99/1`) erweitert; der
  OSD-Wiederholungsschutz bei `mode_code` 14 gilt jetzt für beide
  Fluggeräte-Modelle.

**Bewusst nicht geändert (Abweichung bleibt dokumentiert):**

- `live_status.video_quality` (`rcPro`, `rcPlus2`): Katalog 0–4, Webseite 0–3.
  Ein Verengen würde Werte verwerfen, die eine Firmware senden könnte.
- `obstacle_avoidance`: Katalog `rw`, Webseite `r`; bei rein lesender
  Verarbeitung folgenlos.
- `firmware_version` (M4-Seite): `pushMode` 0, Katalog 1.
- `payloads` und `wpmz_version` stehen nur in den Dock-to-Cloud-Seiten (M30,
  Dock 1), nicht in den Pilot-to-Cloud-Seiten für M3/M4. Der Backend-Code
  akzeptiert sie für die Mavic 3M ausdrücklich als „generische Kandidaten“.
  Dass die M3M sie im State sendet, ist beobachtet, aber für diesen Pfad nicht
  offiziell dokumentiert.
- Auf der M4-Seite steht der dynamische Gimbal-Schlüssel als
  `type_subtype_gimbalindex`; er wird wie bisher über die dynamische
  Gimbal-Behandlung verarbeitet.
- Leere `min`/`max`-Constraints in den Tabellen wurden als „keine Angabe“
  gewertet.

Der Abgleich prüft Struktur und Constraints der Dokumentation, nicht, ob eine
Firmware tatsächlich so sendet. Für die Matrice 4T bleibt das Profil
**vorläufig**, solange 104 Pfade nur aus der generischen Aircraft-Tabelle
stammen.

### Live-Beobachtung Matrice 4T nach dem Katalogabgleich (22.10.2026)

Quelle: `/api/diagnostics/mqtt-model-shapes` (nur Feldnamen) und das
Geräteabbild des Backends, jeweils ohne Kennungen oder Koordinaten. Das Backend
lief bereits mit dem angepassten Katalog.

- OSD (42 Nachrichten): 32 Wurzelfelder. State (26 Nachrichten): 12
  Wurzelfelder, darunter `payloads`, `wpmz_version`, `control_source`,
  `cameras`, `mode_code_reason` und `offline_map_enable`. Nicht gesendet
  wurden in diesem Zeitraum 24 OSD- und 44 State-Wurzelfelder des Katalogs.
- `offline_map_enable` ist am Gerät bestätigt (neu aus der M4-Serien-Seite).
- `rth_mode` und `commander_flight_mode` (Namen der M4-Serien-Seite): In der ersten
  Beobachtung wurden sie nicht gesendet, das Gerät sendete stattdessen `current_rth_mode`
  und `current_commander_flight_mode` (Namen der generischen Aircraft-Tabelle). In einer
  späteren Beobachtung am selben Tag kamen **`rth_mode` und `commander_flight_mode` im State**
  an, die `current_*`-Namen dagegen nicht. Beide Namenspaare sind im Katalog; welcher Name
  gesendet wird, hing hier vom Zeitpunkt ab. Die Ursache wurde nicht geklärt.
- `payloads` und `wpmz_version` sendet die M4T wie die Mavic 3M, obwohl beide
  Felder nur in den Dock-to-Cloud-Seiten dokumentiert sind.
- Position: Ohne RTK-Lösung `rtkFixState` 0, `positionQuality` 5 (19 GPS-,
  20 RTK-Satelliten). Mit RTK-Fix `rtkFixState` 2 („Fixing successful“),
  `positionQuality` weiterhin 5 (20 GPS-, 20 RTK-Satelliten). Der von der
  M4-Seite dokumentierte Wert 10 („RTK fixed“) trat in dieser Beobachtung
  **nicht** auf; ob die M4T ihn je meldet, ist offen. Der aufgenommene Wert 10
  im Katalog bleibt eine Dokumentationsvorgabe, keine Gerätebeobachtung.
- Zum Messzeitpunkt waren 69 Nachrichten vom Backend als Duplikate verworfen
  (`mqttDroppedByReason.duplicate`), solange RC und Flugzeug gemeinsam sendeten;
  das ist der Wiederholungsschutz, kein Datenverlust.

Grenzen: Ein Zeitfenster von wenigen Minuten belegt nicht, dass nicht
gesendete Felder nie gesendet werden. Die Beobachtung stammt von einer
Firmware-Version, die hier nicht erfasst ist.

## Abgleich mit dem Dock Feature Set (22.10.2026)

Quellen: `feature-set/dock-feature-set/` (14 Seiten, u. a. `dock-access-to-cloud`,
`dock-device-management`, `hms`) und die Dock-to-Cloud-API-Referenz
(`api-reference/dock-to-cloud/mqtt/dock/dock1|dock2|dock3/properties`,
`…/aircraft/m3d|m4d|m30-properties`) von `developer.dji.com/doc/cloud-api-tutorial/en/`.
Es ist **keine Dock-Hardware** angeschlossen; alles Folgende sind Definitionen aus der
Dokumentation, nicht am Gerät beobachtet.

**Neu im Katalog** (mechanisch aus den Webtabellen übernommen; der Konverter wurde zuvor an den
vorhandenen Profilen `rcPlus2`, `rcPro`, `mavic3` und `aircraftCommon` geprüft und gibt 140 von
143 bzw. 157 von 160 Pfaden identisch wieder, die übrigen Abweichungen sind Seitenänderungen
der DJI-Seite):

- `dock1`, `dock2`, `dock3` für `3/1/0`, `3/2/0`, `3/3/0` sowie `matrice3D` (Matrice 3D und 3TD)
  und `matrice4D` (Matrice 4D und 4TD). Die Hüllenzeile `data` der Seiten ist keine Property
  und wurde entfernt.
- **Matrice 30 / 30T (`0/67/*`) ist bewusst nicht zugeordnet:** Diese Flugzeuge fliegen auch
  handgesteuert mit Pilot 2, ein Dock-Profil wäre dort falsch.
- `wireless_link_topo.secret_code` ist als `redacted` markiert. Textfelder wie `imei`, `iccid`,
  `sn`, `rtcm_info.*` werden wie bisher nie weitergegeben, weil nur freigegebene Textpfade
  zulässig sind.

**Absicherung:** `privacy: redacted` wirkt jetzt auch im Parser selbst (`cleanValue`). Bisher
schützte nur der Typ (Text und Arrays ohne Elementschema wurden verworfen). Ein Test belegt, dass ein
als redigiert markiertes Feld auch dann nicht durchkommt, wenn sein Typ harmlos wäre, und dass es
ohne den Marker durchkäme.

**HMS-Warntexte** (Dock-Seite `hms`): Der Schlüssel `dock_tip_<code>` wurde schon richtig gewählt.
Neu sind die dokumentierten Ersetzungsregeln:

| Platzhalter | Regel |
|---|---|
| `%alarmid` | Alarmcode (hex) |
| `%component_index` | `component_index + 1` |
| `%index` | `sensor_index + 1` (vorher fälschlich `component_index + 1`) |
| `%battery_index`, `%dock_cover_index` | `sensor_index` 0 = links, sonst rechts |
| `%charging_rod_index` | 0 vorne, 1 hinten, 2 links, 3 rechts |

Platzhalter ohne veröffentlichte Regel (`%1$s`, `%d`, `%1$.1f`, `%lidar_index` …) erscheinen
nicht mehr roh im Text, sondern als `?`. Vorher standen 93 Texte (davon 37 Dock-Texte) mit solchen Platzhaltern
unverändert im Dashboard, z. B. „Dock %1$s cover motor stalled“.

**Offizielle `hms.json` übernommen (22.10.2026, Entscheidung des Projektinhabers):** Die Datei aus
dem DJI-CDN, die das Dock-Feature-Set verlinkt, enthält 3.952 Einträge. Nach den Filtern von
`scripts/build-hms-texts.js` (nur `fpv_tip_`/`dock_tip_`, Klartext, höchstens 400 Zeichen,
Deutsch und Englisch) bleiben 3.003 Texte (vorher 2.288): 715 neue Schlüssel, keiner entfallen,
2.355 mit deutschem Text (vorher 1.714), 381 `_in_the_sky`-Varianten. Der Alarm `0x16070042` der
Matrice 4T („Datenfehler RTK-Basisstation. Prüfen, ob ein Netzwerk-RTK- oder D-RTK-Dienst verbunden ist“) hat damit einen Text. DJI nennt für die Datei
keine Lizenz; Herkunft und Rückfalloption stehen in `backend/data/HMS-LICENSE.txt`.

Bekannte Qualitätsmängel im Herstellertext, bewusst nicht korrigiert: 11 Texte enthalten
`%index` doppelt (z. B. „Kommunikationsfehler: Motor %index %index“) und würden dann den
Index zweimal zeigen; 949 Einträge der Datei fehlen im Ergebnis (816 ohne brauchbaren deutschen oder englischen Text, 56 mit nicht unterstützten
Schlüsselvarianten wie `_index_1` oder `_pm440`, 77 nach der Normalisierung doppelte Schlüssel); für `%lidar_index`,
`%lte_index` und `%gimbal_index` veröffentlicht DJI keine Ersetzungsregel, sie erscheinen als `?`.
Der Herstellertext wird nicht überarbeitet, damit er bei einer neuen Dateiversion
unverändert austauschbar bleibt.

**Nicht umgesetzt** (bewusst, überwiegend steuernde oder schreibende Funktionen): Dock-Zugang
über die Begleit-App und Organisationsbindung (HTTPS), DRC, FTS, Fernsteuerung/Debug,
Firmware-Upgrade, Livestream, Medien, Wayline, benutzerdefinierte Flugzonen, Multi-Dock,
KI-Zielerkennung und Remote-Log.

### Zweite Beobachtung mit allen vier Geräten (22.10.2026)

Alle vier Geräte (RC Pro, RC Plus 2, Mavic 3M, Matrice 4T) sendeten frisches OSD; die Flugzeuge
hatten in Innenräumen keinen GNSS-Fix (`position_state.is_fixed` 0, `quality` nicht gesetzt),
ein RTK-Test war daher nicht möglich. Nur die RC Pro meldete eine gültige Position.

- **RC Pro:** Die fünf mit dem Katalogabgleich ergänzten Felder `wireless_link.4g_link_state`,
  `4g_quality`, `4g_uav_quality`, `4g_gnd_quality` und `4g_freq_band` kommen im OSD an; die Zahl
  beobachteter dokumentierter Pfade stieg von 15 auf 22. Vor der Ergänzung hätte der Parser diese
  Werte verworfen. `drc_state` und `cloud_control_auth` sendete die RC Pro nicht (die RC Plus 2
  sendet `drc_state`).
- **Matrice 4T:** 110 dokumentierte Pfade beobachtet, davon 91 innerhalb von 15 s; zusätzlich zu
  `offline_map_enable` nun auch `rth_mode` und `commander_flight_mode` (siehe oben).
- **Mavic 3M:** 75 Pfade beobachtet, 63 aktuell.
- **HMS ohne Text:** Die M4T meldete den Alarmcode `0x16070042`. Für ihn enthält die
  eingebettete Textkopie keinen Eintrag, die offizielle `hms.json` dagegen schon („RTK base
  station data error …“). Das ist ein belegter Fall der oben beschriebenen 1.681 fehlenden
  Schlüssel. Der zweite Code `0x1B0A0001` hat in der Kopie den älteren Text „GPS signal weak“,
  die offizielle Datei nennt „GNSS signal weak“.

## Verifikation auf dem Pi (ohne Neustart)

```bash
cd ~/Projekte/SkyHub-Next
git fetch origin
git status --short --branch
# Erst nach Sicherung lokaler Änderungen und freigegebenem Checkout:
node --test backend/test/dji-properties.test.js backend/test/telemetry-field-audit.test.js
node scripts/pi-telemetry-fields-check.js
```

Die Testfälle validieren Kennungen, Datenkanäle, Array-Grenzen,
Streamtyp-Whitelist, WGS84-Negativkoordinaten, Nullposition/Teilkoordinaten,
Datenschutz und den Replay-Schutz. Sie ersetzen weder den Vergleich mit
den noch zu importierenden neueren 1.18-Geräteschemas noch reale Pilot-2-/
M4T-/RC-Plus-2-Hardwaretests. Ein GitHub-PR ist kein Pi-Deployment.


## Datierte Feldannahme-Evidenz und neue Diagnoseklassen (23.10.2026)

Die [M3M-Kamera-/State-Feldlückenanalyse](m3m-camera-gap-analysis.md) trennt
Thermografie-Felder des gemeinsamen DJI-Mavic-3-Schemas von den tatsächlichen
RGB-/G-/R-/RE-/NIR-M3M-Sensoren. Die **typisierte Übernahme** aller sechs
M3M-Erweiterungspfade war ein datierter realer **Parserannahmebefund** vom
21.10.2026, keine unabhängige Prüfung der tatsächlichen RTH-/RC-Loss-
Einstellwerte oder ihrer sicherheitsrelevanten Wirkung.

Die neue [RC-Plus-2/M4T-Prüfroutine](hardware-rc-plus2-m4t.md) wertet
ein offizielles RC-Plus-2-Profil mit 54 Pfaden und ein vorläufiges
M4T-Profil mit 199 statischen plus neun dynamischen Feldtypen offline aus.
Eine reale RC-Plus-2/M4T-Hardwareabnahme steht aus.

