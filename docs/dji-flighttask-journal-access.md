# DJI Flighttask Journal – isolierte Workspace-Autorisierung

**Stand 24.10.2026 · Repository [SkyHub-Next](https://github.com/mason82-dotcom/SkyHub-Next).**

## Ziel und Integrationsgrenze

Das Missionsjournal aus [PR #83](https://github.com/mason82-dotcom/SkyHub-Next/pull/83) ist ein interner, persistenter Prototyp. Die separate Lösch- und Aufbewahrungsschicht [`dji-flighttask-journal-retention.js`](dji-flighttask-journal-retention.md) erfordert bereits eine injizierte Autorisierung. Die analogen `start/read/apply/recover/summary`-Operationen des Journals selbst erhalten nun eine **optionale, fail-closed Workspace-Schicht** in `backend/dji-flighttask-journal-access.js`.

Dieses Modul ist **nirgends in `backend/server.js` importiert**, hat keine HTTP-Route, keinen DJI-MQTT-Eingang, keinen Redis-Client und keine eigene Datenbankverbindung. Die frühere Offline-DDL unter `backend/db/offline/` wird dadurch weder migriert noch aktiviert.

## Schnittstelle

```js
const {createFlighttaskJournal}=require('./dji-flighttask-durable-journal');
const {createScopedFlighttaskJournal}=require('./dji-flighttask-journal-access');

// Nur innerhalb eines vertrauenswürdigen Backend-Prozesses.
// db und authorize kommen nicht aus HTTP-/DJI-Nutzdaten.
const raw=createFlighttaskJournal(db);
const scoped=createScopedFlighttaskJournal(raw,{
  authorize:async (trustedPrincipal,workspaceId,action)=>{
    // Hier MUSS eine eigenständig geprüfte, serverseitige
    // Identitäts-, Workspace- und Aktionsbindung erfolgen.
    return await trustedAccessDecision(trustedPrincipal,workspaceId,action);
  }
});
```

Jede Operation erwartet ein Objekt mit `principal`, `workspaceId`
und `observationId`; `start` ergänzt `request`/`ttlMs`,
`apply` ergänzt `kind`/`topic`/`payload`/`now`/`retained`
und `recover` ergänzt `now`.

Die Berechtigung wird **bei jedem einzelnen Aufruf erneut** geprüft.
Die Rückgabe des injizierten Callbacks muss der boolesche Wert
`true` sein. Objekte wie `{allowed:true}`, Exceptions,
fehlende Rückgaben oder falsche Workspace-IDs verweigern den Zugriff.

**Forschungsnachtrag 24.10.2026:** Der eigenständige [RLS-/Workspace-Transaktionsentwurf](dji-flighttask-workspace-rls-retention-policy.md) kann einen Datenbankkontext zusätzlich einschränken und prüft die Nicht-Superuser-Rolle. Er ist nicht mit dieser API-Hülle oder der produktiven Datenbank verdrahtet. Eine clientseitig behauptete Rolle oder PostgreSQL-GUC ist weiterhin **kein** Identitätsnachweis.

## Least-Privilege-Matrix

| Operation | Aktion für `authorize` | Zulässige Rollen nach Vorprüfung |
| --- | --- | --- |
| `start` | `create` | operator, admin |
| `read` | `read_internal` | operator, admin |
| `apply` | `observe` | operator, admin |
| `recover` | `recover` | operator, admin |
| `summary` | `summary` | viewer, operator, admin |

Diese Rollenprüfung ist eine **zusätzliche Hürde, keine Autorisierung**.
Nur der separat injizierte, vertrauenswürdige Callback kann erlauben.
Die Workspace-ID des authentifizierten Principals und die des
Snapshots müssen gleich sein; ein `admin` darf durch die
Frontend-Eingabe keinen anderen Workspace wählen. `pilot` ist für
sämtliche Journalfunktionen gesperrt.

`read` kann interne Korrelationsdaten (`tid`, `bid`, Seriennummer)
zurückgeben und darf nicht direkt für öffentliche API-Antworten verwendet
werden. `summary` ist dafür die zulässige, begrenzte Projektion –
nur nach einer gesonderten Berechtigungsprüfung.

## Tests

```sh
node --test backend/test/dji-flighttask-journal-access.test.js
node --test backend/test/*.test.js
```

Synthetische Tests decken unter anderem ab: anonyme Principals,
Rollen-/Workspace-Spoofing, fälschlich wahre Callback-Objekte,
Berechtigungsentzug zwischen Anfragen, Weitergabe ausschließlich
gebundener IDs und maskierte Autorisierungsfehler.

**Kein Hardwaretest und keine DJI-Freigabe:** Dieses Modul führt keinen
Flug aus und verifiziert keine reale Mission. Noch fehlen eine
produktive Identity-Provider-Bindung, geprüfte Benutzerrollen,
Datenbank-Row-Level-Security bzw. least-privilege Grants,
DSGVO-konforme Aufbewahrung/Backups und Hardware-Evidenz.
`flightReady`, `operationVerified` und `hardwareVerified`
werden dadurch nicht verändert.
