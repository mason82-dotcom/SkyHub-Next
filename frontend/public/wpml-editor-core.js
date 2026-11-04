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
    // DJI WPML: wpml:globalRTHHeight is required in waylines.wpml for M3E/M3T/M3M and M4E/M4T.
    // Older SkyHub drafts have no value; 100 m keeps them exportable. Capped like waypoint heights.
    const rthHeight=numeric(input.rthHeight??100,'rthHeight',20,120);
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
      // Optional point of interest (DJI WPML waypointHeadingMode towardPOI: the nose faces it; DJI ignores its altitude)
      // and an absolute gimbal pitch (gimbalRotate action at the waypoint; M3E/M3T range [-90, 35], used for M4 too).
      let poi=null;
      if(point.poi!==undefined&&point.poi!==null){
        if(typeof point.poi!=='object'||Array.isArray(point.poi))invalid('poi '+index);
        poi=Object.freeze({lat:numeric(point.poi.lat,'poi latitude '+index,-90,90),lon:numeric(point.poi.lon,'poi longitude '+index,-180,180)});
        if(poi.lat===lat&&poi.lon===lon)invalid('poi '+index+' equals the waypoint');
      }
      const gimbalPitch=point.gimbalPitch===undefined||point.gimbalPitch===null?null:
        Math.round(numeric(point.gimbalPitch,'gimbalPitch '+index,-90,35)*10)/10;
      return Object.freeze({lat,lon,height,ellipsoidHeight,photo:point.photo===true,poi,gimbalPitch});
    });
    // Turns: 'stop' (default, stop at every waypoint) or 'pass' (fly a curve through it, DJI
    // toPointAndPassWithContinuityCurvature with a damping distance). First and last waypoint always stop.
    const turnMode=input.turnMode??'stop';
    if(!['stop','pass'].includes(turnMode))invalid('turnMode');
    const turnDampingM=turnMode==='pass'?numeric(input.turnDampingM??5,'turnDampingM',0.2,100):null;
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
      takeoffHeight,rthHeight,finishAction,waypoints,useLocalHeights,intervalPhotos,actionGroups,timestamp,
      turnMode,turnDampingM});
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
      field('globalRTHHeight',p.rthHeight)+
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
  // Heading and turn per waypoint, shared by template.kml and waylines.wpml.
  const R_EARTH=6371008.8,RAD=Math.PI/180;
  function distanceM(a,b){
    const dLat=(b.lat-a.lat)*RAD,dLon=(b.lon-a.lon)*RAD;
    const h=Math.sin(dLat/2)**2+Math.cos(a.lat*RAD)*Math.cos(b.lat*RAD)*Math.sin(dLon/2)**2;
    return 2*R_EARTH*Math.asin(Math.min(1,Math.sqrt(h)));
  }
  function headingXml(point){
    return '<wpml:waypointHeadingParam>'+(point.poi?
      field('waypointHeadingMode','towardPOI')+field('waypointHeadingAngle',0)+
      // DJI: "Z-direction orientation towards the POI is not supported, so the altitude can be set to 0".
      field('waypointPoiPoint',point.poi.lat.toFixed(7)+','+point.poi.lon.toFixed(7)+',0.000000'):
      field('waypointHeadingMode','followWayline'))+
      field('waypointHeadingPathMode','followBadArc')+'</wpml:waypointHeadingParam>';
  }
  // DJI: a segment must be longer than the sum of the turn intercepts of its two waypoints → at most 45 % of each.
  function turnXml(p,index){
    const last=p.waypoints.length-1;
    if(p.turnMode!=='pass'||index===0||index===last)
      return '<wpml:waypointTurnParam>'+field('waypointTurnMode','toPointAndStopWithDiscontinuityCurvature')+'</wpml:waypointTurnParam>';
    const w=p.waypoints,limit=0.45*Math.min(distanceM(w[index-1],w[index]),distanceM(w[index],w[index+1]));
    const damping=Math.max(0.2,Math.round(Math.min(p.turnDampingM,limit)*10)/10);
    return '<wpml:waypointTurnParam>'+field('waypointTurnMode','toPointAndPassWithContinuityCurvature')+
      field('waypointTurnDampingDist',damping)+'</wpml:waypointTurnParam>';
  }
  function gimbalGroup(index,id,pitch,photo){
    const action=(aid,func,param)=>'<wpml:action>'+field('actionId',aid)+field('actionActuatorFunc',func)+
      '<wpml:actionActuatorFuncParam>'+param+'</wpml:actionActuatorFuncParam></wpml:action>';
    return '<wpml:actionGroup>'+field('actionGroupId',id)+field('actionGroupStartIndex',index)+field('actionGroupEndIndex',index)+
      field('actionGroupMode','sequence')+'<wpml:actionTrigger>'+field('actionTriggerType','reachPoint')+'</wpml:actionTrigger>'+
      action(0,'gimbalRotate',field('gimbalHeadingYawBase','north')+field('gimbalRotateMode','absoluteAngle')+
        field('gimbalPitchRotateEnable',1)+field('gimbalPitchRotateAngle',pitch)+field('gimbalRollRotateEnable',0)+
        field('gimbalRollRotateAngle',0)+field('gimbalYawRotateEnable',0)+field('gimbalYawRotateAngle',0)+
        field('gimbalRotateTimeEnable',0)+field('gimbalRotateTime',0)+field('payloadPositionIndex',0))+
      (photo?action(1,'takePhoto',field('payloadPositionIndex',0)):'')+'</wpml:actionGroup>';
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
      // Referenced by every Placemark with useGlobalHeadingParam=1 (as in DJI's template example);
      // identical to the per-waypoint heading written into waylines.wpml.
      '<wpml:globalWaypointHeadingParam>'+field('waypointHeadingMode','followWayline')+
      field('waypointHeadingPathMode','followBadArc')+'</wpml:globalWaypointHeadingParam>'+
      field('globalWaypointTurnMode','toPointAndStopWithDiscontinuityCurvature')+
      p.waypoints.map((point,index)=>
        '<Placemark>'+coordinate(point)+field('index',index)+
        (p.useLocalHeights?field('ellipsoidHeight',point.ellipsoidHeight):'')+
        field('height',point.height)+field('useGlobalHeight',p.useLocalHeights?0:1)+
        field('useGlobalSpeed',1)+
        (point.poi?field('useGlobalHeadingParam',0)+headingXml(point):field('useGlobalHeadingParam',1))+
        (p.turnMode==='pass'?field('useGlobalTurnParam',0)+turnXml(p,index)+field('useStraightLine',0):field('useGlobalTurnParam',1))+
        '</Placemark>').join('')+
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
        headingXml(point)+turnXml(p,index)+(p.turnMode==='pass'?field('useStraightLine',0):'')+
        (index===0?intervalGroup:'')+
        (point.gimbalPitch!==null?gimbalGroup(index,groupId++,point.gimbalPitch,point.photo):
          point.photo?actionGroup(index,groupId++):'')+
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
        rthHeight:output.plan.rthHeight,
        localHeightMode:output.plan.useLocalHeights,
        minRelativeHeight:Math.min(...output.plan.waypoints.map(p=>p.height)),
        maxRelativeHeight:Math.max(...output.plan.waypoints.map(p=>p.height))},
      flightReady:false,validationScope:'offline-partial'};
  }
  // Orbit around a point of interest (idea: hdrpano/map-creator single_circle_poi, MIT; droneroute orbit + smart gimbal pitch, MIT).
  // Waypoints on a circle (regular polygon), nose toward the POI, gimbal pitch from height difference and radius, closed loop.
  // Turn damping as in map-creator (30 % of the inner circle radius); documents() caps it to DJI's segment rule.
  function orbit({center,radiusM,points=12,heightM,poiHeightM=0,direction='cw',startBearing=0,photo=true}={}){
    if(!center||typeof center!=='object')invalid('orbit center required');
    const lat0=numeric(center.lat,'orbit center latitude',-90,90),lon0=numeric(center.lon,'orbit center longitude',-180,180);
    const r=numeric(radiusM,'orbit radius',5,500),n=Math.round(numeric(points,'orbit points',4,72));
    const h=numeric(heightM,'orbit height',2,120),poiH=numeric(poiHeightM,'POI height',0,120);
    if(!['cw','ccw'].includes(direction))invalid('orbit direction');
    const start=numeric(startBearing,'start bearing',0,360);
    const pitch=Math.max(-90,Math.min(35,Math.round(-Math.atan2(h-poiH,r)/RAD*10)/10));
    const ang=r/R_EARTH,lat=lat0*RAD,lon=lon0*RAD;
    const waypoints=[];
    for(let i=0;i<=n;i++){                       // i===n closes the loop at the first point
      const brg=((start+(direction==='cw'?1:-1)*360*(i%n)/n)%360+360)%360*RAD;
      const la=Math.asin(Math.sin(lat)*Math.cos(ang)+Math.cos(lat)*Math.sin(ang)*Math.cos(brg));
      const lo=lon+Math.atan2(Math.sin(brg)*Math.sin(ang)*Math.cos(lat),Math.cos(ang)-Math.sin(lat)*Math.sin(la));
      waypoints.push({lat:Math.round(la/RAD*1e7)/1e7,lon:Math.round(lo/RAD*1e7)/1e7,height:h,photo:photo===true&&i<n,
        poi:{lat:lat0,lon:lon0},gimbalPitch:pitch});
    }
    const turnDampingM=Math.max(0.2,Math.round(r*Math.cos(Math.PI/n)*0.3*10)/10);
    return {waypoints,turnMode:'pass',turnDampingM,gimbalPitch:pitch,
      segmentM:Math.round(2*r*Math.sin(Math.PI/n)*10)/10,lengthM:Math.round(2*Math.PI*r)};
  }
  // Local metric frame around a reference point (equirectangular; error < 0.1 % below 2 km, enough for a facade or obstacle check).
  function enu(ref){
    const kx=Math.cos(ref.lat*RAD)*RAD*R_EARTH,ky=RAD*R_EARTH;
    return {to:p=>({x:(p.lon-ref.lon)*kx,y:(p.lat-ref.lat)*ky}),
      from:q=>({lat:Math.round((ref.lat+q.y/ky)*1e7)/1e7,lon:Math.round((ref.lon+q.x/kx)*1e7)/1e7})};
  }
  // Facade scan (idea: hdrpano facade/inspection apps, droneroute; own implementation): rows parallel to the facade A→B at
  // distance d on the chosen side, serpentine from the lowest row up (odd rows staggered by half a column), a photo at every point, nose toward the facade point
  // straight opposite (per-waypoint POI → towardPOI), gimbal level (pitch 0) or as given. Heights relative to the take-off;
  // different heights need DJI's ellipsoid height per waypoint: computed EXACTLY from the operator-entered ellipsoid height
  // of the take-off point (+ relative height), never estimated. Spacing defaults from the camera field of view and overlap.
  function facade({a,b,side='left',distanceM,minHeightM,maxHeightM,rowSpacingM,columnSpacingM,takeoffEllipsoidM,
    gimbalPitch=0,margin=0}={}){
    for(const [p,n] of [[a,'A'],[b,'B']])if(!p||typeof p!=='object')invalid('facade point '+n+' required');
    const A={lat:numeric(a.lat,'A latitude',-90,90),lon:numeric(a.lon,'A longitude',-180,180)};
    const B={lat:numeric(b.lat,'B latitude',-90,90),lon:numeric(b.lon,'B longitude',-180,180)};
    if(!['left','right'].includes(side))invalid('facade side');
    const d=numeric(distanceM,'facade distance',3,100);
    const h0=numeric(minHeightM,'lowest row',2,120),h1=numeric(maxHeightM,'highest row',2,120);
    if(h1<h0)invalid('highest row below lowest row');
    const dv=numeric(rowSpacingM,'row spacing',0.5,50),dh=numeric(columnSpacingM,'column spacing',0.5,100);
    const e0=numeric(takeoffEllipsoidM,'take-off ellipsoid height',-500,9000);
    const pitch=Math.round(numeric(gimbalPitch,'gimbal pitch',-90,35)*10)/10;
    const ext=numeric(margin,'margin',0,50);
    const f=enu(A),pa={x:0,y:0},pb=f.to(B);
    const len=Math.hypot(pb.x,pb.y);
    if(len<2)invalid('facade shorter than 2 m');
    if(len>1000)invalid('facade longer than 1000 m');
    const ux=pb.x/len,uy=pb.y/len;                               // along the facade
    const nx=side==='left'?-uy:uy,ny=side==='left'?ux:-ux;       // outward normal (left/right of A→B)
    const cols=Math.max(2,Math.ceil((len+2*ext)/dh)+1),rows=Math.max(1,Math.floor((h1-h0)/dv+1e-9)+1);
    if(cols*rows>500)invalid('facade scan needs '+cols*rows+' waypoints (max 500): larger spacing');
    const waypoints=[];
    for(let r=0;r<rows;r++){
      const h=Math.round((h0+r*dv)*10)/10;
      for(let k=0;k<cols;k++){
        const c=r%2===0?k:cols-1-k;
        // odd rows shifted by half a column: no two consecutive points at the same 2D position (normalize() forbids them;
        // a purely vertical leg is not verified on Pilot 2) and a staggered grid covers the facade better.
        const t=-ext+(len+2*ext)*c/(cols-1)+(r%2?(len+2*ext)/(cols-1)/2:0);
        const onFacade={x:pa.x+ux*t,y:pa.y+uy*t};
        const wp=f.from({x:onFacade.x+nx*d,y:onFacade.y+ny*d});
        waypoints.push({...wp,height:h,ellipsoidHeight:Math.round((e0+h)*100)/100,photo:true,poi:f.from(onFacade),gimbalPitch:pitch});
      }
    }
    return {waypoints,rows,columns:cols,lengthM:Math.round(len*10)/10,turnMode:'stop'};
  }
  // Suggested spacing from distance, field of view and overlap (footprint = 2·d·tan(FOV/2)).
  function facadeSpacing({distanceM,hfovDeg=73,vfovDeg=53,overlap=0.7}={}){
    const d=numeric(distanceM,'facade distance',3,100),o=numeric(overlap,'overlap',0.3,0.95);
    const w=2*d*Math.tan(numeric(hfovDeg,'hfov',10,120)/2*RAD),h=2*d*Math.tan(numeric(vfovDeg,'vfov',10,120)/2*RAD);
    return {columnSpacingM:Math.max(0.5,Math.round(w*(1-o)*10)/10),rowSpacingM:Math.max(0.5,Math.round(h*(1-o)*10)/10)};
  }
  // Obstacles (operator-entered: position, radius, height above take-off): every route segment is checked in 3D against a
  // vertical cylinder enlarged by a buffer. Returns the conflicts; an empty list proves nothing about unmapped obstacles.
  function obstacleConflicts(waypoints,obstacles,{bufferM=10}={}){
    const out=[];
    if(!Array.isArray(waypoints)||waypoints.length<1||!Array.isArray(obstacles)||!obstacles.length)return out;
    const f=enu(waypoints[0]);
    const pts=waypoints.map(p=>({...f.to(p),h:p.height}));
    obstacles.forEach((o,oi)=>{
      const c=f.to(o),r=numeric(o.radiusM,'obstacle radius',0,500)+bufferM,top=numeric(o.heightM,'obstacle height',0,1000)+bufferM;
      let worst=null;
      for(let i=0;i<pts.length;i++){
        const p=pts[i],q=pts[i+1]||p;
        const vx=q.x-p.x,vy=q.y-p.y,l2=vx*vx+vy*vy;
        const t=l2?Math.max(0,Math.min(1,((c.x-p.x)*vx+(c.y-p.y)*vy)/l2)):0;
        const dist=Math.hypot(p.x+vx*t-c.x,p.y+vy*t-c.y),h=p.h+(q.h-p.h)*t;
        if(dist<r&&h<top&&(!worst||dist<worst.distanceM))worst={obstacle:oi,name:o.name||('Hindernis '+(oi+1)),segment:i+1,
          distanceM:Math.round(dist*10)/10,routeHeightM:Math.round(h*10)/10,obstacleHeightM:o.heightM,radiusM:o.radiusM};
      }
      if(worst)out.push(worst);
    });
    return out;
  }
  return Object.freeze({MODELS,normalize,documents,createKmz,build,orbit,facade,facadeSpacing,obstacleConflicts});
});
