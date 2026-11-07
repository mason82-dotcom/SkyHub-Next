// A bounded navigator over the existing SkyHub WPML editors.
// No DJI SDK, flight commands, API calls or second mission-planning implementation.
export const PLANNING_TOOLS = Object.freeze([
  Object.freeze({
    id: 'editor',
    path: '/wpml-editor.html',
    name: 'WPML-Missionseditor',
    pageTitle: 'Missionsentwurf',
    description: 'Wegpunkte, Kameraparameter, Validierung und lokaler KMZ-Entwurf.',
    state: 'ENTWURF · KEIN MISSIONSVERSAND',
    flightReady: false,
    dispatchAllowed: false,
  }),
  Object.freeze({
    id: 'area',
    path: '/wpml-survey-preview.html',
    name: 'Flächen- und Routenplaner',
    pageTitle: 'Vermessungsvorschau',
    description: 'Polygone, Scanstreifen, Aufnahmeplanung und optionale DEM-Stichprobe.',
    state: 'GEOMETRISCHE VORSCHAU · NICHT FLIEGBAR',
    flightReady: false,
    dispatchAllowed: false,
  }),
  Object.freeze({
    id: 'library',
    path: '/wpml-route-library.html',
    name: 'Routenbibliothek',
    pageTitle: 'Routenbibliothek',
    description: 'Lokale Entwurfsrevisionen und ausdrücklich ausgelöste Bibliotheksaktionen.',
    state: 'LOKALER ENTWURF · KEINE FLUGFREIGABE',
    flightReady: false,
    dispatchAllowed: false,
  }),
]);

export function initPlanningWorkspace(doc = globalThis.document) {
  if (!doc?.getElementById) return null;
  const status = doc.getElementById('planningStatus');
  const fallback = doc.getElementById('planningOpenFull');
  const empty = doc.getElementById('planningEmpty');
  const buttons = [...doc.querySelectorAll('[data-planning-tool]')];
  if (!status || !fallback || !empty || buttons.length !== PLANNING_TOOLS.length) return null;
  const byId = new Map(PLANNING_TOOLS.map(x => [x.id,x]));
  const frames = new Map();
  for (const tool of PLANNING_TOOLS) {
    const frame = doc.getElementById('planningFrame-' + tool.id);
    if (!frame || frame.getAttribute('src')) return null;
    frames.set(tool.id,frame);
  }
  const states=new Map(PLANNING_TOOLS.map(x=>[x.id,'unloaded']));
  let active = null;
  const updateStatus = message => { status.textContent = message; };

  function activate(id) {
    const tool = byId.get(id);
    if (!tool) return false;
    active = id;
    empty.hidden = true;
    for (const [key,frame] of frames) {
      frame.hidden = key !== id;
    }
    for (const button of buttons) {
      const selected=button.dataset.planningTool===id;
      button.setAttribute('aria-pressed',String(selected));
      button.classList.toggle('selected',selected);
    }
    fallback.href=tool.path;
    fallback.textContent=tool.name + ' separat öffnen';
    const frame=frames.get(id);
    if (!frame.getAttribute('src')) {
      states.set(id,'loading');
      updateStatus(tool.name + ' wird geladen. Noch kein Ergebnis bestätigt.');
      frame.setAttribute('src',tool.path);
    } else {
      const state=states.get(id);
      updateStatus(state==='ready'
        ? tool.name + ' erneut geöffnet. Die eingebettete Ansicht bleibt erhalten.'
        : state==='loading' ? tool.name + ' lädt noch.'
        : 'UNBEKANNT: Einbettung konnte nicht bestätigt werden. Über „separat öffnen“ die Originalseite aufrufen.');
      // Mapping canvases may be sized while hidden. Notify the existing owner on reveal.
      try { frame.contentWindow?.dispatchEvent(new Event('resize')); } catch (_) {}
    }
    return true;
  }
  for (const button of buttons) button.addEventListener('click',()=>activate(button.dataset.planningTool));
  for (const tool of PLANNING_TOOLS) {
    const frame=frames.get(tool.id);
    frame.addEventListener('load',()=>{
      if (active!==tool.id) return;
      // A frame load alone is not proof the editor loaded (404/CSP can also load).
      try {
        const url=new URL(frame.contentWindow.location.href,doc.location.href);
        if (url.origin!==new URL(doc.location.href).origin || url.pathname!==tool.path)
          throw new Error('unexpected-frame-url');
        const title=frame.contentDocument?.title || '';
        if (!title.startsWith(tool.pageTitle)) throw new Error('unexpected-frame-document');
        states.set(tool.id,'ready');
        updateStatus(tool.name + ' geladen. Entwurfs- und Prüfaktionen erfolgen ausschließlich im Originalmodul.');
      } catch (_) {
        states.set(tool.id,'unknown');
        updateStatus('UNBEKANNT: Einbettung konnte nicht bestätigt werden. Über „separat öffnen“ die Originalseite aufrufen.');
      }
    });
    frame.addEventListener('error',()=>{
      states.set(tool.id,'unknown');
      if(active===tool.id) updateStatus('UNBEKANNT: Originalmodul nicht erreichbar. Bitte separat öffnen.');
    });
  }
  return Object.freeze({activate, getActive:()=>active});
}
if (typeof document!=='undefined') initPlanningWorkspace(document);
