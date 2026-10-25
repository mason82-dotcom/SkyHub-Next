'use strict';
/* SkyHub WPML waypoint planner. Self-contained browser/Node module.
 * Offline file creation ONLY: not a dispatch API or DJI certification.
 * https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/dji-wpml/
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports=factory(require('./wpml-interval-actions'),require('./wpml-action-draft'));
  else root.SkyHubWpmlPlanner=factory(root.SkyHubWpmlIntervalActions,root.SkyHubWpmlActionDraft);
})(typeof globalThis === 'object' ? globalThis : this, function (intervalActions,actionDraft) {
  const MODELS=Object.freeze({
    mavic3e:Object.freeze({name:'DJI Mavic 3E',drone:77,subtype:0,payload:66}),
    mavic3t:Object.freeze({name:'DJI Mavic 3T',drone:77,subtype:1,payload:67}),
    mavic3m:Object.freeze({name:'DJI Mavic 3M',drone:77,subtype:2,payload:68}),
    matrice4e:Object.freeze({name:'DJI Matrice 4E',drone:99,subtype:0,payload:88}),
    matrice4t:Object.freeze({name:'DJI Matrice 4T',drone:99,subtype:1,payload:89})
  });
  const KML_HEADER='<?xml version="1.0" encoding="UTF-8"?>\n'+
    '<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:wpml="http://www.dji.com/wpmz/1.0.2">\n<Document>\n';
  const KML_FOOTER='</Document>\n</kml>\n';
  function invalid(reason){throw new TypeError('WPML plan invalid: '+reason);}
  function esc(value){return String(value).replace(/[&<>"']/g, c=>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));}
  function numeric(raw,label,min,max){
    if(typeof raw!=='number'&&typeof raw!=='string')invalid(label+' must be numeric');
    if(typeof raw==='string'&&!/^\s*[-+]?(?:\d+(?:\.\d*)?|\.\d+)\s*$/.test(raw))
      invalid(label+' must be numeric');
    const n=Number(raw);
    if(!Number.isFinite(n)||n<min||n>max)invalid(label+' out of range');
    return n;
  }
  function normalize(input){
    if(!input||typeof input!=='object'||Array.isArray(input))invalid('object required');
    const model=MODELS[input.model];
    if(!model)invalid('unsupported aircraft profile');
    const name=input.name??'SkyHub Waypoint Mission';
    if(typeof name!=='string'||name.trim().length<1||name.length>70||
       /[\u0000-\u001f\u007f]/.test(name))invalid('mission name');
    const speed=numeric(input.speed??5,'speed',0.2,15);
    const transitionSpeed=numeric(input.transitionSpeed??speed,'transitionSpeed',0.2,15);
    const takeoffHeight=numeric(input.takeoffHeight??30,'takeoffHeight',1.2,120);
    const finishAction=input.finishAction??'goHome';
    if(!['goHome','noAction'].includes(finishAction))invalid('finishAction');
    if(!Array.isArray(input.waypoints)||input.waypoints.length<2||input.waypoints.length>500)
      invalid('2 to 500 waypoints required');
    const waypoints=input.waypoints.map((point,index)=>{
      if(!point||typeof point!=='object'||Array.isArray(point))invalid('waypoint '+index);
      const lat=numeric(point.lat,'latitude '+index,-90,90);
      const lon=numeric(point.lon,'longitude '+index,-180,180);
      const height=numeric(point.height??50,'height '+index,2,120);
      const ellipsoidHeight=point.ellipsoidHeight===undefined?null:
        numeric(point.ellipsoidHeight,'ellipsoidHeight '+index,-10000,100000);
      if(typeof point.photo!=='undefined'&&typeof point.photo!=='boolean')
        invalid('photo flag '+index);
      return Object.freeze({lat,lon,height,ellipsoidHeight,photo:point.photo===true});
    });
    // Local heights require explicit, independently measured WGS84 ellipsoid heights.
    // Never derive an ellipsoid reference from height relative to takeoff.
    const variableHeight=waypoints.some(p=>p.height!==waypoints[0].height);
    const hasEllipsoid=waypoints.some(p=>p.ellipsoidHeight!==null);
    if(variableHeight&&!hasEllipsoid)
      invalid('variable relative heights require explicit ellipsoidHeight at every waypoint');
    if(hasEllipsoid&&waypoints.some(p=>p.ellipsoidHeight===null))
      invalid('ellipsoidHeight is required at every waypoint when local heights are used');
    const useLocalHeights=variableHeight||hasEllipsoid;
    for(let i=1;i<waypoints.length;i++){
      const a=waypoints[i-1],b=waypoints[i];
      if(a.lat===b.lat&&a.lon===b.lon)invalid('consecutive identical waypoints');
    }
    const intervalPhotos=input.intervalPhotos===undefined?null:
      intervalActions?.normalize(input.intervalPhotos,{
        waypointCount:waypoints.length,speedMps:speed,
        hasWaypointPhoto:waypoints.some(p=>p.photo)
      });
    if(input.intervalPhotos!==undefined&&!intervalActions)
      invalid('interval action module unavailable');
    if(input.actionGroups!==undefined&&!actionDraft)
      invalid('action group module unavailable');
    const actionGroups=input.actionGroups===undefined?Object.freeze([]):
      actionDraft.normalize(input.actionGroups,waypoints.length,
        waypoints.some(p=>p.photo),intervalPhotos!==null);
    const timestamp=input.timestamp??Date.now();
    if(!Number.isSafeInteger(timestamp)||timestamp<0||timestamp>9999999999999)
      invalid('timestamp');
    return Object.freeze({name:name.trim(),modelKey:input.model,model,speed,transitionSpeed,
      takeoffHeight,finishAction,waypoints,useLocalHeights,intervalPhotos,actionGroups,timestamp});
  }
  function field(name,value){return '<wpml:'+name+'>'+esc(value)+'</wpml:'+name+'>';}
  function missionConfig(p){
    return '<wpml:missionConfig>\n'+
      field('flyToWaylineMode','safely')+
      field('finishAction',p.finishAction)+
      field('exitOnRCLost','executeLostAction')+
      field('executeRCLostAction','goBack')+
      field('takeOffSecurityHeight',p.takeoffHeight)+
      field('globalTransitionalSpeed',p.transitionSpeed)+
      '<wpml:droneInfo>'+field('droneEnumValue',p.model.drone)+
      field('droneSubEnumValue',p.model.subtype)+'</wpml:droneInfo>'+
      '<wpml:payloadInfo>'+field('payloadEnumValue',p.model.payload)+
      field('payloadPositionIndex',0)+'</wpml:payloadInfo>'+
      '</wpml:missionConfig>\n';
  }
  function coordinate(point){
    return '<Point><coordinates>'+point.lon+','+point.lat+'</coordinates></Point>';
  }
  function actionGroup(index,id){
    return '<wpml:actionGroup>'+field('actionGroupId',id)+
      field('actionGroupStartIndex',index)+field('actionGroupEndIndex',index)+
      field('actionGroupMode','sequence')+
      '<wpml:actionTrigger>'+field('actionTriggerType','reachPoint')+
      '</wpml:actionTrigger><wpml:action>'+field('actionId',0)+
      field('actionActuatorFunc','takePhoto')+
      '<wpml:actionActuatorFuncParam>'+field('payloadPositionIndex',0)+
      '</wpml:actionActuatorFuncParam></wpml:action></wpml:actionGroup>';
  }
  function documents(plan){
    const p=normalize(plan);
    const metadata='<name>'+esc(p.name)+'</name>'+field('author','SkyHub')+field('createTime',p.timestamp)+
      field('updateTime',p.timestamp);
    const config=missionConfig(p);
    const templateFolder='<Folder>'+field('templateType','waypoint')+
      field('templateId',0)+
      '<wpml:waylineCoordinateSysParam>'+field('coordinateMode','WGS84')+
      field('heightMode','relativeToStartPoint')+
      '</wpml:waylineCoordinateSysParam>'+
      field('autoFlightSpeed',p.speed)+
      field('globalHeight',p.waypoints[0].height)+
      field('gimbalPitchMode','manual')+
      field('globalWaypointTurnMode','toPointAndStopWithDiscontinuityCurvature')+
      p.waypoints.map((point,index)=>
        '<Placemark>'+coordinate(point)+field('index',index)+
        (p.useLocalHeights?field('ellipsoidHeight',point.ellipsoidHeight):'')+
        field('height',point.height)+field('useGlobalHeight',p.useLocalHeights?0:1)+
        field('useGlobalSpeed',1)+field('useGlobalHeadingParam',1)+
        field('useGlobalTurnParam',1)+'</Placemark>').join('')+
      '</Folder>\n';
    let groupId=0;
    // One interval group from waypoint 0 through the last point.
    // DJI Pilot 2/aircraft timing is not certified by this structural export.
    const intervalGroup=p.intervalPhotos?intervalActions.serializeGroup(p.intervalPhotos,{
      waypointCount:p.waypoints.length,speedMps:p.speed,
      hasWaypointPhoto:false,groupId:groupId++
    }).xml:'';
    const waylineFolder='<Folder>'+field('templateId',0)+field('waylineId',0)+
      field('executeHeightMode','relativeToStartPoint')+field('autoFlightSpeed',p.speed)+
      p.waypoints.map((point,index)=>
        '<Placemark>'+coordinate(point)+field('index',index)+
        field('executeHeight',point.height)+field('waypointSpeed',p.speed)+
        '<wpml:waypointHeadingParam>'+
        field('waypointHeadingMode','followWayline')+
        field('waypointHeadingPathMode','followBadArc')+
        '</wpml:waypointHeadingParam>'+
        '<wpml:waypointTurnParam>'+
        field('waypointTurnMode','toPointAndStopWithDiscontinuityCurvature')+
        '</wpml:waypointTurnParam>'+
        (index===0?intervalGroup:'')+
        (point.photo?actionGroup(index,groupId++):'')+
        p.actionGroups.filter(group=>group.index===index).map(group=>
          actionDraft.serializeGroup(group,groupId++)).join('')+'</Placemark>').join('')+
      '</Folder>\n';
    const templateXml=KML_HEADER+metadata+config+templateFolder+KML_FOOTER;
    const waylinesXml=KML_HEADER+metadata+config+waylineFolder+KML_FOOTER;
    return {templateXml,waylinesXml,plan:p};
  }
  function crc32(data){
    let c=0xffffffff;
    for(const b of data){
      c^=b;
      for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);
    }
    return (c^0xffffffff)>>>0;
  }
  function createKmz(templateXml,waylinesXml){
    if(typeof templateXml!=='string'||typeof waylinesXml!=='string')
      invalid('two XML strings required');
    const entries=[['wpmz/template.kml',templateXml],['wpmz/waylines.wpml',waylinesXml]];
    const encode=new TextEncoder(),locals=[],central=[];
    let offset=0,total=0;
    function le(view,pos,val,bytes){
      if(bytes===2)view.setUint16(pos,val,true);else view.setUint32(pos,val,true);
    }
    for(const [path,xml] of entries){
      const name=encode.encode(path),bytes=encode.encode(xml);
      if(bytes.length>2*1024*1024)invalid('XML exceeds size limit');
      const crc=crc32(bytes);
      const local=new Uint8Array(30+name.length+bytes.length);
      const v=new DataView(local.buffer);
      le(v,0,0x04034b50,4);le(v,4,20,2);le(v,6,0x800,2);
      le(v,14,crc,4);le(v,18,bytes.length,4);le(v,22,bytes.length,4);
      le(v,26,name.length,2);
      local.set(name,30);local.set(bytes,30+name.length);
      locals.push(local);
      const dir=new Uint8Array(46+name.length),dv=new DataView(dir.buffer);
      le(dv,0,0x02014b50,4);le(dv,4,20,2);le(dv,6,20,2);
      le(dv,8,0x800,2);le(dv,16,crc,4);le(dv,20,bytes.length,4);
      le(dv,24,bytes.length,4);le(dv,28,name.length,2);le(dv,42,offset,4);
      dir.set(name,46);central.push(dir);
      offset+=local.length;total+=dir.length;
    }
    const end=new Uint8Array(22),e=new DataView(end.buffer);
    le(e,0,0x06054b50,4);le(e,8,2,2);le(e,10,2,2);
    le(e,12,total,4);le(e,16,offset,4);
    const output=new Uint8Array(offset+total+end.length);
    let cursor=0;
    for(const item of [...locals,...central,end]){
      output.set(item,cursor);cursor+=item.length;
    }
    if(output.length>12*1024*1024)invalid('KMZ exceeds size limit');
    return output;
  }
  function build(plan){
    const output=documents(plan);
    return {templateXml:output.templateXml,waylinesXml:output.waylinesXml,
      kmz:createKmz(output.templateXml,output.waylinesXml),
      summary:{name:output.plan.name,aircraft:output.plan.model.name,
        waypointCount:output.plan.waypoints.length,
        photoCount:output.plan.waypoints.filter(x=>x.photo).length+
          output.plan.actionGroups.reduce((n,g)=>n+g.actions.filter(a=>a.type==='takePhoto').length,0),
        actionGroupCount:output.plan.actionGroups.length,
        orderedActionCount:output.plan.actionGroups.reduce((n,g)=>n+g.actions.length,0),
        cameraHardwareVerified:false,
        intervalPhotos:output.plan.intervalPhotos?{
          type:output.plan.intervalPhotos.type,
          interval:output.plan.intervalPhotos.interval,
          unit:output.plan.intervalPhotos.unit,
          hardwareVerified:false
        }:null,
        heightReference:'relativeToStartPoint',
        localHeightMode:output.plan.useLocalHeights,
        minRelativeHeight:Math.min(...output.plan.waypoints.map(p=>p.height)),
        maxRelativeHeight:Math.max(...output.plan.waypoints.map(p=>p.height))},
      flightReady:false,validationScope:'offline-partial'};
  }
  return Object.freeze({MODELS,normalize,documents,createKmz,build});
});
