'use strict';
// DJI WPML (template.kml / waylines.wpml spec): wpml:globalRTHHeight is required in waylines.wpml
// for M3E/M3T/M3M, and Placemarks with useGlobalHeadingParam=1 refer to the template's
// wpml:globalWaypointHeadingParam (present in DJI's official template example).
const {test}=require('node:test');
const assert=require('node:assert/strict');
const planner=require('../../frontend/public/wpml-editor-core');
const actionDraft=require('../../frontend/public/wpml-action-draft');
const library=require('../../frontend/public/wpml-route-library-core');
const review=require('../../frontend/public/wpml-mission-review');
const {validateDocuments}=require('../wpml');

function plan(extra={}){
  return {name:'RTH check',model:'mavic3m',speed:5,takeoffHeight:30,finishAction:'goHome',
    timestamp:1792573200000,waypoints:[
      {lat:49.124,lon:8.612,height:50,photo:false},
      {lat:49.125,lon:8.613,height:50,photo:false}],...extra};
}
const configOf=(xml)=>xml.slice(xml.indexOf('<wpml:missionConfig>'),xml.indexOf('</wpml:missionConfig>'));

test('both mission configurations carry globalRTHHeight (default 100 m, custom value kept)',()=>{
  for(const [input,expected] of [[plan(),100],[plan({rthHeight:60}),60]]){
    const out=planner.build(input);
    for(const xml of [out.templateXml,out.waylinesXml]){
      const config=configOf(xml);
      assert.match(config,new RegExp('<wpml:globalRTHHeight>'+expected+'</wpml:globalRTHHeight>'));
      // DJI order: transitional speed, then RTH height, then drone info.
      assert.ok(config.indexOf('globalTransitionalSpeed')<config.indexOf('globalRTHHeight'));
      assert.ok(config.indexOf('globalRTHHeight')<config.indexOf('droneInfo'));
    }
    assert.equal(out.summary.rthHeight,expected);
    assert.equal(out.flightReady,false);
  }
});

test('RTH height outside 20–120 m is rejected like other unsafe draft values',()=>{
  for(const bad of [0,19,121,'abc',Infinity])
    assert.throws(()=>planner.build(plan({rthHeight:bad})),/rthHeight/,String(bad));
  assert.ok(review.analyze({name:'x',model:'mavic3m',speed:5,takeoffHeight:30,rthHeight:150,
    finishAction:'goHome',photoTrigger:'reachPoint',globalHeight:50,
    waypoints:plan().waypoints}).issueCodes.includes('invalid-rth-height'));
});

test('template declares the global heading referenced by every Placemark',()=>{
  const {templateXml}=planner.build(plan());
  const folder=templateXml.slice(templateXml.indexOf('<Folder>'));
  assert.match(folder,/<wpml:globalWaypointHeadingParam><wpml:waypointHeadingMode>followWayline<\/wpml:waypointHeadingMode><wpml:waypointHeadingPathMode>followBadArc<\/wpml:waypointHeadingPathMode><\/wpml:globalWaypointHeadingParam>/);
  assert.ok(folder.indexOf('globalWaypointHeadingParam')<folder.indexOf('<Placemark>'));
  assert.equal((folder.match(/<wpml:useGlobalHeadingParam>1</g)||[]).length,2);
});

test('backend validator accepts the export and warns only when globalRTHHeight is missing',()=>{
  const out=planner.build(plan({rthHeight:80}));
  const ok=validateDocuments(out.templateXml,out.waylinesXml);
  assert.equal(ok.valid,true,JSON.stringify(ok.errors));
  assert.equal(ok.warnings.some(w=>/globalRTHHeight/.test(w)),false);
  // An earlier SkyHub export without the field stays valid but is flagged.
  const strip=xml=>xml.replace(/<wpml:globalRTHHeight>80<\/wpml:globalRTHHeight>/,'');
  const legacy=validateDocuments(strip(out.templateXml),strip(out.waylinesXml));
  assert.equal(legacy.valid,true,JSON.stringify(legacy.errors));
  assert.ok(legacy.warnings.some(w=>/globalRTHHeight missing/.test(w)));
  const bad=validateDocuments(out.templateXml,out.waylinesXml.replace('>80</wpml:globalRTHHeight>','>-5</wpml:globalRTHHeight>'));
  assert.equal(bad.valid,false);
});

test('route library and route reversal keep the RTH height; old revisions default to 100 m',()=>{
  const saved=library.save(library.blank(),{name:'RTH',plan:plan({rthHeight:70})});
  assert.equal(library.find(saved.library,saved.routeId,1).plan.rthHeight,70);
  const reversed=actionDraft.reverseRoute(plan({rthHeight:70}));
  assert.equal(reversed.plan.rthHeight,70);
  assert.equal(planner.normalize(plan()).rthHeight,100);
});
