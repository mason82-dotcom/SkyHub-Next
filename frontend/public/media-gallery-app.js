// SkyHub media gallery: complete MinIO inventory with previews, folders, search and a viewer.
// Home-LAN read-only access: no token or password prompt.
(function(){
'use strict';
const M=window.SkyhubMediaLibrary;
const el=id=>document.getElementById(id);
const BATCH=120;
const TEXT_PREVIEW_LIMIT=524288;
const TEXT_EXT=new Set(['json','geojson','txt','csv','xml','kml','mrk','nav','obs','rtk','pbk','log']);
const ICONS={image:'🖼',video:'▶',tiff:'◧',other:'📄'};
const state={
  summary:[],bucket:null,items:[],cache:new Map(),prefix:'',mode:'folders',
  query:'',type:'all',sort:'newest',list:[],shown:0,viewerIndex:-1,loading:0
};

function node(tag,className,text){
  const element=document.createElement(tag);
  if(className)element.className=className;
  if(text!==undefined)element.textContent=text;
  return element;
}
function say(text,kind='info'){
  const message=el('message');
  message.textContent=text;
  message.dataset.kind=kind;
  message.hidden=!text;
}
async function getJson(path){
  const response=await fetch(path,{method:'GET',cache:'no-store',headers:{Accept:'application/json'}});
  if(!response.ok){
    const error=new Error('HTTP '+response.status);
    error.status=response.status;
    throw error;
  }
  return response.json();
}
function explain(error){
  if(error.status===401)return 'Kein Zugriff: Die Mediengalerie ist nur aus dem Heimnetz erreichbar (https://rpi5.fritz.box:4443).';
  if(error.status===404)return 'Die Medien-API ist auf diesem Backend nicht aktiviert (SKYHUB_MEDIA_ENABLED=true).';
  if(error.status===503)return 'Der MinIO-Speicher ist gerade nicht erreichbar. Bitte später erneut versuchen.';
  return 'Medienbestand konnte nicht geladen werden ('+(error.message||'Fehler')+').';
}

// ---------- URL state (#b=bucket&p=prefix&q=...) so Back/Forward and links work ----------
function readHash(){
  const params=new URLSearchParams(location.hash.slice(1));
  return {bucket:params.get('b'),prefix:params.get('p')||'',mode:params.get('v')==='all'?'all':'folders'};
}
function writeHash(replace=false){
  const params=new URLSearchParams();
  if(state.bucket)params.set('b',state.bucket);
  if(state.prefix)params.set('p',state.prefix);
  if(state.mode==='all')params.set('v','all');
  const hash='#'+params.toString();
  if(hash===location.hash)return;
  if(replace)history.replaceState(null,'',hash);else history.pushState(null,'',hash);
}

// ---------- overview ----------
function renderStats(){
  const total={objects:0,bytes:0,image:0,video:0,tiff:0,other:0};
  for(const b of state.summary){
    total.objects+=b.objects;total.bytes+=b.bytes;
    for(const k of M.KINDS)total[k]+=b.kinds[k]||0;
  }
  const tiles=[
    ['Dateien',M.number(total.objects)],['Speicher',M.size(total.bytes)],
    ['Fotos',M.number(total.image)],['Videos',M.number(total.video)],
    ['TIFF',M.number(total.tiff)],['Sonstige',M.number(total.other)]
  ];
  el('stats').replaceChildren(...tiles.map(([label,value])=>{
    const li=node('li','stat');
    li.append(node('strong',null,value),node('span',null,label));
    return li;
  }));
}
function renderBuckets(){
  el('buckets').replaceChildren(...state.summary.map(b=>{
    const button=node('button','bucket');
    button.type='button';
    button.setAttribute('aria-pressed',String(b.bucket===state.bucket));
    button.append(node('strong',null,b.bucket),
      node('span',null,M.number(b.objects)+' Dateien · '+M.size(b.bytes)));
    button.disabled=!b.objects;
    button.addEventListener('click',()=>selectBucket(b.bucket,'',true));
    return button;
  }));
}
async function loadSummary(){
  const data=await getJson('/api/media/summary');
  state.summary=Array.isArray(data.buckets)?data.buckets:[];
  renderStats();
}

// ---------- bucket content ----------
async function selectBucket(bucket,prefix='',push=false,force=false){
  const ticket=++state.loading;
  state.bucket=bucket;state.prefix=prefix;
  renderBuckets();
  if(push)writeHash();
  let items=force?null:state.cache.get(bucket);
  if(!items){
    say('Lade vollständigen Bestand von „'+bucket+'“ …');
    el('files').replaceChildren();el('folders').replaceChildren();
    try{
      const data=await getJson('/api/media/index?'+new URLSearchParams({bucket}));
      items=M.normalizeAll(data.items);
      state.cache.set(bucket,items);
    }catch(error){
      if(ticket===state.loading)say(explain(error),'error');
      return;
    }
  }
  if(ticket!==state.loading)return;
  state.items=items;
  say('');
  render();
}

function scopeItems(){return M.within(state.items,state.prefix);}
function flatMode(){return state.mode==='all'||Boolean(state.query.trim());}

function renderTypes(scope){
  const c=M.counts(scope);
  el('types').replaceChildren(...['all',...M.KINDS].map(type=>{
    const button=node('button','chip');
    button.type='button';
    button.setAttribute('aria-pressed',String(state.type===type));
    button.append(node('span',null,M.KIND_LABELS[type]),node('small',null,M.number(c[type])));
    button.disabled=type!=='all'&&!c[type];
    button.addEventListener('click',()=>{state.type=type;render();});
    return button;
  }));
}
function renderCrumbs(){
  const nav=el('crumbs');
  const root=node('button','crumb',state.bucket||'—');
  root.type='button';
  root.addEventListener('click',()=>openFolder(''));
  const parts=[root];
  for(const crumb of M.crumbs(state.prefix)){
    parts.push(node('span','crumb-sep','/'));
    const button=node('button','crumb',crumb.name);
    button.type='button';
    button.addEventListener('click',()=>openFolder(crumb.prefix));
    parts.push(button);
  }
  if(parts.length>1)parts[parts.length-1].setAttribute('aria-current','location');
  nav.replaceChildren(...parts);
}
function openFolder(prefix){
  state.prefix=prefix;
  writeHash();
  render();
  el('crumbs').scrollIntoView({block:'nearest'});
}

function thumbFor(item,{eager=false}={}){
  const figure=node('div','thumb thumb-'+item.kind);
  const icon=()=>{
    figure.replaceChildren(node('span','thumb-icon',ICONS[item.kind]),
      node('span','thumb-ext',(item.ext||'datei').toUpperCase()));
  };
  if(item.kind==='image'){
    const img=document.createElement('img');
    img.alt='';img.decoding='async';
    if(!eager)img.loading='lazy';
    const direct=M.canPreviewDirectly(item);
    let fellBack=false;
    img.addEventListener('error',()=>{
      if(!fellBack&&direct&&item.ext.startsWith('jp')){fellBack=true;img.src=M.fileUrl(state.bucket,item.key);return;}
      icon();
    });
    if(item.ext==='jpg'||item.ext==='jpeg')img.src=M.thumbUrl(state.bucket,item.key);
    else if(direct)img.src=M.fileUrl(state.bucket,item.key);
    else{icon();return figure;}
    figure.append(img);
  }else if(item.kind==='video'){
    const video=document.createElement('video');
    video.muted=true;video.preload='metadata';video.playsInline=true;
    video.src=M.fileUrl(state.bucket,item.key)+'#t=1';
    video.addEventListener('error',icon);
    figure.append(video,node('span','play-badge','▶'));
  }else{
    icon();
  }
  return figure;
}
function fileCard(item,index){
  const li=node('li');
  const button=node('button','card');
  button.type='button';
  button.title=item.key;
  button.addEventListener('click',()=>openViewer(index));
  const badges=node('div','badges');
  badges.append(node('span','badge badge-'+item.kind,(item.ext||'?').toUpperCase()));
  if(item.lens)badges.append(node('span','badge',item.lens));
  const thumb=thumbFor(item);
  thumb.append(badges);
  const caption=node('div','caption');
  caption.append(node('strong',null,item.name),
    node('small',null,M.size(item.size)+' · '+M.date(item.time)));
  button.append(thumb,caption);
  li.append(button);
  return li;
}
function folderCard(entry){
  const li=node('li');
  const button=node('button','folder');
  button.type='button';
  button.title=entry.prefix;
  button.addEventListener('click',()=>openFolder(entry.prefix));
  const cover=node('div','folder-cover');
  if(entry.cover){
    const img=document.createElement('img');
    img.alt='';img.loading='lazy';img.decoding='async';
    img.src=M.thumbUrl(state.bucket,entry.cover.key);
    img.addEventListener('error',()=>img.remove());
    cover.append(img);
  }
  cover.append(node('span','folder-icon','📁'));
  const text=node('div','caption');
  const parts=[M.number(entry.count)+' Dateien'];
  if(entry.images)parts.push(M.number(entry.images)+' Fotos');
  if(entry.videos)parts.push(M.number(entry.videos)+' Videos');
  text.append(node('strong',null,entry.name),
    node('small',null,parts.join(' · ')+' · '+M.size(entry.bytes)));
  button.append(cover,text);
  li.append(button);
  return li;
}

function render(){
  if(!state.bucket)return;
  const scope=scopeItems();
  renderTypes(scope);
  renderCrumbs();
  el('view-folders').setAttribute('aria-pressed',String(state.mode==='folders'));
  el('view-all').setAttribute('aria-pressed',String(state.mode==='all'));
  let folders=[],files;
  if(flatMode()){
    files=M.filter(scope,{query:state.query,type:state.type});
  }else{
    const view=M.folder(state.items,state.prefix);
    folders=view.folders;
    files=M.filter(view.files,{type:state.type});
  }
  state.list=M.sort(files,state.sort);
  el('folders').replaceChildren(...folders.map(folderCard));
  el('folders').hidden=!folders.length;
  el('files').replaceChildren();
  state.shown=0;
  showMore();
  const bytes=state.list.reduce((sum,item)=>sum+item.size,0);
  const parts=[];
  if(folders.length)parts.push(M.number(folders.length)+' Ordner');
  parts.push(M.number(state.list.length)+' Dateien ('+M.size(bytes)+')');
  if(flatMode()&&state.prefix)parts.push('inkl. Unterordner');
  if(state.query.trim())parts.push('Suche: „'+state.query.trim()+'“');
  el('summary').textContent=parts.join(' · ');
  if(!folders.length&&!state.list.length){
    el('files').append(node('li','empty',state.items.length?
      'Keine Dateien für diese Auswahl.':'Dieser Speicherbereich ist leer.'));
  }
}
function showMore(){
  const next=state.list.slice(state.shown,state.shown+BATCH);
  const start=state.shown;
  el('files').append(...next.map((item,i)=>fileCard(item,start+i)));
  state.shown+=next.length;
  const rest=state.list.length-state.shown;
  el('more').hidden=rest<=0;
  el('more').textContent='Weitere '+M.number(Math.min(rest,BATCH))+' anzeigen (noch '+M.number(rest)+')';
}

// ---------- viewer ----------
function openViewer(index){
  const dialog=el('viewer');
  state.viewerIndex=index;
  showInViewer();
  if(!dialog.open)dialog.showModal();
}
function closeViewer(){
  const stage=el('viewer-stage');
  for(const media of stage.querySelectorAll('video'))media.pause();
  stage.replaceChildren();
  state.viewerIndex=-1;
}
function metaRow(list,label,value){
  if(!value)return;
  list.append(node('dt',null,label),node('dd',null,value));
}
async function textPreview(stage,item){
  const pre=node('pre','text-preview','Lade Inhalt …');
  stage.replaceChildren(pre);
  try{
    const response=await fetch(M.fileUrl(state.bucket,item.key),{cache:'no-store'});
    if(!response.ok)throw new Error('HTTP '+response.status);
    let text=await response.text();
    if(item.ext==='json'||item.ext==='geojson'){
      try{text=JSON.stringify(JSON.parse(text),null,2);}catch(_){}
    }
    pre.textContent=text;
  }catch(error){pre.textContent='Inhalt konnte nicht geladen werden ('+error.message+').';}
}
function showInViewer(){
  const item=state.list[state.viewerIndex];
  if(!item)return;
  const stage=el('viewer-stage');
  for(const media of stage.querySelectorAll('video'))media.pause();
  el('viewer-title').textContent=item.name;
  el('viewer-position').textContent=M.number(state.viewerIndex+1)+' / '+M.number(state.list.length);
  el('viewer-open').href=M.fileUrl(state.bucket,item.key);
  el('viewer-download').href=M.fileUrl(state.bucket,item.key,{download:true});
  el('viewer-download').setAttribute('download',item.name);
  el('viewer-prev').disabled=state.viewerIndex<=0;
  el('viewer-next').disabled=state.viewerIndex>=state.list.length-1;
  if(item.kind==='image'){
    const wrap=node('div','image-wrap');
    const img=document.createElement('img');
    img.alt=item.name;
    if(item.ext==='jpg'||item.ext==='jpeg'){
      wrap.style.backgroundImage='url("'+M.thumbUrl(state.bucket,item.key)+'")';
    }
    wrap.classList.add('loading');
    img.addEventListener('load',()=>{wrap.classList.remove('loading');wrap.style.backgroundImage='';});
    img.addEventListener('error',()=>{wrap.classList.remove('loading');
      wrap.replaceChildren(node('p','no-preview','Bild konnte nicht geladen werden.'));});
    img.src=M.fileUrl(state.bucket,item.key);
    wrap.append(img);
    stage.replaceChildren(wrap);
  }else if(item.kind==='video'){
    const video=document.createElement('video');
    video.controls=true;video.autoplay=true;video.playsInline=true;video.preload='metadata';
    video.src=M.fileUrl(state.bucket,item.key);
    stage.replaceChildren(video);
  }else if(TEXT_EXT.has(item.ext)&&item.size<=TEXT_PREVIEW_LIMIT){
    textPreview(stage,item);
  }else{
    const box=node('div','no-preview');
    box.append(node('span','thumb-icon',ICONS[item.kind]),
      node('strong',null,(item.ext||'Datei').toUpperCase()+' · '+M.size(item.size)),
      node('p',null,item.kind==='tiff'?
        'TIFF-/Multispektralbilder kann der Browser nicht direkt anzeigen. Zum Ansehen bitte herunterladen (z. B. QGIS, DJI Terra).':
        'Für diesen Dateityp gibt es keine Browser-Vorschau. Bitte herunterladen.'));
    stage.replaceChildren(box);
  }
  const meta=el('viewer-meta');
  meta.replaceChildren();
  metaRow(meta,'Speicher',state.bucket);
  metaRow(meta,'Pfad',item.key);
  metaRow(meta,'Größe',M.size(item.size)+' ('+M.number(item.size)+' Bytes)');
  metaRow(meta,'Aufnahme',item.captured?M.date(item.captured):'');
  metaRow(meta,'Hochgeladen',item.modified?M.date(item.modified):'');
  metaRow(meta,'Kamera',item.lens||'');
}
function step(delta){
  const next=state.viewerIndex+delta;
  if(next<0||next>=state.list.length)return;
  state.viewerIndex=next;
  // Keep the grid in step so closing the viewer lands near the current file.
  while(state.shown<=next&&state.shown<state.list.length)showMore();
  showInViewer();
}

// ---------- wiring ----------
let searchTimer=null;
function start(){
  el('search').addEventListener('input',()=>{
    clearTimeout(searchTimer);
    searchTimer=setTimeout(()=>{state.query=el('search').value;render();},180);
  });
  el('sort').addEventListener('change',()=>{state.sort=el('sort').value;render();});
  el('view-folders').addEventListener('click',()=>{state.mode='folders';writeHash();render();});
  el('view-all').addEventListener('click',()=>{state.mode='all';writeHash();render();});
  el('more').addEventListener('click',showMore);
  el('refresh').addEventListener('click',async()=>{
    state.cache.clear();
    try{await loadSummary();renderBuckets();}catch(error){say(explain(error),'error');return;}
    if(state.bucket)selectBucket(state.bucket,state.prefix,false,true);
  });
  if('IntersectionObserver' in window){
    new IntersectionObserver(entries=>{
      if(entries.some(e=>e.isIntersecting)&&state.shown<state.list.length)showMore();
    },{rootMargin:'800px'}).observe(el('sentinel'));
  }
  const dialog=el('viewer');
  el('viewer-close').addEventListener('click',()=>dialog.close());
  el('viewer-prev').addEventListener('click',()=>step(-1));
  el('viewer-next').addEventListener('click',()=>step(1));
  dialog.addEventListener('close',closeViewer);
  dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close();});
  dialog.addEventListener('keydown',event=>{
    if(event.key==='ArrowLeft'){event.preventDefault();step(-1);}
    if(event.key==='ArrowRight'){event.preventDefault();step(1);}
  });
  window.addEventListener('popstate',()=>{
    const wanted=readHash();
    state.mode=wanted.mode;
    if(wanted.bucket&&wanted.bucket!==state.bucket)selectBucket(wanted.bucket,wanted.prefix);
    else{state.prefix=wanted.prefix;render();}
  });
  init();
}
async function init(){
  try{
    await loadSummary();
  }catch(error){say(explain(error),'error');return;}
  if(!state.summary.length){say('Kein Speicherbereich vorhanden.','error');return;}
  const wanted=readHash();
  state.mode=wanted.mode;
  const known=state.summary.find(b=>b.bucket===wanted.bucket);
  const fallback=state.summary.find(b=>b.bucket==='dji-cloud'&&b.objects)||
    state.summary.slice().sort((a,b)=>b.objects-a.objects)[0];
  const bucket=known?known.bucket:fallback.bucket;
  await selectBucket(bucket,known?wanted.prefix:'',false);
  writeHash(true);
}
window.addEventListener('DOMContentLoaded',start);
})();
