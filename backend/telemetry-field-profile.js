'use strict';
const {fieldDefinitions,fieldAvailabilityPolicy} = require('./dji-properties');

function hasPath(data, path) {
  const parts = path.split('.');
  function walk(current,index) {
    if (index===parts.length) return current!==null && current!==undefined;
    if (Array.isArray(current)) return current.some(item=>walk(item,index));
    return current !== null && typeof current==='object' &&
      Object.hasOwn(current,parts[index]) && walk(current[parts[index]],index+1);
  }
  return walk(data,0);
}
// Bounded, value-free DJI field inventory grouped by device type. "Typical"
// means supported by the corresponding DJI message family, NOT required in
// every packet or proof of a sensor/fix being currently available.
const GATEWAY_FIELDS=Object.freeze([
  'latitude','longitude','heightEllipsoid','battery','linkQuality'
]);
const AIRCRAFT_FIELDS=Object.freeze([
  'latitude','longitude','altitude','heightEllipsoid','battery','heading',
  'horizontalSpeed','verticalSpeed','attitudePitch','attitudeRoll',
  'homeDistance','remainingFlightTime','gpsSatellites','rtkSatellites',
  'rtkFixState','positionQuality'
]);
const GATEWAY_OPTIONAL=Object.freeze(['sdrLinkState','fourGLinkState','fourGLinkQuality']);
const AIRCRAFT_OPTIONAL=Object.freeze([
  'windSpeed','windDirectionCode','totalFlightTime','totalFlightDistance'
]);
const ALL_FIELDS=Object.freeze([...new Set([
  ...GATEWAY_FIELDS,...AIRCRAFT_FIELDS,...GATEWAY_OPTIONAL,...AIRCRAFT_OPTIONAL
])]);

function isPresent(t,key){return Number.isFinite(t[key]);}
function summarizeTelemetryFields(devices, now=Date.now()){
  if(!Array.isArray(devices))return [];
  return devices.slice(0,200).map((device,index)=>{
    const d=device&&typeof device==='object'?device:{};
    const t=d.telemetry&&typeof d.telemetry==='object'?d.telemetry:{};
    const role=d.role==='gateway'?'gateway':d.deviceCategory==='aircraft'||
      (d.role==='subdevice'&&d.model?.domain==='0')?'aircraft':'unknown';
    const typical=role==='gateway'?GATEWAY_FIELDS:role==='aircraft'?AIRCRAFT_FIELDS:[];
    const extra=role==='gateway'?GATEWAY_OPTIONAL:
      role==='aircraft'?AIRCRAFT_OPTIONAL:ALL_FIELDS;
    const applicable=new Set([...typical,...extra]);
    const observed=typical.filter(key=>isPresent(t,key));
    const notObserved=typical.filter(key=>!isPresent(t,key));
    const extraObserved=extra.filter(key=>isPresent(t,key));
    const extraNotObserved=extra.filter(key=>!isPresent(t,key));
    const notApplicable=ALL_FIELDS.filter(key=>!applicable.has(key));
    // Only fixed known model labels; do not reflect raw DJI fields/identifiers.
    const definitions=fieldDefinitions(d.model);
    const documented=definitions ? definitions.fields : [];
    const accepted=d.deviceProperties&&typeof d.deviceProperties==='object'?d.deviceProperties:{};
    const times=d.propertyFieldObservedAt&&typeof d.propertyFieldObservedAt==='object'?
      d.propertyFieldObservedAt:{};
    const recent=(channel,path)=>{
      const at=times[channel]?.[path];
      return Number.isFinite(at) && at<=now && now-at<15000;
    };
    const observedDocumented=[],notObservedDocumented=[];
    const freshDocumented=[],staleDocumented=[];
    const redactedDocumented=[],unsupportedDocumented=[];
    // Dynamic DJI payload property keys are per-camera indices. Report
    // only the bounded field *names*, never their keys or measurement data.
    const dynamicNames=definitions?.dynamicPayload?.fields??[];
    const payloadItems=Array.isArray(accepted.osd?.payload_gimbals)?
      accepted.osd.payload_gimbals.slice(0,8):[];
    const observedDynamic=dynamicNames.filter(name=>payloadItems.some(item=>
      item&&typeof item==='object'&&Object.hasOwn(item,name)));
    const notObservedDynamic=dynamicNames.filter(name=>!observedDynamic.includes(name));
    const freshDynamic=observedDynamic.filter(name=>recent('osd','payload_gimbals.'+name));
    const pushByRoot=Object.create(null);
    for(const field of documented){
      if(!field.path.includes('.'))pushByRoot[field.path]=field.push;
    }
    for(const field of documented){
      const top=field.path.split('.')[0];
      const channel=pushByRoot[top]===1?'state':'osd';
      const policy=fieldAvailabilityPolicy(field,documented);
      if(policy==='redacted'){redactedDocumented.push(channel+':'+field.path);continue;}
      if(policy==='unsupported-array'){unsupportedDocumented.push(channel+':'+field.path);continue;}
      const label=channel+':'+field.path;
      if(!hasPath(accepted[channel],field.path)){
        notObservedDocumented.push(label);
      }else{
        observedDocumented.push(label);
        (recent(channel,field.path)?freshDocumented:staleDocumented).push(label);
      }
    }
    // Only fixed known model labels; do not reflect raw DJI fields/identifiers.
    const model=['DJI RC Pro Enterprise','DJI RC Plus 2 Enterprise','Mavic 3E',
      'Mavic 3T','Mavic 3M','Matrice 4T','DJI Dock','DJI Dock 2','DJI Dock 3',
      'Matrice 3D','Matrice 3TD','Matrice 4D','Matrice 4TD'].includes(d.modelName)?
      d.modelName:'anderes Gerät';
    return {
      index:index+1,model,role,
      osdFresh:d.fresh===true,positionFresh:d.positionFresh===true,
      positionUnavailable:d.positionUnavailable===true,
      typicalTotal:typical.length,observed,notObserved,
      extraObserved,extraNotObserved,notApplicable,
      documentedTotal:documented.length,
      documentedInspectableTotal:documented.length-redactedDocumented.length-unsupportedDocumented.length,
      documentedSource:definitions?.source??null,
      documentedExtensionSource:definitions?.extensionSource??null,
      documentedExtensionEdition:definitions?.extensionSourceEdition??null,
      documentedConfidence:definitions?.confidence??null,
      observedDocumented,notObservedDocumented,redactedDocumented,unsupportedDocumented,
      freshDocumented,staleDocumented,
      dynamicDocumentedTotal:dynamicNames.length,observedDynamic,notObservedDynamic,freshDynamic
    };
  });
}
module.exports={ALL_FIELDS,GATEWAY_FIELDS,AIRCRAFT_FIELDS,
  GATEWAY_OPTIONAL,AIRCRAFT_OPTIONAL,summarizeTelemetryFields};
