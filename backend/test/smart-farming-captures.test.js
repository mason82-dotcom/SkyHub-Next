'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const {Readable}=require('node:stream');
const {parseBandHeader,assess,createSmartFarmingCaptures,SCHEMA,ASSESSMENT_VERSION}=require('../smart-farming-captures');

const UUID='c0b53d9a3dd045db9c77bf6c744608d7',NIGHT='c40e99424cbc480ebcc820d84bafef5b';
// Little-endian TIFF magic followed by a DJI-style XMP packet (elements and attributes mixed).
function bandTiff({uuid=UUID,band='Red',irr=991.15,lat='+49.15',lon='+8.589',rel='-0.000',model='M3M'}={}){
  const xmp='<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:Description xmp:CreateDate="2026-10-15T14:02:40+02:00" '+
    'tiff:Model="'+model+'"><drone-dji:CaptureUUID>'+uuid+'</drone-dji:CaptureUUID><Camera:BandName>'+band+
    '</Camera:BandName><Camera:CentralWavelength>650</Camera:CentralWavelength><drone-dji:Irradiance>'+irr+
    '</drone-dji:Irradiance><drone-dji:GpsLatitude>'+lat+'</drone-dji:GpsLatitude><drone-dji:GpsLongitude>'+lon+
    '</drone-dji:GpsLongitude><drone-dji:RelativeAltitude>'+rel+'</drone-dji:RelativeAltitude></rdf:Description></x:xmpmeta>';
  return Buffer.concat([Buffer.from('II*\0','latin1'),Buffer.alloc(856),Buffer.from(xmp,'latin1')]);
}

test('band header parser identifies capture, band and calibration fields from XMP only',()=>{
  const h=parseBandHeader(bandTiff());
  assert.equal(h.captureUUID,UUID);assert.equal(h.band,'R');assert.equal(h.model,'M3M');
  assert.equal(h.irradiance,991.15);assert.equal(h.lat,49.15);assert.equal(h.wavelength,650);
  assert.equal(parseBandHeader(bandTiff({band:'Blue'})),null);
  assert.equal(parseBandHeader(bandTiff({band:'constructor'})),null);
  assert.equal(parseBandHeader(bandTiff({band:'__proto__'})),null);
  assert.equal(parseBandHeader(bandTiff({uuid:'nope'})),null);
  assert.equal(parseBandHeader(Buffer.from('not a tiff at all')),null);
});

test('assessment flags missing bands, night shots, missing GPS and ground-level captures',()=>{
  const bands=Object.fromEntries(['G','R','RE','NIR'].map(b=>[b,{irradiance:900}]));
  assert.equal(assess({bands,gps:{lat:49,lon:8},relativeAltitude:40,model:'M3M'}).usable,true);
  const night=assess({bands:Object.fromEntries(['G','R','RE','NIR'].map(b=>[b,{irradiance:1}])),gps:null,relativeAltitude:0});
  assert.equal(night.usable,false);
  assert.ok(night.blockers.includes('low-irradiance'));
  assert.ok(night.issues.some(i=>/GPS/.test(i)));
  assert.ok(night.blockers.includes('not-above-takeoff'));
  const partial=assess({bands:{G:{irradiance:900}},gps:{lat:1,lon:1},relativeAltitude:30});
  assert.equal(partial.complete,false);assert.match(partial.issues[0],/R, RE, NIR/);
});

test('captures API joins bands from SD import and Pilot 2 uploads by CaptureUUID',async()=>{
  const objects={
    ['wayline/sdimport-X/'+'a'.repeat(64)+'/DJI_20261015140240_0001_MS_G.TIF']:bandTiff({band:'Green'}),
    ['wayline/sdimport-X/'+'b'.repeat(64)+'/DJI_20261015140240_0001_MS_RE.TIF']:bandTiff({band:'RedEdge'}),
    'wayline/org_1_1792065762000.tiff':bandTiff({band:'Red'}),
    'wayline/org_2_1792065762000.tiff':bandTiff({band:'NIR'}),
    'wayline/DJI_20261001223817_0001_MS_R.TIF':bandTiff({uuid:NIGHT,band:'Red',irr:1,lat:'0',lon:'0'}),
    'wayline/other.tif':Buffer.from('II*\0no xmp here')
  };
  const preview=JSON.stringify({indices:{NDVI:{median:0.57,p05:0,p95:0.92,valid_fraction:0.964}},
    calibration:'black level, vignetting',grid_scale:4});
  const farming={['ms-preview/'+UUID+'.json']:Buffer.from(preview)};
  const index={
    'dji-cloud':{objects:Object.keys(objects).map(key=>({key,size:10e6,etag:'"e"',lastModified:null}))},
    farming:{objects:[{key:'ms-preview/'+UUID+'.json'},{key:'ms-preview/'+UUID+'.png'}]}
  };
  const storage={getObject:async(bucket,key)=>{
    const body=(bucket==='farming'?farming:objects)[key];
    if(!body)throw Object.assign(new Error('nf'),{status:404});
    return {body:Readable.from([body])};
  }};
  const app=express();
  app.use('/c',createSmartFarmingCaptures({storage,bucketIndex:async b=>index[b],clock:()=>Date.UTC(2026,10,1)}).router);
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const base='http://127.0.0.1:'+server.address().port;
  try{
    const data=await (await fetch(base+'/c')).json();
    assert.equal(data.count,2);assert.equal(data.usable,0);
    assert.equal(data.assessmentVersion,ASSESSMENT_VERSION);
    const day=data.captures.find(c=>c.captureUUID===UUID);
    assert.deepEqual(Object.keys(day.bands).sort(),['G','NIR','R','RE']);
    assert.equal(day.complete,true);assert.equal(day.usable,false);
    assert.equal(day.completeness,'complete');assert.equal(day.usability,'blocked');
    assert.equal(day.bands.R.key,'wayline/org_1_1792065762000.tiff');
    assert.ok(day.blockers.includes('not-above-takeoff')); // relative altitude 0 in the fixture
    assert.equal(day.preview.indices.NDVI.median,0.57);
    assert.equal(day.preview.image.key,'ms-preview/'+UUID+'.png');
    const night=data.captures.find(c=>c.captureUUID===NIGHT);
    assert.equal(night.complete,false);assert.equal(night.gps,null);
    const manifest=await fetch(base+'/c/manifest');
    assert.match(manifest.headers.get('content-disposition'),/m3m-captures-manifest\.json/);
    const m=await manifest.json();
    assert.equal(m.schema,SCHEMA);assert.equal(m.generatedAt,'2026-11-01T00:00:00.000Z');
    assert.equal(m.schema,'skyhub-m3m-capture-manifest-v2');
    assert.equal(m.assessmentVersion,ASSESSMENT_VERSION);
    const entry=m.captures.find(c=>c.captureUUID===UUID);
    for(const key of ['complete','completeness','usability','usable','blockers','bandCounts',
      'missingBands','duplicateBands','metadataConflicts','irradianceComplete',
      'minIrradiance','gpsAssessment','sourceAuthenticityVerified','radiometryVerified','mappingReady'])assert.deepEqual(entry[key],day[key],key);
    assert.equal(m.captures.find(c=>c.captureUUID===UUID).bands.NIR.etag,'"e"');
  }finally{server.close();}
});

function goodCapture(){
  return {bands:Object.fromEntries(['G','R','RE','NIR'].map(b=>[b,{irradiance:900}])),
    model:'M3M',gps:{lat:49,lon:8},relativeAltitude:30,metadataConflicts:[]};
}

for(const [label,mutate,blocker] of [
  ['one missing irradiance',c=>{c.bands.R.irradiance=null;},'missing-irradiance'],
  ['three missing irradiances',c=>{for(const b of ['R','RE','NIR'])delete c.bands[b].irradiance;},'missing-irradiance'],
  ['all missing irradiances',c=>{for(const b of ['G','R','RE','NIR'])c.bands[b].irradiance=null;},'missing-irradiance'],
  ['string irradiance',c=>{c.bands.R.irradiance='900';},'missing-irradiance'],
  ['nonfinite irradiance',c=>{c.bands.R.irradiance=Infinity;},'missing-irradiance'],
  ['low irradiance',c=>{c.bands.R.irradiance=9.99;},'low-irradiance'],
  ['missing GPS',c=>{c.gps=null;},'invalid-gps'],
  ['invalid latitude',c=>{c.gps.lat=91;},'invalid-gps'],
  ['invalid longitude',c=>{c.gps.lon=-181;},'invalid-gps'],
  ['nonfinite GPS',c=>{c.gps.lat=NaN;},'invalid-gps'],
  ['zero sentinel GPS',c=>{c.gps={lat:0,lon:0};},'invalid-gps'],
  ['unknown altitude',c=>{c.relativeAltitude=null;},'unknown-relative-altitude'],
  ['nonfinite altitude',c=>{c.relativeAltitude=Infinity;},'unknown-relative-altitude'],
  ['takeoff plane',c=>{c.relativeAltitude=0;},'not-above-takeoff'],
  ['below takeoff',c=>{c.relativeAltitude=-20;},'not-above-takeoff'],
  ['less than one metre',c=>{c.relativeAltitude=0.99;},'not-above-takeoff'],
  ['unknown model',c=>{c.model=null;},'unconfirmed-model'],
  ['different camera',c=>{c.model='OTHER';},'unconfirmed-model'],
  ['metadata conflict',c=>{c.metadataConflicts=['gps'];},'metadata-conflict']
])test('metadata screening blocks '+label+' without losing band completeness',()=>{
  const capture=goodCapture();mutate(capture);
  const a=assess(capture);
  assert.equal(a.complete,true);assert.equal(a.completeness,'complete');
  assert.equal(a.usable,false);assert.equal(a.usability,'blocked');
  assert.ok(a.blockers.includes(blocker));
  assert.equal(a.mappingReady,false);assert.equal(a.radiometryVerified,false);
});

test('thresholds allow only a metadata candidate and never scientific readiness',()=>{
  const capture=goodCapture();capture.relativeAltitude=1;capture.gps={lat:0,lon:8};
  for(const b of Object.values(capture.bands))b.irradiance=10;
  const a=assess(capture);
  assert.equal(a.assessmentVersion,ASSESSMENT_VERSION);
  assert.equal(a.usability,'metadata-candidate');assert.equal(a.usable,true);
  assert.equal(a.irradianceComplete,true);assert.deepEqual(a.blockers,[]);
  assert.equal(a.mappingReady,false);assert.equal(a.radiometryVerified,false);
});

function runtime(objects){
  const index=Object.keys(objects).map(key=>({key,size:10e6,etag:'"v1"',lastModified:'2026-11-01T00:00:00Z'}));
  const reads=[];
  const module=createSmartFarmingCaptures({storage:{async getObject(bucket,key,options){
    assert.equal(bucket,'dji-cloud');assert.equal(options.range,'bytes=0-65535');
    reads.push(key);return {body:Readable.from([objects[key]])};
  }},bucketIndex:async b=>({objects:b==='dji-cloud'?index:[]})});
  return {...module,index,reads};
}
function flightObjects(overrides={}){
  return Object.fromEntries(Object.entries({G:'Green',R:'Red',RE:'RedEdge',NIR:'NIR'})
    .map(([b,band])=>['source/'+b+'.tif',bandTiff({rel:'30',band,...overrides[b]})]));
}
async function manifestOf(module){
  return new Promise((resolve,reject)=>module.router.handle({method:'GET',url:'/manifest'},
    {set(){return this;},status(){reject(new Error('Unexpected route error'));return this;},json:resolve},
    ()=>reject(new Error('Unexpected fallthrough'))));
}

test('duplicate bands are omitted, blocked and order independent in API and v2 manifest',async()=>{
  const objects=flightObjects();objects['duplicate/G.tif']=bandTiff({band:'Green',rel:'30',irr:1});
  const module=runtime(objects);
  const first=(await module.captures())[0];
  assert.equal(first.bandCounts.G,2);assert.deepEqual(first.duplicateBands,['G']);
  assert.deepEqual(first.missingBands,[]);assert.equal(first.completeness,'conflicted');
  assert.equal(first.complete,false);assert.equal(first.usable,false);
  assert.ok(first.blockers.includes('duplicate-bands'));assert.equal(first.bands.G,undefined);
  assert.equal(first.preview,null);
  module.index.reverse();assert.deepEqual((await module.captures())[0],first);
  const entry=(await manifestOf(module)).captures[0];
  assert.deepEqual(entry.duplicateBands,['G']);assert.equal(entry.bandCounts.G,2);
  assert.equal(entry.bands.G,undefined);assert.equal(entry.usable,false);
  assert.equal(entry.mappingReady,false);
});

for(const [field,overrides,conflict] of [
  ['GPS',{lat:'50'},'gps'],['relative altitude',{rel:'31'},'relativeAltitude'],
  ['model',{model:'OTHER'},'model']
])test('conflicting '+field+' cannot be selected from the first or last band',async()=>{
  const module=runtime(flightObjects({R:overrides}));
  const first=(await module.captures())[0];
  assert.equal(first.complete,true);assert.equal(first.usable,false);
  assert.ok(first.metadataConflicts.includes(conflict));assert.ok(first.blockers.includes('metadata-conflict'));
  module.index.reverse();assert.deepEqual((await module.captures())[0],first);
  assert.deepEqual((await manifestOf(module)).captures[0].metadataConflicts,first.metadataConflicts);
});

test('missing GPS or altitude on one band is not filled from other bands',async()=>{
  for(const override of [{lat:'invalid'},{rel:'invalid'}]){
    const c=(await runtime(flightObjects({NIR:override})).captures())[0];
    assert.equal(c.complete,true);assert.equal(c.usable,false);
    assert.ok(c.blockers.includes(override.lat?'invalid-gps':'unknown-relative-altitude'));
  }
});

test('ETag changes invalidate a cached header even at identical size and timestamp',async()=>{
  const objects=flightObjects();const module=runtime(objects);
  assert.equal((await module.captures())[0].usable,true);
  assert.equal(module.reads.length,4);
  objects['source/R.tif']=bandTiff({rel:'30',band:'Red',irr:1});
  module.index.find(i=>i.key==='source/R.tif').etag='"v2"';
  const c=(await module.captures())[0];
  assert.equal(c.usable,false);assert.ok(c.blockers.includes('low-irradiance'));
  assert.equal(module.reads.length,5);
});

test('positive metadata candidate and manifest remain explicitly unverified',async()=>{
  const module=runtime(flightObjects());const c=(await module.captures())[0];
  const m=await manifestOf(module),entry=m.captures[0];
  assert.equal(c.usable,true);assert.equal(c.usability,'metadata-candidate');
  assert.equal(c.radiometryVerified,false);assert.equal(c.mappingReady,false);
  assert.equal(c.sourceAuthenticityVerified,false);
  assert.equal(m.assessmentVersion,ASSESSMENT_VERSION);
  assert.equal(entry.usable,true);assert.equal(entry.mappingReady,false);
  assert.equal(entry.radiometryVerified,false);
  assert.equal(entry.sourceAuthenticityVerified,false);
});


test('centimetre band differences are valid GPS but remain blocked without tolerance',async()=>{
  const module=runtime(flightObjects({R:{lat:'49.15000008'},RE:{lat:'49.15000017'},NIR:{lat:'49.15000025'}}));
  const c=(await module.captures())[0],g=c.gpsAssessment;
  assert.equal(c.complete,true);assert.equal(c.usable,false);assert.equal(c.gps,null);
  assert.equal(g.validPositionCount,4);assert.equal(g.positionCount,4);
  assert.equal(g.allPositionsValid,true);assert.equal(g.commonPositionAvailable,false);
  assert.equal(g.consistency,'different');assert.equal(g.toleranceApplied,false);
  assert.ok(g.maxSpreadMetres>.027&&g.maxSpreadMetres<.029);
  assert.ok(c.blockers.includes('gps-disagreement'));assert.ok(!c.blockers.includes('invalid-gps'));
  assert.deepEqual(c.metadataConflicts,['gps']);
  module.index.reverse();assert.deepEqual((await module.captures())[0],c);
  assert.deepEqual((await manifestOf(module)).captures[0].gpsAssessment,g);
  assert.equal(c.sourceAuthenticityVerified,false);assert.equal(c.radiometryVerified,false);
  assert.equal(c.mappingReady,false);
  // Summary contains no extra raw positions; consensus is never averaged.
  assert.ok(!JSON.stringify(g).includes('49.15'));
});

test('exact GPS consensus remains a candidate with zero diagnostic spread',async()=>{
  const c=(await runtime(flightObjects()).captures())[0];
  assert.equal(c.usable,true);assert.deepEqual(c.gps,{lat:49.15,lon:8.589});
  assert.equal(c.gpsAssessment.consistency,'exact');
  assert.equal(c.gpsAssessment.commonPositionAvailable,true);
  assert.equal(c.gpsAssessment.maxSpreadMetres,0);
});

test('invalid GPS reasons and partial disagreement are not hidden by valid bands',async()=>{
  for(const [override,reason] of [
    [{lat:'invalid'},'missingOrNonNumericCount'],[{lat:'91'},'outOfRangeCount'],
    [{lat:'0',lon:'0'},'zeroSentinelCount']
  ]){
    const c=(await runtime(flightObjects({R:override,NIR:{lat:'49.15000025'}})).captures())[0];
    const g=c.gpsAssessment;
    assert.equal(g[reason],1);assert.equal(g.validPositionCount,3);
    assert.equal(g.allPositionsValid,false);assert.equal(g.commonPositionAvailable,false);
    assert.equal(g.consistency,'different');assert.equal(g.maxSpreadMetres,null);
    assert.equal(c.gps,null);assert.equal(c.usable,false);
    assert.ok(c.blockers.includes('invalid-gps'));assert.ok(!c.blockers.includes('gps-disagreement'));
  }
  const zero=Object.fromEntries(['G','R','RE','NIR'].map(b=>[b,{lat:'0',lon:'0'}]));
  const c=(await runtime(flightObjects(zero)).captures())[0];
  assert.equal(c.gpsAssessment.zeroSentinelCount,4);
  assert.equal(c.gpsAssessment.validPositionCount,0);
  assert.equal(c.gpsAssessment.consistency,'unavailable');
  assert.equal(c.gpsAssessment.maxSpreadMetres,null);
});

test('spread is bounded to unique complete groups and measures spherical separation',async()=>{
  const objects=flightObjects({G:{lon:'179.9999999'},R:{lon:'-179.9999999'},
    RE:{lon:'179.9999999'},NIR:{lon:'-179.9999999'}});
  const c=(await runtime(objects).captures())[0];
  assert.ok(c.gpsAssessment.maxSpreadMetres>0&&c.gpsAssessment.maxSpreadMetres<.03);
  assert.equal(c.usable,false); // no longitude wrapping consensus or tolerance
  objects['duplicate/G.tif']=bandTiff({band:'Green',rel:'30',lat:'-49'});
  const dup=(await runtime(objects).captures())[0];
  assert.equal(dup.gpsAssessment.positionCount,5);
  assert.equal(dup.gpsAssessment.maxSpreadMetres,null);
  assert.equal(dup.bands.G,undefined);assert.equal(dup.usable,false);
  delete objects['duplicate/G.tif'];delete objects['source/G.tif'];
  const partial=(await runtime(objects).captures())[0];
  assert.equal(partial.gpsAssessment.positionCount,3);
  assert.equal(partial.gpsAssessment.maxSpreadMetres,null);assert.equal(partial.complete,false);
});
