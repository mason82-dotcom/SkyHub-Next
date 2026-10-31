// SkyHub thermal module: list, render, measure and evaluate radiometric DJI R-JPEGs (home LAN, no login).
(function(){
'use strict';
const T=window.SkyhubThermal;
const el=id=>document.getElementById(id);
const state={items:[],current:null,frame:null,temps:null,width:640,height:512,tool:'view',
  measurements:[],drag:null,series:[],seriesKey:null};
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
async function getJson(url){
  const r=await fetch(url,{cache:'no-store'});
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
function params(){
  const epsFile=state.frame?.emissivity??0.95;
  const eps=Number(el('eps').value)||epsFile;
  return {epsFile,eps,reflected:Number(el('reflected').value)||20};
}
function recompute(){
  if(!state.frame)return;
  state.temps=T.temperatures(state.frame.raw,params());
  const s=T.regionStats(state.temps,state.width,state.height);
  state.whole=s;
  if(el('auto-range').checked){
    el('range-min').value=s.p1.toFixed(1);el('range-max').value=s.p99.toFixed(1);
  }
  draw();renderStats();renderMeasurements();
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
    ['Emissionsgrad',p.eps.toLocaleString('de-DE')+(Math.abs(p.eps-p.epsFile)>1e-9?' (Datei: '+p.epsFile+', korrigiert)':' (aus Datei)')]
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
    ['Berechnung',meta.estimate]
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
  state.current=item;
  renderList();
  say('Lade Wärmebild '+item.name+' …');
  try{
    const [meta,raw]=await Promise.all([
      getJson('/api/thermal/meta?'+q(item.bucket,item.key)),
      fetch('/api/thermal/raw?'+q(item.bucket,item.key),{cache:'no-store'}).then(r=>{
        if(!r.ok)throw Object.assign(new Error('HTTP '+r.status),{status:r.status});return r.arrayBuffer();})
    ]);
    if(state.current!==item)return;
    state.width=meta.width;state.height=meta.height;
    state.frame={raw:new Uint16Array(raw),emissivity:meta.emissivity??0.95};
    el('eps').value=String(state.frame.emissivity);
    if(!store.has(item.key))store.set(item.key,[]);
    state.measurements=store.get(item.key);
    renderMeta(meta);
    const visual=el('visual');
    if(item.visualKey){
      visual.src='/api/media/file?'+q(item.bucket,item.visualKey);
      el('visual-caption').textContent='Foto derselben Aufnahme';
    }else{visual.removeAttribute('src');el('visual-caption').textContent='Kein Foto zu diesem Wärmebild gefunden';}
    el('visual-figure').hidden=!el('show-visual').checked;
    recompute();
    say('');
    history.replaceState(null,'','#'+q(item.bucket,item.key));
  }catch(error){
    say(error.status===422?'Diese Datei enthält keine radiometrischen Wärmedaten.':
      'Wärmebild konnte nicht geladen werden ('+error.message+').','error');
  }
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
const base=()=>state.current.name.replace(/\.[^.]+$/,'');
function exportCsv(){
  const p=params(),s=state.whole;
  const rows=[['Datei',state.current.name],['Emissionsgrad',p.eps],['Reflektierte Temperatur °C',p.reflected],
    ['Hinweis','Schätzung aus Rohdaten (raw/64-273,15), keine DJI-Kalibrierung'],[],
    ['Nr','Art','x0','y0','x1','y1','Pixel','Min °C','Mittel °C','Median °C','Max °C'],
    ['Bild','gesamt',0,0,state.width-1,state.height-1,s.pixels,s.min,s.mean,s.median,s.max]];
  state.measurements.forEach((m,i)=>{const t=m.stats;
    rows.push([i+1,m.type==='spot'?'Punkt':'Bereich',t.x0,t.y0,t.x1,t.y1,t.pixels,t.min,t.mean,t.median,t.max]);});
  download(base()+'_messungen.csv',new Blob([T.csv(rows)],{type:'text/csv;charset=utf-8'}));
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
  const results=new Array(items.length);let done=0;
  el('series-run').disabled=true;el('series-csv').disabled=true;
  const worker=async()=>{
    for(let i;(i=results.findIndex((r,k)=>r===undefined&&!items[k].started))!==-1;){
      items[i].started=true;
      try{results[i]={item:items[i],meta:await getJson('/api/thermal/meta?'+q(items[i].bucket,items[i].key))};}
      catch(e){results[i]={item:items[i],error:e.message};}
      done++;el('series-status').textContent=done+' / '+items.length+' ausgewertet';
    }
  };
  await Promise.all([worker(),worker(),worker()]);
  items.forEach(i=>delete i.started);
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
  const rows=[['Zeit','Datei','Min °C','Median °C','Mittel °C','Max °C','Hotspot x','Hotspot y','Entfernung m','Neigung °']];
  for(const r of state.series){
    if(!r.meta){rows.push([timeLabel(r.item),r.item.name,'Fehler']);continue;}
    const s=r.meta.stats,m=r.meta.meta||{};
    rows.push([timeLabel(r.item),r.item.name,s.min,s.median,s.mean,s.max,s.hotspot.x,s.hotspot.y,m.lrfDistance??'',m.gimbalPitch??'']);
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
  for(const name of T.PALETTES){const o=node('option',null,T.PALETTE_LABELS[name]);o.value=name;el('palette').append(o);}
  for(const id of ['palette','iso-mode','iso-t1','iso-t2'])el(id).addEventListener('input',()=>state.temps&&draw());
  for(const id of ['range-min','range-max'])el(id).addEventListener('input',()=>{el('auto-range').checked=false;state.temps&&draw();});
  el('auto-range').addEventListener('change',()=>state.temps&&recompute());
  for(const id of ['eps','reflected'])el(id).addEventListener('change',()=>state.temps&&recompute());
  el('show-spots').addEventListener('change',()=>state.temps&&draw());
  el('show-visual').addEventListener('change',()=>{el('visual-figure').hidden=!el('show-visual').checked;});
  for(const b of document.querySelectorAll('[data-tool]'))b.addEventListener('click',()=>{
    state.tool=b.dataset.tool;
    for(const o of document.querySelectorAll('[data-tool]'))o.setAttribute('aria-pressed',String(o===b));
  });
  el('clear-measurements').addEventListener('click',()=>{state.measurements.length=0;renderMeasurements();state.temps&&draw();});
  el('export-png').addEventListener('click',()=>state.temps&&el('thermal').toBlob(b=>download(base()+'_'+el('palette').value+'.png',b)));
  el('export-csv').addEventListener('click',()=>state.temps&&exportCsv());
  el('export-matrix').addEventListener('click',()=>state.temps&&download(base()+'_temperaturen.csv',
    new Blob([T.matrixCsv(state.temps,state.width,state.height)],{type:'text/csv;charset=utf-8'})));
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
