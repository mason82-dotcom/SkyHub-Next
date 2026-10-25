'use strict';

// Value-free, documentation-based Mavic 3M applicability context.
// DJI M3M has RGB + multispectral (G/R/RE/NIR) cameras, NOT a thermal
// temperature-measuring imager. NIR reflectance != thermal IR.
// M3-series MQTT property tables are shared and include camera variants
// that may never be emitted by this particular hardware/firmware.
// Classification changes DIAGNOSTIC INTERPRETATION only, not the DJI schema,
// property parser, DJI topics, or flight/control behavior.
const {fieldDefinitions}=require('./dji-properties');

const M3M_MODEL=Object.freeze({domain:'0',type:77,subType:2});
const GROUPS=Object.freeze([
  {key:'thermalCamera',label:'Thermische IR-Mess-/Zoomfelder (M3M ohne Waermebildsensor)',
    pattern:/^osd:cameras\.(?:ir_metering_(?:mode|point|area)(?:\.|$)|ir_zoom_factor$)/},
  {key:'zoomCamera',label:'Zoom-/FOV-Felder einer geteilten M3-Kamerafamilie (nicht nachgewiesen)',
    pattern:/^osd:cameras\.(?:zoom_[a-z_]+(?:\.|$)|liveview_world_region(?:\.|$))/},
  {key:'rgbCameraControls',label:'Optionale RGB-/Wide-Belichtungsfelder (nicht nachgewiesen)',
    pattern:/^osd:cameras\.wide_[a-z_]+(?:\.|$)/},
  {key:'otherCameraOptions',label:'Sonstige Kamera-/Anzeigefunktionen (nicht nachgewiesen)',
    pattern:/^osd:cameras(?:\.|$)/},
  {key:'eventState',label:'Einzelne State-Feldpfade bislang nicht beobachtet (pushMode 1)',
    pattern:/^state:/},
  {key:'otherOsd',label:'Andere OSD-Felder (nicht beobachtet)',
    pattern:/^osd:/}
]);
const definitions=fieldDefinitions(M3M_MODEL);
// Derive all acceptable names ONLY from the pinned schema. Never echo a
// free-form path, device identity, arbitrary MQTT key or property value.
const rootPush=new Map(definitions.fields.filter(f=>!f.path.includes('.'))
  .map(f=>[f.path,f.push]));
const safeLabels=new Set(definitions.fields.map(f=>
  (rootPush.get(f.path.split('.')[0])===1?'state:':'osd:')+f.path));

function classifyM3MGaps(missingPaths){
  if(!Array.isArray(missingPaths)) return null;
  const unique=[...new Set(missingPaths.filter(x=>
    typeof x==='string'&&safeLabels.has(x)))];
  const groups=Object.fromEntries(GROUPS.map(({key,label})=>
    [key,{label,count:0}]));
  for(const path of unique){
    const group=GROUPS.find(({pattern})=>pattern.test(path));
    if(!group)continue;
    groups[group.key].count++;
  }
  return {
    classified:unique.length,
    groups,
    // A reading of 0 missing thermal fields is *not* proof that a
    // thermal camera is present. It may mean the fields were observed
    // (unexpected schema), censored, or not included in the report.
    interpretation:'Eine Schema-Luecke ist kein Geraetefehler. Thermische Messfelder sind nicht mit multispektralem NIR gleichzusetzen.',
    source:'https://enterprise.dji.com/mavic-3-m/specs'
  };
}
module.exports={classifyM3MGaps,GROUPS};
