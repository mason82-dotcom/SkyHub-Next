'use strict';
/* SkyHub Smart Farming experimental UI. No maps, uploads, file paths or actions. */
(function (global) {
  const INDICES = ['ndvi', 'ndre', 'gndvi', 'osavi'];
  const LABELS = {ndvi:'NDVI', ndre:'NDRE', gndvi:'GNDVI', osavi:'OSAVI'};
  const CATALOG = '/api/smart-farming/candidates/';
  const ID = /^m3m-exp-[a-f0-9]{24}$/;

  // Bearer credentials must not traverse the Pi LAN in plaintext. Loopback
  // HTTP is allowed for SSH-tunnel diagnostics only; no HTTP on LAN IPs.
  function allowsBearerOrigin(raw) {
    try {
      if(typeof raw!=='string')return false;
      const origin=new URL(raw);
      if(origin.username||origin.password||origin.pathname!=='/'||
         origin.search||origin.hash)return false;
      return origin.protocol==='https:' ||
        (origin.protocol==='http:' &&
         ['localhost','127.0.0.1','[::1]'].includes(origin.hostname));
    } catch(_) {return false;}
  }

  function assert(ok) { if (!ok) throw new Error('INVALID_CATALOG'); }
  function normalizeCatalog(raw) {
    assert(raw && typeof raw === 'object' && !Array.isArray(raw));
    assert(raw.schema === 'skyhub-m3m-smart-farming-catalog-api-v1');
    assert(raw.readOnly === true && raw.experimental === true);
    assert(Array.isArray(raw.candidates) && raw.candidates.length <= 100);
    assert(Number.isSafeInteger(raw.count) && raw.count === raw.candidates.length);
    const ids = new Set();
    const items = raw.candidates.map(candidate => {
      assert(candidate && typeof candidate === 'object' && !Array.isArray(candidate));
      assert(ID.test(candidate.candidateId) && !ids.has(candidate.candidateId));
      ids.add(candidate.candidateId);
      assert(candidate.state === 'experimental_candidate' &&
        candidate.experimental === true && candidate.readOnly === true &&
        candidate.mapTilesAvailable === false &&
        candidate.recordSha256VerifiedAtRead === true &&
        candidate.rasterQaRecheckedAtRead === false &&
        candidate.radiometricCalibrationVerified === false &&
        candidate.operationalUseAllowed === false &&
        candidate.prescriptionExportAllowed === false &&
        candidate.flightMissionAllowed === false);
      assert(Array.isArray(candidate.indices) && candidate.indices.length === 4);
      return {id: candidate.candidateId, indices: candidate.indices.map((layer,i) => {
        const name = INDICES[i];
        assert(layer && typeof layer === 'object' && layer.index === name &&
          layer.title === LABELS[name] && layer.experimental === true &&
          layer.mapTilesAvailable === false &&
          Number.isSafeInteger(layer.validPixels) && layer.validPixels > 0 &&
          Number.isFinite(layer.mean) && Number.isFinite(layer.min) &&
          Number.isFinite(layer.max) && layer.min >= -2 && layer.max <= 2 &&
          layer.min - 1e-6 <= layer.mean && layer.mean <= layer.max + 1e-6);
        return {index:name,label:LABELS[name],count:layer.validPixels,
          mean:layer.mean,min:layer.min,max:layer.max};
      })};
    });
    return items;
  }
  function format(value) {
    return typeof value === 'number' && Number.isFinite(value)
      ? value.toLocaleString('de-DE',{minimumFractionDigits:3,maximumFractionDigits:3})
      : '—';
  }
  function node(doc,tag,className,text) {
    const out=doc.createElement(tag);
    if(className)out.className=className;
    if(text !== undefined)out.textContent=String(text);
    return out;
  }
  function setStatus(doc,message,error) {
    const target=doc.getElementById('catalogStatus');
    if(target) {
      target.textContent=message;
      target.dataset.kind=error?'error':'normal';
    }
  }
  function clearResults(doc) {
    doc.getElementById('candidateList').replaceChildren();
    doc.getElementById('layerGrid').replaceChildren();
    doc.getElementById('candidateDetails').hidden=true;
    doc.getElementById('catalogCount').textContent='—';
  }
  function drawItems(doc, items) {
    clearResults(doc);
    doc.getElementById('catalogCount').textContent=String(items.length);
    if(!items.length) {
      doc.getElementById('candidateList').append(node(doc,'p','empty-state',
        'Noch keine geprüften experimentellen Datensätze registriert.'));
      return;
    }
    const list=doc.getElementById('candidateList');
    const showCandidate=(item,button) => {
      for(const other of list.querySelectorAll('button')) {
        other.setAttribute('aria-pressed',String(other===button));
      }
      const details=doc.getElementById('candidateDetails');
      details.hidden=false;
      doc.getElementById('candidateName').textContent=item.id;
      const grid=doc.getElementById('layerGrid');
      grid.replaceChildren();
      for(const layer of item.indices) {
        const article=node(doc,'article','metric-card');
        article.append(node(doc,'h3','',layer.label));
        const stats=node(doc,'dl','metric-stats');
        for(const [title,value] of [
          ['Mittelwert',format(layer.mean)],['Minimum',format(layer.min)],
          ['Maximum',format(layer.max)],['Gültige Pixel',layer.count.toLocaleString('de-DE')]
        ]) {
          stats.append(node(doc,'dt','',title),node(doc,'dd','',value));
        }
        article.append(stats,node(doc,'p','metric-note','Keine kalibrierte Karte · keine Kartenkacheln'));
        grid.append(article);
      }
    };
    items.forEach((item,index) => {
      const btn=node(doc,'button','candidate-button');
      btn.type='button';
      btn.textContent=item.id;
      btn.setAttribute('aria-pressed','false');
      btn.addEventListener('click',()=>showCandidate(item,btn));
      list.append(btn);
      if(index===0) showCandidate(item,btn);
    });
  }
  function mount(doc, fetchImpl) {
    const token=doc.getElementById('catalogToken');
    const load=doc.getElementById('loadCatalog');
    const forget=doc.getElementById('clearCatalog');
    if(!token||!load||!forget)return;
    let active=null;
    let generation=0;
    const request=fetchImpl || global.fetch.bind(global);
    const reset=() => {
      generation++;
      if(active)active.abort();
      active=null;
      token.value='';
      clearResults(doc);
      setStatus(doc,'Kein Katalog geladen. Zugriffstoken erforderlich.',false);
      load.disabled=false;
    };
    load.addEventListener('click',async () => {
      const secret=token.value;
      if(!secret) {
        setStatus(doc,'Bitte zuerst den Zugriffstoken eingeben.',true);
        return;
      }
      if(!allowsBearerOrigin(global?.location?.origin)) {
        token.value='';
        setStatus(doc,'Katalog-Token nur über HTTPS oder einen lokalen SSH-Loopback-Zugang senden.',true);
        return;
      }
      generation++;
      const myGeneration=generation;
      if(active)active.abort();
      const controller=new AbortController();
      active=controller;
      load.disabled=true;
      clearResults(doc);
      setStatus(doc,'Authentifizierten Katalog laden …',false);
      try {
        const response=await request(CATALOG,{
          method:'GET',cache:'no-store',credentials:'same-origin',
          // Never follow a 3xx with a credential-bearing request (even on same origin).
          redirect:'error',referrerPolicy:'no-referrer',
          headers:{Authorization:'Bearer '+secret,Accept:'application/json'},
          signal:controller.signal
        });
        if(myGeneration!==generation)return;
        if(response.status===401)throw new Error('AUTH');
        if(response.status===404)throw new Error('DISABLED');
        if(response.status===503)throw new Error('UNAVAILABLE');
        if(!response.ok)throw new Error('NETWORK');
        const raw=await response.json();
        if(myGeneration!==generation)return;
        const items=normalizeCatalog(raw);
        drawItems(doc,items);
        setStatus(doc,items.length+' experimentelle Datensätze geladen. Keine Messfreigabe.',false);
      } catch (err) {
        if(myGeneration!==generation)return;
        clearResults(doc);
        const label=err.message==='AUTH'?'Token ungültig oder nicht berechtigt.':
          err.message==='DISABLED'?'Katalog-API ist nicht aktiviert.':
          err.message==='UNAVAILABLE'?'Katalog derzeit nicht verfügbar.':
          err.message==='INVALID_CATALOG'?'Ungültige oder unvollständige Katalogantwort.':
          'Katalog konnte nicht geladen werden.';
        setStatus(doc,label,true);
      } finally {
        if(myGeneration===generation) {
          token.value=''; // Never keep token in DOM or browser storage.
          active=null;
          load.disabled=false;
        }
      }
    });
    forget.addEventListener('click',reset);
    token.addEventListener('keydown',e=>{
      if(e.key==='Enter') {e.preventDefault();load.click();}
    });
    reset();
  }
  const api={normalizeCatalog,format,mount,allowsBearerOrigin};
  if(typeof module!=='undefined' && module.exports)module.exports=api;
  if(global)global.SkyHubSmartFarming=api;
})(typeof window==='undefined'?null:window);
