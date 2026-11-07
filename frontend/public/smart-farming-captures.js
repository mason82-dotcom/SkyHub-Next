// Smart Farming: Mavic 3M multispectral captures (read-only, home LAN, no login).
(function(){
'use strict';
const el=id=>document.getElementById(id);
const BAND_LABELS={G:'Grün',R:'Rot',RE:'RedEdge',NIR:'NIR'};
const ASSESSMENT_VERSION='skyhub-m3m-capture-assessment-v3';
const currentAssessment=c=>c.assessmentVersion===ASSESSMENT_VERSION;
const metadataCandidate=c=>currentAssessment(c)&&c.usability==='metadata-candidate'&&c.usable===true;
function node(tag,className,text){
  const e=document.createElement(tag);
  if(className)e.className=className;
  if(text!==undefined)e.textContent=text;
  return e;
}
const num=(v,d=2)=>Number.isFinite(v)?v.toLocaleString('de-DE',{minimumFractionDigits:d,maximumFractionDigits:d}):'—';
function when(value){
  const t=Date.parse(value||'');
  return Number.isFinite(t)?new Date(t).toLocaleString('de-DE',{dateStyle:'medium',timeStyle:'medium'}):'Zeit unbekannt';
}
const fileUrl=(bucket,key)=>'/api/media/file?'+new URLSearchParams({bucket,key}).toString();
function gpsText(c){
  if(!currentAssessment(c)||!c.gpsAssessment)return 'GPS-Bewertung nicht aktuell';
  const g=c.gpsAssessment;
  const validity='GPS: '+g.validPositionCount+'/'+g.positionCount+' Objektpositionen gültig';
  if(g.commonPositionAvailable&&c.gps)
    return validity+'; gemeinsamer Wert '+num(c.gps.lat,5)+', '+num(c.gps.lon,5);
  const spread=Number.isFinite(g.maxSpreadMetres)?
    '; maximale Distanz ca. '+num(g.maxSpreadMetres,3)+' m (keine GNSS-Genauigkeit)':'';
  return validity+(g.consistency==='different'?'; Bandpositionen abweichend':'')+
    spread+'; kein gemeinsamer Positionswert';
}
function card(c){
  const article=node('article','capture-card');
  const head=node('div','capture-head');
  const candidate=metadataCandidate(c);
  const label=!currentAssessment(c)?'Bewertung nicht aktuell':candidate?'Metadaten-Kandidat':'Metadaten-Prüfung blockiert';
  head.append(node('h3',null,when(c.createdAt)),
    node('span','capture-status '+(candidate?'ok':'bad'),label));
  article.append(head);
  const completeness={complete:'eindeutig vollständig',incomplete:'unvollständig',conflicted:'mehrdeutig'};
  article.append(node('p','fine','Bandstatus: '+(currentAssessment(c)&&Object.hasOwn(completeness,c.completeness)?
    completeness[c.completeness]:'ungeprüft')+'. Radiometrie und Mapping nicht freigegeben.'));
  if(c.preview&&c.preview.image){
    const fig=node('figure');
    const img=document.createElement('img');
    img.alt='NDVI-Vorschau der Aufnahme '+when(c.createdAt);img.loading='lazy';
    img.src=fileUrl(c.preview.image.bucket,c.preview.image.key);
    fig.append(img,node('figcaption',null,'NDVI-Vorschau (rot niedrig, grün hoch). '+c.preview.note));
    article.append(fig);
  }
  const bands=node('div','band-row');
  for(const b of ['G','R','RE','NIR']){
    const band=c.bands[b];
    if(currentAssessment(c)&&c.duplicateBands?.includes(b)){
      bands.append(node('span','band-chip missing',BAND_LABELS[b]+' mehrdeutig'));
      continue;
    }
    if(!band){bands.append(node('span','band-chip missing',BAND_LABELS[b]+' fehlt'));continue;}
    const a=node('a','band-chip',BAND_LABELS[b]+' '+(band.wavelength||'?')+' nm');
    a.href=fileUrl(band.bucket,band.key);a.download=band.name;
    a.title=band.key+' · Sonnensensor '+num(band.irradiance,1);
    bands.append(a);
  }
  article.append(bands);
  const facts=node('p','fine',[
    c.model||'Kamera ?',
    gpsText(c),
    'Sonnensensor min. '+num(c.minIrradiance,1),
    c.relativeAltitude!==null?num(c.relativeAltitude,1)+' m über Start':''
  ].filter(Boolean).join(' · '));
  article.append(facts);
  const indices=c.preview&&c.preview.indices||{};
  if(Object.keys(indices).length){
    const table=node('table','capture-table');
    const head=node('tr');
    for(const h of ['Index','Median','5–95 %','gültig'])head.append(node('th',null,h));
    table.append(head);
    for(const [name,s] of Object.entries(indices)){
      const tr=node('tr');
      tr.append(node('td',null,name),node('td',null,num(s.median)),
        node('td',null,num(s.p05)+' … '+num(s.p95)),
        node('td',null,Number.isFinite(s.valid_fraction)?Math.round(s.valid_fraction*100)+' %':'—'));
      table.append(tr);
    }
    article.append(table);
  }else{
    article.append(node('p','fine','Noch keine Indexvorschau für diese Aufnahme.'));
  }
  if(c.issues&&c.issues.length){
    const list=node('ul','capture-issues');
    for(const issue of c.issues)list.append(node('li',null,issue));
    article.append(list);
  }
  article.append(node('p','fine','CaptureUUID '+c.captureUUID+' · Quellen: '+(c.sources||[]).join(', ')));
  return article;
}
async function load(){
  const status=el('captureStatus'),list=el('captureList');
  if(!status||!list||el('loadCaptures').disabled)return;
  el('loadCaptures').disabled=true;
  list.setAttribute('aria-busy','true');
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),30000);
  status.textContent='Aufnahmen werden eingelesen …';
  try{
    const r=await fetch('/api/smart-farming/captures',{cache:'no-store',headers:{Accept:'application/json'},signal:controller.signal});
    if(r.status===401)throw new Error('Kein Zugriff: Seite bitte aus dem Heimnetz öffnen.');
    if(r.status===404)throw new Error('Die Medien-API ist auf diesem Backend nicht aktiviert.');
    if(!r.ok)throw new Error('Speicher nicht erreichbar (HTTP '+r.status+').');
    const data=await r.json();
    list.replaceChildren(...data.captures.map(card));
    status.textContent=data.count+' Aufnahmen. Metadaten-Kandidaten: '+data.captures.filter(metadataCandidate).length+
      '. '+(data.assessmentVersion===ASSESSMENT_VERSION?'':
        'Bewertung nicht aktuell; Backend und Seite gemeinsam aktualisieren. ')+data.notice;
  }catch(error){
    list.replaceChildren();
    status.textContent=error.name==='AbortError'?'Zeitüberschreitung beim Einlesen. Bitte erneut laden.':error.message;
  }finally{clearTimeout(timeout);list.setAttribute('aria-busy','false');el('loadCaptures').disabled=false;}
}
window.addEventListener('DOMContentLoaded',()=>{
  if(!el('loadCaptures'))return;
  el('loadCaptures').addEventListener('click',load);
  load();
});
})();
