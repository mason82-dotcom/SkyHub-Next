'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const comparator=require('../../frontend/public/wpml-mission-version-compare');
const client=require('../../frontend/public/wpml-mission-store-client');

const sample=()=>({
  plan:{
    name:'Mission A',model:'mavic3e',speed:5,takeoffHeight:30,rthHeight:100,
    finishAction:'goHome',
    waypoints:[
      {lat:49.11,lon:8.61,height:40,photo:false},
      {lat:49.12,lon:8.62,height:50,photo:true}
    ]
  },notes:[]
});
test('version comparison counts supported differences without disclosing coordinates',()=>{
  const old=sample(),next=sample();
  next.plan.name='Mission B';
  next.plan.speed=6;
  next.plan.waypoints[0].lat=49.15;
  next.plan.waypoints[1].height=60;
  next.plan.waypoints[1].photo=false;
  next.plan.waypoints.push({lat:49.16,lon:8.63,height:70,photo:false});
  const delta=comparator.compare(old,next);
  assert.equal(delta.previousWaypoints,2);
  assert.equal(delta.currentWaypoints,3);
  assert.equal(delta.addedWaypoints,1);
  assert.equal(delta.removedWaypoints,0);
  assert.equal(delta.positionChanges,1);
  assert.equal(delta.heightChanges,1);
  assert.equal(delta.photoChanges,1);
  assert.deepEqual(delta.profileChanges,['speed']);
  assert.equal(delta.flightReady,false);
  assert.equal(delta.dispatchAllowed,false);
  assert.doesNotMatch(JSON.stringify(delta),/49\.11|49\.15|8\.61|Mission A|Mission B/);
});
test('import loss warnings mean comparison is incomplete, not equivalent',()=>{
  const old=sample(),next=sample();
  old.notes=['Unsupported DJI camera action'];next.notes=['Waypoint speed not represented'];
  const delta=comparator.compare(old,next);
  assert.equal(delta.partial,true);
  assert.equal(delta.positionChanges,0);
  assert.equal(delta.flightReady,false);
  assert.throws(()=>comparator.compare({},next),/geprüfte Wegpunkt-KMZ/);
});
test('same-origin client sends optional parent only when explicitly supplied',async()=>{
  const original=global.fetch,seen=[];
  global.fetch=async(_url,options)=>{
    seen.push(options);
    return {ok:true,async json(){return {id:'aaaaaaaa-aaaa-8aaa-8aaa-aaaaaaaaaaaa'};}};
  };
  try{
    const bytes=new Uint8Array([0x50,0x4b,1]);
    const parent='bbbbbbbb-bbbb-8bbb-8bbb-bbbbbbbbbbbb';
    await client.upload('',bytes,'Derivat',{parentId:parent});
    assert.equal(seen[0].headers['X-SkyHub-Parent-Mission-Id'],parent);
    assert.equal(seen[0].headers.Authorization,undefined);
    assert.equal(seen[0].credentials,'same-origin');
    await client.upload('',bytes,'Neuer Entwurf');
    assert.equal(seen[1].headers['X-SkyHub-Parent-Mission-Id'],undefined);
    await assert.rejects(client.upload('',bytes,'Ungültig',{parentId:'x'}),/Vorgänger/);
    assert.equal(seen.length,2,'malformed parent never triggers a request');
  }finally{global.fetch=original;}
});
test('HTML and editor wire read-only predecessor comparison without flight commands',()=>{
  const root=path.join(__dirname,'../../frontend/public');
  const html=fs.readFileSync(path.join(root,'wpml-editor.html'),'utf8');
  const js=fs.readFileSync(path.join(root,'wpml-editor.js'),'utf8');
  assert.match(html,/wpml-mission-version-compare\.js/);
  assert.match(html,/id="store-compare-status"/);
  assert.match(html,/id="store-compare-left"/);
  assert.match(html,/id="store-compare-right"/);
  assert.match(html,/id="store-compare-selected"/);
  assert.match(js,/Manueller Vergleich \(Abstammung nicht belegt\)/);
  assert.match(js,/Mit Vorgänger vergleichen/);
  assert.match(js,/store\.download\(token\(\),beforeId\)/);
  assert.match(js,/mission\.parentId,mission\.id/);
  assert.match(js,/currentParentId=linkedParent/);
  assert.doesNotMatch(js,/flighttask_execute|mqtt\.connect\(/);
});
