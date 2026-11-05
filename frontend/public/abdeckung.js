'use strict';
// Photo coverage page (backend/coverage.js): overlap counts as an image overlay, flown area, largest gaps.
(function(){
  const $=id=>document.getElementById(id);
  const map=L.map('covmap').setView([49.155,8.6],13);
  L.tileLayer('/tiles/osm/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap-Mitwirkende',referrerPolicy:'strict-origin-when-cross-origin'}).addTo(map);
  let layer=null;
  const say=(t,bad)=>{$('status').textContent=t;$('status').className=bad?'bad':'muted';};
  const fmt=n=>n.toLocaleString('de-DE');

  async function flights(){
    try{
      const r=await fetch('/api/coverage/flights',{cache:'no-store',credentials:'same-origin'});
      const b=await r.json().catch(()=>({}));
      if(!r.ok)throw new Error(b.error||('HTTP '+r.status));
      $('flight').replaceChildren(...(b.flights||[]).map(f=>{const o=document.createElement('option');o.value=f.id;
        o.textContent=f.name+' · '+f.photos+' Fotos'+(f.startUtc?' · '+new Date(f.startUtc).toLocaleDateString('de-DE'):'');return o;}));
      if(!(b.flights||[]).length){const o=document.createElement('option');o.value='';o.textContent='keine Flüge mit Fotos im Speicher';$('flight').append(o);}
      $('run').disabled=!(b.flights||[]).length;
    }catch(err){say('Flüge nicht lesbar: '+err.message,true);}
  }
  function overlay(r){
    const counts=new Uint16Array(Uint8Array.from(atob(r.counts),c=>c.charCodeAt(0)).buffer);
    const W=r.width,H=r.height,cv=document.createElement('canvas');cv.width=W;cv.height=H;
    const ctx=cv.getContext('2d'),img=ctx.createImageData(W,H);
    const aoi=r.aoi.map(([la,lo])=>[(lo-r.bounds.west)/(r.bounds.east-r.bounds.west)*W,(r.bounds.north-la)/(r.bounds.north-r.bounds.south)*H]);
    const inAoi=(x,y)=>{let c=false;for(let i=0,j=aoi.length-1;i<aoi.length;j=i++){const [xi,yi]=aoi[i],[xj,yj]=aoi[j];
      if(((yi>y)!==(yj>y))&&(x<(xj-xi)*(y-yi)/(yj-yi)+xi))c=!c;}return c;};
    for(let j=0;j<H;j++)for(let i=0;i<W;i++){
      const n=counts[j*W+i],k=((H-1-j)*W+i)*4;                  // row 0 of the grid is the south edge
      let c=null;
      if(n===0){if(inAoi(i+0.5,H-1-j+0.5))c=[209,36,47,170];}
      else c=n<r.minOverlap?[240,136,62,140]:[45,164,78,110];
      if(c){img.data[k]=c[0];img.data[k+1]=c[1];img.data[k+2]=c[2];img.data[k+3]=c[3];}
    }
    ctx.putImageData(img,0,0);
    return L.imageOverlay(cv.toDataURL(),[[r.bounds.south,r.bounds.west],[r.bounds.north,r.bounds.east]],{opacity:1,interactive:false});
  }
  $('run').addEventListener('click',async()=>{
    $('run').disabled=true;say('Fotoköpfe werden gelesen und ausgewertet …');
    try{
      const r=await fetch('/api/coverage/run',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({flight:$('flight').value,minOverlap:Number($('min').value)})});
      const b=await r.json().catch(()=>({}));
      if(!r.ok)throw new Error(b.error||('HTTP '+r.status));
      if(b.status!=='ok')throw new Error('keine auswertbaren Fotos ('+(b.reason||'?')+')');
      if(layer)map.removeLayer(layer);
      layer=L.layerGroup([overlay(b),L.polygon(b.aoi,{color:'#1f6feb',weight:2,dashArray:'6 4',fill:false})]).addTo(map);
      b.gaps.slice(0,10).forEach((g,i)=>L.circleMarker([g.lat,g.lon],{radius:7,color:'#d1242f',fillOpacity:.9}).bindTooltip('Lücke '+(i+1)+': '+fmt(g.areaM2)+' m²').addTo(layer));
      map.fitBounds([[b.bounds.south,b.bounds.west],[b.bounds.north,b.bounds.east]],{maxZoom:18});
      const dl=$('stats');dl.replaceChildren();
      const add=(t,v)=>{const a=document.createElement('dt');a.textContent=t;const d=document.createElement('dd');d.textContent=v;dl.append(a,d);};
      add('Fotos',b.used+' von '+b.photos+' ausgewertet'+(b.oblique?' ('+b.oblique+' schräg)':''));
      add('Beflogene Fläche',fmt(b.stats.aoiM2)+' m² (Hülle der Aufnahmepositionen)');
      add('Ohne Abdeckung',b.stats.uncoveredPct+' %');
      add('Unter '+b.minOverlap+' Fotos',b.stats.belowPct+' %');
      add('Mindestens '+b.minOverlap+' Fotos',b.stats.okPct+' %');
      add('Höhe über Start',b.aglM.min+'–'+b.aglM.max+' m · Raster '+b.cellM+' m');
      $('gaps').replaceChildren(...(b.gaps.length?b.gaps.slice(0,10).map((g,i)=>{const li=document.createElement('li');
        const btn=document.createElement('button');btn.type='button';btn.className='secondary';btn.textContent=fmt(g.areaM2)+' m²';
        btn.setAttribute('aria-label','Lücke '+(i+1)+' mit '+fmt(g.areaM2)+' m² zeigen');
        btn.addEventListener('click',()=>map.setView([g.lat,g.lon],18));li.append(btn);return li;}):[Object.assign(document.createElement('li'),{textContent:'keine Lücke über 25 m²'})]));
      say('Fertig. Rot = keine Abdeckung innerhalb der beflogenen Fläche.');
    }catch(err){say('Auswertung fehlgeschlagen: '+err.message,true);}
    finally{$('run').disabled=false;}
  });
  flights();
})();
