'use strict';
/* DJI WPML offline action-draft subset. Never dispatches missions. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.SkyHubWpmlActionDraft=factory();
})(typeof globalThis==='object'?globalThis:this,function(){
  const TYPES=Object.freeze(['takePhoto','hover','rotateYaw','startRecord','stopRecord']);
  function bad(){throw new TypeError('WPML-Aktionsentwurf ungültig oder nicht unterstützt');}
  function keys(obj,allowed){
    if(!obj||typeof obj!=='object'||Array.isArray(obj)||
       Object.keys(obj).some(key=>!allowed.includes(key)))bad();
  }
  function number(value,min,max){
    if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)bad();
    return value;
  }
  function index(value,max){
    if(!Number.isInteger(value)||value<0||value>=max)bad();
    return value;
  }
  function normalize(groups,waypointCount,legacyPhotos=false,intervalPhotos=false){
    if(!Array.isArray(groups)||groups.length>waypointCount||groups.length>500||
       !Number.isInteger(waypointCount)||waypointCount<2||waypointCount>500)bad();
    if(groups.length&&(legacyPhotos||intervalPhotos))bad();
    const used=new Set();let recording=false;
    const normalized=groups.map(group=>{
      keys(group,['index','actions']);
      const at=index(group.index,waypointCount);
      if(used.has(at))bad();
      used.add(at);
      if(!Array.isArray(group.actions)||group.actions.length<1||group.actions.length>8)bad();
      const actions=group.actions.map(action=>{
        keys(action,['type','seconds','degrees']);
        if(!TYPES.includes(action.type))bad();
        if(action.type==='takePhoto'||action.type==='startRecord'||action.type==='stopRecord'){
          if(Object.keys(action).some(key=>key!=='type'))bad();
          return Object.freeze({type:action.type});
        }
        if(action.type==='hover'){
          if(Object.keys(action).some(key=>key!=='type'&&key!=='seconds'))bad();
          return Object.freeze({type:'hover',seconds:number(action.seconds,0.1,120)});
        }
        if(Object.keys(action).some(key=>key!=='type'&&key!=='degrees'))bad();
        return Object.freeze({type:'rotateYaw',degrees:number(action.degrees,-180,180)});
      });
      return Object.freeze({index:at,actions:Object.freeze(actions)});
    }).sort((a,b)=>a.index-b.index);
    // Recording state follows flight order, not array-input order.
    for(const g of normalized){
      for(const a of g.actions){
        if(a.type==='startRecord'){if(recording)bad();recording=true;}
        if(a.type==='stopRecord'){if(!recording)bad();recording=false;}
      }
    }
    if(recording)bad();
    return Object.freeze(normalized);
  }
  function xmlField(name,v){return '<wpml:'+name+'>'+v+'</wpml:'+name+'>';}
  function serializeGroup(group,id){
    if(!Number.isInteger(id)||id<0||id>65535)bad();
    const actions=group.actions.map((a,n)=>{
      let params='';
      if(a.type==='takePhoto'||a.type==='startRecord'||a.type==='stopRecord')
        params=xmlField('payloadPositionIndex',0);
      else if(a.type==='hover')params=xmlField('hoverTime',a.seconds);
      else if(a.type==='rotateYaw')params=xmlField('aircraftHeading',a.degrees);
      else bad();
      return '<wpml:action>'+xmlField('actionId',n)+xmlField('actionActuatorFunc',a.type)+
        '<wpml:actionActuatorFuncParam>'+params+'</wpml:actionActuatorFuncParam></wpml:action>';
    }).join('');
    return '<wpml:actionGroup>'+xmlField('actionGroupId',id)+
      xmlField('actionGroupStartIndex',group.index)+xmlField('actionGroupEndIndex',group.index)+
      xmlField('actionGroupMode','sequence')+
      '<wpml:actionTrigger>'+xmlField('actionTriggerType','reachPoint')+
      '</wpml:actionTrigger>'+actions+'</wpml:actionGroup>';
  }
  const TEMPLATES=Object.freeze({
    photo:Object.freeze([{type:'takePhoto'}]),
    hoverPhoto:Object.freeze([{type:'hover',seconds:2},{type:'takePhoto'}]),
    yawPhoto:Object.freeze([{type:'rotateYaw',degrees:0},{type:'takePhoto'}])
  });
  function copy(value){return JSON.parse(JSON.stringify(value));}
  function applyTemplate(groups,waypointCount,{indices,template,mode='replace'}={}){
    if(!Object.hasOwn(TEMPLATES,template)||!['replace','append'].includes(mode)||
       !Array.isArray(indices)||indices.length<1||indices.length>waypointCount)bad();
    const selected=new Set(indices);
    if(selected.size!==indices.length||indices.some(i=>!Number.isInteger(i)||i<0||i>=waypointCount))bad();
    const existing=normalize(groups,waypointCount);
    const draft=existing.map(g=>({index:g.index,actions:copy(g.actions)}));
    for(const at of indices){
      const item=draft.find(g=>g.index===at);
      if(!item)draft.push({index:at,actions:copy(TEMPLATES[template])});
      else if(mode==='replace')item.actions=copy(TEMPLATES[template]);
      else item.actions.push(...copy(TEMPLATES[template]));
    }
    const result=normalize(draft,waypointCount);
    // No implicit changes to waypoint coordinates; even valid action sets
    // are NOT hardware reviewed.
    return {groups:copy(result),requiresReview:true,flightReady:false};
  }
  function reverseRoute(plan){
    if(!plan||typeof plan!=='object'||Array.isArray(plan)||
       !Array.isArray(plan.waypoints)||plan.waypoints.length<2||
       plan.waypoints.length>500)bad();
    const count=plan.waypoints.length;
    keys(plan,['name','model','speed','transitionSpeed','takeoffHeight',
      'finishAction','timestamp','waypoints','actionGroups']);
    if(plan.intervalPhotos||plan.waypoints.some(p=>p.photo===true))bad();
    for(const p of plan.waypoints){
      keys(p,['lat','lon','height','photo']);
      if(!Number.isFinite(p.lat)||p.lat< -90||p.lat>90||
         !Number.isFinite(p.lon)||p.lon< -180||p.lon>180||
         !Number.isFinite(p.height)||p.height<2||p.height>120)bad();
    }
    if(plan.waypoints.some(p=>p.height!==plan.waypoints[0].height))bad();
    const groups=normalize(plan.actionGroups||[],count);
    // Reversing stop/start video semantics safely requires DJI/Pilot 2
    // behavioral evidence. Do not infer equivalent recording behavior.
    if(groups.some(g=>g.actions.some(a=>a.type==='startRecord'||a.type==='stopRecord')))bad();
    const reversed={
      ...copy(plan),
      waypoints:copy(plan.waypoints).reverse(),
      actionGroups:groups.map(g=>({
        index:count-1-g.index,actions:copy(g.actions)
      })).sort((a,b)=>a.index-b.index)
    };
    normalize(reversed.actionGroups,count);
    return {plan:reversed,requiresReview:true,flightReady:false,
      cameraHardwareVerified:false,headingAndRthRevalidationRequired:true};
  }
  return Object.freeze({TYPES,TEMPLATES,normalize,serializeGroup,applyTemplate,reverseRoute});
});
