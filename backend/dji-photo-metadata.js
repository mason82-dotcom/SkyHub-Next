'use strict';
// Bounded DJI photo metadata discovery for the coverage QA path.
// M4T visible lenses V/W/Z and M3M RGB D are eligible; M4T _T R-JPEG is thermal data
// (handled by thermal.js), M3M MS_* TIFF is multispectral data (handled by ndvi.js).
// XMP fields are evidence only: absence is not filled by guessed camera parameters.
const DJI_NAME=/^DJI_(\d{14})_(\d{4})_(V|W|Z|S|N|D|T|MS_G|MS_R|MS_RE|MS_NIR)\.(JPE?G|TIFF?)$/i;
function classifyCaptureName(name){
  const m=DJI_NAME.exec(String(name||''));
  if(!m)return {kind:'unknown',lens:null};
  const lens=m[3].toUpperCase(),ext=m[4].toUpperCase();
  if(lens==='T'&&/^JPE?G$/.test(ext))return {kind:'thermal',lens};
  if(lens.startsWith('MS_')&&/^TIFF?$/.test(ext))return {kind:'multispectral',lens};
  if(['V','W','Z','S','N','D'].includes(lens)&&/^JPE?G$/.test(ext))
    return {kind:'visible',lens};
  return {kind:'unknown',lens};
}
function readDjiXmp(buffer){
  if(!Buffer.isBuffer(buffer)||buffer.length<10)return null;
  const bound=buffer.subarray(0,Math.min(buffer.length,1024*1024)).toString('utf8');
  const first=bound.indexOf('<x:xmpmeta');
  const last=first<0?-1:bound.indexOf('</x:xmpmeta>',first);
  if(first<0||last<first)return null;
  const xml=bound.slice(first,last+12);
  const field=(name,prefix='drone-dji')=>{
    const tag=prefix+':'+name;
    // DJI standard XMP is attribute-form. Some export tools serialize property elements.
    const a=xml.match(new RegExp(tag+'="([^"]{0,256})"','i'))||
      xml.match(new RegExp(tag+"='([^']{0,256})'",'i'));
    if(a)return a[1].trim();
    const e=xml.match(new RegExp('<'+tag+'(?:\\s[^>]*)?>([^<]{0,256})<\\/'+tag+'>','i'));
    return e?e[1].trim():null;
  };
  const number=name=>{
    const raw=field(name);
    if(raw===null||raw==='')return null;
    const value=Number(raw);
    return Number.isFinite(value)?value:null;
  };
  const lat=number('GpsLatitude'),lon=number('GpsLongitude');
  const rtk=number('RtkFlag');
  return {
    lat:lat!==null&&lat>=-90&&lat<=90?lat:null,
    lon:lon!==null&&lon>=-180&&lon<=180?lon:null,
    relAlt:number('RelativeAltitude'),absAlt:number('AbsoluteAltitude'),
    yaw:number('GimbalYawDegree'),pitch:number('GimbalPitchDegree'),roll:number('GimbalRollDegree'),
    rtkFlag:rtk!==null&&Number.isInteger(rtk)?rtk:null,
    calibratedFocalLength:number('CalibratedFocalLength'),
    model:field('DroneModel')||field('ProductName')||field('Model','tiff'),
    captureUuid:field('CaptureUUID'),bandName:field('BandName'),
    imageSource:field('ImageSource'),utc:field('UTCAtExposure')
  };
}
module.exports={classifyCaptureName,readDjiXmp};
