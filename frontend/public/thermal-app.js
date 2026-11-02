// SkyHub thermal module: list, render, measure and evaluate radiometric DJI R-JPEGs (home LAN, no login).
(function(){
'use strict';
const T=window.SkyhubThermal;
const el=id=>document.getElementById(id);
const state={items:[],current:null,frame:null,temps:null,width:640,height:512,tool:'view',
  measurements:[],drag:null,series:[],seriesKey:null,ready:false,loadTicket:0,controller:null};
const store=new Map(); // per-image measurements while the page is open

function node(tag,className,text){
  const e=document.createElement(tag);
  if(className)e.className=className;
  if(text!==undefined)e.textContent=text;
  return e;
}
function say(text,kind='info'){
  const m=el('message');m.textContent=text;m.dataset.kind=kind;m.hidden=!text;
}
const q=(bucket,key)=>new URLSearchParams({bucket,key}).toString();
async function getJson(url,signal){
  const r=await fetch(url,{cache:'no-store',signal:signal||AbortSignal.timeout(20000)});
  if(!r.ok){const e=new Error('HTTP '+r.status);e.status=r.status;throw e;}
  return r.json();
}
function dayLabel(day){
  return day?day.slice(6,8)+'.'+day.slice(4,6)+'.'+day.slice(0,4):'ohne Datum';
}
function timeLabel(item){
  return item.time?item.time.slice(0,2)+':'+item.time.slice(2,4)+':'+item.time.slice(4,6):'';
}
function seriesId(item){return item.bucket+'|'+item.folder+'|'+(item.day||'');}

// ---------- list ----------
function renderList(){
  const needle=el('list-search').value.trim().toLowerCase();
  const items=state.items.filter(i=>!needle||(i.name+' '+i.key).toLowerCase().includes(needle));
  el('list-count').textContent=items.length+' von '+state.items.length+' Wärmebildern';
  const list=el('list');list.replaceChildren();
  let lastDay=null;
  for(const item of items){
    if(item.day!==lastDay){list.append(node('p','list-day',dayLabel(item.day)));lastDay=item.day;}
    const b=node('button','list-item');b.type='button';b.title=item.key;
    b.setAttribute('aria-current',String(state.current===item));
    const img=document.createElement('img');img.alt='';img.loading='lazy';
    img.src='/api/media/thumb?'+q(item.bucket,item.key);
    img.addEventListener('error',()=>img.removeAttribute('src'));
    const text=node('span');
    text.append(node('strong',null,item.name),node('small',null,timeLabel(item)+' · '+item.bucket));
    b.append(img,text);
    b.addEventListener('click',()=>open(item));
    list.append(b);
  }
}

// ---------- image ----------
function setReady(ready){
  state.ready=ready;
  for(const id of ['export-png','export-csv','export-matrix'])el(id).disabled=!ready;
}
function params(){
  const epsFile=state.frame?.emissivity??0.95;
  const eps=el('eps').value.trim()===''?NaN:Number(el('eps').value);
  const reflected=el('reflected').value.trim()===''?NaN:Number(el('reflected').value);
  const validEps=Number.isFinite(eps)&&eps>=0.1&&eps<=1;
  const validRef=Number.isFinite(reflected)&&reflected>=-T.KELVIN;
  el('eps').setAttribute('aria-invalid',String(!validEps));
  el('reflected').setAttribute('aria-invalid',String(!validRef));
  if(!validEps||!validRef)throw new RangeError('Emissionsgrad muss 0,1 bis 1 sein; reflektierte Temperatur mindestens −273,15 °C.');
  return {epsFile,eps,reflected,emissivityAssumed:state.frame?.emissivity==null};
}
function recompute(){
  if(!state.frame)return;
  setReady(false);
  try{
    const p=params();
    state.temps=T.temperatures(state.frame.raw,p);
    state.whole=T.regionStats(state.temps,state.width,state.height);
    if(!state.whole||state.whole.pixels!==state.width*state.height)throw new Error('Ungültige Temperaturwerte');
    if(el('auto-range').checked){
      el('range-min').value=state.whole.p1.toFixed(1);el('range-max').value=state.whole.p99.toFixed(1);
    }
    renderMeasurements();draw();renderStats();
    state.appliedParams={...p};
    setReady(true);say('');
  }catch(error){
    state.temps=null;state.whole=null;
    el('thermal').getContext('2d').clearRect(0,0,state.width,state.height);
    el('measurements').replaceChildren();el('stats').replaceChildren();el('legend').replaceChildren();
    el('histogram').getContext('2d').clearRect(0,0,480,110);
    el('readout').textContent='Keine gültige Auswertung';
    say(error.message,'error');
  }
}
function range(){
  let min=Number(el('range-min').value),max=Number(el('range-max').value);
  if(!Number.isFinite(min)||!Number.isFinite(max)||min===max){min=state.whole.min;max=state.whole.max;}
  return min<max?{min,max}:{min:max,max:min};
}
function isotherm(){
  const mode=el('iso-mode').value;
  if(!mode)return null;
  const t1=Number(el('iso-t1').value),t2=Number(el('iso-t2').value);
  if(!Number.isFinite(t1))return null;
  return {mode,t1,t2:Number.isFinite(t2)?t2:t1};
}
function draw(){
  const canvas=el('thermal'),ctx=canvas.getContext('2d');
  canvas.width=state.width;canvas.height=state.height;
  const {min,max}=range();
  const pixels=T.render(state.temps,{min,max,palette:el('palette').value,isotherm:isotherm()});
  ctx.putImageData(new ImageData(pixels,state.width,state.height),0,0);
  const marker=(x,y,color,label)=>{
    ctx.strokeStyle='#000';ctx.lineWidth=4;
    ctx.beginPath();ctx.moveTo(x-9,y);ctx.lineTo(x+9,y);ctx.moveTo(x,y-9);ctx.lineTo(x,y+9);ctx.stroke();
    ctx.strokeStyle=color;ctx.lineWidth=2;
    ctx.beginPath();ctx.moveTo(x-9,y);ctx.lineTo(x+9,y);ctx.moveTo(x,y-9);ctx.lineTo(x,y+9);ctx.stroke();
    if(label){ctx.font='bold 14px system-ui';ctx.lineWidth=3;ctx.strokeStyle='#000';
      ctx.strokeText(label,x+11,y-6);ctx.fillStyle=color;ctx.fillText(label,x+11,y-6);}
  };
  if(el('show-spots').checked&&state.whole){
    marker(state.whole.hot.x,state.whole.hot.y,'#ff3b30','H '+T.format(state.whole.max));
    marker(state.whole.cold.x,state.whole.cold.y,'#4fc3ff','C '+T.format(state.whole.min));
  }
  state.measurements.forEach((m,i)=>{
    const s=m.stats;
    if(m.type==='spot')marker(m.x,m.y,'#ffffff',(i+1)+': '+T.format(s.mean));
    else{
      ctx.lineWidth=3;ctx.strokeStyle='#000';ctx.strokeRect(s.x0,s.y0,s.x1-s.x0+1,s.y1-s.y0+1);
      ctx.lineWidth=1.5;ctx.strokeStyle='#fff';ctx.strokeRect(s.x0,s.y0,s.x1-s.x0+1,s.y1-s.y0+1);
      ctx.font='bold 13px system-ui';ctx.fillStyle='#fff';ctx.strokeStyle='#000';ctx.lineWidth=3;
      const label=(i+1)+': max '+T.format(s.max);
      ctx.strokeText(label,s.x0+3,s.y0+15);ctx.fillText(label,s.x0+3,s.y0+15);
    }
  });
  if(state.drag){
    const d=state.drag;ctx.setLineDash([5,4]);ctx.strokeStyle='#fff';ctx.lineWidth=1.5;
    ctx.strokeRect(Math.min(d.x0,d.x1),Math.min(d.y0,d.y1),Math.abs(d.x1-d.x0),Math.abs(d.y1-d.y0));
    ctx.setLineDash([]);
  }
  drawHistogram(min,max);
}
function drawHistogram(min,max){
  const c=el('histogram'),ctx=c.getContext('2d'),bins=T.histogram(state.temps,min,max,96);
  const peak=Math.max(...bins,1),table=T.lut(el('palette').value);
  ctx.clearRect(0,0,c.width,c.height);
  const w=c.width/bins.length;
  bins.forEach((n,i)=>{
    const idx=Math.round(i/(bins.length-1)*255);
    ctx.fillStyle='rgb('+table[idx*3]+','+table[idx*3+1]+','+table[idx*3+2]+')';
    const h=Math.max(1,n/peak*(c.height-4));
    ctx.fillRect(i*w,c.height-h,Math.max(1,w-0.5),h);
  });
  const stops=[0,0.25,0.5,0.75,1].map(f=>{const i=Math.round(f*255);
    return 'rgb('+table[i*3]+','+table[i*3+1]+','+table[i*3+2]+') '+(f*100)+'%';});
  const legend=el('legend');
  legend.style.background='linear-gradient(90deg,'+stops.join(',')+')';
  legend.replaceChildren(node('span',null,T.format(min)),node('span',null,T.format(max)));
}
function facts(list,rows){
  list.replaceChildren();
  for(const [k,v] of rows){if(v===null||v===undefined||v==='')continue;list.append(node('dt',null,k),node('dd',null,v));}
}
function renderStats(){
  const s=state.whole,p=params();
  facts(el('stats'),[
    ['Minimum',T.format(s.min)+' ('+s.cold.x+'/'+s.cold.y+')'],['Median',T.format(s.median)],
    ['Mittelwert',T.format(s.mean)],['Maximum',T.format(s.max)+' ('+s.hot.x+'/'+s.hot.y+')'],
    ['Spanne',T.format(s.max-s.min)],
    ['Emissionsgrad',p.eps.toLocaleString('de-DE')+(p.emissivityAssumed?' (Dateiwert fehlt; Ausgangswert 0,95 angenommen)':
      Math.abs(p.eps-p.epsFile)>1e-9?' (Datei: '+p.epsFile+', korrigiert)':' (aus Datei)')],
    ['Korrektur',Math.abs(p.eps-p.epsFile)>1e-9?'Gesamtstrahlungs-Näherung':'Keine Umrechnung; reflektierte Temperatur wirkt nur bei geändertem Emissionsgrad']
  ]);
}
function renderMeta(meta){
  const m=meta.meta||{};
  facts(el('meta'),[
    ['Datei',state.current.name],['Gespeichert als',state.current.name!==state.current.key.split('/').pop()?state.current.key.split('/').pop():''],
    ['Speicher',state.current.bucket],['Aufnahme',m.utcAtExposure?m.utcAtExposure+' UTC':''],
    ['Kamera / Drohne',m.model||''],['Auflösung Rohdaten',meta.width+' × '+meta.height],
    ['Entfernung (Laser)',m.lrfDistance!==null&&m.lrfDistance!==undefined?m.lrfDistance.toLocaleString('de-DE')+' m':''],
    ['Kameraneigung',m.gimbalPitch!==null&&m.gimbalPitch!==undefined?m.gimbalPitch+'°':''],
    ['Richtung',m.gimbalYaw!==null&&m.gimbalYaw!==undefined?m.gimbalYaw+'°':''],
    ['Höhe über Start',m.relativeAltitude!==null&&m.relativeAltitude!==undefined?m.relativeAltitude+' m':''],
    ['Berechnung',meta.estimate],['Formatprüfung','APP3-Layout erkannt; Kamerakompatibilität nicht verifiziert'],
    ['Quellversion (SHA-256)',meta.version]
  ]);
}
function renderMeasurements(){
  const body=el('measurements');body.replaceChildren();
  state.measurements.forEach((m,i)=>{
    m.stats=m.type==='spot'?T.regionStats(state.temps,state.width,state.height,{x0:m.x,y0:m.y,x1:m.x,y1:m.y}):
      T.regionStats(state.temps,state.width,state.height,m.rect);
    const s=m.stats,tr=node('tr');
    const del=node('button','secondary','✕');del.type='button';del.setAttribute('aria-label','Messung '+(i+1)+' löschen');
    del.addEventListener('click',()=>{state.measurements.splice(i,1);renderMeasurements();draw();});
    const td=node('td');td.append(del);
    tr.append(node('td',null,String(i+1)),node('td',null,m.type==='spot'?'Punkt':'Bereich'),
      node('td',null,m.type==='spot'?m.x+'/'+m.y:s.x0+'/'+s.y0+' – '+s.x1+'/'+s.y1),
      node('td',null,T.format(s.min)),node('td',null,T.format(s.mean)),node('td',null,T.format(s.max)),td);
    body.append(tr);
  });
  if(!state.measurements.length){
    const tr=node('tr'),td=node('td','fine','Noch keine Messungen. Werkzeug „Messpunkt“ oder „Messbereich“ wählen.');
    td.colSpan=7;tr.append(td);body.append(tr);
  }
}
async function open(item){
  const ticket=++state.loadTicket;
  state.controller?.abort();
  const controller=new AbortController();state.controller=controller;
  const timeout=setTimeout(()=>controller.abort(),20000);
  state.current=item;state.frame=null;state.temps=null;state.whole=null;state.drag=null;
  state.measurements=[];state.appliedParams=null;
  setReady(false);
  el('thermal').getContext('2d').clearRect(0,0,el('thermal').width,el('thermal').height);
  el('histogram').getContext('2d').clearRect(0,0,480,110);
  for(const id of ['stats','meta','measurements','legend'])el(id).replaceChildren();
  el('visual').removeAttribute('src');el('visual-caption').textContent='';
  el('readout').textContent='Wärmebild wird geladen …';
  renderList();say('Lade Wärmebild '+item.name+' …');
  try{
    const meta=await getJson('/api/thermal/meta?'+q(item.bucket,item.key),controller.signal);
    if(ticket!==state.loadTicket)return;
    if(!/^[0-9a-f]{64}$/.test(meta.version)||!Number.isSafeInteger(meta.width)||!Number.isSafeInteger(meta.height)||
       ![[320,256],[640,512],[1280,1024]].some(([w,h])=>w===meta.width&&h===meta.height)){
      throw new Error('Ungültige Thermal-Metadaten');
    }
    const r=await fetch('/api/thermal/raw?'+q(item.bucket,item.key)+'&version='+meta.version,
      {cache:'no-store',signal:controller.signal});
    if(!r.ok)throw Object.assign(new Error('HTTP '+r.status),{status:r.status});
    const raw=await r.arrayBuffer();
    if(r.headers.get('X-Thermal-Version')!==meta.version||
       Number(r.headers.get('X-Thermal-Width'))!==meta.width||
       Number(r.headers.get('X-Thermal-Height'))!==meta.height||raw.byteLength!==meta.width*meta.height*2){
      throw new Error('Rohdaten und Metadaten gehören nicht zur selben Bildversion');
    }
    if(ticket!==state.loadTicket)return;
    const values=new Uint16Array(meta.width*meta.height),view=new DataView(raw);
    for(let i=0;i<values.length;i++)values[i]=view.getUint16(i*2,true);
    state.width=meta.width;state.height=meta.height;
    state.frame={raw:values,emissivity:meta.emissivity,meta};
    el('eps').value=String(meta.emissivity??0.95);
    const identity=JSON.stringify([item.bucket,item.key,meta.version]);
    if(!store.has(identity))store.set(identity,[]);
    state.measurements=store.get(identity);
    renderMeta(meta);
    if(item.visualKey){
      el('visual').src='/api/media/file?'+q(item.bucket,item.visualKey);
      el('visual-caption').textContent='Fotokandidat nach Dateiname und Zeit; Zuordnung ungeprüft';
    }else el('visual-caption').textContent=item.visualMatch==='ambiguous'?
      'Mehrdeutige Fotopaarung – kein Foto automatisch gewählt':'Kein passender Fotokandidat gefunden';
    el('visual-figure').hidden=!el('show-visual').checked;
    recompute();
    history.replaceState(null,'','#'+q(item.bucket,item.key));
  }catch(error){
    if(ticket!==state.loadTicket)return;
    state.frame=null;state.temps=null;setReady(false);
    el('readout').textContent='Kein Wärmebild geladen';
    say(error.status===422?'Diese Datei enthält keine unterstützten radiometrischen Wärmedaten.':
      error.status===409?'Bildversion nicht mehr verfügbar. Wärmebild erneut auswählen.':
      error.name==='AbortError'?'Laden abgebrochen oder Zeitlimit erreicht. Wärmebild erneut auswählen.':
      'Wärmebild konnte nicht geladen werden ('+error.message+').','error');
  }finally{clearTimeout(timeout);}
}

// ---------- pointer tools ----------
function pixel(event){
  const c=el('thermal'),r=c.getBoundingClientRect();
  const x=Math.floor((event.clientX-r.left)/r.width*state.width);
  const y=Math.floor((event.clientY-r.top)/r.height*state.height);
  return {x:Math.max(0,Math.min(state.width-1,x)),y:Math.max(0,Math.min(state.height-1,y))};
}
function wireCanvas(){
  const c=el('thermal');
  c.addEventListener('pointermove',e=>{
    if(!state.temps)return;
    const {x,y}=pixel(e);
    el('readout').textContent='x '+x+'  y '+y+'  →  '+T.format(state.temps[y*state.width+x],2);
    if(state.drag){state.drag.x1=x;state.drag.y1=y;draw();}
  });
  c.addEventListener('pointerdown',e=>{
    if(!state.temps||state.tool==='view')return;
    const {x,y}=pixel(e);
    if(state.tool==='spot'){state.measurements.push({type:'spot',x,y});renderMeasurements();draw();}
    else{state.drag={x0:x,y0:y,x1:x,y1:y};c.setPointerCapture(e.pointerId);}
  });
  c.addEventListener('pointerup',()=>{
    const d=state.drag;state.drag=null;
    if(!d)return;
    if(Math.abs(d.x1-d.x0)>=2&&Math.abs(d.y1-d.y0)>=2)state.measurements.push({type:'box',rect:d});
    renderMeasurements();draw();
  });
}

// ---------- export ----------
function download(name,blob){
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;
  document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),2000);
}
const base=()=>state.current.name.replace(/\.[^.]+$/,'')+'_'+state.frame.meta.version.slice(0,12);
function provenance(){
  const p=state.appliedParams,m=state.frame.meta;
  return [['Hinweis',T.ESTIMATE],['Software-/Berechnungsstand',T.CALCULATION],
    ['Datei',state.current.name],['Bucket',state.current.bucket],['Objektschlüssel',state.current.key],
    ['Quellversion SHA-256',m.version],['Quellgröße Byte',m.sourceBytes],
    ['Breite Pixel',state.width],['Höhe Pixel',state.height],['Einheit','°C'],
    ['Emissionsgrad Datei',m.emissivity??'fehlt'],['Emissionsgrad Ausgangswert',p.epsFile],
    ['Ausgangswert angenommen',p.emissivityAssumed?'ja':'nein'],['Emissionsgrad gewählt',p.eps],
    ['Reflektierte Temperatur °C',p.reflected],
    ['Korrektur',Math.abs(p.eps-p.epsFile)>1e-9?'Gesamtstrahlungs-Näherung':'keine; T_refl hat bei gleichem Emissionsgrad keinen Einfluss'],
    ['Kamerakompatibilität','nicht verifiziert']];
}
function exportCsv(){
  if(!state.ready)return;
  const s=state.whole;
  const rows=[...provenance(),[],
    ['Nr','Art','x0','y0','x1','y1','Pixel','Min °C','Mittel °C','Median °C','Max °C'],
    ['Bild','gesamt',0,0,state.width-1,state.height-1,s.pixels,s.min,s.mean,s.median,s.max]];
  state.measurements.forEach((m,i)=>{const t=m.stats;
    rows.push([i+1,m.type==='spot'?'Punkt':'Bereich',t.x0,t.y0,t.x1,t.y1,t.pixels,t.min,t.mean,t.median,t.max]);});
  download(base()+'_messungen.csv',new Blob([T.csv(rows)],{type:'text/csv;charset=utf-8'}));
}
function exportPng(){
  if(!state.ready)return;
  // Freeze both pixels and filename BEFORE the asynchronous encoder can finish.
  const name=base()+'_'+el('palette').value+'.png';
  const canvas=document.createElement('canvas');canvas.width=Math.max(640,state.width);
  const ctx=canvas.getContext('2d');ctx.font='12px system-ui';
  const facts=[...provenance(),['Palette',el('palette').value],['Darstellungsbereich °C',range().min+' bis '+range().max],
    ['Isotherme',JSON.stringify(isotherm())]];
  const lines=[];
  for(const [k,v] of facts){
    let rest=k+': '+v;
    while(rest.length){let n=rest.length;while(n>1&&ctx.measureText(rest.slice(0,n)).width>canvas.width-24)n--;
      lines.push(rest.slice(0,n));rest=rest.slice(n);}
  }
  canvas.height=state.height+24+lines.length*17;
  ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.drawImage(el('thermal'),0,0);
  ctx.font='12px system-ui';ctx.fillStyle='#000';
  lines.forEach((line,i)=>ctx.fillText(line,12,state.height+20+i*17));
  canvas.toBlob(blob=>{if(blob)download(name,blob);});
}

// ---------- series ----------
function seriesOptions(){
  const groups=new Map();
  for(const item of state.items){
    const id=seriesId(item);
    if(!groups.has(id))groups.set(id,{id,items:[],label:dayLabel(item.day)+' · '+(item.folder||'/')+' ('+item.bucket+')'});
    groups.get(id).items.push(item);
  }
  const select=el('series-select');select.replaceChildren();
  for(const g of groups.values()){
    const o=node('option',null,g.label+' – '+g.items.length+' Bilder');o.value=g.id;select.append(o);
  }
  state.groups=groups;
}
async function runSeries(){
  const group=state.groups.get(el('series-select').value);
  if(!group)return;
  const items=group.items.slice().sort((a,b)=>(a.time||'').localeCompare(b.time||''));
  const results=new Array(items.length);let done=0,next=0;
  el('series-run').disabled=true;el('series-csv').disabled=true;
  const worker=async()=>{
    while(next<items.length){
      const i=next++;
      try{results[i]={item:items[i],meta:await getJson('/api/thermal/meta?'+q(items[i].bucket,items[i].key))};}
      catch(e){results[i]={item:items[i],error:e.message};}
      done++;el('series-status').textContent=done+' / '+items.length+' ausgewertet';
    }
  };
  await Promise.all([worker(),worker(),worker()]);
  state.series=results;
  renderSeries();
  el('series-run').disabled=false;el('series-csv').disabled=false;
}
function renderSeries(){
  const body=el('series-table');body.replaceChildren();
  const ok=state.series.filter(r=>r.meta);
  for(const r of state.series){
    const tr=node('tr');
    if(!r.meta){tr.append(node('td',null,timeLabel(r.item)),node('td',null,r.item.name),Object.assign(node('td',null,'Fehler: '+r.error),{colSpan:7}));body.append(tr);continue;}
    const s=r.meta.stats,m=r.meta.meta||{};
    const link=node('button','secondary',r.item.name);link.type='button';
    link.addEventListener('click',()=>{selectTab('image');open(r.item);});
    const nameCell=node('td');nameCell.append(link);
    tr.append(node('td',null,timeLabel(r.item)),nameCell,node('td',null,T.format(s.min)),node('td',null,T.format(s.median)),
      node('td',null,T.format(s.mean)),node('td',null,T.format(s.max)),node('td',null,s.hotspot.x+'/'+s.hotspot.y),
      node('td',null,m.lrfDistance!=null?m.lrfDistance.toLocaleString('de-DE')+' m':'—'),
      node('td',null,m.gimbalPitch!=null?m.gimbalPitch.toLocaleString('de-DE')+'°':'—'));
    body.append(tr);
  }
  // Chart: min / median / max over the series.
  const svg=el('series-chart'),NS='http://www.w3.org/2000/svg';svg.replaceChildren();
  if(!ok.length)return;
  const W=900,H=260,L=48,R=12,Tp=14,B=30;
  const lo=Math.floor(Math.min(...ok.map(r=>r.meta.stats.min))),hi=Math.ceil(Math.max(...ok.map(r=>r.meta.stats.max)));
  const x=i=>L+(ok.length===1?0.5:i/(ok.length-1))*(W-L-R),y=t=>Tp+(1-(t-lo)/((hi-lo)||1))*(H-Tp-B);
  const add=(tag,attrs,text)=>{const n=document.createElementNS(NS,tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,v);if(text!==undefined)n.textContent=text;svg.append(n);return n;};
  for(let t=lo;t<=hi;t+=Math.max(1,Math.round((hi-lo)/5))){
    add('line',{x1:L,x2:W-R,y1:y(t),y2:y(t),stroke:'#284056'});
    add('text',{x:L-6,y:y(t)+4,'text-anchor':'end'},t+' °C');
  }
  const series=[['max','#ff6b5a'],['median','#e9c382'],['min','#53c9e7']];
  for(const [k,color] of series){
    add('polyline',{points:ok.map((r,i)=>x(i)+','+y(r.meta.stats[k])).join(' '),fill:'none',stroke:color,'stroke-width':2.5});
    ok.forEach((r,i)=>add('circle',{cx:x(i),cy:y(r.meta.stats[k]),r:3.5,fill:color}));
  }
  ok.forEach((r,i)=>{if(ok.length<=16||i%Math.ceil(ok.length/16)===0)add('text',{x:x(i),y:H-10,'text-anchor':'middle'},timeLabel(r.item).slice(0,5));});
  series.forEach(([k,color],i)=>add('text',{x:W-R-270+i*90,y:Tp+2,fill:color},k==='max'?'Maximum':k==='min'?'Minimum':'Median'));
}
function seriesCsv(){
  const rows=[['Hinweis',T.ESTIMATE],['Software-/Berechnungsstand',T.CALCULATION],
    ['Berechnung','Unkorrigierte Dateischätzung; Einzelbild-Einstellungen werden nicht angewendet'],[],
    ['Zeit','Datei','Min °C','Median °C','Mittel °C','Max °C','Hotspot x','Hotspot y','Entfernung m','Neigung °','Bucket','Objektschlüssel','Quellversion SHA-256','Emissionsgrad Datei']];
  for(const r of state.series){
    if(!r.meta){rows.push([timeLabel(r.item),r.item.name,'Fehler']);continue;}
    const s=r.meta.stats,m=r.meta.meta||{};
    rows.push([timeLabel(r.item),r.item.name,s.min,s.median,s.mean,s.max,s.hotspot.x,s.hotspot.y,m.lrfDistance??'',m.gimbalPitch??'',
      r.item.bucket,r.item.key,r.meta.version,r.meta.emissivity??'fehlt']);
  }
  download('thermal_serie.csv',new Blob([T.csv(rows)],{type:'text/csv;charset=utf-8'}));
}
function selectTab(name){
  for(const [tab,panel] of [['image','panel-image'],['series','panel-series']]){
    el('tab-'+tab).setAttribute('aria-selected',String(tab===name));el(panel).hidden=tab!==name;
  }
}

// ---------- start ----------
async function start(){
  setReady(false);
  for(const name of T.PALETTES){const o=node('option',null,T.PALETTE_LABELS[name]);o.value=name;el('palette').append(o);}
  for(const id of ['palette','iso-mode','iso-t1','iso-t2'])el(id).addEventListener('input',()=>state.temps&&draw());
  for(const id of ['range-min','range-max'])el(id).addEventListener('input',()=>{el('auto-range').checked=false;state.temps&&draw();});
  el('auto-range').addEventListener('change',()=>state.temps&&recompute());
  for(const id of ['eps','reflected'])el(id).addEventListener('input',()=>state.frame&&recompute());
  el('show-spots').addEventListener('change',()=>state.temps&&draw());
  el('show-visual').addEventListener('change',()=>{el('visual-figure').hidden=!el('show-visual').checked;});
  for(const b of document.querySelectorAll('[data-tool]'))b.addEventListener('click',()=>{
    state.tool=b.dataset.tool;
    for(const o of document.querySelectorAll('[data-tool]'))o.setAttribute('aria-pressed',String(o===b));
  });
  el('clear-measurements').addEventListener('click',()=>{state.measurements.length=0;renderMeasurements();state.temps&&draw();});
  el('export-png').addEventListener('click',exportPng);
  el('export-csv').addEventListener('click',exportCsv);
  el('export-matrix').addEventListener('click',()=>state.ready&&download(base()+'_temperaturen.csv',
    new Blob([T.matrixCsv(state.temps,state.width,state.height,provenance())],{type:'text/csv;charset=utf-8'})));
  el('list-search').addEventListener('input',renderList);
  el('tab-image').addEventListener('click',()=>selectTab('image'));
  el('tab-series').addEventListener('click',()=>selectTab('series'));
  el('series-run').addEventListener('click',runSeries);
  el('series-csv').addEventListener('click',seriesCsv);
  wireCanvas();
  try{
    const data=await getJson('/api/thermal/list');
    state.items=data.items||[];
    renderList();seriesOptions();
    if(!state.items.length){say('Keine Wärmebilder (…_T.JPG) im Speicher gefunden.');return;}
    say('');
    const wanted=new URLSearchParams(location.hash.slice(1));
    const first=state.items.find(i=>i.bucket===wanted.get('bucket')&&i.key===wanted.get('key'))||state.items[0];
    open(first);
  }catch(error){
    say(error.status===401?'Kein Zugriff: Das Thermalmodul ist nur aus dem Heimnetz erreichbar.':
      error.status===404?'Die Medien-API ist auf diesem Backend nicht aktiviert.':
      'Wärmebilder konnten nicht geladen werden ('+error.message+').','error');
  }
}
window.addEventListener('DOMContentLoaded',start);
})();
