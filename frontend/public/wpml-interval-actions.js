'use strict';
// DJI WPML Common Elements: actionGroup/actionTrigger (multipleDistance | multipleTiming).
// Serializes OFFLINE action-group draft XML only; no DJI mission upload or flight control.
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.SkyHubWpmlIntervalActions=factory();
})(typeof globalThis==='object'?globalThis:this,function(){
  const TYPE_UNITS=Object.freeze({multipleDistance:'m',multipleTiming:'s'});
  function invalid(s){throw new TypeError('DJI WPML interval action invalid: '+s);}
  function strictNumber(value,label,min,max){
    if(typeof value!=='number'&&typeof value!=='string')invalid(label+' must be numeric');
    if(typeof value==='string'&&!/^\s*(?:\d+(?:\.\d*)?|\.\d+)\s*$/.test(value))
      invalid(label+' must be numeric');
    const n=Number(value);
    if(!Number.isFinite(n)||n<min||n>max)invalid(label+' out of supported preview range');
    return n;
  }
  function normalize(config,{waypointCount,speedMps,hasWaypointPhoto}={}){
    if(!config||typeof config!=='object'||Array.isArray(config))
      invalid('configuration must be object');
    if(!Object.hasOwn(TYPE_UNITS,config.type))invalid('unknown trigger type');
    if(!Number.isInteger(waypointCount)||waypointCount<2||waypointCount>500)
      invalid('requires between 2 and 500 route waypoints');
    if(hasWaypointPhoto)invalid('interval photos cannot be combined with reach-point photos');
    const speed=strictNumber(speedMps,'route speed',0.2,15);
    const interval=strictNumber(config.interval,'trigger interval',1,
      config.type==='multipleDistance'?1000:60);
    const knownMin=config.cameraMinIntervalSeconds==null?null:
      strictNumber(config.cameraMinIntervalSeconds,'camera minimum interval',0.1,60);
    const seconds=config.type==='multipleTiming'?interval:interval/speed;
    if(knownMin!==null&&seconds<knownMin)
      invalid('theoretical trigger interval shorter than known camera limit');
    // Flags deliberately never claim the aircraft's real camera/firmware was checked.
    return Object.freeze({
      type:config.type,interval,unit:TYPE_UNITS[config.type],
      theoreticalSecondsAtConfiguredSpeed:seconds,
      cameraMinIntervalSeconds:knownMin,
      cameraTimingVerified:knownMin!==null,
      startIndex:0,endIndex:waypointCount-1,
      flightReady:false,hardwareVerified:false
    });
  }
  function field(name,v){return '<wpml:'+name+'>'+String(v)+'</wpml:'+name+'>';}
  function serializeGroup(config,{waypointCount,speedMps,hasWaypointPhoto=false,groupId=0}={}){
    if(!Number.isInteger(groupId)||groupId<0||groupId>65535)
      invalid('action group id');
    const p=normalize(config,{waypointCount,speedMps,hasWaypointPhoto});
    const xml='<wpml:actionGroup>'+
      field('actionGroupId',groupId)+
      field('actionGroupStartIndex',p.startIndex)+
      field('actionGroupEndIndex',p.endIndex)+
      field('actionGroupMode','sequence')+
      '<wpml:actionTrigger>'+field('actionTriggerType',p.type)+
      field('actionTriggerParam',p.interval)+'</wpml:actionTrigger>'+
      '<wpml:action>'+field('actionId',0)+
      field('actionActuatorFunc','takePhoto')+
      '<wpml:actionActuatorFuncParam>'+
      field('payloadPositionIndex',0)+
      '</wpml:actionActuatorFuncParam></wpml:action>'+
      '</wpml:actionGroup>';
    return Object.freeze({
      xml,mode:p.type,interval:p.interval,unit:p.unit,
      theoreticalSecondsAtConfiguredSpeed:p.theoreticalSecondsAtConfiguredSpeed,
      startIndex:p.startIndex,endIndex:p.endIndex,
      flightReady:false,hardwareVerified:false,
      validationScope:'draft-wpml-action-xml-unverified'
    });
  }
  return Object.freeze({normalize,serializeGroup,TYPE_UNITS});
});
