/* SKY//PULSE field-provenance cockpit. Presentation-only; no data fetches. */
(function(root){
'use strict';
const SPECS=Object.freeze([
  {key:'battery',id:'Battery',digits:0,unit:' %',range:[0,100]},
  {key:'altitude',id:'Altitude',digits:1,unit:' m'},
  {key:'horizontalSpeed',id:'Speed',digits:1,unit:' m/s'},
  {key:'heading',id:'Heading',digits:0,unit:' °',limit:[-360,360]},
  {key:'verticalSpeed',id:'Climb',digits:1,unit:' m/s'},
  {key:'attitudePitch',id:'Pitch',digits:1,unit:' °',limit:[-90,90]},
  {key:'attitudeRoll',id:'Roll',digits:1,unit:' °',limit:[-180,180]},
  {key:'linkQuality',id:'Link',digits:0,unit:' / 5',range:[0,5]}
]);
function valueFor(device,spec,freshness,now){
  const source=device&&device.telemetry;
  const value=source&&source[spec.key];
  const validRange=spec.range||spec.limit;
  if(!Number.isFinite(value)||(validRange&&(value<validRange[0]||value>validRange[1]))){
    return {value:'—',age:'Nicht empfangen',kind:'missing',meter:null};
  }
  const status=freshness.evaluateField(device,spec.key,now);
  const formatted=value.toFixed(spec.digits).replace('.',',')+spec.unit;
  const meter=spec.range?100*(value-spec.range[0])/(spec.range[1]-spec.range[0]):null;
  return {value:formatted,age:status.text,kind:status.kind,meter};
}
// Direction is visualized only from current, time-verified DJI heading data.
function bearingFor(device,fieldFreshness,now=Date.now()){
  const heading=device?.telemetry?.heading;
  if(!Number.isFinite(heading)||Math.abs(heading)>360)return null;
  const status=fieldFreshness?.evaluateField?.(device,'heading',now);
  if(!status||status.kind!=='current')return null;
  return ((heading%360)+360)%360;
}
/* Presentation-only pitch/roll geometry. Both values must carry fresh, verified
 * field-level provenance; the scene is schematic, not a certified attitude indicator. */
function attitudeFor(device,freshness,now=Date.now()){
  const pitch=device?.telemetry?.attitudePitch;
  const roll=device?.telemetry?.attitudeRoll;
  if(!Number.isFinite(pitch)||Math.abs(pitch)>90||
     !Number.isFinite(roll)||Math.abs(roll)>180)return null;
  if(freshness?.evaluateField?.(device,'attitudePitch',now)?.kind!=='current'||
     freshness?.evaluateField?.(device,'attitudeRoll',now)?.kind!=='current')return null;
  return {pitch,roll,offset:Math.round(pitch*0.8*10)/10};
}
/* Counts the eight displayed instrument fields only; never flight readiness.
 * Unknown or future timestamps count separately from unverified timestamps. */
const QUALITY_KINDS=Object.freeze(['current','stale','unverified','unknown','missing']);
function qualityFor(device,freshness,now=Date.now()){
  if(!device||!freshness||typeof freshness.evaluateField!=='function')return null;
  const counts={current:0,stale:0,unverified:0,unknown:0,missing:0};
  for(const spec of SPECS){
    const kind=valueFor(device,spec,freshness,now).kind;
    counts[QUALITY_KINDS.includes(kind)?kind:'unknown']++;
  }
  return {total:SPECS.length,...counts};
}
/* In-memory observation of displayed FIELD provenance, never a packet log.
 * Only whitelist-backed label strings and local observation times are retained. */
const TIMELINE_MAX=24;
const FIELD_LABELS=Object.freeze({
  battery:'Akku',altitude:'Höhe relativ',horizontalSpeed:'Horizontaltempo',
  heading:'Kurs / Heading',verticalSpeed:'Vertikaltempo',
  attitudePitch:'Nickwinkel',attitudeRoll:'Rollwinkel',linkQuality:'SDR-Funkqualität'
});
const KIND_LABELS=Object.freeze({
  current:'Aktuell',stale:'Veraltet',unverified:'Zeit ungeprüft',
  unknown:'Zeit unbekannt',missing:'Nicht empfangen'
});
function observeFields(device,freshness,now=Date.now()){
  if(!device)return null;
  const fields={};
  for(const spec of SPECS){
    const result=valueFor(device,spec,freshness,now);
    const sourceAt=device.telemetryFieldAt?.[spec.key];
    fields[spec.key]={
      kind:QUALITY_KINDS.includes(result.kind)?result.kind:'unknown',
      sourceAt:result.kind!=='missing'&&Number.isFinite(sourceAt)&&sourceAt<=now?
        sourceAt:null,
      timeVerified:device.telemetryFieldTimeVerified?.[spec.key]===true
    };
  }
  return fields;
}
function timelineChanges(previous,next,observedAt){
  if(!previous||!next)return [];
  const out=[];
  for(const spec of SPECS){
    const older=previous[spec.key],newer=next[spec.key];
    if(!older||!newer)continue;
    const label=FIELD_LABELS[spec.key];
    if(older.kind!==newer.kind){
      // This reflects a UI-observed status change; not a claim about packet loss.
      out.push({key:spec.key,kind:newer.kind,label,
        message:KIND_LABELS[older.kind]+' → '+KIND_LABELS[newer.kind],
        observedAt});
    }else if(newer.timeVerified&&newer.sourceAt!==null&&
             older.sourceAt!==null&&newer.sourceAt>older.sourceAt){
      out.push({key:spec.key,kind:'timestamp',label,message:'Verifizierter Feldzeitpunkt fortgeschrieben',
        observedAt});
    }
  }
  return out;
}
/* Diagnostic counts are based ONLY on the retained (newest first) 24
 * UI observations. They are not packet rates, outage counts or persistent logs. */
function summarizeTimeline(entries){
  const considered=Array.isArray(entries)?entries.slice(0,TIMELINE_MAX):[];
  const staleCounts=new Map(SPECS.map(spec=>[spec.key,0]));
  let staleTransitions=0;
  let timestampAdvances=0;
  let otherTransitions=0;
  for(const event of considered){
    if(!event||!staleCounts.has(event.key))continue;
    if(event.kind==='stale'&&
       typeof event.message==='string'&&event.message.endsWith('→ Veraltet')){
      staleTransitions++;
      staleCounts.set(event.key,staleCounts.get(event.key)+1);
    }else if(event.kind==='timestamp'&&event.message==='Verifizierter Feldzeitpunkt fortgeschrieben'){
      timestampAdvances++;
    }else if(QUALITY_KINDS.includes(event.kind)){
      otherTransitions++;
    }
  }
  const topStale=SPECS.map(spec=>({
    key:spec.key,label:FIELD_LABELS[spec.key],count:staleCounts.get(spec.key)
  })).filter(x=>x.count>0)
    .sort((a,b)=>b.count-a.count||SPECS.findIndex(s=>s.key===a.key)-
      SPECS.findIndex(s=>s.key===b.key)).slice(0,3);
  return {retained:considered.length,staleTransitions,timestampAdvances,
    otherTransitions,topStale};
}
function mount({document:doc,fieldFreshness,onLocate,mapAvailable=false}={}){
  const rootEl=doc&&doc.getElementById('gfxCockpit');
  if(!rootEl||!fieldFreshness||typeof fieldFreshness.evaluateField!=='function')return null;
  const picker=doc.getElementById('gfxCockpitDevice');
  const status=doc.getElementById('gfxCockpitStatus');
  const locate=doc.getElementById('gfxCockpitLocate');
  const timelineList=doc.getElementById('gfxTimelineList');
  const timelineEmpty=doc.getElementById('gfxTimelineEmpty');
  const timelineClear=doc.getElementById('gfxTimelineClear');
  const timelineSummary=doc.getElementById('gfxTimelineSummary');
  const timelineTop=doc.getElementById('gfxTimelineTop');
  const timelineTopEmpty=doc.getElementById('gfxTimelineTopEmpty');
  const qualitySummary=doc.getElementById('gfxQualitySummary');
  const qualityCounts=new Map(QUALITY_KINDS.map(kind=>[
    kind,doc.getElementById('gfxQuality'+kind.charAt(0).toUpperCase()+kind.slice(1))
  ]));
  if(!picker||!status||!locate)return null;
  let selected=null;
  let previousMapSelection=null;
  let signature='';
  let current=null;
  picker.addEventListener('change',()=>{
    selected=picker.value||null;
    updateView();
  });
  locate.addEventListener('click',()=>{
    if(current&&typeof onLocate==='function')onLocate(current.sn);
  });
  const compass=doc.getElementById('gfxCockpitCompass');
  const needle=doc.getElementById('gfxCockpitNeedle');
  const attitude=doc.getElementById('gfxCockpitAttitude');
  const attitudePlane=doc.getElementById('gfxCockpitAttitudePlane');
  const nodes=new Map(SPECS.map(spec=>[spec.key,{
    value:doc.getElementById('gfxCockpit'+spec.id),
    age:doc.getElementById('gfxCockpit'+spec.id+'Age'),
    meter:doc.getElementById('gfxCockpit'+spec.id+'Meter')
  }]));
  let devices=[];
  let state='loading';
  let lastStatus='';
  let observedDevice=null;
  let previousFields=null;
  let timeline=[];
  function renderTimeline(){
    if(!timelineList||!timelineEmpty)return;
    const fragment=doc.createDocumentFragment();
    for(const entry of timeline){
      const item=doc.createElement('li');
      item.className='gfx-timeline-item';
      item.dataset.kind=entry.kind;
      const timestamp=doc.createElement('time');
      timestamp.dateTime=new Date(entry.observedAt).toISOString();
      timestamp.textContent=new Date(entry.observedAt).toLocaleTimeString('de-DE',
        {hour:'2-digit',minute:'2-digit',second:'2-digit'});
      const description=doc.createElement('span');
      const strong=doc.createElement('strong');
      strong.textContent=entry.label;
      description.appendChild(strong);
      description.appendChild(doc.createTextNode(' · '+entry.message));
      item.appendChild(timestamp);
      item.appendChild(description);
      fragment.appendChild(item);
    }
    timelineList.replaceChildren(fragment);
    timelineEmpty.hidden=timeline.length!==0;
    if(timelineClear)timelineClear.disabled=timeline.length===0;
    const aggregate=summarizeTimeline(timeline);
    if(timelineSummary)timelineSummary.textContent=
      aggregate.retained+' von maximal '+TIMELINE_MAX+' lokal behaltenen Beobachtungen: '+
      aggregate.staleTransitions+' Wechsel zu „Veraltet“, '+
      aggregate.timestampAdvances+' bestätigte Feldzeitpunkt-Fortschreibungen, '+
      aggregate.otherTransitions+' andere Statuswechsel.';
    if(timelineTop){
      const ranking=doc.createDocumentFragment();
      for(const item of aggregate.topStale){
        const li=doc.createElement('li');
        const name=doc.createElement('span');
        name.textContent=item.label;
        const tally=doc.createElement('strong');
        tally.textContent=String(item.count)+' ×';
        li.appendChild(name);
        li.appendChild(tally);
        ranking.appendChild(li);
      }
      timelineTop.replaceChildren(ranking);
    }
    if(timelineTopEmpty)timelineTopEmpty.hidden=aggregate.topStale.length>0;
  }
  if(timelineClear)timelineClear.addEventListener('click',()=>{
    timeline=[];
    renderTimeline();
  });
  function updateView(){
    const now=Date.now();
    current=devices.find(d=>d&&d.sn===selected)||null;
    const nextStatus=!current?
      state==='auth-required'?'Zugriffstoken zum Laden der Geräte erforderlich.':
      state==='error'?'Geräteabruf fehlgeschlagen. Verbindung prüfen.':
      state==='loading'?'Warte auf Gerätedaten.':'Keine Geräte empfangen.':
      current.aircraftConnected===false?'Fluggerät nicht verbunden · Werte können veraltet sein.':
      current.telemetryTimeVerified===false?'OSD empfangen · Gesamtzeit ungeprüft; Felder separat bewerten.':
      'Gerätemesswerte · Frische je Feld separat angegeben.';
    if(nextStatus!==lastStatus){status.textContent=nextStatus;lastStatus=nextStatus;}
    // No separate clock: existing dashboard update() observes stale transitions
    // every five seconds. Never claim that a status change is a new OSD packet.
    const nextFields=observeFields(current,fieldFreshness,now);
    const currentDevice=current?.sn||null;
    if(currentDevice!==observedDevice){
      observedDevice=currentDevice;
      previousFields=nextFields;
      timeline=[];
      renderTimeline();
    }else if(nextFields&&previousFields){
      const changes=timelineChanges(previousFields,nextFields,now);
      previousFields=nextFields;
      if(changes.length){
        timeline=[...changes.reverse(),...timeline].slice(0,TIMELINE_MAX);
        renderTimeline();
      }
    }
    const quality=qualityFor(current,fieldFreshness,now);
    if(qualitySummary)qualitySummary.textContent=quality?
      quality.current+' von '+quality.total+' angezeigten Instrumentenfeldern aktuell und zeitverifiziert':
      'Noch keine Instrumentenfelder geprüft';
    for(const kind of QUALITY_KINDS){
      const node=qualityCounts.get(kind);
      if(node)node.textContent=quality?String(quality[kind]):'—';
    }
    locate.disabled=!mapAvailable||!current||
      current.positionUnavailable===true||
      !current.telemetry||
      !Number.isFinite(current.telemetry.latitude)||
      !Number.isFinite(current.telemetry.longitude)||
      Math.abs(current.telemetry.latitude)>90||
      Math.abs(current.telemetry.longitude)>180||
      (current.telemetry.latitude===0&&current.telemetry.longitude===0)||
      !Number.isFinite(current.lastPositionAt);
    // No needle if heading is missing, disconnected, stale or time-unverified.
    if(compass&&needle){
      const bearing=bearingFor(current,fieldFreshness,now);
      compass.hidden=bearing===null;
      needle.style.transform=bearing===null?'':('rotate('+bearing+'deg)');
    }
    // No animated or guessed horizon: neutral if either source is stale.
    if(attitude&&attitudePlane){
      const geometry=attitudeFor(current,fieldFreshness,now);
      attitude.hidden=geometry===null;
      attitudePlane.style.transform=geometry===null?'':(
        'rotate('+(-geometry.roll)+'deg) translateY('+geometry.offset+'px)');
    }
    for(const spec of SPECS){
      const el=nodes.get(spec.key);
      if(!el||!el.value||!el.age)continue;
      const result=valueFor(current,spec,fieldFreshness,now);
      el.value.textContent=result.value;
      el.age.textContent=result.age;
      el.age.dataset.kind=result.kind;
      if(el.meter){
        // A bar is shown only with verified, fresh, field-level provenance.
        const pct=result.kind==='current'&&result.meter!==null?result.meter:0;
        el.meter.style.width=pct.toFixed(1)+'%';
      }
    }
  }
  function render(records,ignoredMapSelection,listState){
    devices=Array.isArray(records)?records.filter(d=>d&&typeof d.sn==='string'&&d.sn.length>0):[];
    state=listState||'loading';
    // The command instrument has its own explicit selection; nothing is stored.
    const ordered=[...devices].sort((a,b)=>a.sn.localeCompare(b.sn,'de'));
    const nextSignature=ordered.map(d=>JSON.stringify([d.sn,d.modelName])).join('|');
    if(signature!==nextSignature){
      const fragment=doc.createDocumentFragment();
      for(const d of ordered){
        const option=doc.createElement('option');
        option.value=d.sn;
        option.textContent=(typeof d.modelName==='string'&&d.modelName.trim()?
          d.modelName:'Gerät')+' · '+d.sn;
        fragment.appendChild(option);
      }
      picker.replaceChildren(fragment);
      signature=nextSignature;
    }
    if(ignoredMapSelection&&ignoredMapSelection!==previousMapSelection&&devices.some(d=>d.sn===ignoredMapSelection))selected=ignoredMapSelection;
    previousMapSelection=ignoredMapSelection||null;
    if(!devices.some(d=>d.sn===selected))selected=devices.length?devices[0].sn:null;
    picker.value=selected||'';
    picker.disabled=!devices.length;
    updateView();
  }
  return {render};
}
const api=Object.freeze({SPECS,QUALITY_KINDS,TIMELINE_MAX,valueFor,bearingFor,attitudeFor,qualityFor,observeFields,timelineChanges,summarizeTimeline,mount});
if(typeof module==='object'&&module.exports)module.exports=api;
if(root)root.SkyHubGfxCockpit=api;
})(typeof window==='object'?window:null);
