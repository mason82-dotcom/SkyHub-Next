// Manufacturer-described Mavic 3 Enterprise variants and adjacent M3M.
// This is a static capability reference, not a hardware-support certification.
export const MAVIC3_MODELS=Object.freeze([
  Object.freeze({id:'m3e',name:'DJI Mavic 3E',group:'Enterprise-Serie',
    focus:'RGB-Vermessung und Photogrammetrie',
    imaging:'4/3-CMOS · 20 MP · mechanischer Verschluss · Telekamera',
    modules:Object.freeze(['RGB / Mapping','RTK-Referenz','WPML-Entwurf']),
    hasThermal:false,hasMultispectral:false,
    note:'Keine Wärmebild- oder Multispektralkamera. RTK-Verfügbarkeit muss am Gerät geprüft werden.'}),
  Object.freeze({id:'m3t',name:'DJI Mavic 3T',group:'Enterprise-Serie',
    focus:'Thermische Inspektion',
    imaging:'Wärmebild 640 × 512 · Weitwinkel · Telekamera',
    modules:Object.freeze(['Thermal / R-JPEG','RGB-Inspektion','WPML-Entwurf']),
    hasThermal:true,hasMultispectral:false,
    note:'Radiometrische Messungen benötigen passende R-JPEGs und nachgewiesene Kalibrierung.'}),
  Object.freeze({id:'m3ta',name:'DJI Mavic 3T Advanced',group:'Enterprise-Serie',
    focus:'Thermische Inspektion – Advanced-Sensor',
    imaging:'Thermal 640 × 512 · 8 µm Pixelpitch · 60-mm-Äquivalent',
    modules:Object.freeze(['Thermal / R-JPEG','RGB-Inspektion','WPML-Entwurf']),
    hasThermal:true,hasMultispectral:false,
    note:'Eigenes Thermal-Sensorprofil; nicht mit dem M3T-Basismodell gleichsetzen. Cloud-/SDK-Unterstützung separat nachweisen.'}),
  Object.freeze({id:'m3m',name:'DJI Mavic 3M',group:'Multispectral – verwandte Baureihe',
    focus:'Landwirtschaft und multispektrale Kartierung',
    imaging:'RGB 20 MP · vier 5-MP-Bänder: G, R, Red Edge, NIR',
    modules:Object.freeze(['Multispektral / NDVI','RGB / Mapping','WPML-Entwurf']),
    hasThermal:false,hasMultispectral:true,
    note:'Eigenständige DJI Multispectral-Produktlinie. NDVI erfordert geeignete Bilddaten und Qualitätsprüfung; kein Thermal-Sensor.'})
]);
const MATCHERS=Object.freeze([
  ['m3ta',/(?:^|\\s)(?:m3ta|mavic\\s*3ta|mavic\\s*3t\\s*advanced)(?:$|\\s)/],
  ['m3m',/(?:^|\\s)(?:m3m|mavic\\s*3m|mavic\\s*3\\s*multispectral)(?:$|\\s)/],
  ['m3t',/(?:^|\\s)(?:m3t|mavic\\s*3t|mavic\\s*3\\s*thermal)(?:$|\\s)/],
  ['m3e',/(?:^|\\s)(?:m3e|mavic\\s*3e|mavic\\s*3\\s*enterprise)(?:$|\\s)/]
]);
export function matchMavic3Model(value){
  if(typeof value!=='string'||value.length>160)return null;
  const normalized=value.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  const found=MATCHERS.find(([,pattern])=>pattern.test(normalized));
  return found?MAVIC3_MODELS.find(model=>model.id===found[0]):null;
}
export function countMavic3Registry(devices){
  if(!Array.isArray(devices))return [];
  return devices.filter(d=>d&&typeof d==='object').map(d=>({device:d,model:matchMavic3Model(d.modelName)})).filter(d=>d.model!==null);
}
