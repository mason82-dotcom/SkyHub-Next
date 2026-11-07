# DJI API 2 V1.1.0 Lab – UX-Vertrag (P3)

## Geltung
Nur Hersteller-DevKit-`web` im **separaten BRIX Mock-Labor**, auf gepinnten Upstream-Commit `705c73f`. Der SkyHub-Operatorvertrag bleibt unabhängig. Dieses Dokument gibt keine Freigabe für eine produktive PaaS-, Missions- oder Drohnenverbindung.

## Verhalten
| Operation | Auslöser | Erfolg | Fehler-/Sicherheitsgrenze |
|---|---|---|---|
| Sprache DE/EN | native Select-Control in AppTopNav | Beschriftungen in freigegebenem Scope wechseln sofort; keine Navigation | Unbekannte Codes ignorieren; kein Storage, kein Netzwerk |
| Navigieren | vorhandene Vue-Router-Links | Zielroute, aktive Hervorhebung | Nicht verfügbare PaaS-abhängige Einträge bleiben echte nicht-fokussierbare deaktivierte Spans |
| Mock-Hinweis | automatisch auf jeder authentifizierten Seite | Ständig sichtbare, textliche Kennzeichnung | Kein Tooltip-only oder farbiger Punkt als Ersatz |
| Dashboard laden | bestehender Hersteller-GET | Daten + lesende Diagramme; Hinweis zur Simulationsquelle | Bestehende Lade-/Fehleranzeigen erhalten; keine neue Refresh-/Write-Aktion |
| Mobile Layout | Viewport ≤900px | Navigation horizontal scrollbar; Karte oberhalb der Datenpaneele; Panels nacheinander | Kein Beschnitt des Auth-Menüs, kein horizontaler Body-Overflow; in Browsern zu verifizieren |
| Zurücksetzen | expliziter Restore-Befehl nach Overlay-Staging | Vendor-Sources aus Backup rekonstruiert | Jede unbekannte Dateiänderung blockiert die Wiederherstellung |

## Zugriffs- und Datengrenzen
Die Mock-Warnung ist eine Eigenschaft des separaten Labor-Builds. Sie darf nicht unbesehen auf eine echte DJI-PaaS-Laufzeit übertragen werden. API-GETs, Anwenderrechte, Websocket-Zustände und vorhandene SDK-Verfügbarkeitsprüfung bleiben unverändert. Keine RC-/Broker-/Drohnenaktionen und keine SkyHub-Cloud-API-2-Bridge.

## Qualitätsnachweise
CI: gepinnter Upstream + Overlay + `npm run build` + vorhandene Nav-/UserDropdown-Unit-Tests. Browser-Manuell: 320/390/834/1440px, Touch, Tastatur, Firefox/Chromium, beide Sprachen, Kontraste, Netzfehler, leerer Datensatz, langsame Antwort, Viewport-Rotation. Statische Tests und Quellcodeprüfung sind **kein** Ersatz für den realen Browser- und Hardwaretest.

## Offene P3-Grenzen
Nicht sämtliche chinesischen Texte aller Herstellerseiten werden in dieser Stufe übersetzt. Die Komponenten für Cesium-Karten-Popups, Registrierung und tiefe Medien-/Routenformulare bleiben vorerst unangetastet.
