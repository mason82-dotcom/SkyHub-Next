import {SkyHubDaaSClient} from './cloud-api2-sdk.mjs';
import {SkyHubLabSimulator} from './cloud-api2-lab.mjs';
const get=id=>document.getElementById(id);
const client=new SkyHubDaaSClient();
const lab=new SkyHubLabSimulator();
const sections=['overview','devices','simulator','sdk','ai'];
const features=[
  ['SkyHub Geräte-Backend','KEYLESS'],
  ['Objektorientierte GET-Fassade','KEYLESS'],
  ['Offline-Gerätesimulator','KEYLESS'],
  ['KI-Entwicklungs-Prompts','KEYLESS'],
  ['Vorhandene WPML-/Medienmodule','BESTEHEND'],
  ['Offizielles DJI Java/JNI SDK','NICHT INSTALLIERT'],
  ['DJI PaaS / Frontend Runtime','NICHT INSTALLIERT'],
  ['DJI API 2 MQTT Bridge','NICHT AKTIV'],
  ['DRC / Flugbetrieb / Missionsversand','GESPERRT']
];
const promptTopics={
  parity:'Vergleiche typisierte Cloud API 1.x Gerätefelder und die dokumentierten Cloud API 2 DaaS-Leseinterfaces. Liefere eine Feldmatrix mit belegten, fehlenden und noch zu prüfenden Werten. Niemals Telemetriedaten interpolieren.',
  backend:'Entwerfe eine strikt lesende SkyHub-Backend-Fassade über die vorhandene Registry. Verwende ausschließlich GET und eine eindeutige Datenherkunft; keine MQTT-Publikation, keine Geräteänderung, keine neue Berechtigung.',
  sim:'Erzeuge reproduzierbare synthetische RC Plus 2 / Matrice 4T Simulationsprofile mit Offline-Testfällen. Keine Weitergabe an Live-Dienste und keine voreilige Hardwarefreigabe.',
  frontend:'Prüfe SkyHub-Frontend-Module auf saubere Komponentenlebenszyklen, HTML-Escaping, Barrierefreiheit, Token-Grenzen, klare Fehlerzustände und strikt getrennte Simulationsdaten.',
  security:'Prüfe SkyHub auf ungewollte Writes, DRC-Kommandos, MQTT-Topic-Schleifen, Doppelantworten, Datenabfluss, Token-Speicherung und Verwechslung von Live-/Laborzuständen.'
};
function el(tag,cls,txt) {
  const node=document.createElement(tag);if(cls)node.className=cls;
  if(txt!==undefined)node.textContent=String(txt);
  return node;
}
function view(key){
  if(!sections.includes(key))return;
  for(const name of sections)get('view-'+name).hidden=name!==key;
  document.querySelectorAll('[data-view]').forEach(button=>{
    const selected=button.dataset.view===key;
    button.classList.toggle('active',selected);
    if(selected)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');
  });
  try{history.replaceState(null,'','#'+key);}catch(_){}
}
document.querySelectorAll('[data-view]').forEach(button=>
  button.addEventListener('click',()=>view(button.dataset.view)));
document.querySelectorAll('[data-open]').forEach(button=>
  button.addEventListener('click',()=>view(button.dataset.open)));
function connected(value,text){
  get('indicator').classList.toggle('ok',value);
  get('connection').textContent=text;
}
function paintDevices(devices){
  const root=get('devices');root.replaceChildren();
  if(!devices.length){
    root.append(el('p','empty','Keine bestätigten Live-Geräte vorhanden oder Zugang eingeschränkt. Der Simulator ist weiterhin nutzbar.'));
    return;
  }
  for(const device of devices){
    const article=el('article','device');
    article.append(el('div','live'+(device.online?'':' off'),device.online?'● FRISCHE TELEMETRIE':'○ OFFLINE / UNBEKANNT'));
    article.append(el('h2','',device.modelName));
    article.append(el('p','',device.role==='gateway'?'Gateway / Fernsteuerung':device.role==='subdevice'?'Fluggerät / Untergerät':'Gerätetyp unbekannt'));
    const dl=el('dl');
    for(const [name,value] of [
      ['Topologie',device.topologyOnline===true?'Gemeldet':device.topologyOnline===false?'Nicht online':'Unbekannt'],
      ['Akku',device.batteryPercent===null?'—':device.batteryPercent+' %'],
      ['OSD Alter',device.telemetryAgeSeconds===null?'Unbekannt':device.telemetryAgeSeconds+' s'],
      ['Qualität',device.online?'Frisch':'Nicht verifiziert']
    ])dl.append(el('dt','',name),el('dd','',value));
    article.append(dl);root.append(article);
  }
}
async function refresh(){
  get('status').textContent='SkyHub wird ausschließlich lesend abgefragt …';
  try{
    const [status,list]=await Promise.all([client.getStatus(),client.listDevices()]);
    const devices=Array.isArray(list.devices)?list.devices:[];
    get('count').textContent=Number.isInteger(list.total)?list.total:'—';
    get('online').textContent=Number.isInteger(list.online)?list.online:'—';
    get('deviceStatus').textContent=String(list.total)+' registriert · '+String(list.online)+' frisch · MQTT '+(status.mqttConnected?'verbunden':'nicht verbunden');
    get('status').textContent='SkyHub-Backend erreichbar. Quelle: bestehende Cloud API 1.x, nicht DJI Cloud API 2.';
    get('status').classList.add('ok');
    connected(true,'SkyHub erreichbar');
    paintDevices(devices);
  }catch(err){
    get('count').textContent='—';get('online').textContent='—';
    get('deviceStatus').textContent='Live-Backend nicht erreichbar / nicht autorisiert';
    get('status').textContent=err instanceof Error?err.message:'Keine Verbindung';
    get('status').classList.remove('ok');
    connected(false,'Live-Daten nicht verfügbar');
    paintDevices([]);
  }
}
get('refresh').addEventListener('click',refresh);
get('reload').addEventListener('click',refresh);
function renderLab(){
  const state=lab.current();
  get('frame').textContent='FRAME '+String(state.index+1).padStart(2,'0')+' / '+state.count;
  get('phase').textContent=state.phase;
  get('height').textContent=state.altitude+' m';
  get('battery').textContent=state.battery+' %';
  get('link').textContent=state.link+' %';
  get('next').disabled=state.index===state.count-1;
  const list=get('labLog');list.replaceChildren();
  for(const entry of lab.history)list.append(el('li','',String(entry.index+1).padStart(2,'0')+' · '+entry.note));
}
get('next').addEventListener('click',()=>{lab.advance();renderLab();});
get('reset').addEventListener('click',()=>{lab.reset();renderLab();});
get('download').addEventListener('click',()=>{
  const blob=new Blob([JSON.stringify(lab.exportData(),null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const anchor=el('a');anchor.href=url;anchor.download='skyhub-cloudapi2-lab.json';
  anchor.click();URL.revokeObjectURL(url);
});
function renderFeatures(){
  const target=get('modules');
  for(const [name,state] of features){
    const item=el('div','feature');
    item.append(el('span','',name),el('b',['KEYLESS','BESTEHEND'].includes(state)?'yes':'',state));
    target.append(item);
  }
}
function makePrompt(){
  const topic=promptTopics[get('task').value];
  const detail=get('target').value.trim().slice(0,600);
  get('prompt').textContent=[
    'Rolle: Senior-Entwickler und Sicherheitsprüfer für SkyHub-Next.',
    'Kontext: Die bestehende Live-Anbindung nutzt DJI Cloud API 1.x. Cloud API 2 V1.1.0 ist Dokumentationsreferenz; die Originalruntime ist nicht installiert.',
    'Aufgabe: '+topic,
    'Konkretes Ziel: '+(detail||'Führe einen reproduzierbaren Offline-Test der genannten Komponente durch.'),
    'Sicherheitsregeln: Nur Lesen; keine Flug-, Last-, Lösch-, Konfigurations- oder MQTT-Schreibbefehle; keine DJI-Keys; Labor und Live strikt trennen.',
    'Ergebnis: Dokumentierte Architektur, sichere Änderungsvorschläge, synthetische Testfälle, PASS/FAIL/UNBEKANNT und offene Risiken. Kein unbelegter Hardwareerfolg.'
  ].join('\n\n');
  get('promptStatus').textContent='Vorlage lokal erzeugt. Keine Netzwerkübertragung.';
}
get('generate').addEventListener('click',makePrompt);
get('copy').addEventListener('click',async()=>{
  try{await navigator.clipboard.writeText(get('prompt').textContent);get('promptStatus').textContent='Vorlage kopiert.';}
  catch(_){get('promptStatus').textContent='Zwischenablage nicht verfügbar; Text manuell markieren.';}
});
function updateTime(){get('localtime').textContent=new Intl.DateTimeFormat('de-DE',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date());}
renderFeatures();renderLab();updateTime();setInterval(updateTime,60000);
view(location.hash.slice(1)||'overview');refresh();