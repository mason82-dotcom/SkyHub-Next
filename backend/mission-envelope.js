'use strict';
// Flight envelope of a DJI WPML route (DJI Cloud API 1.18 / WPML 1.0.x) and the checks that gate a mission release.
// Reads ONLY wpmz/waylines.wpml, the executable file the aircraft flies (template.kml is the editable source).
//   executeHeightMode relativeToStartPoint  height above the take-off point
//   executeHeightMode realTimeFollowSurface height above ground (M3E/M3T/M3M terrain follow)
//   executeHeightMode WGS84                 ellipsoidal height; above take-off only with wpml:takeOffRefPoint
// Manufacturer rules are taken from the DJI Cloud-API-Doc WPML pages pinned in data/dji-wpml-fields.json
// (dji-sdk/Cloud-API-Doc blobs 30.waylines-wpml.md 00656e89…, 20.template-kml.md f593ceb1…), cited as [W:line] / [T:line].
// Errors block a release; warnings must be acknowledged one by one. This is a plausibility gate in front of
// DJI Pilot 2, not an airspace check and not a flight authorisation (risk register M2/M3).
const {readKmz}=require('./wpml-kmz');
const {parseXml,WPML,WPML_REFERENCE_ONLY}=require('./wpml');
// WPML namespaces: 1.0.2 (DJI Cloud API 1.18 examples, SkyHub editor/export) and 1.0.6 (what DJI Pilot 2 on the RC Plus 2
// writes, e.g. routes uploaded from the RC). Decision 04.11.2026: 1.0.6 may be released after the SAME envelope check plus
// an explicit acknowledgement; the file is released unchanged (it came from Pilot 2), it is never edited or re-exported.
const NAMESPACES=Object.freeze([[WPML,'1.0.2'],[WPML_REFERENCE_ONLY,'1.0.6']]);
function parseWpml(xml,only){
  let first=null;
  for(const [ns,version] of NAMESPACES){
    if(only&&ns!==only)continue;
    try{return {root:parseXml(xml,ns),ns,version};}catch(err){first=first||err;}
  }
  throw first;
}
const {assessAircraft}=require('./wpml-product-support');

const DEFAULT_LIMITS=Object.freeze({
  maxHeightM:120,          // EU 2019/947 open category: 120 m above the closest point of the surface
  maxRthHeightM:120,
  maxSpeedMs:15,           // DJI WPML global transition speed cap (see wpml tests)
  maxDurationMin:25,       // conservative single-battery budget for M3M/M4T incl. reserve
  maxDistanceM:2000,       // horizontal distance from the first waypoint / take-off reference
  minWaypointSpacingM:0.5  // closer points are legal in WPML but usually a planning slip (warning)
});
// Dock-only aircraft: Matrice 3D/3TD (91) and Matrice 4D/4TD (100). Without dock hardware no RC can fly them.
const DOCK_ONLY_DRONES=new Set([91,100]);
// [W:149] realTimeFollowSurface "Only supported by M3E/M3T/M3M" = droneEnumValue 77, sub 0/1/2.
const FOLLOW_SURFACE_AIRCRAFT=new Set(['77-0','77-1','77-2']);
// Live template-kml page (updated 2026-03-19): realTimeFollowSurface "(Only applies for mapping)".
const MAPPING_TEMPLATES=new Set(['mapping2d','mapping3d','mappingStrip']);
const RC_TAKEOFF_SECURITY=[1.2,1500];   // [W:133] remote controller range (the dock range [8,1500] does not apply)

const kids=(node,name)=>node?node.children.filter(c=>c.name===name):[];
const one=(node,name)=>kids(node,name)[0]||null;
const text=(node,name)=>{const n=one(node,'wpml:'+name);return n?n.text.trim():null;};
function num(raw){
  if(raw===null||raw===undefined||raw==='')return null;
  const v=Number(raw);
  return Number.isFinite(v)?v:null;
}
function haversine(a,b){
  const R=6371008.8,rad=Math.PI/180;
  const dLat=(b.lat-a.lat)*rad,dLon=(b.lon-a.lon)*rad;
  const h=Math.sin(dLat/2)**2+Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.min(1,Math.sqrt(h)));
}
function parseCoordinates(raw){
  const parts=String(raw||'').trim().split(',');
  if(parts.length<2)return null;
  const lon=num(parts[0]),lat=num(parts[1]);
  if(lat===null||lon===null||Math.abs(lat)>90||Math.abs(lon)>180||(lat===0&&lon===0))return null;
  return {lat,lon};
}
function parseRefPoint(raw){
  // wpml:takeOffRefPoint = "lat,lon,height" (WGS84 ellipsoid), note the lat-first order unlike KML coordinates.
  const p=String(raw||'').split(',').map(s=>num(s.trim()));
  if(p.length!==3||p.some(v=>v===null)||Math.abs(p[0])>90||Math.abs(p[1])>180)return null;
  return {lat:p[0],lon:p[1],height:p[2]};
}
const round=(v,d=1)=>v===null?null:Math.round(v*10**d)/10**d;

function computeEnvelope(waylinesXml,templateXml){
  const errors=[],warnings=[];
  let root,ns,wpmlVersion;
  try{({root,ns,version:wpmlVersion}=parseWpml(waylinesXml));}
  catch(err){return {errors:['waylines.wpml unreadable: '+err.message],warnings,envelope:null};}
  if(wpmlVersion==='1.0.6')warnings.push('WPML 1.0.6 as written by DJI Pilot 2: SkyHub checked the flight envelope, the file is released unchanged (SkyHub itself edits and exports WPML 1.0.2)');
  const doc=one(root,'Document');
  const config=one(doc,'wpml:missionConfig');
  if(!config)return {errors:['wpml:missionConfig missing'],warnings,envelope:null};
  const drone=one(config,'wpml:droneInfo'),payload=one(config,'wpml:payloadInfo');
  const droneType=num(text(drone,'droneEnumValue')),droneSub=num(text(drone,'droneSubEnumValue'))??0;
  const payloadType=num(text(payload,'payloadEnumValue')),payloadIndex=num(text(payload,'payloadPositionIndex'))??0;
  if(droneType===null)errors.push('aircraft (wpml:droneEnumValue) missing: a release must name the aircraft');
  else if(DOCK_ONLY_DRONES.has(droneType))errors.push('dock-only aircraft (droneEnumValue '+droneType+'): no RC on site can fly this route');
  const aircraft=droneType===null?{model:null,errors:[],warnings:[]}:assessAircraft(droneType,droneSub,payloadType,payloadIndex);
  errors.push(...aircraft.errors);warnings.push(...aircraft.warnings);
  // Take-off reference: missionConfig in waylines.wpml or, as written by DJI Pilot 2, in template.kml.
  // [T:163] takeOffRefPoint <latitude,longitude,altitude> (ellipsoid height), template.kml only, optional.
  let ref=parseRefPoint(text(config,'takeOffRefPoint'));
  let templateTypes=[];
  if(templateXml){
    try{
      // template.kml must use the same WPML version as waylines.wpml.
      const tdoc=one(parseWpml(templateXml,ns).root,'Document');
      if(!ref)ref=parseRefPoint(text(one(tdoc,'wpml:missionConfig'),'takeOffRefPoint'));
      templateTypes=kids(tdoc,'Folder').map(f=>text(f,'templateType')).filter(Boolean);
    }catch{ref=ref||null;}
  }
  const rth=num(text(config,'globalRTHHeight')),takeOffSecurity=num(text(config,'takeOffSecurityHeight'));
  const transition=num(text(config,'globalTransitionalSpeed'));
  const finishAction=text(config,'finishAction'),rcLost=text(config,'exitOnRCLost'),rcLostAction=text(config,'executeRCLostAction');
  // [W:135] globalRTHHeight is required in waylines.wpml.
  // WPML 1.0.6 from DJI Pilot 2 carries no globalRTHHeight (seen on the RC Plus 2, 04.11.2026): the aircraft then uses the
  // return-to-home altitude set in Pilot 2, which SkyHub cannot see. Must be acknowledged; for 1.0.2 it stays an error.
  if(rth===null&&wpmlVersion==='1.0.6')
    warnings.push('no return-to-home height in the route (WPML 1.0.6 from Pilot 2): the aircraft uses the RTH altitude set in Pilot 2, check it before take-off');
  else if(rth===null)errors.push('wpml:globalRTHHeight missing (required by DJI WPML waylines.wpml)');
  // [W:133] takeOffSecurityHeight required, remote controller range [1.2, 1500] m.
  if(takeOffSecurity===null)errors.push('wpml:takeOffSecurityHeight missing (required by DJI WPML)');
  else if(takeOffSecurity<RC_TAKEOFF_SECURITY[0]||takeOffSecurity>RC_TAKEOFF_SECURITY[1])
    errors.push('wpml:takeOffSecurityHeight '+takeOffSecurity+' m outside the DJI remote-controller range [1.2, 1500] m');
  // [W:134] globalTransitionalSpeed required, [0, 15] m/s.
  if(transition===null)errors.push('wpml:globalTransitionalSpeed missing (required by DJI WPML)');
  // [W:131/132] exitOnRCLost goContinue|executeLostAction; executeRCLostAction required when executeLostAction.
  if(!['goContinue','executeLostAction'].includes(rcLost))errors.push('wpml:exitOnRCLost missing or invalid: '+JSON.stringify(rcLost));
  if(rcLost==='executeLostAction'&&!['goBack','landing','hover'].includes(rcLostAction))
    errors.push('wpml:executeRCLostAction missing or invalid although exitOnRCLost is executeLostAction');
  // [W:130] finishAction goHome|noAction|autoLand|gotoFirstWaypoint.
  if(!['goHome','noAction','autoLand','gotoFirstWaypoint'].includes(finishAction))
    errors.push('wpml:finishAction missing or invalid: '+JSON.stringify(finishAction));

  const folders=kids(doc,'Folder');
  if(!folders.length)errors.push('no wayline (Folder) in waylines.wpml');
  const points=[],modes=new Set();
  let maxSpeed=transition??0,durationS=0,lengthM=0,minSpacing=null;
  folders.forEach((folder,fi)=>{
    const mode=text(folder,'executeHeightMode');
    modes.add(mode);
    if(!['relativeToStartPoint','realTimeFollowSurface','WGS84'].includes(mode))
      errors.push('wayline '+fi+': unknown executeHeightMode '+JSON.stringify(mode));
    if(mode==='WGS84'&&!ref)
      errors.push('wayline '+fi+': WGS84 heights need wpml:takeOffRefPoint to know the height above take-off');
    if(mode==='WGS84'&&ref)
      warnings.push('wayline '+fi+': WGS84 (ellipsoid) heights; height above take-off uses the planned reference point, but DJI flies from the actual take-off point [T:163]');
    // The WPML pages list terrain follow for M3E/M3T/M3M only; DJI Pilot 2 on the RC Plus 2 itself writes it for the
    // Matrice 4E/4T in WPML 1.0.6 (route "Michaelsberg", 04.11.2026). Accepted only in that combination, with a warning.
    const m4Follow=wpmlVersion==='1.0.6'&&droneType===99;
    if(mode==='realTimeFollowSurface'&&!FOLLOW_SURFACE_AIRCRAFT.has(droneType+'-'+droneSub)&&!m4Follow)
      errors.push('wayline '+fi+': realTimeFollowSurface is only supported by M3E/M3T/M3M (DJI WPML)');
    if(mode==='realTimeFollowSurface'&&m4Follow)
      warnings.push('wayline '+fi+': terrain follow (height above ground) for the Matrice 4 as written by Pilot 2; needs a working downward/terrain sensing and terrain data in Pilot 2');
    if(mode==='realTimeFollowSurface'&&!(templateTypes.length&&templateTypes.every(t=>MAPPING_TEMPLATES.has(t))))
      errors.push('wayline '+fi+': realTimeFollowSurface only applies to mapping templates (DJI WPML template.kml), template is '+
        (templateTypes.join(', ')||'unknown'));
    // [W:147] autoFlightSpeed required, (0, max speed].
    const autoSpeed=num(text(folder,'autoFlightSpeed'));
    if(autoSpeed===null||autoSpeed<=0)errors.push('wayline '+fi+': wpml:autoFlightSpeed missing or not positive');
    if(autoSpeed!==null)maxSpeed=Math.max(maxSpeed,autoSpeed);
    let prev=null;
    kids(folder,'Placemark').forEach((pm,pi)=>{
      const where='wayline '+fi+' waypoint '+pi;
      const pos=parseCoordinates(one(one(pm,'Point'),'coordinates')?.text);
      const h=num(text(pm,'executeHeight')),speed=num(text(pm,'waypointSpeed'))??autoSpeed;
      if(!pos){errors.push(where+': invalid or 0/0 coordinates');return;}
      if(h===null){errors.push(where+': wpml:executeHeight missing');return;}
      const above=mode==='WGS84'?(ref?h-ref.height:null):h;
      if(speed!==null)maxSpeed=Math.max(maxSpeed,speed);
      if(speed!==null&&speed<=0)errors.push(where+': speed must be positive');
      if(prev){
        const d=haversine(prev,pos);
        lengthM+=d;
        minSpacing=minSpacing===null?d:Math.min(minSpacing,d);
        const v=speed||autoSpeed||transition;
        if(v&&v>0)durationS+=d/v;
      }
      points.push({...pos,heightAboveTakeoffM:above,heightMode:mode});
      prev=pos;
    });
  });
  if(!points.length&&folders.length)errors.push('route has no usable waypoints');
  const heights=points.map(p=>p.heightAboveTakeoffM).filter(v=>v!==null);
  const origin=ref||points[0]||null;
  const maxDistance=origin?points.reduce((m,p)=>Math.max(m,haversine(origin,p)),0):null;
  // Transit from take-off to the first waypoint and back (RTH) at transition speed, if a reference is known.
  if(ref&&points.length&&transition&&transition>0)
    durationS+=(haversine(ref,points[0])+haversine(points[points.length-1],ref))/transition;
  const envelope={
    wpmlVersion,aircraft:aircraft.model,droneModelKey:droneType===null?null:'0-'+droneType+'-'+droneSub,
    payloadModelKeys:payloadType===null?[]:['1-'+payloadType+'-0'],
    heightModes:[...modes].filter(Boolean),templateTypes,takeOffRefPoint:ref?{lat:round(ref.lat,7),lon:round(ref.lon,7),height:round(ref.height,1)}:null,
    waylines:folders.length,waypoints:points.length,
    maxHeightAboveTakeoffM:heights.length?round(Math.max(...heights)):null,
    minHeightAboveTakeoffM:heights.length?round(Math.min(...heights)):null,
    rthHeightM:rth,takeOffSecurityHeightM:takeOffSecurity,maxSpeedMs:round(maxSpeed),
    lengthM:Math.round(lengthM),estimatedDurationMin:round(durationS/60),
    maxDistanceFromOriginM:maxDistance===null?null:Math.round(maxDistance),
    minWaypointSpacingM:minSpacing===null?null:round(minSpacing,2),
    finishAction,exitOnRCLost:rcLost,executeRCLostAction:rcLostAction
  };
  // route: waypoints with height above take-off and the take-off reference, for the optional terrain check
  // (mission-terrain.js). Not part of the envelope that is stored with a release.
  return {errors,warnings,envelope,route:{points,ref:ref?{lat:ref.lat,lon:ref.lon}:null}};
}

function checkLimits(envelope,limits=DEFAULT_LIMITS){
  const errors=[],warnings=[];
  if(!envelope)return {errors,warnings};
  const e=envelope,l={...DEFAULT_LIMITS,...limits};
  if(e.maxHeightAboveTakeoffM!==null&&e.maxHeightAboveTakeoffM>l.maxHeightM)
    errors.push('height '+e.maxHeightAboveTakeoffM+' m above take-off exceeds '+l.maxHeightM+' m');
  if(e.heightModes.includes('relativeToStartPoint')||e.heightModes.includes('WGS84'))
    warnings.push('heights are relative to the take-off point, not to the ground: check terrain along the route (rising ground lowers the clearance, falling ground can exceed '+l.maxHeightM+' m above the surface)');
  if(e.minHeightAboveTakeoffM!==null&&e.minHeightAboveTakeoffM<5)
    warnings.push('lowest waypoint '+e.minHeightAboveTakeoffM+' m above take-off: obstacle clearance');
  if(e.rthHeightM!==null&&e.rthHeightM>l.maxRthHeightM)errors.push('RTH height '+e.rthHeightM+' m exceeds '+l.maxRthHeightM+' m');
  if(e.maxSpeedMs!==null&&e.maxSpeedMs>l.maxSpeedMs)errors.push('speed '+e.maxSpeedMs+' m/s exceeds '+l.maxSpeedMs+' m/s');
  if(e.estimatedDurationMin!==null&&e.estimatedDurationMin>l.maxDurationMin)
    errors.push('estimated flight time '+e.estimatedDurationMin+' min exceeds '+l.maxDurationMin+' min');
  if(e.maxDistanceFromOriginM!==null&&e.maxDistanceFromOriginM>l.maxDistanceM)
    errors.push('route reaches '+e.maxDistanceFromOriginM+' m from its origin, more than '+l.maxDistanceM+' m');
  if(e.minWaypointSpacingM!==null&&e.minWaypointSpacingM<l.minWaypointSpacingM)
    warnings.push('two waypoints only '+e.minWaypointSpacingM+' m apart');
  if(e.exitOnRCLost!=='executeLostAction'||e.executeRCLostAction!=='goBack')
    warnings.push('signal loss does not trigger return-to-home (exitOnRCLost='+e.exitOnRCLost+', executeRCLostAction='+e.executeRCLostAction+')');
  if(e.finishAction!=='goHome')warnings.push('finish action is '+JSON.stringify(e.finishAction)+', not return-to-home');
  if(!e.takeOffRefPoint)warnings.push('no take-off reference point: distance and duration are measured from the first waypoint only');
  return {errors,warnings};
}

// Full check of a stored KMZ: envelope plus limits. Pure function of the bytes and the limits.
function checkMission(kmzBytes,limits){
  let docs;
  try{docs=readKmz(kmzBytes);}catch(err){return {ok:false,errors:['KMZ unreadable: '+err.message],warnings:[],envelope:null};}
  const base=computeEnvelope(docs.waylines,docs.template);
  const lim=checkLimits(base.envelope,limits);
  const errors=[...base.errors,...lim.errors],warnings=[...base.warnings,...lim.warnings];
  return {ok:errors.length===0,errors,warnings,envelope:base.envelope,limits:{...DEFAULT_LIMITS,...limits},route:base.route||null};
}

function limitsFromEnv(env=process.env){
  const map={maxHeightM:'SKYHUB_MISSION_MAX_HEIGHT_M',maxRthHeightM:'SKYHUB_MISSION_MAX_RTH_HEIGHT_M',maxSpeedMs:'SKYHUB_MISSION_MAX_SPEED_MS',
    maxDurationMin:'SKYHUB_MISSION_MAX_DURATION_MIN',maxDistanceM:'SKYHUB_MISSION_MAX_DISTANCE_M'};
  const out={};
  for(const [k,name] of Object.entries(map)){
    if(env[name]===undefined||env[name]==='')continue;
    const v=Number(env[name]);
    // Only tightening below the defaults (or equal) is accepted: the defaults are the outer bound.
    if(!Number.isFinite(v)||v<=0||v>DEFAULT_LIMITS[k])throw new Error(name+' must be a number in (0, '+DEFAULT_LIMITS[k]+']');
    out[k]=v;
  }
  return out;
}

module.exports={computeEnvelope,checkLimits,checkMission,limitsFromEnv,DEFAULT_LIMITS,DOCK_ONLY_DRONES,FOLLOW_SURFACE_AIRCRAFT,haversine};
