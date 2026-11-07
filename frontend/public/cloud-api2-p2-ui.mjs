// P2 presentation layer: no fetch, credentials, storage, timers, MQTT or write APIs.
// Only augments the existing SkyHub read-only Cloud API 2 portal.
const dictionary = Object.freeze({
  de: {
    locale:"Sprache", heading:"Datenherkunft & Vergleich", mock:"DJI-DevKit auf BRIX: MOCK – keine Live-Geräte",
    intro:"Vergleich der getrennten Datenquellen. Die lokale DJI-Demo wird hier nicht abgefragt; SkyHub verwendet ausschließlich seine bestehende GET-Fassade.",
    source:"Quelle", skyhub:"SkyHub-Next (bestehende GET-Fassade)", dji:"DJI Cloud API 2 DevKit (separates Mock-Labor)",
    devices:"Geräte", telemetry:"Telemetrie", missions:"Missionen", media:"Medien",
    live:"Live-Registry; Aktualität separat prüfen", fake:"Simulierte Geräte; keine Hardwareabnahme",
    osd:"OSD/Topologie nur mit belegter Quellzeit", noosd:"Mock-Zustände, keine OSD-Livebestätigung",
    plans:"Vorhandene SkyHub-Missionsdaten; kein Dispatch", mockplans:"128 Demo-Routen, statischer Mock-Wert",
    files:"Vorhandene SkyHub-Medienpipeline; Nachweise prüfen", mockfiles:"128 Demo-Medien, statischer Mock-Wert",
    unknown:"Kein automatischer Cross-System-Abgleich", disclaimer:"Kein gemeinsamer Login, keine API-2-Bridge, kein Flugkommando, kein Schreibzugriff.",
    langDe:"Deutsch", langEn:"English"
  },
  en: {
    locale:"Language", heading:"Data provenance & comparison", mock:"DJI DevKit on BRIX: MOCK – no live aircraft",
    intro:"Comparison of isolated sources. This page does not query the local DJI demo; SkyHub uses its existing GET-only facade.",
    source:"Source", skyhub:"SkyHub-Next (existing GET facade)", dji:"DJI Cloud API 2 DevKit (isolated mock lab)",
    devices:"Devices", telemetry:"Telemetry", missions:"Missions", media:"Media",
    live:"Live registry; freshness must be checked separately", fake:"Synthetic devices; no hardware acceptance",
    osd:"OSD/topology only with verified source timestamps", noosd:"Mock state; no live OSD evidence",
    plans:"Existing SkyHub mission records; no dispatch", mockplans:"128 demo waylines, fixed mock value",
    files:"Existing SkyHub media pipeline; evidence required", mockfiles:"128 demo media files, fixed mock value",
    unknown:"No automated cross-system reconciliation", disclaimer:"No shared login, API-2 bridge, flight commands or write access.",
    langDe:"Deutsch", langEn:"English"
  }
});
const rows = [
  ["devices","live","fake"],
  ["telemetry","osd","noosd"],
  ["missions","plans","mockplans"],
  ["media","files","mockfiles"]
];
const root = document.getElementById("p2-provenance");
const chooser = document.getElementById("p2-language");
const alert = document.getElementById("p2-mock-banner");
const title = document.getElementById("p2-compare-title");
const intro = document.getElementById("p2-compare-intro");
const status = document.getElementById("p2-compare-status");
function cell(tag,value) {
  const node=document.createElement(tag); node.textContent=value; return node;
}
export function renderP2(locale) {
  const language=Object.hasOwn(dictionary,locale)?locale:"de";
  const t=dictionary[language];
  // Only this P2 region is localized: other portal views remain German.
  // Never mislabel the document language for assistive technology.
  for (const node of [root,alert,title,intro,status]) node.lang=language;
  chooser.value=language;
  chooser.setAttribute("aria-label",t.locale);
  alert.textContent=t.mock;
  title.textContent=t.heading;
  intro.textContent=t.intro;
  const table=document.createElement("table");
  table.className="p2-table";
  const caption=cell("caption",t.unknown); table.append(caption);
  const head=document.createElement("thead"),tr=document.createElement("tr");
  [t.source,t.skyhub,t.dji].forEach(x=>tr.append(cell("th",x)));
  head.append(tr);table.append(head);
  const body=document.createElement("tbody");
  rows.forEach(([name,sky,mock])=>{
    const r=document.createElement("tr");
    const h=cell("th",t[name]);h.scope="row";r.append(h,cell("td",t[sky]),cell("td",t[mock]));
    body.append(r);
  });
  table.append(body);
  const wrap=document.createElement("div");wrap.className="p2-table-scroll";wrap.tabIndex=0;
  wrap.setAttribute("role","region");wrap.setAttribute("aria-label",t.heading);
  wrap.append(table);
  root.replaceChildren(wrap,cell("p",t.disclaimer));
  status.textContent=t.unknown;
  document.querySelectorAll("[data-p2-nav]").forEach(node=>{
    const key=node.getAttribute("data-p2-nav");
    if(t[key])node.textContent=t[key];
  });
}
if(root&&chooser&&alert&&title&&intro&&status){
  const requested=new URLSearchParams(location.search).get("lang");
  renderP2(requested==="en"?"en":"de");
  chooser.addEventListener("change",()=>renderP2(chooser.value));
}
