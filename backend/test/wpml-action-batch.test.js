'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const actions=require('../../frontend/public/wpml-action-draft');
const planner=require('../../frontend/public/wpml-editor-core');
const {readKmz}=require('../wpml-kmz');
const {validateDocuments}=require('../wpml');
function plan(){
  return {name:'Private route',model:'matrice4t',speed:5,takeoffHeight:30,
    waypoints:[
      {lat:49.1001,lon:8.6001,height:50,photo:false},
      {lat:49.1002,lon:8.6002,height:50,photo:false},
      {lat:49.1003,lon:8.6003,height:50,photo:false},
      {lat:49.1004,lon:8.6004,height:50,photo:false}
    ]};
}
test('P1 batch templates produce independent groups without mutating input',()=>{
  const input=[{index:1,actions:[{type:'takePhoto'}]}];
  const clone=JSON.stringify(input);
  const result=actions.applyTemplate(input,4,{indices:[0,2,3],template:'hoverPhoto'});
  assert.equal(JSON.stringify(input),clone);
  assert.deepEqual(result.groups.map(g=>g.index),[0,1,2,3]);
  assert.deepEqual(result.groups[0].actions,
    [{type:'hover',seconds:2},{type:'takePhoto'}]);
  result.groups[0].actions[0].seconds=8;
  assert.equal(actions.TEMPLATES.hoverPhoto[0].seconds,2);
  assert.equal(result.flightReady,false);
  assert.equal(result.requiresReview,true);
  const parsed=readKmz(Buffer.from(planner.build({...plan(),actionGroups:result.groups}).kmz));
  const v=validateDocuments(parsed.template,parsed.waylines);
  assert.equal(v.valid,true,JSON.stringify(v.errors));
});
test('append mode retains order, fails atomically at action capacity, and never mutates original',()=>{
  const input=[{index:0,actions:[{type:'takePhoto'}]}];
  const appended=actions.applyTemplate(input,4,{
    indices:[0],template:'hoverPhoto',mode:'append'});
  assert.deepEqual(appended.groups[0].actions,
    [{type:'takePhoto'},{type:'hover',seconds:2},{type:'takePhoto'}]);
  const saturated=[{index:0,actions:Array.from({length:8},()=>({type:'takePhoto'}))}];
  const snapshot=JSON.stringify(saturated);
  assert.throws(()=>actions.applyTemplate(saturated,4,{
    indices:[0,1],template:'photo',mode:'append'}),/Aktionsentwurf/);
  assert.equal(JSON.stringify(saturated),snapshot);
});
test('batch selection rejects duplicates, unsupported actions and invalid indices',()=>{
  for(const args of [
    {indices:[0,0],template:'photo'},
    {indices:[-1],template:'photo'},
    {indices:[99],template:'photo'},
    {indices:[1.2],template:'photo'},
    {indices:[],template:'photo'},
    {indices:[0],template:'zoom'},
    {indices:[0],template:'photo',mode:'merge'},
  ])assert.throws(()=>actions.applyTemplate([],4,args),/Aktionsentwurf/);
});
test('guarded route reversal swaps waypoint indices but preserves independent action order',()=>{
  const original=plan();
  original.actionGroups=[
    {index:0,actions:[{type:'takePhoto'}]},
    {index:2,actions:[{type:'hover',seconds:3},{type:'rotateYaw',degrees:25}]}
  ];
  const before=JSON.stringify(original);
  const result=actions.reverseRoute(original);
  assert.equal(JSON.stringify(original),before);
  assert.deepEqual(result.plan.waypoints[0],original.waypoints[3]);
  assert.deepEqual(result.plan.actionGroups.map(g=>g.index),[1,3]);
  assert.equal(result.plan.actionGroups[0].actions[0].type,'hover');
  assert.equal(result.requiresReview,true);
  assert.equal(result.headingAndRthRevalidationRequired,true);
  assert.equal(result.flightReady,false);
  const roundtrip=actions.reverseRoute(result.plan);
  assert.deepEqual(roundtrip.plan.waypoints,original.waypoints);
  assert.deepEqual(roundtrip.plan.actionGroups,original.actionGroups);
  const out=planner.build(result.plan);
  const docs=readKmz(Buffer.from(out.kmz));
  assert.equal(validateDocuments(docs.template,docs.waylines).valid,true);
});
test('video semantics, intervals, legacy photos, unknown source keys or uncertain heights block reversal',()=>{
  const cases=[
    {...plan(),actionGroups:[
      {index:0,actions:[{type:'startRecord'}]},
      {index:3,actions:[{type:'stopRecord'}]}]},
    {...plan(),intervalPhotos:{type:'multipleDistance',interval:12}},
    {...plan(),waypoints:plan().waypoints.map((p,i)=>({...p,photo:i===1}))},
    {...plan(),waypoints:plan().waypoints.map((p,i)=>({...p,height:i===1?70:50}))},
    {...plan(),waypoints:plan().waypoints.map((p,i)=>({...p,ellipsoidHeight:50}))},
    {...plan(),waypoints:plan().waypoints.map((p,i)=>({...p,lat:i===1?null:p.lat}))},
    {...plan(),cameraPose:'unknown'}
  ];
  for(const item of cases){
    const before=JSON.stringify(item);
    assert.throws(()=>actions.reverseRoute(item),/Aktionsentwurf/);
    assert.equal(JSON.stringify(item),before);
  }
});
test('batching cannot silently resolve invalid recording sequences',()=>{
  const input=[{index:0,actions:[{type:'startRecord'}]},
    {index:3,actions:[{type:'stopRecord'}]}];
  assert.throws(()=>actions.applyTemplate(input,4,{
    indices:[3],template:'photo',mode:'replace'}),/Aktionsentwurf/);
});
