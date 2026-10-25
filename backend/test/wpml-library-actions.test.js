'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const actions=require('../../frontend/public/wpml-action-draft');
const library=require('../../frontend/public/wpml-route-library-core');
const planner=require('../../frontend/public/wpml-editor-core');
const {readKmz}=require('../wpml-kmz');
const {validateDocuments}=require('../wpml');
function plan(){
  return {name:'Private Route 49.12345',model:'matrice4t',speed:5,takeoffHeight:30,
    finishAction:'goHome',timestamp:1792573200000,
    waypoints:[{lat:49.12345,lon:8.56789,height:50},
      {lat:49.12445,lon:8.56889,height:50},
      {lat:49.12545,lon:8.56989,height:50}]};
}
function full(){
  return {...plan(),actionGroups:[
    {index:2,actions:[{type:'hover',seconds:2.5},{type:'rotateYaw',degrees:-40},
      {type:'takePhoto'},{type:'stopRecord'}]},
    {index:0,actions:[{type:'startRecord'}]}
  ]};
}
test('P1 ordered grouped reachPoint actions compile into structurally validated WPML',()=>{
  const output=planner.build(full());
  const data=readKmz(Buffer.from(output.kmz));
  const valid=validateDocuments(data.template,data.waylines);
  assert.equal(valid.valid,true,JSON.stringify(valid.errors));
  assert.equal(output.flightReady,false);
  assert.equal(output.summary.actionGroupCount,2);
  assert.equal(output.summary.orderedActionCount,5);
  assert.equal(output.summary.photoCount,1);
  assert.equal(output.summary.cameraHardwareVerified,false);
  assert.match(data.waylines,/<wpml:actionGroupStartIndex>2<\/wpml:actionGroupStartIndex>/);
  assert.match(data.waylines,/<wpml:hoverTime>2.5<\/wpml:hoverTime>/);
  assert.match(data.waylines,/<wpml:aircraftHeading>-40<\/wpml:aircraftHeading>/);
  assert.ok(data.waylines.indexOf('startRecord')<data.waylines.indexOf('stopRecord'));
  assert.ok(data.waylines.indexOf('hoverTime')<data.waylines.indexOf('aircraftHeading'));
});
test('P1 rejects non-whitelisted actions and params rather than dropping them',()=>{
  const attempts=[
    [{index:0,actions:[{type:'orientedShoot'}]}],
    [{index:0,actions:[{type:'takePhoto',fileSuffix:'PII'}]}],
    [{index:0,actions:[{type:'zoom'}]}],
    [{index:0,actions:[{type:'hover',seconds:999}]}],
    [{index:0,actions:[{type:'rotateYaw',degrees:200}]}],
    [{index:10,actions:[{type:'takePhoto'}]}],
    [{index:0,actions:[{type:'startRecord'}]}],
    [{index:0,actions:[{type:'stopRecord'}]}],
    [{index:0,actions:[{type:'startRecord'},{type:'startRecord'}]}],
    [{index:0,actions:[{type:'stopRecord'}]},{index:2,actions:[{type:'startRecord'}]}],
    [{index:0,actions:[{type:'takePhoto'}]},{index:0,actions:[{type:'hover',seconds:1}]}],
    [{index:0,actions:[]}],
    [{index:0,actions:Array.from({length:9},()=>({type:'takePhoto'}))}]
  ];
  for(const x of attempts)
    assert.throws(()=>planner.build({...plan(),actionGroups:x}),/Aktionsentwurf/);
});
test('P1 cannot silently mix legacy point photos or interval captures with new groups',()=>{
  const p=plan(),g=[{index:0,actions:[{type:'takePhoto'}]}];
  p.waypoints[0].photo=true;
  assert.throws(()=>planner.build({...p,actionGroups:g}),/Aktionsentwurf/);
  const interval=plan();
  interval.intervalPhotos={type:'multipleDistance',interval:12};
  assert.throws(()=>planner.build({...interval,actionGroups:g}),/Aktionsentwurf/);
});
test('P1 action lists compile in flight index order, then in declared action order',()=>{
  const g=actions.normalize([
    {index:2,actions:[{type:'stopRecord'}]},
    {index:0,actions:[{type:'startRecord'},{type:'takePhoto'}]}
  ],3);
  assert.deepEqual(g.map(x=>x.index),[0,2]);
  assert.ok(Object.isFrozen(g)&&Object.isFrozen(g[0].actions));
  const xml=actions.serializeGroup(g[0],2);
  assert.ok(xml.indexOf('<wpml:actionActuatorFunc>startRecord')<
    xml.indexOf('<wpml:actionActuatorFunc>takePhoto'));
});
test('P0 append-only route revisions remain available after edits and are deep copies',()=>{
  const a=library.save(library.blank(),{name:'Route A',folder:'Bruchsal',
    plan:full(),savedAt:1792573200000});
  assert.equal(a.revision,1);
  const old=library.find(a.library,a.routeId,1);
  old.plan.waypoints[0].lat=2;
  const edited=full();
  edited.waypoints[0].lat=48.8;
  edited.name='New Revision';
  const b=library.save(a.library,{routeId:a.routeId,name:'Route A',
    folder:'Inspektion',plan:edited,savedAt:1792573210000});
  assert.equal(b.revision,2);
  assert.equal(library.find(b.library,a.routeId,1).plan.waypoints[0].lat,49.12345);
  assert.equal(library.find(b.library,a.routeId,2).plan.waypoints[0].lat,48.8);
  assert.equal(library.list(b.library)[0].revisionCount,2);
  assert.equal(library.list(a.library)[0].revisionCount,1);
  assert.equal(library.find(b.library,a.routeId).folder,'Inspektion');
  assert.equal(library.find(b.library,a.routeId).flightReady,false);
});
test('P0 creates an immutable, detached reference snapshot with no dispatch permission',()=>{
  const a=library.save(library.blank(),{name:'Route A',plan:full(),savedAt:123456});
  const snap=library.taskSnapshot(a.library,a.routeId);
  assert.equal(snap.schema,'skyhub-offline-task-snapshot-v1');
  assert.equal(snap.sourceRevision,1);
  assert.equal(snap.actionCount,5);
  assert.equal(snap.previewOnly,true);
  assert.equal(snap.flightReady,false);
  assert.equal(snap.dispatchAllowed,false);
  assert.equal(snap.hardwareVerified,false);
  assert.ok(Object.isFrozen(snap)&&Object.isFrozen(snap.plan));
  assert.ok(Object.isFrozen(snap.plan.waypoints[0]));
  assert.throws(()=>{snap.plan.waypoints[0].lat=0;},/read only|Cannot assign/);
  assert.equal(library.find(a.library,a.routeId).plan.waypoints[0].lat,49.12345);
});
test('P0 cloning is detached, and deleting a route leaves its older source untouched',()=>{
  const origin=library.save(library.blank(),{name:'Private Route',plan:plan(),savedAt:1234});
  const clone=library.copy(origin.library,origin.routeId,{savedAt:1235});
  assert.equal(library.list(clone.library).length,2);
  const deleted=library.remove(clone.library,origin.routeId);
  assert.equal(library.list(deleted).length,1);
  assert.equal(library.find(deleted,clone.routeId).plan.waypoints.length,3);
  assert.equal(library.list(clone.library).length,2);
  assert.equal(library.list(origin.library).length,1);
});
test('P0 fails closed for malformed, oversized, unknown aircraft and revision overflow',()=>{
  assert.throws(()=>library.load('{'),/Routenbibliothek/);
  assert.throws(()=>library.load('x'.repeat(512*1024+1)),/Routenbibliothek/);
  assert.throws(()=>library.save(library.blank(),{name:'Invalid',
    plan:{...plan(),model:'unknown'}}),/Routenbibliothek/);
  let state=library.blank(),id;
  for(let i=0;i<library.MAX_REVISIONS;i++){
    const result=library.save(state,{name:'Bounded',plan:plan(),
      ...(id?{routeId:id}:{}),savedAt:i+1});
    id=result.routeId;state=result.library;
  }
  assert.throws(()=>library.save(state,{name:'Bounded',routeId:id,
    plan:plan()}),/Routenbibliothek/);
});
test('P0 serialization permits explicit local reload and does not create flight authorization',()=>{
  const a=library.save(library.blank(),{name:'Local',plan:plan(),savedAt:1234});
  const raw=library.serialize(a.library);
  const reloaded=library.load(raw);
  assert.deepEqual(reloaded,a.library);
  assert.equal(library.taskSnapshot(reloaded,a.routeId).flightReady,false);
});
test('UI entrypoint and local-only module links exist, no mission writes or external storage',()=>{
  const dir=path.resolve(__dirname,'../../frontend/public');
  const html=fs.readFileSync(path.join(dir,'wpml-route-library.html'),'utf8');
  const browser=fs.readFileSync(path.join(dir,'wpml-route-library.js'),'utf8');
  const routeCore=fs.readFileSync(path.join(dir,'wpml-route-library-core.js'),'utf8');
  const actionCore=fs.readFileSync(path.join(dir,'wpml-action-draft.js'),'utf8');
  for(const filename of ['wpml-interval-actions.js','wpml-action-draft.js',
    'wpml-editor-core.js','wpml-route-library-core.js','wpml-route-library.js'])
    assert.ok(html.includes('<script src="/'+filename+'"></script>'),filename);
  for(const id of ['route-name','route-folder','save','new','routes','revision-select',
    'load','clone','delete','clear-storage','waypoints','groups','add-point',
    'add-group','review','export','model','speed','height','takeoff','finish','group-index']){
    assert.ok(html.includes('id="'+id+'"'),id);
  }
  assert.doesNotMatch(browser+routeCore+actionCore,
    /\bfetch\s*\(|XMLHttpRequest|WebSocket|mqtt\.publish|\/api\/mission\/create/);
  assert.match(html,/Klartext/);
  assert.match(browser,/localStorage\.setItem\(STORAGE/);
  assert.match(browser,/window\.confirm\('Gesamte Route/);
});

test('P0 revision comparisons only reveal aggregate changes and fixed public field names',()=>{
  const a=library.save(library.blank(),{name:'Sensitive field',plan:plan(),savedAt:100});
  const newPlan=plan();
  newPlan.waypoints[1].lat=48.123456;
  newPlan.waypoints[2].height=60;
  // Explicit provenance markers are required at every waypoint for local heights.
  newPlan.waypoints.forEach((p,i)=>{p.ellipsoidHeight=170+i;});
  newPlan.speed=7;
  newPlan.actionGroups=[{index:0,actions:[{type:'takePhoto'}]}];
  const b=library.save(a.library,{routeId:a.routeId,name:'Sensitive field',
    plan:newPlan,savedAt:200});
  const compare=library.compareRevisions(b.library,a.routeId,1,2);
  assert.equal(compare.leftRevision,1);
  assert.equal(compare.rightRevision,2);
  assert.equal(compare.positionChanges,1);
  assert.equal(compare.heightChanges,3);
  assert.equal(compare.photoChanges,0);
  assert.equal(compare.actionGroupsChanged,true);
  assert.deepEqual(compare.flightProfileFieldsChanged,['speed','transitionSpeed']);
  assert.equal(compare.flightReady,false);
  assert.equal(compare.dispatchAllowed,false);
  assert.doesNotMatch(JSON.stringify(compare),/48\.123456|49\.12345|8\.56789|Sensitive field/);
  assert.ok(Object.isFrozen(compare));
  assert.throws(()=>library.compareRevisions(b.library,99,1,2),/Routenbibliothek/);
});
test('P0 restored revision is appended without rewriting older version history',()=>{
  const a=library.save(library.blank(),{name:'Route A',folder:'Referenz',plan:plan(),
    savedAt:100});
  const amended=plan();amended.speed=8;
  const b=library.save(a.library,{routeId:a.routeId,name:'Route A',folder:'Referenz',
    plan:amended,savedAt:200});
  const restored=library.restoreRevision(b.library,a.routeId,1,300);
  assert.equal(restored.revision,3);
  assert.equal(library.find(restored.library,a.routeId,1).plan.speed,5);
  assert.equal(library.find(restored.library,a.routeId,2).plan.speed,8);
  assert.equal(library.find(restored.library,a.routeId,3).plan.speed,5);
  assert.equal(library.list(b.library)[0].latestRevision,2);
  assert.equal(library.list(restored.library)[0].latestRevision,3);
  assert.equal(library.taskSnapshot(restored.library,a.routeId,3).flightReady,false);
  assert.throws(()=>library.restoreRevision(b.library,a.routeId,44,300),/Routenbibliothek/);
});
