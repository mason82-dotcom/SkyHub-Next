# SkyHub Next – Repository-Stand vom 25.10.2026

> GitHub-Momentaufnahme für die Pflege des Repositories. Kein Raspberry-Pi-Live-Audit und keine DJI-Hardwarefreigabe. Zahlen und PR-Basen vor einem Merge erneut abfragen.

## Verifizierter Stand

| Gegenstand | Befund |
| --- | --- |
| Standardbranch | `main` @ [`db7c940`](https://github.com/mason82-dotcom/SkyHub-Next/commit/db7c940641e50205272ec07f10d127bcaffb39b1) |
| Letzter Merge | [#19](https://github.com/mason82-dotcom/SkyHub-Next/pull/19): gemeinsamer MinIO-Speicherpfad und Hilfsprogramme; kein automatischer Pi-Start |
| CI auf diesem Commit | [SkyHub Next checks](https://github.com/mason82-dotcom/SkyHub-Next/actions/runs/40193211559) und [TAK UI browser acceptance](https://github.com/mason82-dotcom/SkyHub-Next/actions/runs/40193211486): erfolgreich |
| Offene Pull Requests | 43: acht mit Basis `main`, 35 mit anderem Basisbranch; darunter die noch offene [Triage #167](https://github.com/mason82-dotcom/SkyHub-Next/pull/167) und der MinIO-Backend-Zugang [#168](https://github.com/mason82-dotcom/SkyHub-Next/pull/168) |
| Repository-Baum | 524 Einträge einschließlich Verzeichnissen; vier GitHub-Actions-Workflows |

## Implementierung und Betriebsgrenzen

- Der Root-Stack besteht aus Node.js/Express, MQTT, Redis, PostGIS und einer statischen Oberfläche. Er bindet den Backend-Hostport standardmäßig an `127.0.0.1:4001`. Die Root-Compose-Datei startet keinen MQTT-Broker.
- Das Root-Compose erwartet ohne explizite Umstellung EMQX/1884. Für einen anderen Pi-Broker sind `MQTT_BROKER_URL`, `SKYHUB_MQTT_BROKER_KIND` und `SKYHUB_MQTT_REQUIRED_PORT` gemeinsam zu prüfen. Aus GitHub lässt sich die aktuelle Pi-Konfiguration nicht belegen.
- Die Medien-API ist im Root-Compose standardmäßig aus (`SKYHUB_MEDIA_ENABLED=false`). Der dortige MinIO-Dienst liegt im optionalen Profil `media`; die Übernahme des bestehenden gemeinsamen Speichers in #19 ist ein separater, kontrollierter Betriebsweg. [MinIO-Runbook](minio-shared-storage.md).
- Die DJI-Cloud-API-Demo liegt als eigenständiger Teststack unter `ops/cloud-api-demo/` und ist nicht Teil der SkyHub-Next-Produktivlaufzeit. [Demo-Anleitung](cloud-api-demo-lokal.md).
- WPML-Routenbibliothek, M3M-Rasterlabor und Flighttask-Beobachtungsmodule haben jeweils eigene Freigabegrenzen. Ein erfolgreicher CI-Lauf bestätigt weder reale Kalibrierung noch Missionsausführung oder den Zustand auf dem Pi.

## Aufarbeitung der offenen Arbeit

1. [PR-Triage #167](https://github.com/mason82-dotcom/SkyHub-Next/pull/167) behandelt 42 PRs gegen einen älteren `main`-Commit. Ihr Befund ist als datierte Messung nutzbar, muss vor Integration aber um #19 und #168 sowie alle späteren Änderungen ergänzt werden.
2. [#168](https://github.com/mason82-dotcom/SkyHub-Next/pull/168) betrifft die Opt-in-Verdrahtung eines lesenden S3-Kontos. Vor einem Merge die Shell-Hilfe und die dokumentierten `.env`-Schritte gesondert auf wiederholbare Anwendung, bestehende Konfiguration und Secret-Handhabung prüfen. Kein Pi-Apply aus dem Review ableiten.
3. Die 35 gestapelten PRs nach ihrer tatsächlichen Basis und ihrem eigenen Diff beurteilen. Besonders Medien/STS/Thermal, Smart Farming P3 und WPML haben Abhängigkeiten; grüne CI auf einem PR-Head prüft nicht automatisch den Merge mit dem heutigen `main`.
4. Frühere Stichtage bleiben als Historie erhalten. Für den Einstieg gelten dieser Stand, die [Dokumentationsnavigation](index.md) und das jeweilige Fach-Runbook; alte PR-Zahlen und Main-SHAs sind keine Live-Anzeige.

## Reproduzierbare lokale Checks

```bash
node --check backend/server.js
node --test backend/test/*.test.js
python3 -m unittest discover -s tests -p 'test_*.py'
docker compose --env-file .env.example config --quiet
```

Diese Befehle prüfen Quelltext beziehungsweise Compose-Auflösung, nicht die Pi-Laufzeit. Vor jeder Änderung am Pi die [Betriebsanleitung](ops.md) und den aktuellen dortigen Checkout/Compose-Stand prüfen.
