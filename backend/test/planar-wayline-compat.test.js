'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {reviewPlanarKmz}=require('../planar-wayline-compat');
const editor=require('../../frontend/public/wpml-editor-core');
const {packageKmz}=require('../wpml-kmz');
function example(){
 const x=editor.documents({model:'mavic3m',name:'SENSITIVE mission',
   waypoints:[{lat:49.123456,lon:8.654321,height:60},
     {lat:49.124456,lon:8.655321,height:60}]});
 return packageKmz(x.templateXml,x.waylinesXml);
}
test('P2 strictly denies use of imported, non-planar KMZ',()=>{
 const r=reviewPlanarKmz(example(),{targetModel:'mavic3m'});
 assert.equal(r.status,'blocked');
 assert.equal(r.flightReady,false);
 assert.equal(r.exportableAsWaylines,false);
 assert.equal(r.sourceMatchesTarget,true);
 assert.ok(r.blockers.includes('NOT_PLANAR_MAPPING'));
 assert.equal(JSON.stringify(r).includes('SENSITIVE mission'),false);
 assert.equal(JSON.stringify(r).includes('49.123456'),false);
});
test('P2 mismatched target blocks, never auto-corrects subtype',()=>{
 const r=reviewPlanarKmz(example(),{targetModel:'matrice4t'});
 assert.ok(r.blockers.includes('SOURCE_TARGET_PROFILE_MISMATCH'));
 assert.equal(r.sourceMatchesTarget,false);
 assert.equal(r.originalXmlRewritten,false);
});
test('P2 invalid model or archive fails closed',()=>{
 assert.throws(()=>reviewPlanarKmz(example(),{targetModel:'not-a-drone'}),/Unsupported target/);
 assert.throws(()=>reviewPlanarKmz(Buffer.from('garbage')),/Invalid KMZ/);
});

test('P2 parses 1.0.6 reference and exposes upstream M3TD default as mismatch',()=>{
 const x=editor.documents({model:'matrice4t',name:'PRIVATE MAPPING',
   waypoints:[{lat:48.1,lon:8.1,height:60},{lat:48.101,lon:8.101,height:60}]});
 const modify=xml=>xml
   .replace('http://www.dji.com/wpmz/1.0.2','http://www.dji.com/wpmz/1.0.6')
   .replace('<wpml:templateType>waypoint</wpml:templateType>',
     '<wpml:templateType>mapping2d</wpml:templateType>')
   .replace('<wpml:droneEnumValue>99</wpml:droneEnumValue>',
     '<wpml:droneEnumValue>91</wpml:droneEnumValue>')
   .replace('<wpml:payloadEnumValue>89</wpml:payloadEnumValue>',
     '<wpml:payloadEnumValue>81</wpml:payloadEnumValue>');
 const zip=Buffer.from(editor.createKmz(modify(x.templateXml),modify(x.waylinesXml)));
 const r=reviewPlanarKmz(zip,{targetModel:'matrice4t'});
 assert.equal(r.namespaceProfile,'http://www.dji.com/wpmz/1.0.6');
 assert.equal(r.templateType,'mapping2d');
 assert.equal(r.aircraft,'Matrice 3TD');
 assert.ok(r.blockers.includes('UPSTREAM_DEFAULT_M3TD'));
 assert.ok(r.blockers.includes('SOURCE_TARGET_PROFILE_MISMATCH'));
 assert.ok(r.blockers.includes('WPML_106_INSPECT_ONLY'));
 assert.equal(r.offlineValid,null);
 assert.equal(r.flightReady,false);
 assert.equal(r.originalXmlRewritten,false);
 assert.equal(JSON.stringify(r).includes('PRIVATE MAPPING'),false);
});
