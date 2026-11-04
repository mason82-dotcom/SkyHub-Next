'use strict';
// Map elements page (backend/map-element-write.js → /api/map-elements; pushed to Pilot 2 as map_element_*).
(function(){
  const $=id=>document.getElementById(id);
  let mode=null,draft=[],draftLayer=null,elements=[],colors={};
  const map=L.map('memap').setView([49.155,8.6],13);
  L.tileLayer('/tiles/osm/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap-Mitwirkende',referrerPolicy:'strict-origin-when-cross-origin'}).addTo(map);
  if(window.SkyHubGeozones)window.SkyHubGeozones.attach(map);
  const layer=L.layerGroup().addTo(map);
  const say=(t,bad)=>{$('msg').textContent=t;$('msg').className=bad?'bad':'muted';};
  const hint=t=>{$('hint').textContent=t;};
  const latlng=c=>[c[1],c[0]];
  const label={Point:'Punkt',LineString:'Linie',Polygon:'Fläche'};

  async function api(method,path,body){
    const r=await fetch('/api/map-elements'+path,{method,credentials:'same-origin',cache:'no-store',
      headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
    const b=await r.json().catch(()=>({}));
    if(r.status===404&&!path)throw new Error('Kartenelemente sind auf diesem SkyHub nicht eingeschaltet');
    if(!r.ok)throw new Error(b.error||('HTTP '+r.status));
    return b;
  }
  function shape(el){
    const g=el.resource.content.geometry,color=el.resource.content.properties.color||'#2D8CF0';
    if(g.type==='Point')return L.circleMarker(latlng(g.coordinates),{radius:7,color,fillOpacity:.8});
    if(g.type==='LineString')return L.polyline(g.coordinates.map(latlng),{color,weight:3});
    if(g.type==='Polygon')return L.polygon(g.coordinates[0].map(latlng),{color,weight:2,fillOpacity:.2});
    return null;
  }
  function render(){
    layer.clearLayers();
    const list=$('list');list.replaceChildren();
    if(!elements.length){const li=document.createElement('li');li.className='muted';li.textContent='Noch keine Elemente.';list.append(li);}
    for(const el of elements){
      const s=shape(el);if(s)s.bindTooltip(el.name).addTo(layer);
      const li=document.createElement('li');
      const sw=document.createElement('span');sw.className='sw';sw.style.background=el.resource.content.properties.color||'#2D8CF0';
      const nm=document.createElement('span');nm.className='nm';nm.textContent=el.name;
      const sm=document.createElement('small');
      sm.textContent=(label[el.resource.content.geometry.type]||'')+(el.updateTime?' · '+new Date(el.updateTime).toLocaleString('de-DE',{dateStyle:'short',timeStyle:'short'}):'');
      nm.append(sm);
      const show=document.createElement('button');show.type='button';show.className='secondary';show.textContent='Zeigen';
      show.addEventListener('click',()=>{if(!s)return;if(s.getBounds)map.fitBounds(s.getBounds().pad(.3),{maxZoom:18});else map.setView(s.getLatLng(),17);});
      const del=document.createElement('button');del.type='button';del.className='secondary';del.textContent='Löschen';
      del.setAttribute('aria-label',el.name+' löschen');
      del.addEventListener('click',async()=>{
        if(!confirm('„'+el.name+'“ löschen? Es verschwindet auch in Pilot 2.'))return;
        try{await api('DELETE','/'+encodeURIComponent(el.id));say('Gelöscht.');load();}catch(err){say(err.message,true);}
      });
      li.append(sw,nm,show,del);list.append(li);
    }
  }
  async function load(){
    try{
      const b=await api('GET','');
      elements=b.elements||[];
      if(!Object.keys(colors).length){
        colors=b.colors||{};
        $('color').replaceChildren(...Object.entries(colors).map(([hex,name])=>{const o=document.createElement('option');o.value=hex;o.textContent=name;return o;}));
      }
      render();
    }catch(err){$('list').replaceChildren();say(err.message,true);}
  }
  function setMode(m){
    mode=m;draft=[];drawDraft();
    for(const b of document.querySelectorAll('[data-mode]'))b.setAttribute('aria-pressed',String(b.dataset.mode===m));
    $('memap').classList.toggle('drawing',Boolean(m));
    $('cancel').disabled=!m;$('finish').disabled=true;
    hint(m==='Point'?'In die Karte klicken, um den Punkt zu setzen.':m?'Punkte setzen, dann „Fertig“.':'Werkzeug wählen, dann in die Karte klicken.');
  }
  function drawDraft(){
    if(draftLayer){map.removeLayer(draftLayer);draftLayer=null;}
    if(!draft.length)return;
    const color=$('color').value||'#2D8CF0';
    draftLayer=L.layerGroup().addTo(map);
    (mode==='Polygon'&&draft.length>2?L.polygon(draft,{color,dashArray:'6 4'}):L.polyline(draft,{color,dashArray:'6 4'})).addTo(draftLayer);
    for(const p of draft)L.circleMarker(p,{radius:4,color}).addTo(draftLayer);
  }
  async function save(geometry){
    const name=$('name').value.trim()||label[geometry.type];
    try{
      await api('POST','',{name,color:$('color').value,geometry});
      say('„'+name+'“ gespeichert und an Pilot 2 gesendet.');$('name').value='';setMode(null);load();
    }catch(err){say(err.message,true);}
  }
  const round=v=>Math.round(v*1e7)/1e7;
  map.on('click',e=>{
    if(!mode)return;
    const p=[round(e.latlng.lat),round(e.latlng.lng)];
    if(mode==='Point')return save({type:'Point',coordinates:[p[1],p[0]]});
    draft.push(p);drawDraft();
    $('finish').disabled=mode==='LineString'?draft.length<2:draft.length<3;
  });
  $('finish').addEventListener('click',()=>{
    const c=draft.map(p=>[p[1],p[0]]);
    if(mode==='LineString')save({type:'LineString',coordinates:c});
    else if(mode==='Polygon')save({type:'Polygon',coordinates:[[...c,c[0]]]});
  });
  $('cancel').addEventListener('click',()=>setMode(null));
  for(const b of document.querySelectorAll('[data-mode]'))b.addEventListener('click',()=>setMode(mode===b.dataset.mode?null:b.dataset.mode));
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&mode)setMode(null);});
  load();setInterval(()=>{if(!mode)load();},15000);
})();
