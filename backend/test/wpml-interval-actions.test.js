'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {normalize,serializeGroup,TYPE_UNITS}=require('../../frontend/public/wpml-interval-actions');
const planner=require('../../frontend/public/wpml-editor-core');
const {validateDocuments}=require('../wpml');
const {inspectKmz,readKmz}=require('../wpml-kmz');
function route(trigger){
  return {model:'mavic3m',name:'Offline interval test',speed:5,
    takeoffHeight:30,finishAction:'goHome',
    ...(trigger?{intervalPhotos:trigger}:{}),
    waypoints:[{lat:48.1,lon:8.1,height:50},
      {lat:48.101,lon:8.101,height:50},
      {lat:48.102,lon:8.102,height:50}]};
}
test('DJI action-group interval enumerations and units come from Common Elements',()=>{
  assert.deepEqual({...TYPE_UNITS},{multipleDistance:'m',multipleTiming:'s'});
  for(const [type,unit] of Object.entries(TYPE_UNITS)){
    const x=serializeGroup({type,interval:type==='multipleTiming'?3:12},
      {waypointCount:3,speedMps:5,groupId:3});
    assert.equal(x.flightReady,false);
    assert.equal(x.hardwareVerified,false);
    assert.equal(x.startIndex,0);
    assert.equal(x.endIndex,2);
    assert.equal(x.unit,unit);
    assert.match(x.xml,/<wpml:actionGroupId>3<\/wpml:actionGroupId>/);
    assert.match(x.xml,/<wpml:actionGroupStartIndex>0<\/wpml:actionGroupStartIndex>/);
    assert.match(x.xml,/<wpml:actionGroupEndIndex>2<\/wpml:actionGroupEndIndex>/);
    assert.match(x.xml,new RegExp('<wpml:actionTriggerType>'+type+'</wpml:actionTriggerType>'));
    assert.match(x.xml,/<wpml:actionTriggerParam>(?:3|12)<\/wpml:actionTriggerParam>/);
    assert.match(x.xml,/<wpml:actionActuatorFunc>takePhoto<\/wpml:actionActuatorFunc>/);
    assert.match(x.xml,/<wpml:payloadPositionIndex>0<\/wpml:payloadPositionIndex>/);
  }
});
test('all five DJI browser aircraft produce parseable offline WPML/KMZ interval action drafts',()=>{
  for(const model of Object.keys(planner.MODELS)){
    for(const type of Object.keys(TYPE_UNITS)){
      const input=route({type,interval:type==='multipleDistance'?12:3});
      input.model=model;
      const output=planner.build(input);
      assert.equal(output.flightReady,false);
      assert.equal(output.summary.photoCount,0);
      assert.equal(output.summary.intervalPhotos.type,type);
      assert.equal(output.summary.intervalPhotos.hardwareVerified,false);
      assert.equal((output.waylinesXml.match(/<wpml:actionGroup>/g)||[]).length,1);
      assert.equal((output.waylinesXml.match(/<wpml:actionTriggerParam>/g)||[]).length,1);
      const report=validateDocuments(output.templateXml,output.waylinesXml);
      assert.equal(report.valid,true,model+' '+type+': '+JSON.stringify(report.errors));
      const parsed=readKmz(Buffer.from(output.kmz));
      assert.equal(parsed.waylines,output.waylinesXml);
      assert.equal(inspectKmz(Buffer.from(output.kmz)).valid,true);
      assert.equal(inspectKmz(Buffer.from(output.kmz)).flightReady,false);
    }
  }
});
test('unknown camera cadence remains explicitly unverified; supplied limits are enforced',()=>{
  const unknown=normalize({type:'multipleDistance',interval:12},
    {waypointCount:3,speedMps:5});
  assert.equal(unknown.cameraTimingVerified,false);
  assert.equal(unknown.cameraMinIntervalSeconds,null);
  assert.ok(unknown.theoreticalSecondsAtConfiguredSpeed>2.3);
  assert.throws(()=>planner.build(route({
    type:'multipleDistance',interval:5,cameraMinIntervalSeconds:3
  })),/theoretical trigger interval shorter than known camera limit/);
  const allowed=planner.build(route({
    type:'multipleTiming',interval:3,cameraMinIntervalSeconds:2
  }));
  assert.equal(allowed.summary.intervalPhotos.type,'multipleTiming');
});
test('offline authoring refuses conflicting photos, bad intervals, unknown modes and unsupported limits',()=>{
  for(const input of [
    {type:'multipleDistance',interval:0},
    {type:'multipleDistance',interval:'0'},
    {type:'multipleDistance',interval:-3},
    {type:'multipleDistance',interval:1001},
    {type:'multipleTiming',interval:61},
    {type:'multipleTiming',interval:'not a number'},
    {type:'startRecord',interval:3},
    {type:'multipleTiming',interval:3,cameraMinIntervalSeconds:'0'},
    {type:'multipleTiming',interval:3,cameraMinIntervalSeconds:'nan'}
  ])assert.throws(()=>planner.build(route(input)),/DJI WPML interval action invalid/);
  const conflicting=route({type:'multipleTiming',interval:3});
  conflicting.waypoints[1].photo=true;
  assert.throws(()=>planner.build(conflicting),/cannot be combined with reach-point photos/);
  assert.throws(()=>serializeGroup({type:'multipleTiming',interval:3},
    {waypointCount:3,speedMps:5,groupId:65536}),/action group id/);
  assert.throws(()=>serializeGroup({type:'multipleTiming',interval:3},
    {waypointCount:1,speedMps:5}),/2 and 500/);
});
test('explicitly disabled mode preserves original no-interval XML',()=>{
  const original=planner.build(route());
  assert.doesNotMatch(original.waylinesXml,/<wpml:actionTriggerType>multiple/);
  assert.equal(original.summary.intervalPhotos,null);
});
test('browser contains no remote mutation for interval actions',()=>{
  const folder=path.join(__dirname,'../../frontend/public');
  const html=fs.readFileSync(path.join(folder,'wpml-editor.html'),'utf8');
  const ui=fs.readFileSync(path.join(folder,'wpml-editor.js'),'utf8');
  const engine=fs.readFileSync(path.join(folder,'wpml-interval-actions.js'),'utf8');
  assert.match(html,/wpml-interval-actions\.js/);
  assert.match(html,/id="photo-trigger"/);
  assert.match(ui,/photoModeUpdate/);
  assert.doesNotMatch(engine,/\bfetch\s*\(|XMLHttpRequest|new\s+WebSocket|\/api\/mission\/create/);
  assert.doesNotMatch(ui,/\bfetch\s*\(|XMLHttpRequest|new\s+WebSocket|\/api\/mission\/create/);
});

test('WPML validator rejects duplicate action group ids across separate waypoint actions',()=>{
  const input=route();
  input.waypoints[0].photo=true;
  input.waypoints[1].photo=true;
  const built=planner.build(input);
  assert.equal(validateDocuments(built.templateXml,built.waylinesXml).valid,true);
  const duplicate=built.waylinesXml.replace(
    '<wpml:actionGroupId>1</wpml:actionGroupId>',
    '<wpml:actionGroupId>0</wpml:actionGroupId>');
  assert.ok(validateDocuments(built.templateXml,duplicate).errors.some(
    x=>x.message.includes('duplicate action group ID')));
});
test('DJI permits a single-waypoint periodic action group, but rejects invalid index order and interval',()=>{
  const built=planner.build(route({type:'multipleDistance',interval:12}));
  const singleIndex=built.waylinesXml.replace(
    '<wpml:actionGroupEndIndex>2</wpml:actionGroupEndIndex>',
    '<wpml:actionGroupEndIndex>0</wpml:actionGroupEndIndex>');
  assert.equal(validateDocuments(built.templateXml,singleIndex).valid,true);
  const reversed=singleIndex.replace(
    '<wpml:actionGroupStartIndex>0</wpml:actionGroupStartIndex>',
    '<wpml:actionGroupStartIndex>1</wpml:actionGroupStartIndex>');
  assert.ok(validateDocuments(built.templateXml,reversed).errors.some(
    x=>x.message.includes('end index precedes start')));
  const badInterval=built.waylinesXml.replace(
    '<wpml:actionTriggerParam>12</wpml:actionTriggerParam>',
    '<wpml:actionTriggerParam>0</wpml:actionTriggerParam>');
  assert.equal(validateDocuments(built.templateXml,badInterval).valid,false);
  assert.ok(validateDocuments(built.templateXml,badInterval).errors.some(
    x=>x.path.endsWith('/actionTriggerParam')));
});

test('offline CLI processes synthetic multipleDistance example and rejects overwrites',()=>{
  const {spawnSync}=require('node:child_process');
  const os=require('node:os');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'skyhub-interval-'));
  const fixture=path.join(__dirname,'../../docs/examples/wpml-interval-photo-plan.json');
  const script=path.join(__dirname,'../../scripts/wpml-plan.js');
  const output=path.join(dir,'interval-draft.kmz');
  try{
    const result=spawnSync(process.execPath,[script,fixture,output],
      {encoding:'utf8',timeout:15000});
    assert.equal(result.status,0,result.stderr);
    const inspection=inspectKmz(fs.readFileSync(output));
    assert.equal(inspection.valid,true,JSON.stringify(inspection.errors));
    assert.equal(inspection.flightReady,false);
    const data=readKmz(fs.readFileSync(output)).waylines;
    assert.match(data,/<wpml:actionTriggerType>multipleDistance<\/wpml:actionTriggerType>/);
    assert.match(data,/<wpml:actionTriggerParam>12<\/wpml:actionTriggerParam>/);
    const again=spawnSync(process.execPath,[script,fixture,output],
      {encoding:'utf8',timeout:15000});
    assert.equal(again.status,2);
    assert.match(again.stderr,/generation rejected/);
  }finally{
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
