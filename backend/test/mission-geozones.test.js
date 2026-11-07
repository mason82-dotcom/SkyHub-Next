'use strict';
// Geozone check (dipul WFS) with a fake service.
const test=require('node:test');
const assert=require('node:assert/strict');
const {geozoneConfig,createGeozoneClient,geozoneFindings,contains,LAYERS}=require('../mission-geozones');

const square=(w,s,e,n,hole)=>({type:'Polygon',coordinates:[[[w,s],[e,s],[e,n],[w,n],[w,s]],...(hole?[hole]:[])]});
test('config: opt-in, https only, dipul by default',()=>{
  assert.equal(geozoneConfig({}).enabled,false);
  assert.equal(geozoneConfig({SKYHUB_GEOZONES_ENABLED:'true'}).url,'https://uas-betrieb.de/geoservices/dipul/wfs');
  assert.match(geozoneConfig({SKYHUB_GEOZONES_ENABLED:'true',SKYHUB_GEOZONES_WFS_URL:'http://x/wfs'}).issue,/https/);
});
test('point in polygon respects holes and multipolygons',()=>{
  const g=square(8,49,9,50,[[8.4,49.4],[8.6,49.4],[8.6,49.6],[8.4,49.6],[8.4,49.4]]);
  assert.equal(contains(g,[8.2,49.2]),true);assert.equal(contains(g,[8.5,49.5]),false);assert.equal(contains(g,[9.5,49.5]),false);
  assert.equal(contains({type:'MultiPolygon',coordinates:[square(0,0,1,1).coordinates,g.coordinates]},[8.2,49.2]),true);
});
function fakeWfs(features,{fail=[]}={}){
  const calls=[];
  const fetchImpl=async url=>{
    const u=new URL(url);calls.push(u);
    const layer=u.searchParams.get('typeNames').replace('dipul:','');
    if(fail.includes(layer))return {ok:false,status:503};
    return {ok:true,json:async()=>({type:'FeatureCollection',features:features.filter(f=>f.layer===layer).map(f=>({id:f.id,geometry:f.geometry,properties:f.properties}))})};
  };
  return {fetchImpl,calls};
}
const NSG={layer:'naturschutzgebiete',id:'naturschutzgebiete.6680',geometry:square(8.55,49.08,8.57,49.10),
  properties:{name:'Michaelsberg und Habichtsbuckel',type_code:'NATURSCHUTZGEBIET',legal_ref:'§ 21h, Abs. 3 (6.) LuftVO',lower_limit_m_agl:0}};
const route=[{lat:49.09,lon:8.54,h:50},{lat:49.09,lon:8.56,h:50},{lat:49.09,lon:8.58,h:50}];
test('zones on the route: name, legal reference, waypoint span; only the bounding box is sent',async()=>{
  const {fetchImpl,calls}=fakeWfs([NSG,{...NSG,id:'far',geometry:square(10,50,11,51)}]);
  const c=createGeozoneClient({url:'https://wfs.test/wfs',bufferM:100},{fetchImpl});
  const g=await c.check('sha',route);
  assert.equal(g.status,'ok');assert.equal(calls.length,LAYERS.length);
  assert.ok(calls.every(u=>/^[\d.]+,[\d.]+,[\d.]+,[\d.]+,urn:ogc:def:crs:EPSG::4326$/.test(u.searchParams.get('bbox'))));
  assert.equal(g.zones.length,1);
  const z=g.zones[0];
  assert.equal(z.name,'Michaelsberg und Habichtsbuckel');assert.equal(z.fromWaypoint,1);assert.equal(z.toWaypoint,3);
  assert.ok(z.share>40&&z.share<60);
  const f=geozoneFindings(g);
  assert.equal(f.errors.length,0);
  assert.match(f.warnings[0],/^geozone: Michaelsberg und Habichtsbuckel \(NATURSCHUTZGEBIET, § 21h, Abs\. 3 \(6\.\) LuftVO\) waypoints 1-3/);
  await c.check('sha',route);assert.equal(calls.length,LAYERS.length,'cached per route hash');
});
test('partial and total outages are reported, never silently "clear"',async()=>{
  const part=createGeozoneClient({url:'https://wfs.test/wfs',bufferM:100},{fetchImpl:fakeWfs([],{fail:['kontrollzonen']}).fetchImpl});
  const g=await part.check('a',route);
  assert.deepEqual(g.layersFailed,['kontrollzonen']);
  assert.ok(geozoneFindings(g).warnings.some(w=>/partly checked: 1/.test(w)));
  assert.equal(geozoneFindings(g).warnings.some(w=>/no published dipul zone/.test(w)),false);
  const none=createGeozoneClient({url:'https://wfs.test/wfs',bufferM:100},{fetchImpl:fakeWfs([],{fail:LAYERS}).fetchImpl});
  const n=await none.check('b',route);
  assert.equal(n.status,'unavailable');
  assert.match(geozoneFindings(n).warnings[0],/^geozones not checked/);
});
