'use strict';
/* P3.2 PRIVATE OFFLINE MAP LAB. No network, storage or automatic API calls. */
(function (global) {
  const INDEX_NAMES = ['ndvi', 'ndre', 'gndvi', 'osavi'];
  const MAX_MERCATOR = 20037508.342789244;
  const R = 6378137;
  const HEX = /^[a-f0-9]{64}$/;
  const MANIFEST_NAME = 'viewport.json';
  const MAX_FILE_BYTES = 2 * 1024 * 1024;

  function reject(ok) { if (!ok) throw new Error('INVALID_MAP_PACKAGE'); }
  function keys(value, names) {
    return !!value && typeof value === 'object' && !Array.isArray(value) &&
      Object.keys(value).length === names.length &&
      names.every(k => Object.prototype.hasOwnProperty.call(value, k));
  }
  function normalizeManifest(raw) {
    reject(raw && typeof raw === 'object' && !Array.isArray(raw));
    reject(keys(raw, ['schema', 'classification', 'projection', 'boundsMeters',
      'width', 'height', 'images', 'sourceSealSha256',
      'imagePixelsAreMeasurements', 'sourceRasterIntegrityRechecked',
      'geolocationIsSensitive', 'mapTilesAvailable',
      'radiometricCalibrationVerified', 'reflectanceReady',
      'operationalUseAllowed', 'prescriptionExportAllowed', 'flightMissionAllowed']));
    reject(raw.schema === 'skyhub-m3m-private-mercator-map-lab-v1' &&
      raw.classification === 'private-local-georeferenced-visualization-not-calibrated' &&
      raw.projection === 'EPSG:3857');
    reject(Number.isSafeInteger(raw.width) && raw.width >= 1 && raw.width <= 512 &&
      Number.isSafeInteger(raw.height) && raw.height >= 1 && raw.height <= 512);
    reject(Array.isArray(raw.boundsMeters) && raw.boundsMeters.length === 4 &&
      raw.boundsMeters.every(v => typeof v === 'number' && Number.isFinite(v)));
    const [w,s,e,n] = raw.boundsMeters;
    reject(w < e && s < n && [w,s,e,n].every(x => Math.abs(x) < MAX_MERCATOR));
    reject(typeof raw.sourceSealSha256 === 'string' && HEX.test(raw.sourceSealSha256));
    reject(raw.imagePixelsAreMeasurements === false &&
      raw.sourceRasterIntegrityRechecked === true &&
      raw.geolocationIsSensitive === true &&
      raw.mapTilesAvailable === false &&
      raw.radiometricCalibrationVerified === false &&
      raw.reflectanceReady === false &&
      raw.operationalUseAllowed === false &&
      raw.prescriptionExportAllowed === false &&
      raw.flightMissionAllowed === false);
    reject(Array.isArray(raw.images) && raw.images.length === 4);
    const images = raw.images.map((image, i) => {
      const index = INDEX_NAMES[i];
      reject(keys(image, ['index', 'filename', 'sha256']) &&
        image.index === index && image.filename === index + '.png' &&
        typeof image.sha256 === 'string' && HEX.test(image.sha256));
      return {index, filename: image.filename, sha256: image.sha256};
    });
    return {boundsMeters: [...raw.boundsMeters], width:raw.width, height:raw.height,
      images, sourceSealSha256:raw.sourceSealSha256, experimental:true};
  }
  function projectedPoint(manifest, u, v) {
    reject(manifest && Array.isArray(manifest.boundsMeters) &&
      typeof u === 'number' && typeof v === 'number' &&
      Number.isFinite(u) && Number.isFinite(v) &&
      u >= 0 && u <= 1 && v >= 0 && v <= 1);
    const [west,south,east,north] = manifest.boundsMeters;
    const x = west + u * (east - west);
    const y = north - v * (north - south);
    const lon = x / R * 180 / Math.PI;
    const lat = (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * 180 / Math.PI;
    reject(Number.isFinite(lon) && Number.isFinite(lat) &&
      Math.abs(lon) <= 180 && Math.abs(lat) <= 85.052);
    return [lon,lat];
  }
  function polygonValid(points) {
    reject(Array.isArray(points) && points.length >= 3 && points.length <= 255);
    const lons = points.map(p => p[0]), lats = points.map(p => p[1]);
    reject(Math.max(...lons) - Math.min(...lons) <= .25 &&
      Math.max(...lats) - Math.min(...lats) <= .25);
    const area = points.reduce((total,p,i) => {
      const q=points[(i+1)%points.length];
      return total + p[0]*q[1]-q[0]*p[1];
    },0);
    reject(Number.isFinite(area) && Math.abs(area)>1e-15);
    function cross(p,q,r) {
      return (q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]);
    }
    const len=points.length;
    for(let i=0;i<len;i++) {
      const a=points[i],b=points[(i+1)%len];
      reject(a[0]!==b[0] || a[1]!==b[1]);
      for(let j=i+1;j<len;j++) {
        if(j===i+1 || (i===0 && j===len-1))continue;
        const c=points[j],d=points[(j+1)%len];
        if(cross(a,b,c)*cross(a,b,d)<0 && cross(c,d,a)*cross(c,d,b)<0)
          reject(false);
      }
    }
  }
  function makeQuery(manifest, points, mode) {
    reject(mode === 'point' || mode === 'polygon');
    reject(Array.isArray(points) && points.length >= 1);
    let geometry;
    if(mode === 'point') {
      reject(points.length === 1);
      geometry={type:'Point',coordinates:projectedPoint(manifest,...points[0])};
    } else {
      const coords=points.map(p=>projectedPoint(manifest,...p));
      polygonValid(coords);
      geometry={type:'Polygon',coordinates:[[...coords,coords[0]]]};
    }
    return {schema:'skyhub-m3m-geospatial-request-v1',geometry};
  }
  async function sha256(bytes, subtle) {
    reject(subtle && typeof subtle.digest === 'function');
    const hash = await subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(hash), x=>x.toString(16).padStart(2,'0')).join('');
  }
  function validatePng(bytes, width, height) {
    reject(bytes.byteLength >= 45 && bytes.byteLength <= MAX_FILE_BYTES);
    const arr=new Uint8Array(bytes);
    const magic=[137,80,78,71,13,10,26,10];
    reject(magic.every((n,i)=>arr[i]===n));
    const view=new DataView(bytes);
    reject(view.getUint32(8)===13 &&
      String.fromCharCode(...arr.slice(12,16))==='IHDR' &&
      view.getUint32(16)===width && view.getUint32(20)===height &&
      arr[24]===8 && arr[25]===6);
  }
  async function verifyFiles(fileList, independentPin, subtle) {
    reject(typeof independentPin==='string' && HEX.test(independentPin));
    const files=Array.from(fileList || []);
    reject(files.length===5);
    const byName=new Map();
    for(const file of files) {
      reject(typeof file.name==='string' && !byName.has(file.name) &&
        file.size > 0 && file.size <= MAX_FILE_BYTES);
      byName.set(file.name,file);
    }
    reject(byName.has(MANIFEST_NAME));
    const manifestBytes=await byName.get(MANIFEST_NAME).arrayBuffer();
    reject((await sha256(manifestBytes,subtle))===independentPin);
    const data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(manifestBytes));
    const manifest=normalizeManifest(data);
    const images=new Map();
    for(const item of manifest.images) {
      reject(byName.has(item.filename));
      const bytes=await byName.get(item.filename).arrayBuffer();
      reject((await sha256(bytes,subtle))===item.sha256);
      validatePng(bytes,manifest.width,manifest.height);
      images.set(item.index,new Blob([bytes],{type:'image/png'}));
    }
    reject(byName.size===5);
    return {manifest,images};
  }
  function mount(doc) {
    const fileInput=doc.getElementById('mapFiles');
    const pinInput=doc.getElementById('mapPin');
    const load=doc.getElementById('mapLoad');
    const clear=doc.getElementById('mapClear');
    const layer=doc.getElementById('mapLayer');
    const stage=doc.getElementById('mapStage');
    const img=doc.getElementById('mapImage');
    const svg=doc.getElementById('mapOverlay');
    const queryOutput=doc.getElementById('mapQuery');
    const status=doc.getElementById('mapStatus');
    const placeholder=doc.getElementById('mapPlaceholder');
    const pointButton=doc.getElementById('mapPoint');
    const polyButton=doc.getElementById('mapPolygon');
    const complete=doc.getElementById('mapComplete');
    const undo=doc.getElementById('mapUndo');
    const copy=doc.getElementById('mapCopy');
    if(!fileInput || !pinInput || !load || !clear || !stage || !img || !svg)return;
    let manifest=null,urls=new Map(),points=[],mode='point',version=0;
    const setStatus=(s,error=false)=>{status.textContent=s;status.dataset.error=String(error);};
    function draw() {
      svg.replaceChildren();
      if(!manifest || !points.length)return;
      const ns='http://www.w3.org/2000/svg';
      if(points.length>1) {
        const line=doc.createElementNS(ns,'polyline');
        line.setAttribute('points',points.map(([u,v])=>u+','+v).join(' '));
        line.setAttribute('fill','none');
        line.setAttribute('stroke','#fff');
        line.setAttribute('stroke-width','.006');
        svg.append(line);
      }
      for(const [u,v] of points) {
        const mark=doc.createElementNS(ns,'circle');
        mark.setAttribute('cx',String(u));mark.setAttribute('cy',String(v));
        mark.setAttribute('r','.009');mark.setAttribute('fill','#ff4e4a');
        mark.setAttribute('stroke','#fff');mark.setAttribute('stroke-width','.004');
        svg.append(mark);
      }
    }
    function output() {
      try {
        const request=makeQuery(manifest,points,mode);
        queryOutput.textContent=JSON.stringify(request,null,2);
        copy.disabled=false;
      } catch (_) {
        queryOutput.textContent='Noch keine vollständige gültige Geometrie.';
        copy.disabled=true;
      }
      complete.disabled=!(mode==='polygon' && points.length>=3);
      undo.disabled=points.length===0;
      draw();
    }
    function switchMode(next) {
      mode=next;points=[];
      pointButton.setAttribute('aria-pressed',String(mode==='point'));
      polyButton.setAttribute('aria-pressed',String(mode==='polygon'));
      output();
    }
    function reset() {
      version++;
      for(const url of urls.values())URL.revokeObjectURL(url);
      urls=new Map();manifest=null;points=[];
      img.removeAttribute('src');img.hidden=true;
      stage.hidden=true;placeholder.hidden=false;layer.disabled=true;
      fileInput.value='';pinInput.value='';
      load.disabled=false;
      pointButton.disabled=true;polyButton.disabled=true;
      switchMode('point');
      setStatus('Keine privaten Karten geladen. Es werden keine Daten hochgeladen.');
    }
    function switchLayer() {
      if(manifest)img.src=urls.get(layer.value) || '';
      points=[];output();
    }
    load.addEventListener('click',async()=>{
      const myVersion=++version;
      load.disabled=true;
      setStatus('Lokales Paket und unabhängigen SHA-256-Pin prüfen …');
      let created=[];
      try {
        const result=await verifyFiles(fileInput.files,
          pinInput.value.trim().toLowerCase(),global.crypto?.subtle);
        if(myVersion!==version)return;
        const next=new Map();
        for(const [key,blob] of result.images) {
          const url=URL.createObjectURL(blob);created.push(url);next.set(key,url);
        }
        for(const url of urls.values())URL.revokeObjectURL(url);
        urls=next;manifest=result.manifest;
        img.width=manifest.width;img.height=manifest.height;img.hidden=false;
        stage.hidden=false;placeholder.hidden=true;layer.disabled=false;
        pointButton.disabled=false;polyButton.disabled=false;
        layer.value='ndvi';switchMode('point');switchLayer();
        setStatus('Vier georeferenzierte Vorschauen lokal geprüft. Rein visuell, nicht kalibriert.');
      }catch(_){
        for(const url of created)URL.revokeObjectURL(url);
        if(myVersion===version)setStatus('Paket, Georeferenz oder SHA-256-Prüfung ungültig.',true);
      }finally{if(myVersion===version){pinInput.value='';load.disabled=false;}}
    });
    clear.addEventListener('click',reset);
    layer.addEventListener('change',switchLayer);
    pointButton.addEventListener('click',()=>switchMode('point'));
    polyButton.addEventListener('click',()=>switchMode('polygon'));
    stage.addEventListener('click',event=>{
      if(!manifest)return;
      const box=img.getBoundingClientRect();
      const u=(event.clientX-box.left)/box.width, v=(event.clientY-box.top)/box.height;
      if(!Number.isFinite(u)||!Number.isFinite(v)||u<0||u>1||v<0||v>1)return;
      if(mode==='point')points=[[u,v]];
      else if(points.length<255)points.push([u,v]);
      output();
    });
    complete.addEventListener('click',()=>{
      if(mode!=='polygon')return;
      try{const request=makeQuery(manifest,points,mode);
        queryOutput.textContent=JSON.stringify(request,null,2);
        copy.disabled=false;
        setStatus('Polygon ist lokal gültig. Kein Analyseauftrag wurde versendet.');
      }catch(_){setStatus('Polygon ungültig: Grenzen, Überkreuzungen und Fläche prüfen.',true);}
    });
    undo.addEventListener('click',()=>{points.pop();output();});
    copy.addEventListener('click',async()=>{
      if(copy.disabled || !global.navigator?.clipboard?.writeText)return;
      try{await global.navigator.clipboard.writeText(queryOutput.textContent);
        setStatus('GeoJSON lokal kopiert. Die Zwischenablage kann vertrauliche Koordinaten enthalten.');
      }catch(_){setStatus('Kopieren nicht möglich.',true);}
    });
    reset();
  }
  const api={normalizeManifest,projectedPoint,makeQuery,validatePng,verifyFiles,mount};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(global) {
    global.SkyHubPrivateMapLab=api;
    if(global.document && typeof global.document.addEventListener==='function')
      global.document.addEventListener('DOMContentLoaded',()=>mount(global.document));
  }
})(typeof window==='undefined'?null:window);
