'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const {Readable}=require('node:stream');
const {parseBandHeader,assess,createSmartFarmingCaptures,SCHEMA}=require('../smart-farming-captures');

const UUID='c0b53d9a3dd045db9c77bf6c744608d7',NIGHT='c40e99424cbc480ebcc820d84bafef5b';
// Little-endian TIFF magic followed by a DJI-style XMP packet (elements and attributes mixed).
function bandTiff({uuid=UUID,band='Red',irr=991.15,lat='+49.15',lon='+8.589',rel='-0.000'}={}){
  const xmp='<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:Description xmp:CreateDate="2026-10-15T14:02:40+02:00" '+
    'tiff:Model="M3M"><drone-dji:CaptureUUID>'+uuid+'</drone-dji:CaptureUUID><Camera:BandName>'+band+
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
  assert.equal(parseBandHeader(bandTiff({uuid:'nope'})),null);
  assert.equal(parseBandHeader(Buffer.from('not a tiff at all')),null);
});

test('assessment flags missing bands, night shots, missing GPS and ground-level captures',()=>{
  const bands=Object.fromEntries(['G','R','RE','NIR'].map(b=>[b,{irradiance:900}]));
  assert.equal(assess({bands,gps:{lat:49,lon:8},relativeAltitude:40}).usable,true);
  const night=assess({bands:Object.fromEntries(['G','R','RE','NIR'].map(b=>[b,{irradiance:1}])),gps:null,relativeAltitude:0});
  assert.equal(night.usable,false);
  assert.ok(night.issues.some(i=>/Tageslicht/.test(i)));
  assert.ok(night.issues.some(i=>/GPS/.test(i)));
  assert.ok(night.issues.some(i=>/am Boden/.test(i)));
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
    assert.equal(data.count,2);assert.equal(data.usable,1);
    const day=data.captures.find(c=>c.captureUUID===UUID);
    assert.deepEqual(Object.keys(day.bands).sort(),['G','NIR','R','RE']);
    assert.equal(day.complete,true);assert.equal(day.usable,true);
    assert.equal(day.bands.R.key,'wayline/org_1_1792065762000.tiff');
    assert.ok(day.issues.some(i=>/am Boden/.test(i)));   // relative altitude 0 in the fixture
    assert.equal(day.preview.indices.NDVI.median,0.57);
    assert.equal(day.preview.image.key,'ms-preview/'+UUID+'.png');
    const night=data.captures.find(c=>c.captureUUID===NIGHT);
    assert.equal(night.complete,false);assert.equal(night.gps,null);
    const manifest=await fetch(base+'/c/manifest');
    assert.match(manifest.headers.get('content-disposition'),/m3m-captures-manifest\.json/);
    const m=await manifest.json();
    assert.equal(m.schema,SCHEMA);assert.equal(m.generatedAt,'2026-11-01T00:00:00.000Z');
    assert.equal(m.captures.find(c=>c.captureUUID===UUID).bands.NIR.etag,'"e"');
  }finally{server.close();}
});
