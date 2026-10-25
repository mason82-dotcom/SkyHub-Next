'use strict';
// Restrictive DJI XMP field-marker analysis. Bounded XMP bytes may contain
// private values in RAM, but they MUST NOT leave the isolated reader.
// Only enumerated field-presence counters and enumerated band hints exit.
const MARKERS=Object.freeze([
  'ImageSource','BandName','SensorIndex','BandFreq','CentralWavelength',
  'BlackCurrent','SensorGain','SensorGainAdjustment','Irradiance',
  'IrradianceExposureTime','IrradianceGain','VignettingData',
  'VignettingPolynomial','DewarpData'
]);
const BANDS=Object.freeze(['G','R','RE','NIR']);
const BAND_HINTS=Object.freeze(['G','R','RE','NIR','unknown','inconsistent']);
const STATUSES=Object.freeze(['ok','xmpTagMissing','xmpTooLarge',
  'invalidXmpPointer','notClassicTiff','unavailable','rangeNotHonored',
  'xmpNotRecognized']);
const EMPTY=Object.freeze({
  bandHint:'unknown',
  djiFieldPresence:Object.freeze(
    Object.fromEntries(MARKERS.map(k=>[k,false])))
});
function recordStatus(status){
  if(!STATUSES.includes(status))throw new RangeError('Bad XMP status');
  return {status,bandHint:'unknown',
    djiFieldPresence:Object.fromEntries(MARKERS.map(k=>[k,false]))};
}
function locateXmpFromIfd(header,ifd,fileSize){
  if(!Buffer.isBuffer(header)||header.length<8||
     !Buffer.isBuffer(ifd)||!Number.isSafeInteger(fileSize)||
     fileSize<16)return {status:'invalidXmpPointer'};
  const le=header[0]===73&&header[1]===73&&header[2]===42&&header[3]===0;
  const be=header[0]===77&&header[1]===77&&header[2]===0&&header[3]===42;
  if(!le&&!be)return {status:'notClassicTiff'};
  const u16=(p)=>le?ifd.readUInt16LE(p):ifd.readUInt16BE(p);
  const u32=(p)=>le?ifd.readUInt32LE(p):ifd.readUInt32BE(p);
  if(ifd.length<2)return {status:'invalidXmpPointer'};
  const n=u16(0);
  if(n>64||ifd.length<2+n*12+4)return {status:'invalidXmpPointer'};
  let found;
  for(let i=0;i<n;i++){
    const pos=2+i*12;
    if(u16(pos)!==700)continue;
    if(found)return {status:'invalidXmpPointer'};
    found={type:u16(pos+2),bytes:u32(pos+4),offset:u32(pos+8)};
  }
  if(!found)return {status:'xmpTagMissing'};
  if(![1,2,7].includes(found.type)||found.bytes<16)
    return {status:'invalidXmpPointer'};
  if(found.bytes>32768)return {status:'xmpTooLarge'};
  if(found.offset<8||found.offset+found.bytes>fileSize)
    return {status:'invalidXmpPointer'};
  return {status:'ok',offset:found.offset,length:found.bytes};
}
function extractEnumValue(xml,name){
  // Only the two common RDF encodings. Repeated or mixed values fail closed.
  const escaped=name.replace(/[^A-Za-z0-9]/g,'');
  const values=[];
  const attr=new RegExp('(?:\\s)drone-dji:'+escaped+'\\s*=\\s*["\\x27]([A-Za-z_]{1,32})["\\x27]','g');
  const tag=new RegExp('<drone-dji:'+escaped+'\\s*>\\s*([A-Za-z_]{1,32})\\s*</drone-dji:'+escaped+'\\s*>','g');
  for(const pattern of [attr,tag]){
    let m;
    while((m=pattern.exec(xml))!==null){
      values.push(m[1]);
      if(values.length>2)return null;
    }
  }
  return values.length===1?values[0]:null;
}
function bandFromName(value){
  return value==='Green'?'G':value==='Red'?'R':
    value==='RedEdge'?'RE':value==='NIR'?'NIR':null;
}
function bandFromSource(value){
  const m=/^MS_(G|R|RE|NIR)_CAMERA$/.exec(value||'');
  return m?m[1]:null;
}
function classifyDJIXmp(bytes){
  if(!Buffer.isBuffer(bytes)||bytes.length<16||bytes.length>32768)
    return recordStatus('unavailable');
  const text=bytes.toString('utf8');
  // XMP: require a real XML-ish document wrapper; never parse arbitrary text
  // as sufficient evidence of DJI provenance.
  if(!/<(?:\w+:)?(?:xmpmeta|RDF)\b/.test(text)||
     !/xmlns:drone-dji\s*=\s*["\x27]http:\/\/www\.dji\.com\/drone-dji\/1\.0\/["\x27]/.test(text))
    return recordStatus('xmpNotRecognized');
  const presence=Object.fromEntries(MARKERS.map(name=>{
    const tag=new RegExp('<drone-dji:'+name+'(?:\\s|/?>)');
    const attr=new RegExp('(?:\\s)drone-dji:'+name+'\\s*=');
    return [name,tag.test(text)||attr.test(text)];
  }));
  const fromName=bandFromName(extractEnumValue(text,'BandName'));
  const fromSource=bandFromSource(extractEnumValue(text,'ImageSource'));
  const inconsistent=fromName&&fromSource&&fromName!==fromSource;
  // If a field is present but duplicated, malformed or outside our enum,
  // a value from the *other* field must not silently infer a band.
  const unresolved=(presence.BandName&&!fromName)||
    (presence.ImageSource&&!fromSource);
  return {status:'ok',
    bandHint:inconsistent?'inconsistent':
      unresolved?'unknown':(fromName||fromSource||'unknown'),
    djiFieldPresence:presence};
}
function summarizeXmp(records){
  if(!Array.isArray(records)||records.length>12)throw new RangeError('Too many XMP records');
  const status=Object.fromEntries(STATUSES.map(x=>[x,0]));
  const bandHints=Object.fromEntries(BAND_HINTS.map(x=>[x,0]));
  const fieldPresenceCount=Object.fromEntries(MARKERS.map(x=>[x,0]));
  for(const r of records){
    if(!r||!STATUSES.includes(r.status)||!BAND_HINTS.includes(r.bandHint)||
      !r.djiFieldPresence||typeof r.djiFieldPresence!=='object'||
      Object.keys(r.djiFieldPresence).length!==MARKERS.length||
      MARKERS.some(x=>typeof r.djiFieldPresence[x]!=='boolean'))
      throw new RangeError('Invalid XMP record');
    status[r.status]++;bandHints[r.bandHint]++;
    for(const name of MARKERS)fieldPresenceCount[name]+=Number(r.djiFieldPresence[name]);
  }
  return {
    schema:'skyhub-m3m-xmp-markers-v1',
    classification:'bounded-whitelisted-XMP-markers-only',
    examined:records.length,status,bandHints,fieldPresenceCount,
    imagePayloadVerified:false,m3mSourceVerified:false,
    radiometricCalibrationVerified:false,bandCoregistrationVerified:false,
    reflectanceReady:false,ndviReady:false,ndreReady:false,
    caveat:'XMP marker names and whitelisted band hints do not prove DJI camera origin, calibration, image integrity or vegetative index readiness.'
  };
}

function validateXmpAggregateReport(report,expected){
  // A subprocess can return only these enumerated aggregate fields. Reject
  // untrusted extra keys before printing anything outside the container.
  const baseline=summarizeXmp([]);
  const numeric=(n)=>Number.isSafeInteger(n)&&n>=0&&n<=expected;
  const exactKeys=(value,keys)=>value&&typeof value==='object'&&
    !Array.isArray(value)&&
    Object.keys(value).length===keys.length&&
    keys.every(key=>Object.hasOwn(value,key));
  if(!Number.isInteger(expected)||expected<0||expected>12||
     !exactKeys(report,Object.keys(baseline))||
     report.schema!==baseline.schema||
     report.classification!==baseline.classification||
     report.caveat!==baseline.caveat||
     report.examined!==expected)
    throw new RangeError('Unsafe XMP aggregate report');
  for(const flag of ['imagePayloadVerified','m3mSourceVerified',
    'radiometricCalibrationVerified','bandCoregistrationVerified',
    'reflectanceReady','ndviReady','ndreReady']){
    if(report[flag]!==false)
      throw new RangeError('Unsafe XMP aggregate flags');
  }
  const domains=[
    ['status',STATUSES],
    ['bandHints',BAND_HINTS],
    ['fieldPresenceCount',MARKERS]
  ];
  for(const [name,keys] of domains){
    if(!exactKeys(report[name],keys)||keys.some(key=>!numeric(report[name][key])))
      throw new RangeError('Unsafe XMP aggregate counter');
  }
  const sum=(obj)=>Object.values(obj).reduce((n,v)=>n+v,0);
  if(sum(report.status)!==expected||sum(report.bandHints)!==expected||
     Object.values(report.fieldPresenceCount).some(x=>x>report.status.ok))
    throw new RangeError('Inconsistent XMP aggregate totals');
  // Re-emit only the validated schema; never propagate unverified fields.
  return {
    ...baseline,examined:expected,
    status:Object.fromEntries(STATUSES.map(k=>[k,report.status[k]])),
    bandHints:Object.fromEntries(BAND_HINTS.map(k=>[k,report.bandHints[k]])),
    fieldPresenceCount:Object.fromEntries(
      MARKERS.map(k=>[k,report.fieldPresenceCount[k]]))
  };
}

module.exports={MARKERS,BANDS,BAND_HINTS,STATUSES,EMPTY,recordStatus,
  locateXmpFromIfd,extractEnumValue,bandFromName,bandFromSource,
  classifyDJIXmp,summarizeXmp,validateXmpAggregateReport};
