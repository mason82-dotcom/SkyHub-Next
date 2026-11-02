# WPML: lokale Routenrevisionen nach MinIO synchronisieren

Stand: 02.11.2026. Einseitige, **manuell per Klick ausgelöste** Migration von Browser-`localStorage` in die bereits vorhandene, serverseitig validierte WPML-Missionsbibliothek. Kein DJI-Flighttask, kein automatischer Start und keine Flugfreigabe.

## Was synchronisiert wird

- Die lokale Routenbibliothek (`/wpml-route-library.html`) speichert bisher bis zu 32 Routen mit jeweils bis zu 12 unveränderlichen Revisionen **nur im lokalen Browser**.
- Die einmalige Freigabe „Manuelle MinIO-Speicherung freigeben“ erlaubt zunächst **keinen Upload**. Erst ein Klick auf „Gespeicherte Revisionen jetzt in MinIO speichern“ samt Bestätigung überträgt lokal gespeicherte Revisionen als separate DJI-WPML-KMZ-Dateien an `POST /api/wpml/missions`.
- Jede künftig lokal gespeicherte neue Revision bleibt zunächst **nur lokal**. Auch bei bereits freigegebenem Browser erfolgen **keine Uploads** beim Speichern, Neuladen der Seite oder Neustart. Erst ein weiterer manueller Klick synchronisiert ausstehende Revisionen. Ungespeicherte Editorentwürfe werden niemals übertragen.
- Die Serverbibliothek nutzt unverändert ihren MinIO-Bucket `skyhub-wpml`, `missions/<uuid>.kmz`, Write-once, gültige WPML-Daten, höchstens 500 KMZ-Dateien, keine API zum Löschen.
- Die Uploads sind seriell und werden nur nach einer positiven Serverantwort im Browserspeicher als bestätigt markiert. Nach Netzfehlern bleibt die lokale Kopie erhalten; ein erneuter **manueller Klick** versucht fehlende Revisionen erneut. Der nächste Besuch startet keinen Upload.
- Vor dem Upload erhält jede Revision einen reproduzierbaren, DJI-konformen Namen: gekürzter ursprünglicher Routenname + lokale Routen-ID, Revision und ein Inhalts-Fingerabdruck. Die KMZ erhält denselben Namen. Klone bleiben getrennte KMZ-Dateien; auch mehrfach ausgeführte Versuche sind inhaltsadressiert.
- „Freigabe ausschalten“ stoppt weitere Uploads nach der laufenden Anfrage. Auf dem Server bereits vorhandene Missionen werden **nicht** gelöscht.
- Lokale JSON-Sicherungen, Ordnerzuordnung, Revisionen und Änderungen der Routenbibliothek bleiben unverändert; insbesondere ist das **keine bidirektionale Wiederherstellung des lokalen Bearbeitungsmodells**. In MinIO liegen eigenständige KMZ-Dateien. Andere Geräte können diese mit dem WPML-Missionseditor laden.

## Heimnetz und Freigabe

Erforderlich sind die schon vorhandenen Konfigurationseinträge (in `.env`, nach gesicherter Backend-Aktualisierung):

```dotenv
SKYHUB_LAN_VIEW_CIDR=192.168.178.0/24
SKYHUB_WPML_LAN_NO_TOKEN_ENABLED=true
SKYHUB_WPML_LAN_ORIGINS=https://rpi5.fritz.box:4443,https://192.168.178.63:4443
```

Der Browser muss `https://rpi5.fritz.box:4443/wpml-route-library.html` oder die ausdrücklich freigegebene IP-Origin verwenden. Nur dort erlaubt `backend/wpml-lan-auth.js` den tokenfreien `POST` mit passendem `Origin` und vertrauenswürdigem Heimnetz-Client. Andere Schreib-APIs, Pilot-2-Authentifizierung und Geräte-Steuerfunktionen sind nicht betroffen. Den Proxy nicht pauschal öffnen oder `/api` global freigeben. Mehrere vertrauenswürdige Geräte im Heimnetz können jeweils ihre eigenen lokal gespeicherten Revisionen hochladen.

## Vorhandene Routen von Port 443 / anderer Adresse übernehmen

**Browser-`localStorage` ist an Protokoll, Host und Port gebunden.** Wenn die Routen ursprünglich z. B. unter `https://rpi5.fritz.box/wpml-route-library.html` gespeichert wurden, sind sie unter `:4443` nicht sichtbar. Die leere MinIO-Bibliothek ist deshalb **kein Beweis**, dass die lokalen Routen verschwunden sind.

1. Die **ursprüngliche Webadresse im selben Browser/Profil** öffnen, an dem die alten Routen gespeichert wurden. Unter „Lokale Sicherung und Wiederherstellung“ eine **JSON-Sicherung** exportieren.
2. Auf `https://rpi5.fritz.box:4443/wpml-route-library.html` die JSON-Sicherung prüfen. Achtung: Die vorhandene lokale `:4443`-Bibliothek wird beim Übernehmen vollständig ersetzt; bei Bedarf **auch diese vorher separat sichern**.
3. „Manuelle MinIO-Speicherung freigeben“ wählen (kein Upload), dann „Gespeicherte Revisionen jetzt in MinIO speichern“ anklicken und die konkrete Übertragung bestätigen. Die Anzeige nennt verarbeitete, gespeicherte, bereits bestätigte und fehlgeschlagene Revisionen. Bei Fehlern bleiben lokale Daten bestehen.
4. `https://rpi5.fritz.box:4443/wpml-editor.html` → „Bibliothek laden“: veröffentlichte KMZ-Missionen verifizieren und testweise eine herunterladen. Es wird dadurch kein DJI-Flug ausgelöst.

Keine automatische Browser-Origin-Übertragung, kein Serverzugriff auf private lokale Browserspeicher, keine Remote-Löschung.

## Sicherheit und Tests

- Eine Freigabe pro Browserprofil, **zusätzlich Bestätigung für jeden manuellen Übertragungslauf**. Die Freigabe allein sendet nichts; auch eine früher aktivierte automatische Synchronisierung wird nach diesem Update nicht fortgesetzt.
- Nur HTTPS im freigegebenen LAN; keine Tokenverwaltung und keine zusätzlichen Server-Schreib-Endpunkte.
- Kein unbearbeiteter GPS-Daten-Log-Eintrag. Fehlermeldungen melden Zählwerte, nicht den Routeninhalt.
- Unveränderte `flightReady:false`-/`dispatch:false`-Grenzen. Der Server validiert jede KMZ; keine Flugfähigkeitsbescheinigung.
- Prüfungen: `node --test backend/test/wpml-route-sync.test.js backend/test/wpml-route-library-ui.test.js backend/test/wpml-mission-store.test.js backend/test/wpml-lan-no-token.test.js`.

Rücknahme der manuellen Speicherfreigabe jederzeit über den UI-Button. Remote gespeicherte Missionsdateien bleiben dabei erhalten.
