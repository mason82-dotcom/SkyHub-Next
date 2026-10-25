# Dokumentationspflege und Gültigkeitsregeln

## Zweck und Quellenhierarchie

Die Dokumentation von SkyHub Next besteht aus (a) Einstiegs- und Referenzseiten für den derzeitigen Hauptbranch, (b) Fachspezifikationen und (c) datierten Evidenz-/Entwicklungsberichten. Diese Kategorien dürfen nicht vermischt werden.

1. **Tatsächliche Implementierung**: `backend/server.js`, die importierten Router/Module, `docker-compose.yml`, Overrides, `.env.example` und Workflow-/Testdateien des **konkret genannten** Commits.
2. **Aktuelle Orientierung**: [README](../README.md), [Doku-Index](index.md) und [Main-Audit](stand-2026-10-25-main-audit.md). Die Stichtagswerte gelten nur für den genannten SHA.
3. **Fachreferenzen**: [Architektur](architecture.md), [API](api-reference.md), [Konfiguration](config-reference.md), [Sicherheit](security.md), [Betrieb](ops.md), [Skriptwirkungen](scripts.md), DJI-/M3M-/WPML-Spezifikationen.
4. **Historische Evidenz**: `projektstand-*`, `repository-*`, `pr-triage-*`, `hardware-*-2026-*`, ältere Migrations- und Live-Smoke-Protokolle. Niemals nachträglich Messdaten verändern, um sie an einen späteren Commit anzupassen.
5. **Draft-PRs**: eigener Branch, eigener Prüfstand; Inhalt erst nach tatsächlichem Main-Merge als Main-Feature dokumentieren.

## Statuswörter

- **In `main`**: Datei/Code auf dem referenzierten Git-Commit, noch keine Runtime-Aussage.
- **Aktiv gemountet**: Route/Worker ist von der aktiven Server- oder Compose-Konfiguration erreichbar; Feature-Flags/ACLs separat nennen.
- **Offline-/synthetisch geprüft**: kein realer DJI-Geräte-, M3M-Kalibrierungs- oder Pi-Einsatznachweis.
- **Hardwarebeobachtet**: Gerät, Datum, Versionsstand, Prüfmethode und echte erhaltene Daten explizit angeben; nicht pauschal auf andere Modelle/Firmware übertragen.
- **Deployed**: im Zielsystem anhand von Image/Commit/Compose und Health verifiziert; ein GitHub-Merge alleine genügt nicht.
- **Einsatzfreigegeben**: explizite autorisierte Freigabe mit dokumentiertem Geltungsbereich; nicht aus OSD, Pairing, CI oder Testkarten ableiten.

## Änderungs-Checkliste

- An der zentralen Einstiegsseite **keine fortlaufende Liste aller PR-Merges** anhängen. Den aktuellen Überblick kurz halten; relevante Historie in datierten Reports belassen.
- Nach Änderungen die drei Fälle **auf Main / in Draft-PR / nur geplant** getrennt schreiben. Für jeden neuen Endpoint: HTTP-Methode, Pfad, Authentifizierung, Flag, Default, Laufzeit-Mount, Seiteneffekte und Dateireferenz prüfen.
- Bei Broker-/Storage-/Pi-Themen Root-Compose, Overrides, tatsächliche lokale `.env`, Zugriffsrechte und Standardeinstellungen unterscheiden. Keine angenommenen Docker- oder Portzustände.
- Bei neuen Originaldaten- und GIS-Funktionen wissenschaftliche Herkunft, Byte-/Hash-Nachweise, Kalibrierung, Bandzuordnung, CRS und Validierungsgrenzen gesondert dokumentieren. Grafisch kolorierte Vegetationskarten sind keine unabhängige Rohmessung.
- Vor Merge die Basis des PR, alle Abhängigkeiten, Konflikte und CI auf dem **finalen Head-SHA** prüfen. Keine ungefragten Änderungen auf dem Pi; keine Flugsteuerungs-, Mission- oder Storage-Schreibbefehle zum Dokumentationstest ausführen.
- Relative Markdown-Links gegen den aktuellen Dateibaum prüfen. Ehemalige Repository-Slugs nur korrigieren, wenn sie **aktuelle** Navigationslinks sind; historische Verweise auf den Legacy-Stack bleiben erhalten.
- Keine Tokens, Zugangsdaten, Gerätese­riennummern, Rohpayloads, privaten GPS-Koordinaten oder individuellen Pilot-Identitäten einchecken.

## Struktur und Rückwärtskompatibilität

`docs/index.md` ist der zentrale Wegweiser. Die lange, thematisch wertvolle technische Historie in bestehenden Runbooks bleibt für die Nachvollziehbarkeit erhalten. Fehlerhafte gegenwartsbezogene Aussagen werden mit einem deutlich datierten Korrekturhinweis oder einer präzisen Textkorrektur berichtigt. Historische Feldmessungen, Kommandobeispiele und Integrationszweige nicht durch unbelegte Erfolgsmeldungen ersetzen.

Diese Regeln wurden am 25.10.2026 als Dokumentationsprozess formuliert. Sie ersetzen weder Tests noch Review.
