# DJI Cloud API 2 V1.1.0 DevKit – lokales Vue-Labor-Overlay

## Abgrenzung
Ein Versions-Pin auf DJI-Commit `705c73f48a77bb5120b28d73436d73594d289359`, **nicht** auf die SkyHub-Produktivoberfläche. Das Overlay wird in der DJI-DevKit-Quellkopie unter `devkit/skeleton/web` geprüft und nur mit explizitem `--apply` übernommen. Die DJIs auf BRIX bleiben bis zu einer gesonderten Freigabe unverändert; keine Bridge zur SkyHub-Registry.

## Designkontext
Quelle für Runtime-Tokens sind `src/styles/variables.css` und die vorhandenen DJI-Komponenten – das Overlay verändert diese Tokens nicht. Visuelle Leitidee: dunkle, informationsdichte Flug-/Missionsleitstelle; eine einzelne bernsteinfarbene Datenherkunftsleiste ist absichtlich das prägnante Element. Das Layout passt sich dem echten schmalen Telefon-Viewport statt einer künstlichen Desktop-Breite an.

- Schrift: bestehende UI-Systemschrift; tabellarische Ziffern für Kennzahlen.
- Fläche: die vorhandenen `--app-bg*` und `--app-border`-Tokens.
- Interaktion: die bestehenden `--app-primary*` und `:focus-visible`-Regeln.
- Akzent für Provenienz: Hintergrund `#4c3a1f`, Text `#ffedc5`, Rand `#c28f40`. Nie ohne klaren Text `LAB / MOCK-DATEN`.
- Breakpoint: 900px für zweizeilige, scrollbar bedienbare Kopf-Navigation und untereinander gestellte Dashboard-Panels; 520px für kompakte Telefonansicht.
- Originale Kunden-/Markenkomponenten und komplexe Cesium-SDK-Strukturen bleiben unverändert.

## Lokalisierungsgrenze
Die gemeinsame Vue-Composable `useLabLocale` enthält DE/EN-Strings für die Kernnavigation, die Accountaktionen, das Dashboard inklusive Chart-Legenden und die Laborkennzeichnung. Diese P3-Ausbaustufe **übersetzt noch nicht alle weiteren Herstellerseiten** (z. B. vollständige Route-/User-Formulare, Cesium-Popup, Handbuch), die weiterhin chinesische Strings enthalten können. Eine Vollübersetzung erfordert systematische Katalogisierung, Importvalidierung und Tests.

## Daten- und Berechtigungsgrenze
Nur Text, CSS und Layout werden geändert. Kein Eingriff in `AuthController`, `application-mock.yml`, DJI JNI, MQTT, Drohnen/RC, externe Ports, Login-Token oder echte Missionsaufträge. Das Overlay aktiviert keine Flugfunktionen. SkyHub-Kopplungen bleiben unangetastet.

## Arbeitsablauf (manuelle Zustimmung erforderlich)
1. P3-Branch separat auschecken, **nicht** direkt in `main` oder der produktiven SkyHub-Kopie entwickeln.
2. `node scripts/dji-cloudapi2-v110-p3-overlay.mjs --check --vendor ~/Projekte/skyhub-next-brix-ops/vendor/dji-cloud-api2` – **nur Prüfung**.
3. Bei kontrolliertem Änderungsfenster `--apply` statt `--check`. Vorherige Inhalte werden außerhalb des Vendor-Git-Baums gesichert; Ausgabe nennt den Backup-Pfad.
4. Unter `devkit/skeleton/web` die unabhängigen Tests `npm ci && npm run build && npx vitest run src/components/AppTopNav.test.ts src/components/UserDropdown.test.ts` ausführen.
5. Nach erfolgreicher Review **separater** Frontend-Containerbuild und kontrollierter Redeploy; niemals Backend/DB/RC automatisch ändern.
6. Im Fehlerfall den im Skript ausgegebenen `--restore --backup <Pfad>`-Befehl ausführen, **bevor** andere Änderungen an den betroffenen Quellen erfolgen.

## Verifikation / noch offene Nachweise
- Die GitHub-Workflowdatei `.github/workflows/cloud-api2-p3-vendor-ui.yml` kompiliert den gepinnten Herstellerquellcode mit Overlay und führt die vorhandenen Navigation-/Account-Tests aus. Ein erfolgreicher CI-Lauf ist noch kein Hardwaretest.
- Manuelle Browserprüfung bei **320, 390, 834 und 1440 Pixeln**, Darkmode, Fokus, Screenreader, Navigation, Mock-Kennzeichnung, Fehler-, Lade- und Leerdatenstatus. Insbesondere Kartenansicht und `AppTopNav` ohne horizontalen Body-Overflow prüfen.
- Nach Sprachwechsel bleiben Pfade, Benutzerrollen und aktive Route unverändert.
- Die Mock-Demo-Zahlen (u. a. 128 Demo-Routen, 128 Demo-Medien und 24 Demo-Modelle) sind **keine** von SkyHub bestätigten Gerätedaten.
