// Standalone read-only MinIO catalog; inventory is not image authenticity or preview.
(function(){
'use strict';
const M=window.SkyhubMediaModel;
const el=id=>document.getElementById(id);
let token=null,active=null,generation=0,seen=new Set(),nextCursor=null,pageNumber=0,busy=false;
const headers=()=>token?{Authorization:'Bearer '+token}:{};
function say(message){el('storage-message').textContent=message;}
function setStatus(message){el('storage-state').textContent=message;}
function row(tag,className,value){
  const element=document.createElement(tag);
  if(className)element.className=className;
  if(value!==undefined)element.textContent=value;
  return element;
}
function reset(){
  nextCursor=null;pageNumber=0;seen=new Set();
  el('storage-objects').replaceChildren();
  el('storage-page').textContent='Noch keine Objekte geladen';
  el('storage-next').hidden=true;
  el('storage-next').disabled=true;
}
function controls(){
  el('storage-connect').disabled=busy;
  el('storage-load').disabled=busy||!token||!el('storage-bucket').value;
  el('storage-next').disabled=busy||!nextCursor;
}
function begin(){
  generation++;
  if(active)active.abort();
  active=new AbortController();
  busy=true;controls();
  return generation;
}
function finish(id){
  if(id!==generation)return;
  busy=false;active=null;controls();
}
function cancelPending(){
  generation++;
  if(active)active.abort();
  active=null;busy=false;
}
async function get(name,params,signal){
  const q=new URLSearchParams(params||{});
  const path='/api/media/'+name+(q.size?'?'+q.toString():'');
  const response=await fetch(path,{method:'GET',headers:headers(),cache:'no-store',signal});
  if(!response.ok){
    const error=new Error('Media API request failed');
    error.status=response.status;
    throw error;
  }
  return response.json();
}
function errorState(error){
  reset();
  if(error.status===401){
    token=null;
    el('storage-bucket').replaceChildren();
    say('HTTP 401: Für Medien wird ein eigener gültiger SkyHub-Zugriffstoken benötigt.');
    setStatus('ZUGRIFF GESPERRT');
  }else if(error.status===404){
    say('Medien-API auf diesem Backend nicht aktiviert (HTTP 404). Keine Beispieldateien als echte Medien dargestellt.');
    setStatus('NICHT AKTIV');
  }else if(error.status===503){
    say('MinIO derzeit nicht erreichbar (HTTP 503). Es wurden keine Dateien verändert.');
    setStatus('NICHT ERREICHBAR');
  }else{
    say('Medienübersicht konnte nicht geladen oder sicher validiert werden.');
    setStatus('FEHLER');
  }
  controls();
}
async function connect(){
  const value=el('storage-token').value.trim();
  el('storage-token').value='';
  if(!value){say('Bitte den SkyHub-Zugriffstoken eingeben.');return;}
  if(location.protocol!=='https:'&&!['127.0.0.1','localhost'].includes(location.hostname)){
    say('HTTPS für die Medienanmeldung erforderlich.');return;
  }
  if(value.length<24||value.length>512){say('Ungültiges SkyHub-Zugriffstoken.');return;}
  token=value;reset();
  const id=begin();
  setStatus('PRÜFUNG');
  say('Prüfe getrennt geschützten MinIO-Lesezugriff …');
  try{
    const status=await get('status',null,active.signal);
    if(id!==generation)return;
    if(!status||status.status!=='online'||status.readOnly!==true)throw Error('Invalid media status');
    const available=M.buckets(await get('buckets',null,active.signal));
    if(id!==generation)return;
    const select=el('storage-bucket');
    select.replaceChildren();
    for(const name of available){
      const opt=document.createElement('option');
      opt.value=name;opt.textContent=name;select.append(opt);
    }
    if(available.includes('dji-cloud'))select.value='dji-cloud';
    setStatus('READ-ONLY');
    say(available.length?available.length+' erlaubte Buckets erreichbar. Nur Objektnamen, Größen und Änderungszeiten; keine Originale oder EXIF/XMP verifiziert.':'MinIO erreichbar; kein freigegebener Bucket vorhanden.');
  }catch(error){if(id===generation)errorState(error);}
  finally{finish(id);}
}
function render(data){
  const list=el('storage-objects');
  list.replaceChildren();
  for(const item of data.items){
    const entry=row('li','storage-object');
    entry.append(row('span','gallery-visual','▤'),
      row('strong','storage-object-name',item.name),
      row('small','storage-object-meta',M.size(item.bytes)+' · zuletzt geändert: '+M.date(item.modified)));
    entry.setAttribute('aria-label','S3-Objekt, nicht verifiziert: '+item.name);
    list.append(entry);
  }
  if(!data.items.length)list.append(row('li','storage-empty','In diesem Bereich sind keine Objekte enthalten.'));
  el('storage-page').textContent='Seite '+pageNumber+' · '+data.items.length+' S3-Objekte (max. 50 je Seite)';
  nextCursor=data.nextCursor;
  el('storage-next').hidden=!data.truncated;
  say(data.truncated?'Weitere Objekte vorhanden. Nächste Seite wird nur auf Anforderung geladen.':
    'Objektauflistung für diesen Prefix beendet. Diese Einträge sind nicht als DJI-Medien oder Bildinhalte verifiziert.');
}
async function load(next=false){
  if(!token){say('Zuerst mit einem SkyHub-Zugriffstoken anmelden.');return;}
  const bucket=el('storage-bucket').value,prefix=el('storage-prefix').value;
  if(!M.ALLOWED_BUCKETS.includes(bucket)||prefix.length>512){say('Bucket oder Prefix ungültig.');return;}
  const cursor=next?nextCursor:null;
  if(next&&(!cursor||seen.has(cursor)||pageNumber>=20)){
    say('Seitenlimit oder wiederholter Cursor: weiterer Abruf gestoppt.');
    nextCursor=null;controls();return;
  }
  if(!next)reset();
  const id=begin();
  setStatus('LÄDT');
  say('Lese ausschließlich S3-Objektübersicht …');
  try{
    const input={bucket,prefix,limit:'50'};
    if(cursor)input.cursor=cursor;
    const data=M.page(await get('objects',input,active.signal),{bucket,prefix,cursor,limit:50});
    if(id!==generation)return;
    if(cursor)seen.add(cursor);
    pageNumber=next?pageNumber+1:1;
    render(data);
    setStatus('READ-ONLY');
  }catch(error){if(id===generation)errorState(error);}
  finally{finish(id);}
}
function start(){
  const connectButton=el('storage-connect');
  if(!connectButton)return;
  connectButton.addEventListener('click',connect);
  el('storage-token').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();connect();}});
  el('storage-load').addEventListener('click',()=>load(false));
  el('storage-next').addEventListener('click',()=>load(true));
  el('storage-clear').addEventListener('click',()=>{
    cancelPending();token=null;reset();seen.clear();
    el('storage-bucket').replaceChildren();el('storage-token').value='';
    el('storage-prefix').value='';say('Zugriffstoken aus Seitenspeicher entfernt.');
    setStatus('NICHT VERBUNDEN');controls();
  });
  el('storage-bucket').addEventListener('change',()=>{cancelPending();reset();controls();});
  el('storage-prefix').addEventListener('input',()=>{cancelPending();reset();controls();});
  controls();
}
window.addEventListener('DOMContentLoaded',start);
})();
