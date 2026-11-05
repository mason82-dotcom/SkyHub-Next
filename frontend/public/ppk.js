'use strict';
// PPK geotagging page (backend/ppk.js -> docker/ppk/ppk_server.py, dji-geotagger).
// Builds one ZIP in the browser: flights/<folder>/{*.MRK, *_PPKRAW.bin|*.RTK, photo headers}, base/<SAPOS files>.
// Photos are reduced to their header (all segments before the first scan + EOI): dji-geotagger reads only the XMP.
(function(){
  const $=id=>document.getElementById(id);
  const flights=new Map();   // folder -> [{name, file}]
  let baseFiles=[],job=null,timer=null,stored=[],baseHead=null,baseHeadFor=null;
  const source=()=>document.querySelector('input[name=source]:checked').value;
  const chosen=()=>[...document.querySelectorAll('#storageFlights input:checked')].map(x=>x.value);
  const KEEP=/\.(mrk|rtk|jpe?g|tif)$|_ppkraw\.bin$/i;
  const fmt=n=>n>1048576?(n/1048576).toFixed(1)+' MB':Math.round(n/1024)+' KB';

  function renderLists(){
    $('flights').replaceChildren(...[...flights].map(([folder,files])=>{
      const li=document.createElement('li');
      const photos=files.filter(f=>/\.(jpe?g|tif)$/i.test(f.name)).length,mrk=files.some(f=>/\.mrk$/i.test(f.name)),
        raw=files.some(f=>/_ppkraw\.bin$|\.rtk$/i.test(f.name));
      li.textContent=folder+': '+photos+' Fotos, MRK '+(mrk?'✓':'fehlt')+', GNSS-Rohdaten '+(raw?'✓':'fehlt');
      if(!mrk||!raw)li.className='bad';
      return li;
    }));
    $('baseList').replaceChildren(...baseFiles.map(f=>{const li=document.createElement('li');li.textContent=f.name+' ('+fmt(f.size)+')';return li;}));
    const flightsOk=source()==='storage'?chosen().length>0:
      flights.size>0&&[...flights.values()].every(fs=>fs.some(f=>/\.mrk$/i.test(f.name))&&fs.some(f=>/_ppkraw\.bin$|\.rtk$/i.test(f.name)));
    const obs=baseFiles.filter(f=>OBS.test(f.name));
    const check=baseCheck(obs);
    const ok=flightsOk&&obs.length===1&&!check.block&&baseFiles.some(f=>NAV.test(f.name));
    $('run').disabled=!ok||Boolean(job);
  }
  // --- base check before upload (rinex-head.js): drone file, missing position, distance to the flight -----------------
  const OBS=/(_[A-Z]O\.rnx|\.obs|\.\d\do)$/i,NAV=/(_[A-Z]N\.rnx|\.nav|\.\d\d[nglpfhq])$/i;
  function baseCheck(obs){
    const el=$('baseCheck');
    const show=(text,cls)=>{el.hidden=!text;el.textContent=text||'';el.className='small '+(cls||'muted');};
    if(!baseFiles.length){show('');return {block:true};}
    if(obs.length!==1){show(obs.length?'Genau eine Beobachtungsdatei der Basis wählen ('+obs.length+' gewählt).':
      'Beobachtungsdatei der Basis fehlt (…_MO.rnx, .obs oder .26o).','bad');return {block:true};}
    if(!baseFiles.some(f=>NAV.test(f.name))){show('Navigationsdatei fehlt (…_MN.rnx, .nav oder .26n).','bad');return {block:true};}
    if(baseHeadFor!==obs[0]){show('RINEX-Kopf wird gelesen …');return {block:true};}
    const pos=source()==='storage'?stored.filter(f=>chosen().includes(f.id)).map(f=>f.position).filter(Boolean):[];
    const num=id=>{const v=$(id).value.trim();return v===''?NaN:Number(v);};
    const r=window.SkyHubRinex.assess(baseHead,{mode:mode(),flights:pos,manual:{lat:num('lat'),lon:num('lon'),h:num('height')}});
    show(r.text,r.block?'bad':r.warn?'bad':'ok');
    return r;
  }
  async function readBaseHead(){
    const obs=baseFiles.filter(f=>OBS.test(f.name));
    if(obs.length!==1){baseHead=null;baseHeadFor=null;return renderLists();}
    const f=obs[0];
    let text='';try{text=await f.slice(0,65536).text();}catch(_){}
    if(baseFiles.filter(x=>OBS.test(x.name))[0]!==f)return;   // selection changed meanwhile
    baseHead=window.SkyHubRinex.parseHeader(text);baseHeadFor=f;renderLists();
  }
  // --- flights already imported into MinIO --------------------------------------------------------------------------
  const when=iso=>iso?new Date(iso).toLocaleString('de-DE',{dateStyle:'medium',timeStyle:'short'}):'?';
  const utcRange=f=>f.startUtc?f.startUtc.slice(11,16)+'–'+(f.endUtc||f.startUtc).slice(11,16)+' UTC':'';
  async function loadStored(){
    try{
      const r=await fetch('/api/ppk/flights',{cache:'no-store',credentials:'same-origin'});
      const b=await r.json().catch(()=>({}));
      if(!r.ok)throw new Error(b.error||('HTTP '+r.status));
      stored=b.flights||[];
      $('storageState').textContent=stored.length?'Mehrere Flüge möglich, wenn derselbe SAPOS-Zeitraum sie abdeckt.':
        'Keine Flüge mit GNSS-Rohdaten im Speicher. Ordner von der SD-Karte wählen.';
      $('storageFlights').replaceChildren(...stored.map(f=>{
        const l=document.createElement('label');if(!f.usable)l.className='bad';
        const c=document.createElement('input');c.type='checkbox';c.value=f.id;c.disabled=!f.usable;c.addEventListener('change',renderLists);
        const t=document.createElement('span');
        const b=document.createElement('strong');b.textContent=f.name;
        const d=document.createElement('small');
        d.textContent=when(f.startUtc)+' · '+utcRange(f)+' · '+f.photos+' von '+f.exposures+' Fotos · im Flug: '+(f.quality||'?')+
          (f.position?' · '+f.position.lat.toFixed(4)+' N, '+f.position.lon.toFixed(4)+' E':'')+
          (f.droppedMrkLines?' · '+f.droppedMrkLines+' defekte MRK-Zeile(n) übersprungen':'');
        t.append(b,d);
        if(f.issues&&f.issues.length){const w=document.createElement('small');w.textContent=f.issues.join('; ');t.append(w);}
        l.append(c,t);return l;
      }));
    }catch(err){$('storageState').textContent='Speicher nicht lesbar: '+err.message;$('storageState').className='bad';}
    renderLists();
  }
  for(const r of document.querySelectorAll('input[name=source]'))r.addEventListener('change',()=>{
    $('srcStorage').hidden=source()!=='storage';$('srcSd').hidden=source()!=='sd';renderLists();
  });
  $('flight').addEventListener('change',e=>{
    for(const file of e.target.files){
      const parts=(file.webkitRelativePath||file.name).split('/');
      if(parts.length<2||!KEEP.test(file.name))continue;
      const folder=parts[parts.length-2].replace(/[^\w.-]/g,'_').slice(0,80);
      if(!flights.has(folder))flights.set(folder,[]);
      const list=flights.get(folder);
      if(!list.some(f=>f.name===file.name))list.push({name:file.name,file});
    }
    e.target.value='';renderLists();
  });
  $('flightsClear').addEventListener('click',()=>{flights.clear();renderLists();});
  $('base').addEventListener('change',e=>{baseFiles=[...e.target.files].filter(f=>f.size>0);renderLists();readBaseHead();});
  for(const r of document.querySelectorAll('input[name=mode]'))r.addEventListener('change',()=>{$('manual').hidden=mode()!=='manual';renderLists();});
  for(const id of ['lat','lon','height'])$(id).addEventListener('input',renderLists);   // distance check uses the hand-entered base
  const mode=()=>document.querySelector('input[name=mode]:checked').value;

  // --- JPEG header stub: SOI + all segments before SOS + EOI (XMP/EXIF kept, image data dropped) ---------------------
  async function jpegHeader(file){
    for(const size of [262144,1048576,4194304]){
      const buf=new Uint8Array(await file.slice(0,Math.min(size,file.size)).arrayBuffer());
      if(buf[0]!==0xFF||buf[1]!==0xD8)return null;
      let p=2;
      while(p+4<=buf.length){
        if(buf[p]!==0xFF)return null;
        const m=buf[p+1];
        if(m===0xDA){const out=new Uint8Array(p+2);out.set(buf.subarray(0,p));out[p]=0xFF;out[p+1]=0xD9;return out;}
        const len=(buf[p+2]<<8)|buf[p+3];
        if(len<2)return null;
        p+=2+len;
      }
      if(size>=file.size)return null;
    }
    return null;
  }
  // --- minimal ZIP (stored, CRC-32), streamed as a Blob of parts --------------------------------------------------
  const T=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;t[n]=c>>>0;}return t;})();
  async function crcOf(data){
    let c=0xffffffff;
    if(data instanceof Uint8Array){for(let i=0;i<data.length;i++)c=T[(c^data[i])&255]^(c>>>8);return (c^0xffffffff)>>>0;}
    for(let off=0;off<data.size;off+=8388608){
      const b=new Uint8Array(await data.slice(off,off+8388608).arrayBuffer());
      for(let i=0;i<b.length;i++)c=T[(c^b[i])&255]^(c>>>8);
    }
    return (c^0xffffffff)>>>0;
  }
  async function buildZip(entries,onStep){
    const parts=[],central=[],enc=new TextEncoder();let offset=0;
    for(let i=0;i<entries.length;i++){
      const {name,data}=entries[i],n=enc.encode(name),size=data instanceof Uint8Array?data.length:data.size,crc=await crcOf(data);
      const h=new DataView(new ArrayBuffer(30));
      h.setUint32(0,0x04034b50,true);h.setUint16(4,20,true);h.setUint16(6,0x800,true);
      h.setUint32(14,crc,true);h.setUint32(18,size,true);h.setUint32(22,size,true);h.setUint16(26,n.length,true);
      parts.push(h.buffer,n,data);
      const c=new DataView(new ArrayBuffer(46));
      c.setUint32(0,0x02014b50,true);c.setUint16(4,20,true);c.setUint16(6,20,true);c.setUint16(8,0x800,true);
      c.setUint32(16,crc,true);c.setUint32(20,size,true);c.setUint32(24,size,true);c.setUint16(28,n.length,true);c.setUint32(42,offset,true);
      central.push(c.buffer,n);
      offset+=30+n.length+size;
      if(offset>3*1024**3)throw new Error('Upload größer als 3 GiB');
      onStep(i+1,entries.length);
    }
    const dirSize=central.reduce((s,x)=>s+(x.byteLength??x.length),0),e=new DataView(new ArrayBuffer(22));
    e.setUint32(0,0x06054b50,true);e.setUint16(8,entries.length,true);e.setUint16(10,entries.length,true);
    e.setUint32(12,dirSize,true);e.setUint32(16,offset,true);
    return new Blob([...parts,...central,e.buffer],{type:'application/zip'});
  }
  function params(){
    const base={mode:mode(),sigma_e:$('sigH').value,sigma_n:$('sigH').value,sigma_u:$('sigU').value,frame:'ETRS89 (SAPOS)'};
    if(base.mode==='manual')Object.assign(base,{lat:$('lat').value,lon:$('lon').value,height:$('height').value});
    return JSON.stringify({base});
  }
  const status=(t,cls)=>{$('status').textContent=t;$('status').className=cls||'muted';};

  $('run').addEventListener('click',async()=>{
    $('run').disabled=true;$('download').hidden=true;$('failed').replaceChildren();
    const prog=$('progress');prog.hidden=false;prog.value=0;
    try{
      const entries=[];let skipped=0;const fromStorage=source()==='storage';
      if(!fromStorage)for(const [folder,files] of flights)for(const f of files){
        if(/\.(jpe?g)$/i.test(f.name)){
          const head=await jpegHeader(f.file);
          if(!head){skipped++;continue;}
          entries.push({name:'flights/'+folder+'/'+f.name,data:head});
        }else entries.push({name:'flights/'+folder+'/'+f.name,data:f.file});
      }
      for(const f of baseFiles)entries.push({name:'base/'+f.name.replace(/[^\w.-]/g,'_'),data:f});
      status('ZIP wird vorbereitet (Prüfsummen) …');
      const zip=await buildZip(entries,(i,n)=>{prog.value=i/n*0.3;});
      status('Upload '+fmt(zip.size)+(skipped?' ('+skipped+' Fotos ohne lesbaren Kopf übersprungen)':'')+' …');
      const res=await new Promise((resolve,reject)=>{
        const x=new XMLHttpRequest();
        x.open('POST',fromStorage?'/api/ppk/jobs/storage':'/api/ppk/jobs');
        x.setRequestHeader('Content-Type','application/zip');x.setRequestHeader('X-PPK-Params',params());
        if(fromStorage)x.setRequestHeader('X-PPK-Flights',JSON.stringify(chosen()));
        x.upload.onprogress=e=>{if(e.lengthComputable)prog.value=0.3+e.loaded/e.total*0.2;};
        x.onload=()=>{let b={};try{b=JSON.parse(x.responseText);}catch{}resolve({status:x.status,body:b});};
        x.onerror=()=>reject(new Error('Netzwerkfehler beim Upload'));
        x.send(zip);
      });
      if(res.status!==202)throw new Error(res.body.error||('HTTP '+res.status));
      job=res.body.id;$('cancel').disabled=false;poll();
    }catch(err){status(err.message,'bad');prog.hidden=true;job=null;renderLists();}
  });
  async function poll(){
    clearTimeout(timer);
    if(!job)return;
    try{
      const r=await fetch('/api/ppk/jobs/'+job,{cache:'no-store',credentials:'same-origin'});
      const s=await r.json();
      if(!r.ok)throw new Error(s.error||('HTTP '+r.status));
      const label={preparing:'bereitet vor',staged:'bereitet vor',receiving:'Upload',queued:'wartet',running:'rechnet',done:'fertig',failed:'fehlgeschlagen',cancelled:'abgebrochen'}[s.state]||s.state;
      status(label+': '+(s.message||'')+(s.ephemeris?' · Bahndaten: '+s.ephemeris:''),s.state==='failed'?'bad':s.state==='done'?'ok':'muted');
      if(typeof s.fraction==='number')$('progress').value=0.5+0.5*Math.max(0,Math.min(1,s.fraction));
      $('failed').replaceChildren(...(s.failed||[]).map(f=>{const li=document.createElement('li');li.className='bad';li.textContent='Flug '+f.flight+': '+f.reason;return li;}));
      if(['done','failed','cancelled'].includes(s.state)){
        $('progress').hidden=s.state!=='done';$('cancel').disabled=true;
        if(s.state==='done'){const a=$('download');a.href='/api/ppk/jobs/'+job+'/result.csv';a.hidden=false;}
        job=null;renderLists();return;
      }
    }catch(err){status('Status nicht abrufbar: '+err.message,'bad');}
    timer=setTimeout(poll,3000);
  }
  $('cancel').addEventListener('click',async()=>{
    if(!job)return;
    await fetch('/api/ppk/jobs/'+job,{method:'DELETE',credentials:'same-origin'}).catch(()=>{});
    poll();
  });
  loadStored();
})();
