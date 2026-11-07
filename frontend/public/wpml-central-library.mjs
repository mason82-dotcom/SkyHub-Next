// Central WPML route library in the planning tab (ADR-001). Talks ONLY to the same-origin /wpml-central/* API
// behind the Forgejo operator login. No DJI SDK, no MQTT, no mission dispatch, no flight approval.
// Writes happen only on an explicit click; the local browser library is read, and written only by
// "In lokale Bibliothek kopieren" (a NEW local route, existing local routes are never changed).
export const LOCAL_STORAGE_KEY = 'skyhub.wpml.local-route-library.v1';
export const LOGIN_PATH = '/wpml/oidc/login';
const MAX_ROUTES = 32, MAX_REVISIONS = 12;

const ERRORS = Object.freeze({
  login_required: 'Deine Anmeldung ist abgelaufen. Bitte erneut mit Forgejo anmelden.',
  invalid: 'Der Server hat die Route nicht angenommen. Prüfe die Route im Missionseditor (mindestens zwei gültige Wegpunkte).',
  'not-found': 'Diese Route gibt es zentral nicht mehr. Die Liste wurde aktualisiert.',
  conflict: 'Jemand hat die Route inzwischen geändert. Die Liste wurde aktualisiert; bitte erneut versuchen.',
  capacity: `Die zentrale Bibliothek ist voll (höchstens ${MAX_ROUTES} Routen). Lege die Route lokal ab.`,
  origin: 'Die Anfrage kam nicht von der freigegebenen SkyHub-Adresse. Öffne SkyHub über https://rpi5.fritz.box:4443.',
  rate_limited: 'Zu viele Anfragen in kurzer Zeit. Bitte eine Minute warten und erneut versuchen.',
  unavailable: 'Die zentrale Bibliothek ist gerade nicht erreichbar. Deine lokalen Routen sind davon nicht betroffen.',
  network: 'Keine Verbindung zum SkyHub-Server. Deine lokalen Routen sind davon nicht betroffen.',
});
export function errorMessage(code) { return ERRORS[code] || ERRORS.unavailable; }

export class CentralError extends Error {
  constructor(code, status) { super(code); this.code = code; this.status = status; }
}

// ---- API client (pure; fetch injected for tests) ----
export function createCentralClient({ fetch = globalThis.fetch } = {}) {
  async function call(path, { method = 'GET', body } = {}) {
    let res;
    try {
      res = await fetch(path, {
        method, credentials: 'same-origin', cache: 'no-store', redirect: 'error',
        headers: body === undefined ? { accept: 'application/json' } : { accept: 'application/json', 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch { throw new CentralError('network', 0); }
    if (res.status === 204) return null;
    let data = null;
    try { data = await res.json(); } catch { /* non-JSON, e.g. the server 404 page */ }
    if (!res.ok) {
      // A plain 404 on /me means the feature is switched off on this server.
      const code = res.status === 404 && !data?.error ? 'disabled' : String(data?.error || 'unavailable');
      throw new CentralError(code, res.status);
    }
    return data;
  }
  return Object.freeze({
    me: () => call('/wpml-central/me'),
    list: async () => (await call('/wpml-central/routes'))?.routes ?? [],
    create: (name, plan) => call('/wpml-central/routes', { method: 'POST', body: { name, plan } }),
    append: (routeId, expectedRevision, plan) => call(`/wpml-central/routes/${encodeURIComponent(routeId)}/revisions`,
      { method: 'POST', body: { expectedRevision, plan } }),
    read: (routeId, revision) => call(`/wpml-central/routes/${encodeURIComponent(routeId)}/revisions/${revision}`),
    logout: () => call('/wpml/oidc/logout', { method: 'POST' }),
  });
}

// ---- helpers ----
export function sortAndFilter(routes, query) {
  const q = String(query || '').trim().toLocaleLowerCase('de');
  return routes.filter(r => !q || r.name.toLocaleLowerCase('de').includes(q))
    .sort((a, b) => a.name.localeCompare(b.name, 'de', { sensitivity: 'base' }));
}
export function readLocalLibrary(storage, lib) {
  try {
    const raw = storage?.getItem(LOCAL_STORAGE_KEY);
    return raw ? lib.load(raw) : lib.blank();
  } catch { return null; }   // unreadable or blocked storage: never overwrite it
}
export function roleLabel(role) { return role === 'admin' ? 'Admin' : 'Operator'; }

// ---- UI ----
export function initCentralLibrary(doc = globalThis.document, {
  client = createCentralClient(), storage = globalThis.localStorage, lib = globalThis.SkyHubWpmlRouteLibrary,
  workspace = 'pilot', now = () => Date.now(),
} = {}) {
  const $ = id => doc?.getElementById?.(id);
  const root = $('centralLibrary');
  if (!root || !lib) return null;
  const el = {
    session: $('centralSession'), login: $('centralLogin'), logout: $('centralLogout'),
    source: $('centralSource'), upload: $('centralUpload'), search: $('centralSearch'),
    body: $('centralRows'), status: $('centralStatus'), count: $('centralCount'),
    prev: $('centralPrev'), next: $('centralNext'), reload: $('centralReload'),
  };
  if (Object.values(el).some(x => !x)) return null;
  let routes = [], operator = null, busy = false;
  el.login.href = `${LOGIN_PATH}?workspace=${encodeURIComponent(workspace)}`;

  const say = (text, tone = '') => { el.status.textContent = text; el.status.dataset.tone = tone; };
  const make = (tag, text, cls) => { const n = doc.createElement(tag); if (text != null) n.textContent = text; if (cls) n.className = cls; return n; };

  function localRoutes() {
    const db = readLocalLibrary(storage, lib);
    return db ? lib.list(db) : null;
  }
  function renderSource() {
    const list = localRoutes();
    el.source.replaceChildren();
    if (!list) { el.source.append(new Option('Lokaler Speicher nicht lesbar', '')); return; }
    if (!list.length) { el.source.append(new Option('Noch keine lokale Route gespeichert', '')); return; }
    for (const r of list) el.source.append(new Option(`${r.name} · Rev. ${r.latestRevision} · ${r.folder}`, String(r.id)));
  }
  function selectedLocal() {
    const id = Number(el.source.value);
    const db = readLocalLibrary(storage, lib);
    if (!db || !Number.isSafeInteger(id)) return null;
    try { return lib.find(db, id); } catch { return null; }
  }
  function setBusy(on) {
    busy = on;
    root.setAttribute('aria-busy', String(on));
    for (const b of root.querySelectorAll('button:not([data-row]):not([data-static])')) b.disabled = on;
    el.upload.disabled = on;
    if (on) for (const b of root.querySelectorAll('button[data-row]')) b.disabled = true;
    else renderRows();   // row buttons carry their own rules (revision limit, source selected)
  }
  function renderSession() {
    const signedIn = !!operator;
    el.login.hidden = signedIn;
    el.logout.hidden = !signedIn;
    el.session.textContent = signedIn
      ? `Angemeldet · ${roleLabel(operator.role)} · Workspace ${workspace}`
      : 'Nicht angemeldet';
  }
  function cell(row, content) { const td = make('td'); td.append(content); row.append(td); return td; }
  function emptyRow(text, action) {
    const tr = make('tr', null, 'central-empty-row'); const td = make('td'); td.colSpan = 3;
    td.append(make('p', text));
    if (action) td.append(action);
    tr.append(td); return tr;
  }
  function renderRows() {
    const shown = sortAndFilter(routes, el.search.value);
    el.body.replaceChildren();
    if (!operator) {
      // The one login call to action sits in the header; the frame only explains the empty state.
      el.body.append(emptyRow(root.dataset.state === 'disabled'
        ? 'Auf diesem Server ist die zentrale Bibliothek ausgeschaltet.'
        : 'Melde dich oben mit Forgejo an, um die zentralen Routen deines Workspaces zu sehen.'));
    } else if (!routes.length) {
      const b = make('button', 'Erste lokale Route übernehmen', 'secondary'); b.type = 'button';
      b.addEventListener('click', () => el.source.focus());
      el.body.append(emptyRow('Noch keine zentralen Routen. Wähle oben eine lokale Route und übernimm sie.', b));
    } else if (!shown.length) {
      const b = make('button', 'Suche zurücksetzen', 'secondary'); b.type = 'button';
      b.addEventListener('click', () => { el.search.value = ''; renderRows(); el.search.focus(); });
      el.body.append(emptyRow(`Keine Route enthält „${el.search.value.trim()}“.`, b));
    }
    for (const r of shown) {
      const tr = make('tr');
      const th = make('th', r.name); th.scope = 'row'; tr.append(th);
      cell(tr, make('span', `Rev. ${r.latestRevision}`, 'central-rev'));
      const actions = make('div', null, 'central-actions');
      const copy = make('button', 'In lokale Bibliothek kopieren', 'secondary'); copy.type = 'button'; copy.dataset.row = '1';
      copy.setAttribute('aria-label', `${r.name}: Revision ${r.latestRevision} in die lokale Bibliothek kopieren`);
      copy.addEventListener('click', () => copyToLocal(r));
      const append = make('button', `Lokale Route als Rev. ${r.latestRevision + 1} anhängen`, 'secondary'); append.type = 'button'; append.dataset.row = '1';
      append.setAttribute('aria-label', `${r.name}: ausgewählte lokale Route als Revision ${r.latestRevision + 1} anhängen`);
      append.disabled = r.latestRevision >= MAX_REVISIONS;
      if (r.latestRevision >= MAX_REVISIONS) append.title = `Höchstens ${MAX_REVISIONS} Revisionen je Route`;
      append.addEventListener('click', () => appendRevision(r));
      actions.append(copy, append);
      cell(tr, actions);
      el.body.append(tr);
    }
    el.count.textContent = operator
      ? `${shown.length} von ${routes.length} Routen · höchstens ${MAX_ROUTES} · Seite 1 von 1`
      : 'Seite 1 von 1';
  }
  function fail(err) {
    if (err?.code === 'login_required') { operator = null; routes = []; renderSession(); renderRows(); }
    say(errorMessage(err?.code), 'error');
  }
  async function refresh({ quiet = false } = {}) {
    setBusy(true);
    if (!quiet) say('Zentrale Bibliothek wird geladen …');
    try {
      try { operator = await client.me(); }
      catch (err) {
        operator = null; routes = [];
        if (err.code === 'login_required') { renderSession(); renderRows(); say('Nicht angemeldet. Die lokale Bibliothek funktioniert weiterhin ohne Anmeldung.'); return; }
        if (err.code === 'disabled') {
          root.dataset.state = 'disabled'; renderSession(); el.login.hidden = true; renderRows();
          say('Die zentrale Bibliothek ist auf diesem Server nicht eingeschaltet. Lokale Routen funktionieren unverändert.');
          return;
        }
        throw err;
      }
      routes = await client.list();
      renderSession(); renderRows();
      if (!quiet) say(`${routes.length} zentrale ${routes.length === 1 ? 'Route' : 'Routen'} geladen. Keine Flugfreigabe.`, 'ok');
    } catch (err) { fail(err); }
    finally { renderSource(); setBusy(false); }
  }
  async function upload() {
    if (!operator) { say('Melde dich zuerst oben mit Forgejo an. Die lokale Route bleibt bis dahin nur in diesem Browser.', 'error'); el.login.focus(); return; }
    const local = selectedLocal();
    if (!local) { say('Wähle zuerst eine lokale Route aus.', 'error'); el.source.focus(); return; }
    setBusy(true); say(`„${local.name}“ wird übernommen …`);
    try {
      const out = await client.create(local.name, local.plan);
      await refresh({ quiet: true });
      say(`„${local.name}“ liegt jetzt zentral (Rev. ${out.revision}). Die lokale Route bleibt unverändert.`, 'ok');
    } catch (err) { fail(err); if (err.code === 'not-found' || err.code === 'conflict') await refresh({ quiet: true }); }
    finally { setBusy(false); }
  }
  async function appendRevision(route) {
    const local = selectedLocal();
    if (!local) { say('Wähle zuerst oben die lokale Route aus, die angehängt werden soll.', 'error'); el.source.focus(); return; }
    setBusy(true); say(`Revision für „${route.name}“ wird angehängt …`);
    try {
      const out = await client.append(route.routeId, route.latestRevision, local.plan);
      await refresh({ quiet: true });
      say(`„${route.name}“ hat jetzt Rev. ${out.revision}. Frühere Revisionen bleiben unverändert.`, 'ok');
    } catch (err) {
      fail(err);
      if (err.code === 'conflict' || err.code === 'not-found') await refresh({ quiet: true });
    } finally { setBusy(false); }
  }
  async function copyToLocal(route) {
    setBusy(true); say(`„${route.name}“ wird in die lokale Bibliothek kopiert …`);
    try {
      const rev = await client.read(route.routeId, route.latestRevision);
      // Re-read right before writing so a change made meanwhile in another tab is kept.
      const db = readLocalLibrary(storage, lib);
      if (!db) { say('Der lokale Speicher ist nicht lesbar. Es wurde nichts geändert.', 'error'); return; }
      let out;
      try { out = lib.save(db, { name: route.name, folder: 'Zentral', plan: rev.plan, savedAt: now() }); }
      catch { say(`Die lokale Bibliothek ist voll (höchstens ${lib.MAX_ROUTES} Routen). Entferne dort zuerst eine Route.`, 'error'); return; }
      storage.setItem(LOCAL_STORAGE_KEY, lib.serialize(out.library));
      renderSource();
      say(`„${route.name}“ (Rev. ${route.latestRevision}) liegt jetzt lokal im Ordner „Zentral“. Eine bereits geöffnete Routenbibliothek bitte neu laden, sonst überschreibt sie die Kopie beim nächsten Speichern.`, 'ok');
    } catch (err) { fail(err); }
    finally { setBusy(false); }
  }
  async function logout() {
    setBusy(true);
    try { await client.logout(); } catch (err) { if (err.code !== 'login_required') { fail(err); setBusy(false); return; } }
    operator = null; routes = []; renderSession(); renderRows(); setBusy(false);
    say('Abgemeldet. Die Sitzung ist auf dem Server beendet.', 'ok');
  }

  el.upload.addEventListener('click', upload);
  el.logout.addEventListener('click', logout);
  el.reload.addEventListener('click', () => refresh());
  el.search.addEventListener('input', renderRows);
  el.source.addEventListener('change', () => setBusy(busy));
  doc.addEventListener?.('keydown', e => {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || root.closest?.('[hidden]')) return;
    const t = e.target?.tagName; if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT' || e.target?.isContentEditable) return;
    e.preventDefault(); el.search.focus();
  });
  globalThis.addEventListener?.('storage', e => { if (e.key === LOCAL_STORAGE_KEY) renderSource(); });
  renderSession(); renderSource(); renderRows();
  const ready = refresh();
  return Object.freeze({ refresh, ready, getRoutes: () => routes.slice(), getOperator: () => operator });
}
if (typeof document !== 'undefined' && document.getElementById('centralLibrary')) initCentralLibrary(document);
