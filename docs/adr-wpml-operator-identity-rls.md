# ADR-001: Operator-Identität und produktive RLS für die zentrale WPML-Routenbibliothek

**Status:** Angenommen (07.11.2026: Forgejo als OIDC-Provider, Datenbank mit `SET LOCAL ROLE`)
**Entscheider:** mason (Betreiber SkyHub-Next)
**Bezug:** PR #99, `docs/wpml-central-routes-isolated.md`, Sicherheitsprüfung vom 07.11.2026 (keine Befunde ≥ 8)

## Kontext

PR #99 liefert den isolierten Dienst `wpml-central-routes.js` mit drei harten Voraussetzungen, die heute fehlen:

1. **Identität:** ein Ed25519-signiertes Operator-JWT (`kind:human`, `sub`, `workspaceId`, `role` `operator|admin`, `jti`,
   höchstens 900 s, gepinnte `kid`) und ein v2-Sitzungsdatensatz in Redis (HMAC-Schlüssel, MAC, `status:active`).
   Wer diese beiden ausstellt, ist offen. SkyHub-Next hat bisher **keine Benutzerkonten**: Lesen im Heim-LAN ist token-frei,
   Administration nutzt ein View-Token, DJI Pilot 2 hat ein eigenes Pairing.
2. **Datenbankrolle:** eine PostgreSQL-Laufzeitrolle ohne `SUPERUSER`/`BYPASSRLS` mit minimalen Grants.
3. **RLS-Policies:** heute gilt Default-Deny ohne erlaubende Policies. Die Doku verbietet frei setzbare Custom-GUCs
   (`SET skyhub.workspace = …`) als alleinige Workspace-Quelle.

Rahmen: ein Betreiber, wenige Operatoren, Heimnetz plus Tailscale. Backend auf brix-node (Docker, PostGIS 15, Redis),
Eingang über Caddy auf rpi5. Vorhandene Dienste: Forgejo 17 (kann OAuth2/OIDC-Provider sein), Home Assistant, Tailscale.
Wartungsaufwand zählt mehr als Skalierung.

## Entscheidung (Vorschlag)

**Identität:** Generischer **OIDC-Login (Authorization Code + PKCE)** gegen einen externen IdP. Start mit **Forgejo als
OIDC-Provider**, austauschbar über Konfiguration (Issuer-URL, Client-ID). Ein neuer SkyHub-Baustein
`wpml-operator-issuer.js` prüft das ID-Token (Signatur über JWKS, `iss`, `aud`, `nonce`, `exp`), leitet aus der
Gruppen-/Team-Mitgliedschaft `skyhub-ws-<workspace>-operator|admin` Workspace und Rolle ab, signiert das kurzlebige
Operator-JWT mit eigenem Ed25519-Schlüssel und schreibt den v2-Sitzungsdatensatz nach Redis. Abmelden = Datensatz auf
`revoked`.

**Datenbank:** Option **A – `SET LOCAL ROLE` auf Workspace-Rollen**:
- Login-Rolle `skyhub_wpml_app` (`LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEROLE`), hat **keine** eigenen
  Tabellenrechte.
- Je Workspace eine Rolle `skyhub_wpml_ws_<8 Hex des UUID-Hashes>` (`NOLOGIN NOBYPASSRLS`), Mitglied der Gruppenrolle
  `skyhub_wpml_workspace`, die die minimalen Grants trägt (`SELECT, INSERT` auf Routen/Revisionen/Audit, kein
  `UPDATE/DELETE`). `skyhub_wpml_app` ist Mitglied aller Workspace-Rollen, darf sie aber wegen `NOINHERIT` nur per
  `SET ROLE` nutzen.
- Zuordnungstabelle `skyhub_wpml_workspace_role(role_name name PRIMARY KEY, workspace_id uuid UNIQUE)`, nur vom
  Migrationseigentümer beschreibbar.
- Policies `USING/WITH CHECK (workspace_id = skyhub_wpml_current_workspace())`; die Funktion
  (`SECURITY DEFINER`, `STABLE`, fester `search_path`) liest die Zuordnung für `current_user`.
- Der Dienst führt jede Transaktion als `BEGIN; SET LOCAL ROLE <ws-rolle>; …; COMMIT` aus. Die Rolle stammt aus dem
  **geprüften** Operator-Token, nie aus der Anfrage.

## Betrachtete Optionen

### Identität

| | A: Forgejo als OIDC | B: eigener schlanker IdP (Pocket ID / Authelia / Kanidm) | C: lokale Konten mit Passkeys in SkyHub |
|---|---|---|---|
| Aufwand | gering: läuft schon, Konten existieren | mittel: neuer Dienst, Backup, Updates | hoch: Kontenverwaltung, WebAuthn, Wiederherstellung selbst bauen |
| Sicherheit | TOTP/WebAuthn in Forgejo; Forgejo-Admin = IdP-Admin | Passkeys erstklassig (Pocket ID), sauber getrennt | volle Kontrolle, aber eigener Krypto-/Recovery-Code = Risiko |
| Gruppen → Workspace | Organisations-Teams als Gruppen-Claim | Gruppen nativ | eigene Tabelle |
| Kopplung | Login hängt an Forgejo auf rpi5 | eigener Dienst, eigene Verfügbarkeit | keine |

**Pro A:** sofort nutzbar, kein neuer Dienst, MFA vorhanden. **Contra A:** Forgejo-Ausfall sperrt Planung, Git-Admin ist
zugleich Identitätsadmin. **Pro B:** sauberste Trennung, Passkeys. **Contra B:** ein weiterer Dienst. **Contra C:**
höchster Bau- und Prüfaufwand für ein Hobbysystem.

### Datenbank

| | A: `SET LOCAL ROLE` + Zuordnung | B: signierter GUC (HMAC in SQL prüfen) | C: Verbindungspool je Workspace |
|---|---|---|---|
| Workspace-Quelle | `current_user`, nicht frei setzbar ohne Rollenmitgliedschaft | GUC + Signatur; Geheimnis muss in DB und App liegen | eigene Login-Rolle je Workspace |
| Schutz bei SQL-Injection im Dienst | Abfragen bleiben im gesetzten Workspace (nur Einzelanweisungen, parametrisiert) | gleichwertig, wenn Signatur korrekt geprüft wird | gleichwertig |
| Aufwand | mittel, rein SQL | hoch (pgcrypto, Schlüsselrotation in DB) | hoch (Pools, Credentials je Workspace) |
| Grenze | eine kompromittierte App kann jede Workspace-Rolle setzen | ebenso, sie kennt den Schlüssel | ebenso, sie kennt alle Credentials |

## Abwägung

Gegen eine **vollständig kompromittierte App** schützt keine Variante, denn die App braucht Zugang zu allen Workspaces.
RLS ist hier **Verteidigung in der Tiefe** gegen Fehler im Dienstcode (vergessener `workspace_id`-Filter, SQL-Fehler).
Dafür ist Option A die einfachste, prüfbare Lösung ohne Geheimnis in der Datenbank. Bei der Identität entscheidet der
Betriebsaufwand: A ist sofort nutzbar, B ist die bessere Langfristlösung. Weil der Issuer generisches OIDC spricht, ist
ein späterer Wechsel A → B nur Konfiguration.

## Konsequenzen

- **Einfacher:** Operatoren melden sich mit vorhandenem Forgejo-Konto an; RLS schützt jede Abfrage zusätzlich zum Code.
- **Schwerer:** Rollen anlegen braucht einen privilegierten, manuellen Migrationsschritt (`CREATEROLE`), nie zur Laufzeit.
  Neue Workspaces = neue Rolle + Zuordnung (Skript). Signierschlüssel des Issuers muss als Secret auf brix-node liegen
  und rotierbar sein (`kid`).
- **Später prüfen:** Wechsel auf Pocket ID mit Passkeys; Rate-Limit/CSRF/Cookie-Gestaltung des Login-Flows;
  Einbindung in `server.js` erst nach eigener Sicherheitsprüfung des Issuers.

## Umsetzungsschritte

1. [ ] Migration `006_wpml_runtime_rls_draft.sql` (Familie `wpml-draft`, `blocked_draft`): Rollen, Zuordnungstabelle,
       `skyhub_wpml_current_workspace()`, Policies, Grants. Integrationstest im Wegwerf-PostGIS: zwei Workspaces,
       Querzugriff ausgeschlossen, ohne `SET ROLE` nichts sichtbar, `UPDATE/DELETE` verweigert.
2. [ ] `wpml-central-routes.js`: Transaktion mit `SET LOCAL ROLE` aus dem geprüften Token (Rollenname aus Zuordnung,
       per `quote_ident`-sicherer Allowlist).
3. [ ] `wpml-operator-issuer.js`: OIDC-Code-Flow mit PKCE, ID-Token-Prüfung, Gruppen → Workspace/Rolle, Ed25519-Ausgabe,
       v2-Redis-Datensatz, Abmelden/Widerruf. Unit-Tests mit lokalem Test-IdP (JWKS-Fixture).
4. [ ] Forgejo: OAuth2-Anwendung „SkyHub WPML“, Organisation mit Teams `skyhub-ws-<workspace>-operator|admin`.
5. [ ] Eigene Sicherheitsprüfung von Issuer + RLS, dann erst Einbindung in `server.js` hinter Feature-Flag.
