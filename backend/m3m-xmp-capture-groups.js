'use strict';
// DJI Capture UUID is the unique label of one capture per the official 2023
// Mavic 3M Image Processing Guide, p.4. Strict UUIDv4 parser. Never print,
// serialize, hash, log or persist values. Only in-container counts may exit.
const CAPTURE_BANDS=Object.freeze(['G','R','RE','NIR']);
const CAPTURE_STATUSES=Object.freeze(['ok','xmpTagMissing','xmpTooLarge',
  'invalidXmpPointer','notClassicTiff','unavailable','rangeNotHonored',
  'xmpNotRecognized']);
function captureUuidFromXmp(bytes){
  if(!Buffer.isBuffer(bytes)||bytes.length<16||bytes.length>32768)
    return null;
  const text=bytes.toString('utf8');
  // The namespace is checked again here; merely seeing "CaptureUUID" in
  // an unrelated XMP document cannot create a candidate capture group.
  if(!/<(?:\w+:)?(?:xmpmeta|RDF)\b/.test(text)||
     !/xmlns:drone-dji\s*=\s*["\x27]http:\/\/www\.dji\.com\/drone-dji\/1\.0\/["\x27]/.test(text))
    return null;
  // Also count malformed or oversized duplicate attributes/elements:
  // even if a second value fails our strict extractor it must block pairing.
  const markers=(text.match(/(?:\s)drone-dji:Capture(?:UUID|Uuid)\s*=/g)||[]).length+
    (text.match(/<drone-dji:Capture(?:UUID|Uuid)\s*>/g)||[]).length;
  if(markers!==1)return null;
  const found=[];
  // Accept the two observed spelling variants conservatively.
  // Accept only a single unambiguous field, in RDF attribute or element form.
  for(const name of ['CaptureUUID','CaptureUuid']){
    const attr=new RegExp('(?:\\s)drone-dji:'+name+
      '\\s*=\\s*["\\x27]([^"\\x27\\s]{1,48})["\\x27]','g');
    const tag=new RegExp('<drone-dji:'+name+'\\s*>\\s*'+
      '([^<\\s]{1,48})\\s*</drone-dji:'+name+'\\s*>','g');
    for(const regex of [attr,tag]){
      let m;
      while((m=regex.exec(text))!==null){
        found.push(m[1]);
        if(found.length!==1)return null;
      }
    }
  }
  if(found.length!==1)return null;
  if(!/^(?:[a-fA-F0-9]{32}|[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12})$/.test(found[0]))
    return null;
  const normalized=found[0].toLowerCase().replace(/-/g,'');
  // UUIDv4 and RFC-4122 variant as documented by DJI. Arbitrary device IDs,
  // timestamps, serials and capture names are not accepted.
  return /^[a-f0-9]{12}4[a-f0-9]{3}[89ab][a-f0-9]{15}$/.test(normalized)?
    normalized:null;
}
function summarizeCaptureGroups(records){
  if(!Array.isArray(records)||records.length>12)
    throw new RangeError('Unsafe capture group input');
  const bands=Object.fromEntries([...CAPTURE_BANDS,'unknown','inconsistent']
    .map(x=>[x,0]));
  const statuses=Object.fromEntries(CAPTURE_STATUSES.map(x=>[x,0]));
  const groups=new Map();
  let withCaptureUuid=0,withoutCaptureUuid=0;
  for(const item of records){
    if(!item||!CAPTURE_STATUSES.includes(item.status)||
       !Object.hasOwn(bands,item.bandHint)||
       (item.captureUuid!==null&&item.captureUuid!==undefined&&
       (typeof item.captureUuid!=='string'||
        !/^[a-f0-9]{12}4[a-f0-9]{3}[89ab][a-f0-9]{15}$/.test(item.captureUuid))))
      throw new RangeError('Invalid private capture group record');
    statuses[item.status]++;bands[item.bandHint]++;
    // Bad XMP, missing/ambiguous capture label or contradictory bands are
    // never treated as evidence of a complete capture.
    const uuid=item.status==='ok'?item.captureUuid:null;
    if(!uuid){withoutCaptureUuid++;continue;}
    withCaptureUuid++;
    const g=groups.get(uuid)||{G:0,R:0,RE:0,NIR:0,unresolved:0,total:0};
    if(Object.hasOwn(g,item.bandHint)&&CAPTURE_BANDS.includes(item.bandHint))
      g[item.bandHint]++;
    else g.unresolved++;
    g.total++;
    groups.set(uuid,g);
  }
  let redNirCandidateGroups=0,fullFourBandHintGroups=0,
    groupsWithDuplicateBands=0,groupsWithUnresolvedBands=0,
    incompleteBandHintGroups=0;
  for(const g of groups.values()){
    const duplicate=CAPTURE_BANDS.some(b=>g[b]>1);
    const unresolved=g.unresolved>0;
    const full=CAPTURE_BANDS.every(b=>g[b]===1);
    if(duplicate)groupsWithDuplicateBands++;
    if(unresolved)groupsWithUnresolvedBands++;
    if(!full||duplicate||unresolved)incompleteBandHintGroups++;
    if(!duplicate&&!unresolved&&g.R===1&&g.NIR===1)
      redNirCandidateGroups++;
    if(!duplicate&&!unresolved&&full)
      fullFourBandHintGroups++;
  }
  return {
    schema:'skyhub-m3m-capture-uuid-hints-v1',
    classification:'private-XMP-UUID-equality-hints-only',
    examined:records.length,status:statuses,bandHints:bands,
    withCaptureUuid,withoutCaptureUuid,
    uniqueCaptureUuidGroups:groups.size,
    redNirCandidateGroups,fullFourBandHintGroups,
    groupsWithDuplicateBands,groupsWithUnresolvedBands,
    incompleteBandHintGroups,
    m3mSourceVerified:false,imagePayloadVerified:false,
    radiometricCalibrationVerified:false,bandCoregistrationVerified:false,
    reflectanceReady:false,ndviReady:false,ndreReady:false,
    caveat:'Private DJI-style UUID equality and band hints identify only candidate captures; no image registration, radiometric correction, proven origin or NDVI/NDRE readiness.'
  };
}
function validateCaptureAggregate(report,expected){
  const template=summarizeCaptureGroups([]);
  const obj=(value,keys)=>value&&typeof value==='object'&&
    !Array.isArray(value)&&Object.keys(value).length===keys.length&&
    keys.every(k=>Object.hasOwn(value,k));
  const numeric=(v)=>Number.isSafeInteger(v)&&v>=0&&v<=expected;
  if(!Number.isSafeInteger(expected)||expected<0||expected>12||
     !obj(report,Object.keys(template))||
     ['schema','classification','caveat'].some(k=>report[k]!==template[k])||
     report.examined!==expected)throw new RangeError('Invalid capture aggregate schema');
  for(const k of ['m3mSourceVerified','imagePayloadVerified',
    'radiometricCalibrationVerified','bandCoregistrationVerified',
    'reflectanceReady','ndviReady','ndreReady'])
    if(report[k]!==false)throw new RangeError('Invalid capture safety flags');
  for(const [domain,keys] of [
    ['status',CAPTURE_STATUSES],
    ['bandHints',[...CAPTURE_BANDS,'unknown','inconsistent']]
  ]){
    if(!obj(report[domain],keys)||keys.some(k=>!numeric(report[domain][k])))
      throw new RangeError('Invalid capture domain');
  }
  for(const k of ['withCaptureUuid','withoutCaptureUuid',
    'uniqueCaptureUuidGroups','redNirCandidateGroups',
    'fullFourBandHintGroups','groupsWithDuplicateBands',
    'groupsWithUnresolvedBands','incompleteBandHintGroups'])
    if(!numeric(report[k]))throw new RangeError('Invalid capture count');
  const sum=vals=>Object.values(vals).reduce((a,b)=>a+b,0);
  if(sum(report.status)!==expected||sum(report.bandHints)!==expected||
     report.withCaptureUuid+report.withoutCaptureUuid!==expected||
     report.withCaptureUuid>report.status.ok||
     report.uniqueCaptureUuidGroups>report.withCaptureUuid||
     report.redNirCandidateGroups>report.uniqueCaptureUuidGroups||
     report.redNirCandidateGroups>report.bandHints.R||
     report.redNirCandidateGroups>report.bandHints.NIR||
     report.fullFourBandHintGroups>report.bandHints.G||
     report.fullFourBandHintGroups>report.bandHints.RE||
     report.fullFourBandHintGroups>report.redNirCandidateGroups||
     report.groupsWithDuplicateBands>report.uniqueCaptureUuidGroups||
     report.groupsWithUnresolvedBands>report.uniqueCaptureUuidGroups||
     report.incompleteBandHintGroups>report.uniqueCaptureUuidGroups||
     report.fullFourBandHintGroups+report.incompleteBandHintGroups!==
       report.uniqueCaptureUuidGroups)
    throw new RangeError('Inconsistent capture aggregate counts');
  return {
    ...template,examined:expected,
    status:Object.fromEntries(CAPTURE_STATUSES.map(k=>[k,report.status[k]])),
    bandHints:Object.fromEntries([...CAPTURE_BANDS,'unknown','inconsistent']
      .map(k=>[k,report.bandHints[k]])),
    ...Object.fromEntries([
      'withCaptureUuid','withoutCaptureUuid','uniqueCaptureUuidGroups',
      'redNirCandidateGroups','fullFourBandHintGroups',
      'groupsWithDuplicateBands','groupsWithUnresolvedBands',
      'incompleteBandHintGroups'
    ].map(k=>[k,report[k]]))
  };
}
module.exports={CAPTURE_BANDS,CAPTURE_STATUSES,captureUuidFromXmp,
  summarizeCaptureGroups,validateCaptureAggregate};
