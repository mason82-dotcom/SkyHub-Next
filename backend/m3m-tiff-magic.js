'use strict';
// Read only the TIFF signature. No pixel, IFD/EXIF/XMP or positional metadata
// is interpreted. These labels are structural, not proof of M3M origin.
const FAMILIES=Object.freeze([
  'classicLittleEndian','classicBigEndian',
  'bigTiffLittleEndian','bigTiffBigEndian',
  'notTiff','tooShort','unavailable','rangeNotHonored'
]);
function classifyMagic(bytes){
  if(!Buffer.isBuffer(bytes))return 'unavailable';
  if(bytes.length<4)return 'tooShort';
  if(bytes.subarray(0,4).equals(Buffer.from([0x49,0x49,0x2a,0x00])))
    return 'classicLittleEndian';
  if(bytes.subarray(0,4).equals(Buffer.from([0x4d,0x4d,0x00,0x2a])))
    return 'classicBigEndian';
  if(bytes.subarray(0,4).equals(Buffer.from([0x49,0x49,0x2b,0x00])))
    return 'bigTiffLittleEndian';
  if(bytes.subarray(0,4).equals(Buffer.from([0x4d,0x4d,0x00,0x2b])))
    return 'bigTiffBigEndian';
  return 'notTiff';
}
function summarizeMagic(labels){
  if(!Array.isArray(labels)||labels.length>12||
     labels.some(x=>!FAMILIES.includes(x)))throw new RangeError('Invalid TIFF probe labels');
  const headerTypes=Object.fromEntries(FAMILIES.map(x=>[x,0]));
  for(const label of labels)headerTypes[label]++;
  return {
    schema:'skyhub-m3m-tiff-magic-v1',
    classification:'first-16-bytes-only',
    examined:labels.length,headerTypes,
    tiffSignatureConfirmed:['classicLittleEndian','classicBigEndian',
      'bigTiffLittleEndian','bigTiffBigEndian']
      .reduce((n,x)=>n+headerTypes[x],0),
    imagePayloadVerified:false,exifOrXmpVerified:false,
    m3mSourceVerified:false,radiometricCalibrationVerified:false,
    reflectanceReady:false,ndviReady:false,ndreReady:false,
    caveat:'A TIFF signature proves container magic only, not image content, spectral channels, calibration or georeferencing.'
  };
}
module.exports={FAMILIES,classifyMagic,summarizeMagic};
