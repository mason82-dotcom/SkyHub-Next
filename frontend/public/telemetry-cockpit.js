/* Telemetry cockpit for the selected device. Presentation only: it reads the device
 * records the dashboard already holds and never fetches, stores or sends anything.
 * Every value is judged per field (telemetry-freshness.js), never by the aggregate OSD time. */
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
const QUALITY_KINDS=Object.freeze(['current','stale','unverified','unknown','missing']);
function valueFor(device,spec,freshness,now){
  const value=device&&device.telemetry&&device.telemetry[spec.key];
  const bounds=spec.range||spec.limit;
  if(!Number.isFinite(value)||(bounds&&(value<bounds[0]||value>bounds[1]))){
    return {value:'—',age:'Nicht empfangen',kind:'missing',meter:null};
  }
  const status=freshness.evaluateField(device,spec.key,now);
  return {
    value:value.toFixed(spec.digits).replace('.',',')+spec.unit,
    age:status.text,kind:status.kind,
    meter:spec.range?100*(value-spec.range[0])/(spec.range[1]-spec.range[0]):null
  };
}
// A direction is drawn only from a current, time-verified, bounded heading.
function bearingFor(device,freshness,now=Date.now()){
  const heading=device?.telemetry?.heading;
  if(!Number.isFinite(heading)||Math.abs(heading)>360)return null;
  if(freshness?.evaluateField?.(device,'heading',now)?.kind!=='current')return null;
  return ((heading%360)+360)%360;
}
// Schematic horizon: both angles must be current and time-verified, otherwise no geometry at all.
function attitudeFor(device,freshness,now=Date.now()){
  const pitch=device?.telemetry?.attitudePitch;
  const roll=device?.telemetry?.attitudeRoll;
  if(!Number.isFinite(pitch)||Math.abs(pitch)>90||
     !Number.isFinite(roll)||Math.abs(roll)>180)return null;
  if(freshness?.evaluateField?.(device,'attitudePitch',now)?.kind!=='current'||
     freshness?.evaluateField?.(device,'attitudeRoll',now)?.kind!=='current')return null;
  return {pitch,roll,offset:Math.round(pitch*0.8*10)/10};
}
// Counts only the eight displayed fields; never a statement about flight readiness.
function qualityFor(device,freshness,now=Date.now()){
  if(!device||typeof freshness?.evaluateField!=='function')return null;
  const counts={current:0,stale:0,unverified:0,unknown:0,missing:0};
  for(const spec of SPECS){
    const kind=valueFor(device,spec,freshness,now).kind;
    counts[QUALITY_KINDS.includes(kind)?kind:'unknown']++;
  }
  return {total:SPECS.length,...counts};
}
function validPosition(device){
  const t=device?.telemetry;
  return Boolean(t)&&device.positionUnavailable!==true&&
    Number.isFinite(t.latitude)&&Number.isFinite(t.longitude)&&
    Math.abs(t.latitude)<=90&&Math.abs(t.longitude)<=180&&
    !(t.latitude===0&&t.longitude===0)&&Number.isFinite(device.lastPositionAt);
}
function mount({document:doc,fieldFreshness,onLocate,mapAvailable=()=>false}={}){
  const section=doc&&doc.getElementById('cockpit');
  if(!section||typeof fieldFreshness?.evaluateField!=='function')return null;
  const picker=doc.getElementById('cockpitDevice');
  const status=doc.getElementById('cockpitStatus');
  const locate=doc.getElementById('cockpitLocate');
  if(!picker||!status||!locate)return null;
  const compass=doc.getElementById('cockpitCompass');
  const needle=doc.getElementById('cockpitNeedle');
  const attitude=doc.getElementById('cockpitAttitude');
  const plane=doc.getElementById('cockpitAttitudePlane');
  const summary=doc.getElementById('cockpitQualitySummary');
  const counts=new Map(QUALITY_KINDS.map(kind=>[
    kind,doc.getElementById('cockpitQuality'+kind.charAt(0).toUpperCase()+kind.slice(1))]));
  const nodes=new Map(SPECS.map(spec=>[spec.key,{
    value:doc.getElementById('cockpit'+spec.id),
    age:doc.getElementById('cockpit'+spec.id+'Age'),
    meter:doc.getElementById('cockpit'+spec.id+'Meter')
  }]));
  let devices=[],selected=null,previousMapSelection=null,signature='',current=null;
  let state='loading',lastStatus='';
  picker.addEventListener('change',()=>{selected=picker.value||null;updateView();});
  locate.addEventListener('click',()=>{
    if(current&&typeof onLocate==='function')onLocate(current.sn);
  });
  function statusText(){
    if(!current){
      return state==='auth-required'?'Zugriffstoken zum Laden der Geräte erforderlich.':
        state==='error'?'Geräteabruf fehlgeschlagen. Verbindung prüfen.':
        state==='loading'?'Warte auf Gerätedaten.':'Keine Geräte empfangen.';
    }
    return current.aircraftConnected===false?'Fluggerät nicht verbunden · Werte können veraltet sein.':
      current.telemetryTimeVerified===false?'OSD empfangen · Gesamtzeit ungeprüft; Felder separat bewerten.':
      'Gerätemesswerte · Frische je Feld separat angegeben.';
  }
  function updateView(){
    const now=Date.now();
    current=devices.find(d=>d.sn===selected)||null;
    const text=statusText();
    if(text!==lastStatus){status.textContent=text;lastStatus=text;}
    const quality=qualityFor(current,fieldFreshness,now);
    if(summary)summary.textContent=quality?
      quality.current+' von '+quality.total+' angezeigten Instrumentenfeldern aktuell und zeitverifiziert':
      'Noch keine Instrumentenfelder geprüft';
    for(const kind of QUALITY_KINDS){
      const node=counts.get(kind);
      if(node)node.textContent=quality?String(quality[kind]):'—';
    }
    locate.disabled=!mapAvailable()||!validPosition(current);
    if(compass&&needle){
      const bearing=bearingFor(current,fieldFreshness,now);
      compass.hidden=bearing===null;
      needle.style.transform=bearing===null?'':'rotate('+bearing+'deg)';
    }
    if(attitude&&plane){
      const geometry=attitudeFor(current,fieldFreshness,now);
      attitude.hidden=geometry===null;
      plane.style.transform=geometry===null?'':
        'rotate('+(-geometry.roll)+'deg) translateY('+geometry.offset+'px)';
    }
    for(const spec of SPECS){
      const node=nodes.get(spec.key);
      if(!node||!node.value||!node.age)continue;
      const result=valueFor(current,spec,fieldFreshness,now);
      node.value.textContent=result.value;
      node.age.textContent=result.age;
      node.age.dataset.kind=result.kind;
      // A bar is filled only for a current, verified value.
      if(node.meter){
        const pct=result.kind==='current'&&result.meter!==null?result.meter:0;
        node.meter.style.width=pct.toFixed(1)+'%';
      }
    }
  }
  function render(records,mapSelection,listState){
    devices=Array.isArray(records)?records.filter(d=>d&&typeof d.sn==='string'&&d.sn):[];
    state=listState||'loading';
    const ordered=[...devices].sort((a,b)=>a.sn.localeCompare(b.sn,'de'));
    const next=ordered.map(d=>JSON.stringify([d.sn,d.modelName])).join('|');
    if(signature!==next){
      const fragment=doc.createDocumentFragment();
      for(const d of ordered){
        const option=doc.createElement('option');
        option.value=d.sn;
        option.textContent=(typeof d.modelName==='string'&&d.modelName.trim()?d.modelName:'Gerät')+' · '+d.sn;
        fragment.appendChild(option);
      }
      picker.replaceChildren(fragment);
      signature=next;
    }
    // Follow a new selection on the map once; afterwards the cockpit keeps its own choice.
    if(mapSelection&&mapSelection!==previousMapSelection&&devices.some(d=>d.sn===mapSelection))selected=mapSelection;
    previousMapSelection=mapSelection||null;
    if(!devices.some(d=>d.sn===selected))selected=devices.length?devices[0].sn:null;
    picker.value=selected||'';
    picker.disabled=!devices.length;
    updateView();
  }
  return {render};
}
const api=Object.freeze({SPECS,QUALITY_KINDS,valueFor,bearingFor,attitudeFor,qualityFor,validPosition,mount});
if(typeof module==='object'&&module.exports)module.exports=api;
if(root)root.SkyHubCockpit=api;
})(typeof window==='object'?window:null);
