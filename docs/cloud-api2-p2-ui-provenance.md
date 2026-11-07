# Cloud API 2 – P2 UI, Lokalisierung und Datenherkunft (Entwicklungsbranch)

## Grundlage und Skill-Entscheidungen
Angewandt: `frontend-design` und `frontend-design-premium`. Bestehende SkyHub-Tokens, UI-Verträge und GET-only-Grenzen bleiben maßgeblich. Die P2-Styles erweitern nur das isolierte Portal `cloud-api2.html`; keine globale Operator-Theme-Migration.

## Implementiert
- DE/EN-Sprachumschalter **nur** für den neuen Datenherkunfts- und Vergleichsbereich; `lang` wird auf die lokalisierten Elemente gesetzt. Die unveränderten deutschsprachigen Portalbereiche bleiben als `html[lang=de]` ausgezeichnet. Keine persistierten Spracheinstellungen.
- Mobile horizontale Tastatur-/Touch-Navigation bei ≤900px, einspaltige Karten bei ≤520px und horizontal bedienbare Vergleichstabelle.
- Permanenter, sichtbarer Hinweis `DJI DevKit BRIX: MOCK` auf jeder Portalansicht.
- Statische, strikt getrennte Vergleichsmatrix für Geräte, OSD/Telemetrie, Missionen und Medien. DJI-Demowerte 128 Routen / 128 Medien sind im Hersteller-Mock fest codiert; keine Abfrage des BRIX.
- Keine zusätzliche API-Route, kein CORS, kein Auth-Token, kein MQTT, keine Schreibfunktion, keine automatische DJI-Synchronisierung.

## Grenzen / offene Arbeiten
- **Nicht vollständig lokalisiert:** Das bestehende SkyHub-Portal ist überwiegend deutsch; die DJI-Hersteller-Vue-App auf `192.168.178.50:18082` ist weiterhin chinesisch. Ihre Übersetzung erfordert einen separaten Patch des vendor DevKit `web/` mit eigener Vue-i18n-Analyse, Regressionstests und manueller BRIX-Freigabe.
- Die mobile Überarbeitung gilt für `SkyHub cloud-api2.html`, **nicht** für die DJI-Hersteller-Web-App auf BRIX. Screenshots des DJI-Dashboards sind kein Browsernachweis für diese SkyHub-Änderung.
- Die Matrix ist ein Quellen-/Statusvergleich, **keine** Live-Verknüpfung, kein Hardware-Nachweis und keine Datenreplikation.
- P2 baut auf dem noch ungemergten P1-PR #307 auf. Erst P1 reviewen/mergen, dann P2 rebasen. Kein Produktionsdeployment.

## Prüfung
```bash
node --test backend/test/cloud-api2-p2-ui.test.js
node --check frontend/public/cloud-api2-p2-ui.mjs
```
Der neue CommonJS-Test liegt in `backend/test/*.test.js` und läuft dadurch in der bestehenden CI automatisch mit. Neben statischen Verträgen prüft er den tatsächlichen Sprachwechsel mit einer isolierten synthetischen DOM-Testumgebung. Er ersetzt keinen echten Browser.

Zusätzlich erforderlich: echte Browser-Smokes bei 320, 390, 834, 1440px, Tastaturfokus, Tab-Navigation, DE/EN-Wechsel, fehlende Live-Daten, P1 GET-Inspektion und kein unerwarteter horizontaler Body-Overflow. Diese Prüfungen sind nicht durch statische Tests ersetzt.

## BRIX-Betrieb
Keine Änderung an `~/Projekte/skyhub-next-brix-ops/dji2-local-mock`, laufenden Containern, RC-Kopplung oder SkyHub-Backend. DJI DevKit bleibt im Mock-Profil.
