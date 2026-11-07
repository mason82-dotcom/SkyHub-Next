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

// Conservative classification of UNKNOWN names only. These buckets are fixed
// labels, NEVER a reflection of input extensions, tokens or object keys.
// Counts are not proof that a file is a valid image or came from an M3M.
const UNKNOWN_FORMATS=Object.freeze([
  'JPEG','TIFF','DNG','PNG','MP4','MOV','LRF','SRT','JSON','XML',
  'KMZ','OTHER_EXTENSION','NO_EXTENSION'
]);
function unknownFormat(name){
  if(typeof name!=='string')return 'NO_EXTENSION';
  const ext=/\.([a-z0-9]{1,32})$/i.exec(name);
  if(!ext)return 'NO_EXTENSION';
  const suffix=ext[1].toUpperCase();
  if(suffix==='JPG'||suffix==='JPEG')return 'JPEG';
  if(suffix==='TIF'||suffix==='TIFF')return 'TIFF';
  return UNKNOWN_FORMATS.includes(suffix)?suffix:'OTHER_EXTENSION';
}

// Fixed and deliberately narrow TIFF naming hints. These describe only
// literal suffix/tokens in the object filename, never verified TIFF contents.
// Priority is exclusive, so the four categories always sum to the unknown
// TIFF filename count; arbitrary identifiers never enter the report.
const TIFF_HINT_BANDS=Object.freeze(['G','R','RE','NIR']);
function classifyUnknownTiffName(name){
  const stem=name.replace(/\.TIFF?$/i,'').toUpperCase();
  const spectral=/(?:^|[_-])MS[_-](G|R|RE|NIR)$/.exec(stem);
  if(spectral)return {category:'spectralBandSuffix',band:spectral[1]};
  if(/(?:^|[_-])(NDVI|NDRE|GNDVI|OSAVI|SAVI|EVI)(?:[_-]|$)/.test(stem))
    return {category:'vegetationIndex'};
  if(/(?:^|[_-])(ORTHOMOSAIC|ORTHO|MOSAIC|DSM|DTM|DEM)(?:[_-]|$)/.test(stem))
    return {category:'mosaicOrElevation'};
  return {category:'other'};
}
function inventoryMediaNames(names){
  if(!Array.isArray(names)||names.length>MAX_ENTRIES)
    throw new RangeError('M3M inventory count out of bounds');
  const groups=new Map();
  const bandCounts=Object.fromEntries(BANDS.map(b=>[b,0]));
  let classified=0,unrecognized=0,invalid=0;
  const unrecognizedFormats=Object.fromEntries(UNKNOWN_FORMATS.map(x=>[x,0]));
  let unrecognizedDjiPrefixedImages=0;
  let unrecognizedOtherImages=0;
  // Cross-tabulation uses fixed labels only. No input strings are echoed.
  const imageFormats=['JPEG','TIFF','DNG','PNG'];
  const unrecognizedImagesByPrefix={
    djiPrefixed:Object.fromEntries(imageFormats.map(x=>[x,0])),
    other:Object.fromEntries(imageFormats.map(x=>[x,0]))
  };
  const unrecognizedTiffNameHints={
    spectralBandSuffix:Object.fromEntries(TIFF_HINT_BANDS.map(x=>[x,0])),
    vegetationIndex:0,
    mosaicOrElevation:0,
    other:0
  };
  for(const value of names){
    const n=typeof value==='string'?value:null;
    const item=identify(n);
    if(!item){
      if(n&&/^[\w.-]{1,180}$/.test(n)){
        unrecognized++;
        const format=unknownFormat(n);
        unrecognizedFormats[format]++;
        if(format==='TIFF'){
          const hint=classifyUnknownTiffName(n);
          if(hint.category==='spectralBandSuffix')
            unrecognizedTiffNameHints.spectralBandSuffix[hint.band]++;
          else
            unrecognizedTiffNameHints[hint.category]++;
        }
        if(imageFormats.includes(format)){
          if(/^DJI_/i.test(n)){
            unrecognizedDjiPrefixedImages++;
            unrecognizedImagesByPrefix.djiPrefixed[format]++;
          }else{
            unrecognizedOtherImages++;
            unrecognizedImagesByPrefix.other[format]++;
          }
        }
      }else invalid++;
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
    unrecognizedFormats,unrecognizedDjiPrefixedImages,unrecognizedOtherImages,
    unrecognizedImagesByPrefix,unrecognizedTiffNameHints,
    bandCounts,captureGroups:groups.size,
    spectralSets,fiveChannelSets,partialSets,duplicateSets,missingBands,
    radiometricCalibrationVerified:false,bandCoregistrationVerified:false,
    reflectanceReady:false,ndviReady:false,ndreReady:false,
    caveat:'Filename matches do not verify M3M origin, image payload, EXIF/XMP, radiometric calibration, alignment or vegetation-index readiness.'
  });
}
module.exports={identify,inventoryMediaNames,BANDS,REQUIRED_SPECTRAL,MAX_ENTRIES};
