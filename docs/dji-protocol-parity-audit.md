# DJI Cloud API 1.18 – Protocol Parity Audit (offline)

Stand: 23.10.2026. **Ausschließlich synthetische Offline-Prüfung; keine Pi-Installation und keine Geräteabnahme.** Ein eventueller Merge nach `main` aktiviert weder den Prüfer automatisch im Server noch neue DJI-/MQTT-Funktionen.

## Aufgabe und Herkunft

Diese Regression prüft ausschließlich **synthetische** Protokollformen gegen die
bereits vorhandene SkyHub-Next-Implementierung in backend/dji.js,
backend/message-guard.js, backend/topology-ack.js und backend/catalog.js.

**Abgleichreferenz:** [cdmiltd/dji-cloud-api-sdk Version 1.18.0.2](https://github.com/cdmiltd/dji-cloud-api-sdk/tree/73c977e526d39f410ccf112bfcfd79e090285640)
(Apache-2.0). Im SDK relevante Modelle:

- [UpdateTopoData](https://github.com/cdmiltd/dji-cloud-api-sdk/blob/73c977e526d39f410ccf112bfcfd79e090285640/sdk/src/main/java/ltd/cdmi/dji/cloudapi/sdk/command/status/UpdateTopoData.java):
  domain als Text, type/sub_type als Ganzzahl; Subdevice domain/index optional,
  doch für RC Plus 2 nur **inferiert**, nicht hardwarebestätigt.
- [UpdateTopoReplyData](https://github.com/cdmiltd/dji-cloud-api-sdk/blob/73c977e526d39f410ccf112bfcfd79e090285640/sdk/src/main/java/ltd/cdmi/dji/cloudapi/sdk/command/status/UpdateTopoReplyData.java):
  status_reply mit data.result.
- [Service reply envelope](https://github.com/cdmiltd/dji-cloud-api-sdk/blob/73c977e526d39f410ccf112bfcfd79e090285640/sdk/src/main/java/ltd/cdmi/dji/cloudapi/sdk/protocol/envelope/ReplyEnvelope.java)
  und [flat reply envelope](https://github.com/cdmiltd/dji-cloud-api-sdk/blob/73c977e526d39f410ccf112bfcfd79e090285640/sdk/src/main/java/ltd/cdmi/dji/cloudapi/sdk/protocol/envelope/FlatReplyEnvelope.java):
  mehrere data-Layouts je Methode.

Der Audit bildet **keine** vollständige Dokumentation der Methoden ab und ist
weder ein DJI-Zertifikat noch eine Produkt-/Firmware-Kompatibilitätsaussage.
Hardwarebeobachtungen an RC Pro Enterprise/Mavic 3M bleiben eine
separate Evidenzquelle. Für RC Plus 2/Matrice 4T stehen sie noch aus.

## Implementierte Fälle

Stand dieses Commits: 16 synthetische Fälle, darunter:

1. RC Plus 2 (2:174:0) + Matrice 4T (0:99:1): vollständig auflösbar.
2. Dieselbe Topologie ohne sub_devices[].domain: **unknown-domain**, nicht
   stillschweigend als aircraft/domain=0 ergänzen. Ein nach Protokoll
   bestätigbares status_reply bedeutet **nicht**, dass das Modell identifiziert wurde.
3. Numerische domain- und version-Felder im bestehenden SkyHub-Parser.
4. Fehlende/ungültige Topologie, leerer Subdevice-Satz, unbekannte Modelle.
5. Ungültige tid, retained-MQTT-Pakete und veraltete Quellzeit:
   keine positive Reply-Eignung im Audit.
6. services_reply-Datenformen: nur result, result+output, flaches
   result+Felder; unbekannte, mehrdeutige oder falsch typisierte Resultate.
7. Separat markierter **object-result-candidate** als Forschungsfall aus
   isoliertem SkyHub-RPC-Entwurf, **nicht** als offizieller Hardwarebeweis.
8. Zeitstempelloses services_reply darf keine bestätigte
   Transaktionskorrelation erhalten, auch wenn die bestehende lesende
   Eingangspolitik das Paket zeitlich ungeprüft akzeptiert.

Alle Identifikatoren und secrets in den Fixtures sind ausdrücklich fiktiv.
Die Audit-Ausgabe enthält weder Payload-Inhalte noch synthetische Geräte-IDs,
Transaktions-IDs, Tokens oder GPS-Koordinaten. Der Report verwendet ausschließlich
feste Auswertungsschlüssel, bekannte Gerätemodellnamen, Fall-IDs und Zähler.
Ein erfolgreicher Report belegt die erwartete **Implementierungsreaktion**
auf diese 16 Testdaten, nicht sämtliche DJI-Protokollanforderungen.

## Ausführen

Im isolierten Branch-Checkout:

    node --check backend/dji-protocol-parity.js
    node --check scripts/dji-protocol-parity-audit.js
    node --test backend/test/dji-protocol-parity.test.js
    node scripts/dji-protocol-parity-audit.js

Die CLI liest ausschließlich backend/data/dji-118-parity-fixtures.json und
liefert ein JSON-Objekt mit schema=skyhub-dji-parity-report-v1,
classification=bounded-synthetic-fixtures-only, total, passed, failed,
unresolvedModelCases, candidateReplyCases und einer Liste redigierter Fallresultate.

Exitcode 0: alle 16 Abgleichfälle erwartungsgemäß.
Exitcode 1: eine Fixture-Erwartung passt nicht zur aktuellen SkyHub-Implementierung.
Exitcode 2: invalide Audit-Daten oder Programmfehler.
**Erfolgreiche Tests sind keine Flugfreigabe.**

Die bestehende .github/workflows/ci.yml testet automatisch
backend/test/*.test.js und prüft Skript-Syntax. Deshalb sind keine Änderungen
an CI, backend/server.js, Docker Compose, MQTT, PostGIS, Redis, Caddy oder Pi nötig.

## Offene Diskrepanzen und Reihenfolge

| Priorität | Bereich | Folgeschritt |
| --- | --- | --- |
| P1 | RC Plus 2: unvollständige Subdevice-Topologie | Echte Pilot-2-Nachricht nur als **sicher aggregierter, anonymisierter Feldnamen-Abgleich** überprüfen; keinen Domainwert erfinden |
| P1 | services_reply/DRC | Mit isoliertem SkyHub-RPC-Contract-Branch harmonisieren; vor Schreibfreigabe tid+bid+gateway, TTL, Replays, Methoden und Autorisierung prüfen |
| P1 | Methodenabhängige Reply-Daten | Nur bestätigte Schemafamilien übernehmen; unbekannte Result-Formen markieren, nicht blind ausführen |
| P2 | WPML | Feld-/Aktionstabellen mit dem isolierten, bounded WPML-Validator vergleichen; keine automatische Flugfreigabe |
| P2 | RC Plus 2/M4T | Echten Read-only-Hardwaretest auf gesondertem Branch durchführen |
| P3 | DJI Cloud API 1.18 weitere Modelle und Dock/FTS | Geräte- und Firmware-Support separat prüfen, keine ungezielte Aktivierung |

### Sicherheits- und Betriebsgrenzen

- Kein MQTT-connect/subscribe/publish im neuen Code; keine HTTP-Endpunkte,
  Flug-/Missionskommandos oder autorisierenden Rollen.
- Keine Rohdaten-Capture-Funktion und keine Geheimnisverarbeitung.
- Nur dokumentierte, synthetische Testfälle, keine Live-MQTT-Payloads.
- Das Bereitstellen dieses Prüfers oder ein GitHub-Merge ist **kein** Pi-Deployment und aktiviert keinen produktiven Prozess.
- SkyHub-Next auf dem Raspberry Pi sowie EMQX, Caddy, Redis, PostGIS und MinIO
  bleiben unberührt.
