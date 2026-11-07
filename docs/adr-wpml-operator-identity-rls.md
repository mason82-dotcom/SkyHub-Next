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

1. [x] Migration `006_wpml_runtime_rls_draft.sql` (Familie `wpml-draft`, `blocked_draft`): Rollen, Zuordnungstabelle,
       `skyhub_wpml_current_workspace()`, Policies, Grants. Integrationstest im Wegwerf-PostGIS: zwei Workspaces,
       Querzugriff ausgeschlossen, ohne `SET ROLE` nichts sichtbar, `UPDATE/DELETE` verweigert.
2. [x] `wpml-central-routes.js`: Transaktion mit `SET LOCAL ROLE` aus dem geprüften Token (Rollenname aus Zuordnung,
       per `quote_ident`-sicherer Allowlist).
3. [x] `wpml-operator-issuer.js`: OIDC-Code-Flow mit PKCE, ID-Token-Prüfung, Gruppen → Workspace/Rolle, Ed25519-Ausgabe,
       v2-Redis-Datensatz, Abmelden/Widerruf. Unit-Tests mit lokalem Test-IdP (JWKS-Fixture).
4. [x] Forgejo: OAuth2-Anwendung „SkyHub WPML“, Organisation mit Teams `skyhub-ws-<workspace>-operator|admin`.
5. [x] Eigene Sicherheitsprüfung von Issuer + RLS, dann erst Einbindung in `server.js` hinter Feature-Flag.

## Umsetzungsstand (07.11.2026)

- **Schritt 1 erledigt:** `005_wpml_runtime_rls_draft.sql` plus Integrationstest `wpml-runtime-rls.integration.test.js`.
- **Schritt 2 erledigt:** `createWpmlRouteStore(pool,{workspaceRoles:true})` setzt je Transaktion `SET LOCAL ROLE`.
- **Schritt 3 erledigt:** `backend/wpml-operator-issuer.js` (`beginLogin`, `completeLogin`, `reissue`, `revoke`), getestet
  gegen einen lokalen Test-IdP; ausgestellte Tokens prüft der vorhandene Verifier samt Redis-Sitzung. Sicherheitsprüfung
  ohne Befund ab Vertrauen 8. Sitzungsdauer standardmäßig 1 h: `reissue()` prüft die Team-Mitgliedschaft nicht erneut,
  eine Entfernung aus dem Forgejo-Team wirkt also spätestens nach einer Sitzung (sofort: `revoke()`).

### Schritt 4: Forgejo einrichten – erledigt am 07.11.2026

Eingerichtet: Organisation `skyhub` (privat), Teams `ws-pilot-operator` und `ws-pilot-admin` ohne Repository-Zugriff
(mason ist Admin), OAuth2-Anwendung „SkyHub WPML“ (vertraulich, Weiterleitung
`https://rpi5.fritz.box:4443/wpml/oidc/callback`). Client-ID/Secret liegen auf brix-node in
`~/.config/skyhub-wpml/oidc-client.json` (0600). Workspace `pilot` = `SKYHUB_PILOT_WORKSPACE_ID`.

Nachweis mit einem temporären Testkonto (danach gelöscht), echter Code-Flow mit PKCE: ID-Token RS256 mit `kid`,
`iss` = `https://rpi5-pironman.tailf59dac.ts.net:9445` (ohne Schrägstrich), `aud` = Liste mit der Client-ID, `nonce`
korrekt, `groups` = `["skyhub","skyhub:ws-pilot-operator"]`. Hinweis: Forgejo setzt Secure-Cookies; der Browser muss
die HTTPS-Adresse aus `ROOT_URL` nutzen.

Ursprüngliche Anleitung:

1. **Organisation** anlegen, z. B. `skyhub` (Wert für `oidc.organization`).
2. Je Workspace zwei **Teams**: `ws-<workspace>-operator` und `ws-<workspace>-admin` (Workspace-Name 3–32 Zeichen,
   Kleinbuchstaben, Ziffern, `-`). Mitglieder hinzufügen. Teams brauchen keine Repository-Rechte.
3. **OAuth2-Anwendung** unter *Einstellungen → Anwendungen* (bzw. als Organisation): Name „SkyHub WPML“,
   Weiterleitungs-URI exakt die spätere `oidc.redirectUri` (HTTPS), vertraulicher Client. Client-ID und -Secret als
   Secret auf brix-node ablegen, nie im Repo.
4. Prüfen, dass Forgejo bei `scope=openid profile groups` den Claim `groups` mit Einträgen `skyhub:ws-<workspace>-…`
   liefert (einmal mit einem Testkonto anmelden und das ID-Token ansehen). Erst danach Schritt 5.
5. `oidc.issuer` ist die `ROOT_URL` von Forgejo (derzeit `https://rpi5-pironman.tailf59dac.ts.net:9445/`). Die
   Browser-Weiterleitung muss diese Adresse erreichen können.

### Schritt 5: HTTP-Anbindung hinter Schalter – Code fertig am 07.11.2026, noch nicht eingeschaltet

`backend/wpml-central-http.js`, eingebunden in `server.js` nur bei `SKYHUB_WPML_CENTRAL=1` (Standard aus; bei
fehlerhafter Konfiguration wird nichts eingehängt und eine Zeile protokolliert, der Server läuft weiter).

| Route | Zweck |
|---|---|
| `GET /wpml/oidc/login?workspace=<name>` | Forgejo-Login starten; PKCE/State/Nonce im versiegelten Cookie `skyhub_wpml_login` (10 min, `Path=/wpml/oidc`, `SameSite=Lax`) |
| `GET /wpml/oidc/callback` | Login abschließen, Login-Cookie löschen, Sitzungs-Cookie `skyhub_wpml_session` (`SameSite=Strict`, 1 h), Weiterleitung zu `/cloud-api2.html#planning` |
| `POST /wpml/oidc/logout` | Sitzung serverseitig widerrufen |
| `GET /wpml-central/me`, `GET/POST /wpml-central/routes`, `POST …/routes/:id/revisions`, `GET …/revisions/:n` | Routenbibliothek |

- Cookies AES-256-GCM-versiegelt mit zweckgebundener AAD (Login-Cookie taugt nicht als Sitzung), `HttpOnly; Secure`.
  Das Cookie enthält nur die Sitzungs-ID; pro Anfrage stellt `reissue()` ein frisches 15-min-Token aus, das der
  Verifier inkl. Redis-Sitzung prüft. Workspace und Rolle kommen nur aus dem Token, nie aus dem Request.
- Schreibende Anfragen: `Origin` aus `SKYHUB_WPML_CENTRAL_ORIGINS` und `application/json`, sonst 403/415.
- Rate-Limit je Client-IP: Login 20/min, API 240/min. Fehler als feste Codes ohne SQL- oder Verbindungsdetails.
- Datenbank: eigener Pool als `skyhub_wpml_app` (NOBYPASSRLS), `workspaceRoles:true`, `statement_timeout` 5 s.

Konfiguration (Secrets nur in 0600-Dateien, nie im Repo oder in `.env`):

```
SKYHUB_WPML_CENTRAL=1
SKYHUB_WPML_OIDC_ISSUER=https://rpi5-pironman.tailf59dac.ts.net:9445
SKYHUB_WPML_OIDC_REDIRECT_URI=https://rpi5.fritz.box:4443/wpml/oidc/callback
SKYHUB_WPML_OIDC_ORG=skyhub
SKYHUB_WPML_OIDC_CONFIG_FILE=/run/secrets/wpml-oidc-client.json      # {"client_id","client_secret"}
SKYHUB_WPML_CENTRAL_SECRETS_FILE=/run/secrets/wpml-central.json      # {"signingKeyPem","keyId","keySecret",
                                                                     #  "recordMacSecret","cookieKey","databaseUrl"}
SKYHUB_WPML_OPERATOR_ISSUER=https://rpi5.fritz.box:4443/wpml-operator
SKYHUB_WPML_WORKSPACES=pilot=<SKYHUB_PILOT_WORKSPACE_ID>
SKYHUB_WPML_CENTRAL_ORIGINS=https://rpi5.fritz.box:4443
```

Vor dem Einschalten auf brix-node: Migrationen 003–005 mit Admin-Rechten, `skyhub_wpml_provision_workspace(<pilot>)`,
Login-Rolle für `skyhub_wpml_app` mit eigenem Passwort, Secrets-Datei erzeugen, Container-Mount der beiden Dateien.
