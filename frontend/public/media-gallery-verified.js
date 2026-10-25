// Standalone verified Pilot 2 gallery. The main backend's GET contract is already opt-in mounted.
// It never loads media bytes, XMP, object keys or URLs. No S3 token is shared.
(function(){
'use strict';
const M=window.SkyhubVerifiedMediaModel;
const F=window.SkyhubGalleryControls;
const $=id=>document.getElementById(id);
let workspace=null,token=null,viewToken=null,cursor=null,page=0,selectedId=null,selected=null;
let pending=null,generation=0,busy=false,currentPage=[];
const seen=new Set();
function node(tag,text,cls){
  const item=document.createElement(tag);
  if(cls)item.className=cls;
  if(text!==undefined)item.textContent=String(text);
  return item;
}
function status(text){$('verified-state').textContent=text;}
function message(text){$('verified-message').textContent=text;}
function clear(){
  cursor=null;page=0;selected=null;selectedId=null;seen.clear();currentPage=[];
  $('verified-filter-count').textContent='Noch keine Seite geladen';
  $('verified-list').replaceChildren();
  $('verified-detail').replaceChildren();
  $('verified-page').textContent='Keine Seite geladen';
  $('verified-next').hidden=true;
  $('verified-group').disabled=true;
}
function stop(){
  generation++;if(pending)pending.abort();pending=null;busy=false;
}
function begin(){
  stop();pending=new AbortController();busy=true;controls();return generation;
}
function finish(id){if(id===generation){pending=null;busy=false;controls();}}
function controls(){
  $('verified-connect').disabled=busy;
  $('verified-next').disabled=busy||!cursor||page>=20;
  $('verified-next').hidden=!cursor;
  $('verified-group').disabled=busy||!selected||!selected.fileGroupId||!M.GROUP.test(selected.fileGroupId);
}
function error(e){
  if(e.status===401){token=null;viewToken=null;workspace=null;clear();status('AUTHENTIFIZIERUNG FEHLGESCHLAGEN');
    message('Medienzugriff verweigert (401). Erneut mit einem gültigen Pilot-2-API-Token anmelden.');}
  else if(e.status===403){status('ZUGRIFF VERWEIGERT');
    message('HTTP 403: HTTPS oder Pilot-/Operator-Berechtigung für diesen Workspace fehlt.');}
  else if(e.status===404){status('NICHT VERFÜGBAR');
    message('Verifizierte Pilot-2-Bibliothek hier nicht erreichbar (404): API deaktiviert, Workspace unbekannt oder Asset nicht vorhanden.');}
  else if(e.status===409){status('OBJEKT GEÄNDERT');
    message('Die aktuelle S3-HEAD-Prüfung bestätigt das Asset nicht mehr (409). Keine Metadatenfreigabe.');}
  else if(e.status===429){status('RATE LIMIT');message('Leselimit erreicht (429).');}
  else{status('NICHT VERIFIZIERT');message('Antwort konnte nicht sicher verarbeitet werden. Keine Daten übernommen.');}
}
async function request(suffix,options,signal){
  const url='/api/media-library/v1/workspaces/'+encodeURIComponent(workspace)+suffix;
  const query=new URLSearchParams(options||{});
  const response=await fetch(url+(query.size?'?'+query.toString():''),
    {method:'GET',headers:{'X-Auth-Token':token,Authorization:'Bearer '+viewToken},cache:'no-store',signal});
  if(!response.ok){const e=new Error('Media library unavailable');e.status=response.status;throw e;}
  return response.json();
}
function renderList(){
  const filtered=F.view(currentPage,{
    query:$('verified-search').value,type:$('verified-type').value,sort:$('verified-sort').value
  });
  const items=filtered.items;
  $('verified-filter-count').textContent=filtered.shown+' von '+filtered.total+
    ' Einträgen dieser geladenen Seite sichtbar · Dateityp nur aus Namensendung';
  const ul=$('verified-list');ul.replaceChildren();
  if(!items.length)ul.append(node('li',filtered.total?
    'Keine Treffer für die aktuellen Filter auf dieser Seite.':
    'Keine registrierten Medien auf dieser Seite.','verified-empty'));
  for(const x of items){
    const li=node('li',undefined,'verified-entry');
    const button=node('button',undefined,'verified-asset');
    button.type='button';
    button.dataset.asset=x.id;
    button.append(node('span',x.bandHint==='RGB'?'▧':x.bandHint?'◈':'▤','gallery-visual'),
      node('strong',x.name),node('small',x.bandHint?
      'Kanalhinweis '+x.bandHint+' · nur Dateiname':'Sensortyp nicht verifiziert'));
    button.setAttribute('aria-label','Aktuellen S3-HEAD für '+x.name+' prüfen');
    button.append(node('small','Größe '+x.bytes+' Bytes · registriert '+x.verifiedAt));
    button.addEventListener('click',()=>loadDetail(x.id));
    li.append(button);ul.append(li);
  }
}
function renderDetail(x){
  const target=$('verified-detail');target.replaceChildren();
  const title=node('strong',x.name);
  target.append(title,
    node('p','S3-HEAD jetzt bestätigt: Größe, ETag und Änderungszeit stimmen mit der Registrierung überein.'),
    node('p','Asset-ID: '+x.id),
    node('p','Größe: '+x.bytes+' Bytes · zuletzt geändert '+x.objectLastModified),
    node('p','Sensorband: '+(x.bandHint||'unbekannt')+' (reiner Dateinamenhinweis)'),
    node('p','EXIF/XMP nicht ausgelesen · Capture UUID nicht bestätigt · keine Radiometrie, NDVI oder NDRE.'));
  if(x.fileGroupId)target.append(node('p','Mediengruppe: '+x.fileGroupId));
}
async function loadList(next=false){
  if(!workspace||!token||!viewToken){message('Workspace und Pilot-2-API-Token erforderlich.');return;}
  if(next&&(!cursor||seen.has(cursor)||page>=20)){
    message('Wiederholter Cursor oder Seitenlimit erreicht; kein weiterer Abruf.');
    cursor=null;controls();return;
  }
  if(!next)clear();
  const previousCursor=next?cursor:null;
  const id=begin();status('LÄDT');
  message('Rufe registrierte Pilot-2-Assets lesend ab …');
  try{
    const query={limit:'20'};
    if(previousCursor)query.cursor=previousCursor;
    const result=M.libraryList(await request('/assets',query,pending.signal),20);
    if(id!==generation)return;
    if(previousCursor)seen.add(previousCursor);
    page=next?page+1:1;
    cursor=result.nextCursor;
    $('verified-page').textContent='Seite '+page+' · '+result.items.length+
      ' registrierte Medien (HEAD bei Registrierung, kein neuer Integritätscheck)';
    currentPage=result.items;renderList();status('REGISTRIERT');
    message('Diese Einträge stammen aus der registrierten Medienbibliothek. Einzelne Assets müssen für aktuellen S3-HEAD-Nachweis geöffnet werden.');
  }catch(e){if(id===generation){cursor=null;error(e);}}
  finally{finish(id);}
}
async function loadDetail(assetId){
  if(!workspace||!token||!viewToken||!M.UUID.test(assetId))return;
  const id=begin();status('PRÜFE HEAD');selected=null;
  $('verified-detail').replaceChildren();message('Prüfe S3-Objektidentität erneut …');
  try{
    const result=M.detail(await request('/assets/'+encodeURIComponent(assetId),null,pending.signal),assetId);
    if(id!==generation)return;
    selected=result;selectedId=assetId;
    renderDetail(result);status('HEAD BESTÄTIGT');
    message('Größe, ETag und Änderungsdatum wurden aktuell bestätigt. Bildinhalte und DJI-Sensoreigenschaften sind weiterhin nicht validiert.');
  }catch(e){if(id===generation){selected=null;selectedId=null;error(e);}}
  finally{finish(id);}
}
async function loadGroup(){
  if(!selected||!selected.fileGroupId||!M.GROUP.test(selected.fileGroupId))return;
  const id=begin();status('PRÜFE HINWEISE');
  $('verified-detail').replaceChildren();
  try{
    const group=M.group(await request('/groups/'+encodeURIComponent(selected.fileGroupId)+'/m3m-hints',
      null,pending.signal));
    if(id!==generation)return;
    $('verified-detail').append(
      node('strong','M3M-Dateinamenanalyse · nur aggregierte Hinweise'),
      node('p','Untersucht: '+group.examined+' · Sessions: '+group.sessionPartitions),
      node('p','Vierkanal-Hinweise: '+group.spectralSets+' · Fünfkanal-Hinweise: '+group.fiveChannelSets),
      node('p','RGB '+group.bands.RGB+' · G '+group.bands.G+' · R '+group.bands.R+
        ' · RE '+group.bands.RE+' · NIR '+group.bands.NIR),
      node('p','Capture UUID, Radiometrie und Bandregistrierung NICHT bestätigt. Keine Freigabe für NDVI/NDRE.'));
    status('DATEINAMEN-HINWEISE');
    message('Zähler sind nur Hinweise innerhalb derselben STS-Session, keine bestätigten M3M-Bilddatensätze.');
  }catch(e){if(id===generation)error(e);}
  finally{finish(id);}
}
function connect(){
  const candidate=$('verified-workspace').value.trim().toLowerCase();
  const credential=$('verified-token').value.trim();
  const viewCredential=$('verified-view-token').value.trim();
  $('verified-token').value='';$('verified-view-token').value='';
  stop();clear();token=null;viewToken=null;workspace=null;
  if(location.protocol!=='https:'&&!['127.0.0.1','localhost'].includes(location.hostname)){
    status('HTTPS ERFORDERLICH');message('Anmeldung nur per HTTPS möglich.');controls();return;
  }
  if(!M.UUID.test(candidate)||!credential||credential.length>512||
      viewCredential.length<24||viewCredential.length>512){
    status('ANMELDUNG ERFORDERLICH');
    message('Gültige Workspace-UUID, SkyHub-View-Token (24–512 Zeichen) und Pilot-2-API-Token erforderlich.');
    controls();return;
  }
  token=credential;viewToken=viewCredential;workspace=candidate;loadList(false);
}
function start(){
  if(!$('verified-connect'))return;
  $('verified-connect').addEventListener('click',connect);
  $('verified-token').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();connect();}});
  $('verified-workspace').addEventListener('change',()=>{
    stop();clear();workspace=null;token=null;viewToken=null;status('NICHT VERBUNDEN');
    message('Workspace wurde geändert. Erneute Anmeldung erforderlich.');controls();
  });
  $('verified-next').addEventListener('click',()=>loadList(true));
  $('verified-clear').addEventListener('click',()=>{
    stop();clear();workspace=null;token=null;viewToken=null;
    $('verified-workspace').value='';$('verified-token').value='';$('verified-view-token').value='';
    status('NICHT VERBUNDEN');message('Sitzungsspeicher geleert.');controls();
  });
  $('verified-group').addEventListener('click',loadGroup);
  $('verified-search').addEventListener('input',renderList);
  $('verified-type').addEventListener('change',renderList);
  $('verified-sort').addEventListener('change',renderList);
  controls();
}
window.addEventListener('DOMContentLoaded',start);
})();
