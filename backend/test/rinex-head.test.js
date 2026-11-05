'use strict';
// PPK page: RINEX header check before upload (frontend/public/rinex-head.js).
const test=require('node:test');
const assert=require('node:assert/strict');
const R=require('../../frontend/public/rinex-head.js');
const L=(body,label)=>body.padEnd(60)+label;
const head=lines=>lines.join('\n')+'\n';
// As written by the DJI aircraft (FLY .OBS, 15.08.2025): empty marker/receiver/antenna, position 0/0/0.
const drone=head([L('     3.05           OBSERVATION DATA    M: Mixed','RINEX VERSION / TYPE'),L('','MARKER NAME'),L('','REC # / TYPE / VERS'),
  L('','ANT # / TYPE'),L('        0.0000        0.0000        0.0000','APPROX POSITION XYZ'),L('','END OF HEADER')]);
// SAPOS virtual reference station near Bad Schönborn (49.15 N, 8.60 E, ~160 m).
const geo={lat:49.15,lon:8.60,h:160};
const xyz=(()=>{const a=6378137,f=1/298.257222101,e2=f*(2-f),r=Math.PI/180,N=a/Math.sqrt(1-e2*Math.sin(geo.lat*r)**2);
  return [(N+geo.h)*Math.cos(geo.lat*r)*Math.cos(geo.lon*r),(N+geo.h)*Math.cos(geo.lat*r)*Math.sin(geo.lon*r),(N*(1-e2)+geo.h)*Math.sin(geo.lat*r)];})();
const sapos=head([L('     3.04           OBSERVATION DATA    M (MIXED)','RINEX VERSION / TYPE'),L('VRS_0416','MARKER NAME'),
  L('0000                VRS                 GNSMART','REC # / TYPE / VERS'),L('0000                LEIAR25.R4      NONE','ANT # / TYPE'),
  L(xyz.map(v=>v.toFixed(4).padStart(14)).join(''),'APPROX POSITION XYZ'),L('','END OF HEADER')]);

test('drone file is recognised and blocks the run in both modes',()=>{
  const h=R.parseHeader(drone);
  assert.equal(h.version,'3.05');assert.equal(h.receiver,'');assert.deepEqual(h.approx,{x:0,y:0,z:0});
  for(const mode of ['header','manual']){const r=R.assess(h,{mode});assert.equal(r.block,true);assert.match(r.text,/von der Drohne/);}
});
test('SAPOS header: position, receiver, antenna and distance to the flight',()=>{
  const h=R.parseHeader(sapos);
  assert.equal(h.marker,'VRS_0416');assert.equal(h.receiver,'VRS');assert.equal(h.antenna,'LEIAR25.R4 NONE');
  const r=R.assess(h,{flights:[{lat:49.1525,lon:8.6044}]});
  assert.equal(r.block,false);assert.equal(r.warn,false);
  assert.ok(Math.abs(r.geo.lat-49.15)<1e-6&&Math.abs(r.geo.lon-8.60)<1e-6&&Math.abs(r.geo.h-160)<0.01);
  assert.match(r.text,/Abstand zum Flug \d+ m/);
  const far=R.assess(h,{flights:[{lat:48.40,lon:9.99}]});
  assert.equal(far.warn,true);assert.match(far.text,/über 30 km/);
});
test('real station without position: header mode blocks, manual mode passes',()=>{
  const h=R.parseHeader(sapos.replace(/^.*APPROX POSITION XYZ\n/m,''));
  assert.equal(h.approx,null);
  assert.equal(R.assess(h,{mode:'header'}).block,true);
  assert.equal(R.assess(h,{mode:'manual'}).block,false);
});
test('not a RINEX observation file (compressed, binary, cut header)',()=>{
  assert.equal(R.assess(R.parseHeader('\x1f\x8b\x08 binary')).block,true);
  assert.equal(R.assess(R.parseHeader(sapos.replace(/^.*END OF HEADER\n/m,''))).block,true);
});
test('implausible header height (e.g. wrong units) blocks the run',()=>{
  const h=R.parseHeader(sapos);h.approx={x:h.approx.x*1.001,y:h.approx.y*1.001,z:h.approx.z*1.001};
  const r=R.assess(h);assert.equal(r.block,true);assert.match(r.text,/unplausibel/);
});
