'use strict';
// Standalone, bounded Classic TIFF first-IFD inspector. Only structural
// scalar tags in the first IFD are considered. No linked offsets are followed.
// No EXIF/XMP/GPS values, object names, pixels or TIFF payloads are exported.
function firstIfdOffset(header){
  if(!Buffer.isBuffer(header)||header.length<8)return null;
  const le=header[0]===73&&header[1]===73&&header[2]===42&&header[3]===0;
  const be=header[0]===77&&header[1]===77&&header[2]===0&&header[3]===42;
  if(!le&&!be)return null; // BigTIFF deliberately out of scope
  const offset=le?header.readUInt32LE(4):header.readUInt32BE(4);
  return offset>=8&&offset<=262144?offset:null;
}
function inspectClassicIfd(header,ifd){
  const empty={dimensionClass:'unknown',sampleClass:'unknown',
    bitsClass:'unknown',compressionClass:'unknown',
    geoTagPresent:false,exifTagPresent:false,xmpTagPresent:false};
  if(!Buffer.isBuffer(header)||header.length<8||
     !Buffer.isBuffer(ifd))return {status:'unavailable',...empty};
  const offset=firstIfdOffset(header);
  if(offset===null)return {status:'unprobeableHeaderOrOffset',...empty};
  const le=header[0]===73;
  const u16=(buf,pos)=>le?buf.readUInt16LE(pos):buf.readUInt16BE(pos);
  const u32=(buf,pos)=>le?buf.readUInt32LE(pos):buf.readUInt32BE(pos);
  if(ifd.length<2)return {status:'truncatedIfd',...empty};
  const count=u16(ifd,0);
  if(count>64)return {status:'tooManyTags',...empty};
  if(ifd.length<2+count*12+4)return {status:'truncatedIfd',...empty};
  const values=new Map();
  let geo=false,exif=false,xmp=false;
  for(let i=0;i<count;i++){
    const pos=2+i*12,tag=u16(ifd,pos),type=u16(ifd,pos+2),
      n=u32(ifd,pos+4);
    if(values.has(tag))return {status:'malformedIfd',...empty};
    let scalar=null;
    // Only the inline SHORT/LONG values of count=1; never dereference.
    if(n===1&&type===3)scalar=u16(ifd,pos+8);
    else if(n===1&&type===4)scalar=u32(ifd,pos+8);
    values.set(tag,{n,scalar});
    if([33550,33922,34264,34735,34736,34737].includes(tag))geo=true;
    if(tag===34665||tag===34853)exif=true;
    if(tag===700)xmp=true;
  }
  const scalar=id=>values.get(id)?.scalar??null;
  const width=scalar(256),height=scalar(257);
  let dimensionClass='unknown';
  if(Number.isInteger(width)&&width>0&&width<=1e6&&
     Number.isInteger(height)&&height>0&&height<=1e6){
    const pixels=width*height;
    dimensionClass=pixels<=5e6?'upTo5MP':pixels<=25e6?'5To25MP':'over25MP';
  }
  const samples=scalar(277);
  const sampleClass=samples===1?'one':samples===3?'three':
    samples===4?'four':samples===null?'unknown':'other';
  const bits=scalar(258);
  const bitsClass=[8,10,12,16,32].includes(bits)?'bits'+bits:
    (values.has(258)&&bits===null)?'externalOrMixed':'unknown';
  const compression=scalar(259);
  const compressionClass=compression===1?'uncompressed':
    compression===null?'unknown':'compressedOrOther';
  return {status:'ok',dimensionClass,sampleClass,bitsClass,
    compressionClass,geoTagPresent:geo,exifTagPresent:exif,
    xmpTagPresent:xmp};
}
function summarizeIfd(records){
  const domains={
    status:['ok','unavailable','rangeNotHonored','unprobeableHeaderOrOffset',
      'tooManyTags','truncatedIfd','malformedIfd'],
    dimensionClass:['upTo5MP','5To25MP','over25MP','unknown'],
    sampleClass:['one','three','four','other','unknown'],
    bitsClass:['bits8','bits10','bits12','bits16','bits32',
      'externalOrMixed','unknown'],
    compressionClass:['uncompressed','compressedOrOther','unknown']
  };
  if(!Array.isArray(records)||records.length>12)throw new RangeError('Invalid IFD record count');
  const summary={};
  for(const [name,choices] of Object.entries(domains))
    summary[name]=Object.fromEntries(choices.map(x=>[x,0]));
  let geoTagPresentCount=0,exifTagPresentCount=0,xmpTagPresentCount=0;
  for(const rec of records){
    if(!rec||typeof rec!=='object'||
       Object.entries(domains).some(([name,opts])=>!opts.includes(rec[name]))||
       ['geoTagPresent','exifTagPresent','xmpTagPresent'].some(x=>typeof rec[x]!=='boolean'))
      throw new RangeError('Invalid IFD category record');
    for(const name of Object.keys(domains))summary[name][rec[name]]++;
    geoTagPresentCount+=Number(rec.geoTagPresent);
    exifTagPresentCount+=Number(rec.exifTagPresent);
    xmpTagPresentCount+=Number(rec.xmpTagPresent);
  }
  return {
    schema:'skyhub-m3m-tiff-ifd-v1',
    classification:'bounded-first-ifd-inline-scalars-only',
    examined:records.length,
    ...summary,geoTagPresentCount,exifTagPresentCount,xmpTagPresentCount,
    m3mSourceVerified:false,radiometricCalibrationVerified:false,
    imagePayloadVerified:false,exifOrXmpValuesRead:false,
    bandCoregistrationVerified:false,reflectanceReady:false,
    ndviReady:false,ndreReady:false,
    caveat:'First-IFD categories and tag presence do not establish image integrity, M3M origin, spectral band, reflectance, geolocation or vegetation-index readiness.'
  };
}
module.exports={firstIfdOffset,inspectClassicIfd,summarizeIfd};
