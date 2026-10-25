# Offene PRs – Abhängigkeitsregister (25.10.2026)

> **Stichtagsprüfung, nur GitHub-Quellstand, kein Merge-Beschluss.** Abfrage von [offenen Pull Requests](https://github.com/mason82-dotcom/SkyHub-Next/pulls) am 25.10.2026 gegen `main` @ [`4ca7aa040d4b1ac09edecdac652dfc8ce47f57e0`](https://github.com/mason82-dotcom/SkyHub-Next/commit/4ca7aa040d4b1ac09edecdac652dfc8ce47f57e0). Zahlen und PR-Basisäste sind nur für diesen Abruf gültig.

## Verifizierte Bestandszahlen

| Kriterium | Anzahl |
| --- | ---: |
| Offene Pull Requests | 37 |
| Davon Draft | 37 |
| Basis direkt `main` | 6 |
| Basis ein anderer Branch | 31 |
| Basis entspricht dem Head eines weiteren **offenen** PR | 22 |
| Basis entspricht **keinem offenen** PR-Head (Branch kann weiterhin existieren) | 9 |

**Wichtig:** Die 9 nicht zugeordneten Basen sind **nicht als gelöscht oder ungültig verifiziert**. Es sind lediglich aktuell keine separat offenen PRs für diese Basis-Branches vorhanden. Jeder Integrationsvergleich muss die konkrete Base-SHA erneut kontrollieren.

## Direkt gegen Main – sechs Drafts

| PR | Inhalt und bei Vergleich beobachtete Abweichung | Technische Freigabesperre |
| --- | --- | --- |
| [#176](https://github.com/mason82-dotcom/SkyHub-Next/pull/176) | HTTP-/LAN-/Proxy-Vertrauen; gegenüber Main **13 Commits voraus/1 zurück** | CI grün, aber **kein Merge ohne realen Caddy-Socket-Peer- und Pilot-HTTPS-Stagingnachweis**; Root-Compose-Env-Änderung |
| [#25](https://github.com/mason82-dotcom/SkyHub-Next/pull/25) | MinIO-Backup-/Restore-Hilfsprogramme und separater Workflow; **3 voraus/504 zurück** | Altes Branch-Fundament; Tools dürfen nicht auf laufende Volumes/Dienste angewandt werden, bevor Restore, Pfade, Berechtigungen, Retention und Isolation geprüft sind |
| [#46](https://github.com/mason82-dotcom/SkyHub-Next/pull/46) | HiveMind-Simulatorlabor, aber auch Eingriffe in `backend/dji.js`, `backend/registry.js`, Haupt-CI und Dashboard; **93 voraus/5 zurück** | Eigenständige Simulatorbausteine von Änderungen am livefähigen DJI-Parser/Frontend trennen; alte Haupt-CI nicht übernehmen |
| [#81](https://github.com/mason82-dotcom/SkyHub-Next/pull/81) | Isolierte PV-PostgreSQL-Concurrency-Tests/Job-Store; **12 voraus/493 zurück** | Fachmodul nur nach isolierter PostgreSQL- und Rollenprüfung auf heutige Basis portieren; nicht ganzen Alt-Branch übernehmen |
| [#99](https://github.com/mason82-dotcom/SkyHub-Next/pull/99) | WPML-Transaktions-/Operatorentwürfe, RLS-Tests und `004_wpml_route_audit_draft.sql`; **46 voraus/139 zurück** | Kein produktiver Server-Mount. **Weiteres SQL-Nummernpräfix `004`** kollidiert als globaler Zähler mit bestehendem `004_dji_pilot_media_http.sql`. Registrierung/Fachfamilie, SQL-ACL, RLS und [Migration-Gates](sql-migration-inventory.md) vor Rebase prüfen |
| [#127](https://github.com/mason82-dotcom/SkyHub-Next/pull/127) | Experimental-HyperFrames-UI mit umfangreichen CSS/HTML-/Frontend-/CI-Änderungen; **35 voraus/286 zurück** | Separater Design-/Browser-/Accessibility-Test, kein ungeprüfter Ersatz des bisherigen Dashboards oder alter Sicherheits-Header |

**Methodengrenze:** `ahead`/`behind` beschreiben die **Git-Historie des gesamten PR-Head-Branches gegenüber `main`**, nicht die Zahl der eigenständigen Feature-Commits oder die Schwierigkeit einer Neuimplementierung. Es wurde **kein** Entwurf in Main gemergt.

## Gestapelte und verzweigte PR-Ketten

Die Pfeile bedeuten: **rechter PR nutzt den Head-Branch des linken PR als Base**. Sie bedeuten **keine** GitHub-Mergefreigabe.

| Bereich | Direkte offene Abstammung | Eingangsbasis / Risikogrenze |
| --- | --- | --- |
| Smart Farming P1/P3 | [#113](https://github.com/mason82-dotcom/SkyHub-Next/pull/113) → [#114](https://github.com/mason82-dotcom/SkyHub-Next/pull/114) → [#115](https://github.com/mason82-dotcom/SkyHub-Next/pull/115) → [#116](https://github.com/mason82-dotcom/SkyHub-Next/pull/116) → [#117](https://github.com/mason82-dotcom/SkyHub-Next/pull/117) → [#122](https://github.com/mason82-dotcom/SkyHub-Next/pull/122) → [#125](https://github.com/mason82-dotcom/SkyHub-Next/pull/125) → [#128](https://github.com/mason82-dotcom/SkyHub-Next/pull/128) → [#131](https://github.com/mason82-dotcom/SkyHub-Next/pull/131) → **[#144](https://github.com/mason82-dotcom/SkyHub-Next/pull/144) oder [#145](https://github.com/mason82-dotcom/SkyHub-Next/pull/145)** | #113 basiert auf `integrate/m3m-smart-farming-20261024`, derzeit keinem offenen PR-Head. Die Geschwister #144/#145 sind **keine direkte gegenseitige Reihenfolge**. Keine automatische Kalibrierungs- oder Feldfreigabe |
| Pilot-Medien → M3M → Vision/Thermal | [#39](https://github.com/mason82-dotcom/SkyHub-Next/pull/39) → [#40](https://github.com/mason82-dotcom/SkyHub-Next/pull/40) → [#43](https://github.com/mason82-dotcom/SkyHub-Next/pull/43) → [#45](https://github.com/mason82-dotcom/SkyHub-Next/pull/45) → [#49](https://github.com/mason82-dotcom/SkyHub-Next/pull/49) → [#50](https://github.com/mason82-dotcom/SkyHub-Next/pull/50) → [#52](https://github.com/mason82-dotcom/SkyHub-Next/pull/52) → [#54](https://github.com/mason82-dotcom/SkyHub-Next/pull/54) → [#56](https://github.com/mason82-dotcom/SkyHub-Next/pull/56) → [#62](https://github.com/mason82-dotcom/SkyHub-Next/pull/62) | #39 basiert auf `feature/pilot2-media-https-api-20261022`, derzeit keinem offenen PR-Head. Originalmedien, Kalibrierung, Modellgewichte, Lizenzen, Identitäts-/Datenschutzrisiken getrennt prüfen |
| Geschützter Medienbrowser | [#41](https://github.com/mason82-dotcom/SkyHub-Next/pull/41) → [#42](https://github.com/mason82-dotcom/SkyHub-Next/pull/42) | #41 basiert auf `feature/dashboard-next-ui` ohne offenen PR-Head. Nicht mit bereits gemergter Main-Medien-Lese-API gleichsetzen |
| TSA-/Integrationskette | [#28](https://github.com/mason82-dotcom/SkyHub-Next/pull/28) → [#29](https://github.com/mason82-dotcom/SkyHub-Next/pull/29) → [#30](https://github.com/mason82-dotcom/SkyHub-Next/pull/30) | #28 basiert auf `feature/m3m-minio-integration-20261021` ohne offenen PR-Head. Vergangenes Docker-/Proxy-/MQTT-Basismaterial nicht ungeprüft übernehmen |

Weitere gestapelte Einzel-PRs ohne offenen Parent-Head: [#36 MinIO-STS](https://github.com/mason82-dotcom/SkyHub-Next/pull/36), [#44 DJI-Referenz](https://github.com/mason82-dotcom/SkyHub-Next/pull/44), [#80 Flighttask-Restart](https://github.com/mason82-dotcom/SkyHub-Next/pull/80), [#110 Flight-Area-Lab](https://github.com/mason82-dotcom/SkyHub-Next/pull/110), [#129 WPML-Dualoptik](https://github.com/mason82-dotcom/SkyHub-Next/pull/129). Ohne Prüfung ihrer tatsächlichen Base-Commits ist keine direkte Main-Integration abzuleiten.

## Kontrollierte Bearbeitungsreihenfolge

1. **Produktive Sicherheitsgrenzen zuerst:** [#176](https://github.com/mason82-dotcom/SkyHub-Next/pull/176) nur im gesicherten Pi-/Caddy-Staging abnehmen; andernfalls als Draft liegenlassen.
2. **Datenbankfundament ohne Produktivmigration:** [#178](https://github.com/mason82-dotcom/SkyHub-Next/pull/178) ist bereits in Main; [Issue #177](https://github.com/mason82-dotcom/SkyHub-Next/issues/177) bleibt für reale Schema-Freigaben offen. Ein späterer #99-Retarget muss auch die zusätzliche `004`-Namenskollision behandeln.
3. **Isolierte, vornehmlich nicht produktive Beiträge neu aufsetzen:** Bei #25, #46 und #81 jeweils nur den eigentlichen Feature-Diff aus einem frischen Main-Branch übernehmen; separate Tests und Risiken prüfen.
4. **UI-Kandidaten:** #127 erst nach Design-Kontrakt, Hardware-Anzeige-Korrektheit, responsiver Bedienung und Browser-Smoke; nicht per Alt-Branch-Gesamtmerge.
5. **Fachketten:** M3M, Thermal und Pilot-Medien nach bereits verfügbaren Main-Modulen deduplizieren, Provenienz und Lizenz abnehmen, danach einzelne kleine, Main-basierte PRs neu testen. Kein Massensquash gestapelter PR-Historien.

## Reproduzierbare Live-Prüfung (nur lesen)

```bash
git fetch origin
git status --short --branch
git rev-parse origin/main
git branch -r
# Für einen bestimmten PR die GitHub-Base und den PR-Head separat abrufen:
# git fetch origin refs/pull/NN/head:refs/remotes/origin/pr-NN
# git diff --stat origin/main...origin/pr-NN
```

Vor einer tatsächlichen Integration zusätzlich PR-Base- und Head-SHA, exakten Diff, Import-/Mount-Grenze, Node-/Python-/PostgreSQL-/Browser-CI auf dem **finalen SHA**, Pi-Ports, Secrets und Rollback prüfen. Das GitHub-Repository kann keine aktuelle Pi-Installation oder DJI-Hardwarefreigabe beweisen.
