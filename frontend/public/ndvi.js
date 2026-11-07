'use strict';
// NDVI page (backend/ndvi.js → /api/ndvi).
(function(){
  const $=id=>document.getElementById(id);
  const say=(t,bad)=>{$('state').textContent=t;$('state').className=bad?'bad':'muted';};
  async function load(){
    try{
      const r=await fetch('/api/ndvi/captures',{cache:'no-store',credentials:'same-origin'});const b=await r.json().catch(()=>({}));
      if(!r.ok)throw new Error(b.error||('HTTP '+r.status));
      $('list').replaceChildren(...(b.captures.length?b.captures.map(c=>{const li=document.createElement('li'),btn=document.createElement('button');
        btn.type='button';btn.className='secondary';btn.textContent=c.name+' · Bänder '+c.bands.join('/').toUpperCase()+(c.sun?'':' · ohne Sonnenlichtwert');
        btn.addEventListener('click',()=>run(c));li.append(btn);return li;}):[Object.assign(document.createElement('li'),{className:'muted',textContent:'Keine Aufnahme mit Rot- und NIR-Band im Speicher.'})]));
    }catch(err){say('Aufnahmen nicht lesbar: '+err.message,true);}
  }
  async function run(c){
    say('Wird berechnet (einige Sekunden) …');$('preview').hidden=true;$('scale').hidden=true;$('dl').hidden=true;
    try{
      const index=document.querySelector('input[name=index]:checked').value;
      const r=await fetch('/api/ndvi/run',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({capture:c.id,index})});
      const b=await r.json().catch(()=>({}));if(!r.ok)throw new Error(b.error||('HTTP '+r.status));
      $('preview').src='/api/ndvi/results/'+b.id+'.png';$('preview').alt='NDVI-Vorschau '+c.name;$('preview').hidden=false;$('scale').hidden=false;
      $('dl').href='/api/ndvi/results/'+b.id+'.tif';$('dl').hidden=false;
      const dl=$('stats');dl.replaceChildren();
      const add=(t,v)=>{const a=document.createElement('dt');a.textContent=t;const d=document.createElement('dd');d.textContent=v;dl.append(a,d);};
      add('Status',b.status==='calibrated'?'kalibriert (Sonnenlichtsensor gültig, Bänder deckungsgleich)':'relativ – nur innerhalb dieses Bildes vergleichbar');
      add((b.index||'ndvi').toUpperCase(),b.validPct+' % der Pixel auswertbar · Median '+b.median+' (5 %: '+b.p5+', 95 %: '+b.p95+')');
      add('Bandausrichtung','Restversatz '+b.alignment.dx+' / '+b.alignment.dy+' px, Korrelation '+b.alignment.correlation);
      add('Bild',b.width+' × '+b.height+' px'+(b.position?' · '+b.position.lat.toFixed(5)+' N, '+b.position.lon.toFixed(5)+' E':' · ohne GPS'));
      $('notes').replaceChildren(...(b.notes||[]).map(n=>Object.assign(document.createElement('li'),{textContent:n})));
      say('Fertig: '+(b.index||'ndvi').toUpperCase()+' · '+c.name);
    }catch(err){say('Berechnung fehlgeschlagen: '+err.message,true);}
  }
  load();
})();
