'use strict';

// A STRICTLY OFFLINE, filename-only Mavic 3M file-set inventory.
// No TIFF/JPEG parsing, no EXIF/XMP inference, no cloud upload, no keys,
// no locations and no claim that grouped files are radiometrically aligned.
// Parsing only recognizes explicit DJI M3M filename patterns. Results expose
// aggregate COUNTS, never original filenames, prefixes, directory names or
// timestamps. Filenames only provide an unverified capture grouping hint.
const BANDS=Object.freeze(['RGB','G','R','RE','NIR']);
const REQUIRED_SPECTRAL=Object.freeze(['G','R','RE','NIR']);
const MAX_ENTRIES=20000;
const MAX_GROUPS=12000;

// DJI_<capture_date_14d>_<sequence_4d>_MS_<band>.TIF
// DJI_<capture_date_14d>_<sequence_4d>_D.JPG
// Sequence-only legacy/export names are intentionally excluded: grouping
// without timestamp is too ambiguous across flights and directories.
const MS=/^DJI_(\d{14})_(\d{4})_MS_(G|R|RE|NIR)\.TIFF?$/i;
const RGB=/^DJI_(\d{14})_(\d{4})_D\.JPE?G$/i;

function identify(name){
  if(typeof name!=='string'||name.length>180||
    /[/\\\0-\x1f]/.test(name))return null;
  let m=MS.exec(name);
  if(m)return {capture:m[1]+'_'+m[2],band:m[3].toUpperCase()};
  m=RGB.exec(name);
  if(m)return {capture:m[1]+'_'+m[2],band:'RGB'};
  return null;
}
function inventoryMediaNames(names){
  if(!Array.isArray(names)||names.length>MAX_ENTRIES)
    throw new RangeError('M3M inventory count out of bounds');
  const groups=new Map();
  const bandCounts=Object.fromEntries(BANDS.map(b=>[b,0]));
  let classified=0,unrecognized=0,invalid=0;
  for(const value of names){
    const n=typeof value==='string'?value:null;
    const item=identify(n);
    if(!item){
      if(n&&/^[\w.\-]{1,180}$/.test(n))unrecognized++;
      else invalid++;
      continue;
    }
    classified++;
    bandCounts[item.band]++;
    let group=groups.get(item.capture);
    if(!group){
      if(groups.size>=MAX_GROUPS)throw new RangeError('Too many capture groups');
      group=Object.fromEntries(BANDS.map(b=>[b,0]));
      groups.set(item.capture,group);
    }
    group[item.band]++;
  }
  let spectralSets=0,fiveChannelSets=0,partialSets=0,duplicateSets=0;
  const missingBands=Object.fromEntries(BANDS.map(b=>[b,0]));
  for(const group of groups.values()){
    const spectral=REQUIRED_SPECTRAL.every(b=>group[b]===1);
    const allFive=spectral&&group.RGB===1;
    const dup=BANDS.some(b=>group[b]>1);
    if(dup)duplicateSets++;
    // Any duplicates make a capture ambiguous, not ready to pair.
    if(!dup&&spectral)spectralSets++;
    if(!dup&&allFive)fiveChannelSets++;
    if(!allFive||dup)partialSets++;
    for(const b of BANDS)if(group[b]===0)missingBands[b]++;
  }
  return Object.freeze({
    schema:'skyhub-m3m-media-inventory-v1',
    classification:'filename-hints-only',
    totalEntries:names.length,classified,unrecognized,invalid,
    bandCounts,captureGroups:groups.size,
    spectralSets,fiveChannelSets,partialSets,duplicateSets,missingBands,
    radiometricCalibrationVerified:false,bandCoregistrationVerified:false,
    reflectanceReady:false,ndviReady:false,ndreReady:false,
    caveat:'Filename matches do not verify M3M origin, image payload, EXIF/XMP, radiometric calibration, alignment or vegetation-index readiness.'
  });
}
module.exports={identify,inventoryMediaNames,BANDS,REQUIRED_SPECTRAL,MAX_ENTRIES};
