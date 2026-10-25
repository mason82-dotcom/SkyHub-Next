'use strict';
// Offline, privacy-preserving structural comparison of two DJI WPML KMZ files.
// No flight commands, network, camera media extraction, or raw coordinate output.
const {readKmz}=require('./wpml-kmz');
const {parseXml,validateDocuments}=require('./wpml');

const LIMIT=200;
const PATTERN_LIMIT=80;
// Never echo unknown XML element/attribute names: attacker-controlled tag names can contain
// sensitive substrings even when text and attribute values are suppressed.
const FIELD_CATALOG=require('./data/dji-wpml-fields.json');
const TAGS=new Set([
  'kml','Document','Folder','Placemark','Point','coordinates','Polygon',
  'outerBoundaryIs','innerBoundaryIs','LinearRing','LineString','MultiGeometry',
  'name','description','#present',
  ...FIELD_CATALOG.fields.map(f=>f.field),
  'wpml:missionConfig','wpml:actionGroup','wpml:actionTrigger','wpml:action',
  'wpml:actionActuatorFuncParam','wpml:waypointHeadingParam','wpml:waypointTurnParam',
  'wpml:waylineCoordinateSysParam','wpml:payloadInfo','wpml:droneInfo'
]);
function publicPath(path){
  return path.split('/').map((component,index)=>{
    if(index===0||component==='')return component;
    if(component.startsWith('@'))return '@[attribute]';
    const match=/^([A-Za-z_][\w.:-]*|#present)(\[\d+\])?$/.exec(component);
    if(!match)return '[unrecognized-element]';
    return (TAGS.has(match[1])?match[1]:'[unrecognized-element]')+(match[2]||'');
  }).join('/');
}
function patternPath(path){
  return publicPath(path).replace(/\[\d+\]/g,'[*]').replace(/\/#present$/,'');
}
const OMIT_NAMES=new Set([
  'name','description','wpml:author','wpml:createTime','wpml:updateTime',
  'wpml:missionName','wpml:fileSuffix','wpml:directoryName'
]);
function safeError(message){
  // Only static diagnostic words are allowed in CLI output; never raw XML/file content.
  throw Error('WPML comparison rejected: '+message);
}
function classify(path){
  if(/heightMode|ellipsoidHeight|executeHeight|globalHeight|globalRTHHeight|takeOffSecurityHeight/.test(path))
    return 'heightReferences';
  if(/imageFormat|payloadLensIndex/.test(path))return 'cameraFormats';
  if(path.includes('actionGroup')||path.includes('actionTrigger')||
     path.includes('actionActuator'))return 'actions';
  if(path.includes('missionConfig'))return 'mission';
  if(path.includes('payload')||path.includes('imageFormat'))return 'payload';
  if(path.includes('coordinates')||path.includes('Point')||
     path.includes('Polygon')||path.includes('LineString'))return 'geometry';
  if(path.includes('Placemark'))return 'waypoints';
  if(path.includes('Folder'))return 'folders';
  return 'other';
}
function values(tree){
  const nodes=new Map();
  function walk(node,prefix,depth){
    if(depth>48||nodes.size>20000)safeError('XML complexity limit');
    const path=prefix+'/'+node.name;
    const ignored=OMIT_NAMES.has(node.name);
    if(!ignored){
      // Capture empty elements too: removing a self-closing XML node is a structural change.
      nodes.set(path+'/#present','1');
      const value=node.text.trim().replace(/\s+/g,' ');
      // Store actual strings only transiently in RAM to compare. Never return them.
      if(value)nodes.set(path,value);
      for(const [key,val] of Object.entries(node.attributes)){
        if(!key.startsWith('xmlns'))nodes.set(path+'/@'+key,val);
      }
    }
    const seen=new Map();
    for(const child of node.children){
      const count=seen.get(child.name)||0;
      seen.set(child.name,count+1);
      // Identical ordering of repeated elements is relevant to waypoint and action execution.
      walk(child,path+'['+count+']',depth+1);
    }
  }
  walk(tree,'',0);
  return nodes;
}
function compareDocuments(a,b,file){
  const left=values(parseXml(a)),right=values(parseXml(b));
  const union=new Set([...left.keys(),...right.keys()]);
  if(union.size>40000)safeError('XML comparison complexity limit');
  const groups={},changes=[],patterns=new Map();
  const kinds={leftOnly:0,rightOnly:0,differentValues:0};
  const dataKinds={elementPresence:0,attributes:0,fieldText:0};
  let total=0,same=0;
  for(const path of [...union].sort()){
    if(left.has(path)&&right.has(path)&&left.get(path)===right.get(path)){
      same++;continue;
    }
    const category=classify(path);
    const kind=!left.has(path)?'added':!right.has(path)?'removed':'changed';
    groups[category]=(groups[category]||0)+1;
    const direction=kind==='removed'?'leftOnly':kind==='added'?'rightOnly':'differentValues';
    kinds[direction]++;
    const dataKind=path.endsWith('/#present')?'elementPresence':
      path.includes('/@')?'attributes':'fieldText';
    dataKinds[dataKind]++;
    const pattern=file+patternPath(path);
    let item=patterns.get(pattern);
    if(!item){
      item={path:pattern,category,leftOnly:0,rightOnly:0,differentValues:0};
      patterns.set(pattern,item);
    }
    item[direction]++;
    total++;
    if(changes.length<LIMIT)changes.push({
      path:file+publicPath(path),
      category,kind,dataKind,
      // NO mission field values, serials, GPS coordinates, author or timestamps emitted.
      valuesRedacted:true
    });
  }
  return {
    file,comparable:true,equal:total===0,totalChanges:total,
    displayedChanges:changes.length,truncated:total>LIMIT,
    unchangedFields:same,
    changedByCategory:groups,changes,
    changesByDirection:kinds,changesByRepresentation:dataKinds,
    // Group repetitive waypoint/action indices; counts still reflect all differences.
    patterns:{
      total:patterns.size,
      displayed:Math.min(patterns.size,PATTERN_LIMIT),
      truncated:patterns.size>PATTERN_LIMIT,
      entries:[...patterns.values()]
        .sort((a,b)=>{
          const preferred=['actions','cameraFormats','heightReferences','payload',
            'mission','waypoints','folders','geometry','other'];
          const priority=preferred.indexOf(a.category)-preferred.indexOf(b.category);
          return priority||a.path.localeCompare(b.path);
        }).slice(0,PATTERN_LIMIT)
    }
  };
}

// Semantic counts from the executable file, independent of where WPML action groups
// are attached in the XML tree. Values are whitelisted enums or static placeholders;
// no coordinates, IDs, free-text fields or raw trigger intervals are returned.
const TRIGGER_MODES=new Set(['reachPoint','betweenAdjacentPoints','multipleDistance','multipleTiming']);
const ACTUATORS=new Set(['takePhoto','startRecord','stopRecord','focus','zoom',
  'customDirName','gimbalRotate','rotateYaw','hover','gimbalEvenlyRotate',
  'accurateShoot','orientedShoot','panoShot','searchlight','recordPointCloud']);
function actionInventory(waylinesXml){
  const root=parseXml(waylinesXml);
  const get=(node,name)=>node?node.children.filter(c=>c.name===name):[];
  const text=(node,name)=>(get(node,name)[0]?.text??'').trim();
  const folders=get(get(root,'Document')[0],'Folder');
  const triggerModes={},actuatorFunctions={};
  const result={
    actionGroupCount:0,
    actionCount:0,
    actionGroupsByWayline:[],
    initialActionGroups:0,
    triggerModes,actuatorFunctions,
    reachPointPhotoActions:0,
    periodicDistancePhotoActions:0,
    periodicTimePhotoActions:0,
    photoCountIsActionsNotCapturedImages:true,
    cameraHardwareVerified:false
  };
  for(const folder of folders){
    const placemarks=get(folder,'Placemark');
    const atStart=get(folder,'wpml:startActionGroup');
    const groups=[
      ...atStart,
      ...placemarks.flatMap(p=>get(p,'wpml:actionGroup'))
    ];
    result.actionGroupsByWayline.push(groups.length);
    result.initialActionGroups+=atStart.length;
    result.actionGroupCount+=groups.length;
    for(const group of groups){
      const trigger=get(group,'wpml:actionTrigger')[0];
      const rawMode=text(trigger,'wpml:actionTriggerType');
      const mode=TRIGGER_MODES.has(rawMode)?rawMode:'unrecognized';
      triggerModes[mode]=(triggerModes[mode]||0)+1;
      const actions=get(group,'wpml:action');
      result.actionCount+=actions.length;
      for(const action of actions){
        const rawFn=text(action,'wpml:actionActuatorFunc');
        const fn=ACTUATORS.has(rawFn)?rawFn:'unrecognized';
        actuatorFunctions[fn]=(actuatorFunctions[fn]||0)+1;
        if(fn==='takePhoto'){
          if(mode==='reachPoint')result.reachPointPhotoActions++;
          if(mode==='multipleDistance')result.periodicDistancePhotoActions++;
          if(mode==='multipleTiming')result.periodicTimePhotoActions++;
        }
      }
    }
  }
  return result;
}

function inspection(template,waylines,resourceCount){
  const v=validateDocuments(template,waylines);
  return {
    valid:v.valid,
    // Parser/validator errors are known paths and diagnostic strings only.
    errorCount:v.errors.length,
    warningCount:v.warnings.length,
    templateTypes:v.templates.map(t=>t.templateType),
    templateCount:v.templates.length,
    waylineCount:v.waylines.length,
    waypointCounts:v.waylines.map(w=>w.waypointCount),
    aircraftModel:v.aircraft?.model??null,
    undocumentedFieldCount:v.fieldCoverage?.undocumentedFields?.length??null,
    resourceCount,
    cameraActionSummary:actionInventory(waylines),
    flightReady:false
  };
}
function compareKmz(leftBytes,rightBytes){
  let left,right;
  try{
    left=readKmz(leftBytes);right=readKmz(rightBytes);
  }catch{
    safeError('invalid, encrypted, unsupported, oversized or corrupt KMZ archive');
  }
  let docs;
  try{
    docs=[compareDocuments(left.template,right.template,'template.kml'),
      compareDocuments(left.waylines,right.waylines,'waylines.wpml')];
  }catch{
    safeError('unsupported or malformed WPML XML');
  }
  // validateDocuments normally catches XML errors, and never reads from the filesystem.
  const l=inspection(left.template,left.waylines,left.resourceCount);
  const r=inspection(right.template,right.waylines,right.resourceCount);
  const differences=docs.reduce((n,d)=>n+d.totalChanges,0);
  return {
    comparisonSchema:'skyhub-wpml-compat-v1',
    left:l,right:r,
    summary:{
      structuralDifferences:differences,
      // Structural path additions/removals and differing text values are counted separately.
      leftOnlyFieldOccurrences:docs.reduce((n,d)=>n+d.changesByDirection.leftOnly,0),
      rightOnlyFieldOccurrences:docs.reduce((n,d)=>n+d.changesByDirection.rightOnly,0),
      changedValueOccurrences:docs.reduce((n,d)=>n+d.changesByDirection.differentValues,0),
      structurallyEqualExcludingVolatileMetadata:differences===0,
      resourceCountMatches:left.resourceCount===right.resourceCount,
      bothOfflineValid:l.valid&&r.valid,
      cameraActionSummariesDiffer:
        JSON.stringify(l.cameraActionSummary)!==JSON.stringify(r.cameraActionSummary),
      pilot2HardwareVerified:false,
      flightReady:false
    },
    documents:docs,
    // Differences are path/kind only; no mission names, numerical telemetry or waypoints.
    privacy:'field paths and aggregate counts only; values and GPS coordinates redacted',
    scope:'offline-structural-comparison-not-pilot2-compatibility-certification'
  };
}
module.exports={compareKmz};
