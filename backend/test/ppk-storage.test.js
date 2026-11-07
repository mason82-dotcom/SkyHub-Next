'use strict';
// PPK from storage: MRK parsing, photo pairing, JPEG header stubs and the flights/ ZIP part.
const test=require('node:test');
const assert=require('node:assert/strict');
const {createPpkStorage,parseMrk,mrkSummary,matchPhotos,jpegHeader}=require('../ppk-storage');

const line=(seq,sow,week,lat,lon,q)=>[seq,sow.toFixed(6),'['+week+']','  -153,N','   -98,E','    71,V',
  lat.toFixed(8)+',Lat',lon.toFixed(8)+',Lon','243.651,Ellh','0.001493, 0.001869, 0.003279',q+',Q'].join('\t');
const MRK=[line(1,56219.73,2364,49.1624903,8.5929059,34),line(2,56221.73,2364,49.16251,8.59291,34),
  line(3,56223.73,2364,49.16253,8.59292,34),
  '4\t-259200.000000\t[-522]\t     0,N\t     0,E\t     0,V\t49.16126739,Lat\t8.59247662,Lon\t200.434,Ellh\t0, 0, 0\t34,Q'].join('\r\n');

test('MRK: aborted last line (negative week) dropped, summary in UTC',()=>{
  const {rows,dropped}=parseMrk(MRK);
  assert.equal(rows.length,3);assert.equal(dropped.length,1);
  const s=mrkSummary(rows);
  assert.equal(s.quality,'RTK float');assert.equal(s.maxSeq,3);assert.equal(s.durationS,4);
  assert.equal(s.startUtc,'2025-04-27T15:36:41.730Z');
  assert.ok(Math.abs(s.position.lat-49.1625)<0.001);
});

test('MRK without satellite position: no position reported',()=>{
  const {rows}=parseMrk(line(1,489500.98,2438,-0.00000033,0.00000066,1));
  assert.equal(mrkSummary(rows).position,null);
});

test('photos: time window of the MRK, exposure number in range, one lens per exposure',()=>{
  const summary={photos:3,durationS:4,maxSeq:3};
  const p=(name,key='wayline/x/'+name)=>({name,key});
  const photos=[p('DJI_20250427173642_0001_V.JPG'),p('DJI_20250427173642_0001_T.JPG'),p('DJI_20250427173644_0002_V.JPG'),
    p('DJI_20250427173646_0004_V.JPG'),   // number beyond the MRK
    p('DJI_20250815163601_0002_V.JPG'),   // other flight, same number
    p('DJI_20250427173646_0003_T.JPG')];  // only thermal available
  const m=matchPhotos('DJI_20250427173642_0002_D.MRK',summary,photos).map(x=>x.name);
  assert.deepEqual(m,['DJI_20250427173642_0001_V.JPG','DJI_20250427173644_0002_V.JPG','DJI_20250427173646_0003_T.JPG']);
});

const jpeg=(...segs)=>Buffer.concat([Buffer.from([0xFF,0xD8]),...segs,Buffer.from([0xFF,0xDA,0,4,1,2]),Buffer.alloc(100,7),Buffer.from([0xFF,0xD9])]);
const seg=(marker,payload)=>{const b=Buffer.alloc(4);b[0]=0xFF;b[1]=marker;b.writeUInt16BE(payload.length+2,2);return Buffer.concat([b,payload]);};

test('JPEG header: segments before SOS + EOI; truncated buffer asks for more',()=>{
  const xmp=seg(0xE1,Buffer.from('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta/>'));
  const full=jpeg(xmp);
  const r=jpegHeader(full);
  assert.deepEqual(r.header,Buffer.concat([Buffer.from([0xFF,0xD8]),xmp,Buffer.from([0xFF,0xD9])]));
  assert.equal(jpegHeader(full.subarray(0,10)).more,true);
  assert.ok(jpegHeader(Buffer.from('nope')).error);
});

function fakeStorage(objects){
  return {
    async objects(bucket,{prefix,limit,cursor}){
      assert.equal(bucket,'dji-cloud');
      const all=Object.keys(objects).filter(k=>k.startsWith(prefix)).sort();
      const start=cursor?Number(cursor):0,page=all.slice(start,start+limit);
      const more=start+limit<all.length;
      return {objects:page.map(key=>({key,size:objects[key].length})),truncated:more,nextCursor:more?String(start+limit):null};
    },
    async getObject(bucket,key,{range}={}){
      let b=objects[key];
      if(range){const m=range.match(/bytes=(\d+)-(\d+)/);b=b.subarray(Number(m[1]),Number(m[2])+1);}
      return {body:{transformToByteArray:async()=>new Uint8Array(b)}};
    }
  };
}

test('storage: lists usable flights, refuses flights without position, packs cleaned MRK + rover + headers',async()=>{
  const photo=jpeg(seg(0xE1,Buffer.from('xmp')));
  const objects={
    'ppk/sd/DJI_202504271730_001_SeeRutsche/DJI_20250427173642_0002_D.MRK':Buffer.from(MRK,'latin1'),
    'ppk/sd/DJI_202504271730_001_SeeRutsche/DJI_20250427173642_0002_D.RTK':Buffer.from('rtcm'),
    'ppk/sd/DJI_202504271730_001_SeeRutsche/DJI_20250427173642_0002_D.OBS':Buffer.from('big'),
    'ppk/sd/DJI_202610021756_005_Hall/DJI_20261002175802_0002_D.MRK':Buffer.from(line(1,489500.98,2438,0,0,1)),
    'ppk/sd/DJI_202610021756_005_Hall/DJI_20261002175802_0002_D.RTK':Buffer.from('rtcm'),
    'wayline/sd/aa/DJI_20250427173642_0001_V.JPG':photo,
    'wayline/sd/bb/DJI_20250427173644_0002_V.JPG':photo,
    'wayline/sd/cc/DJI_20250427173646_0003_V.JPG':photo,
    'wayline/DJI_20261002175802_0001_V.JPG':photo
  };
  const store=createPpkStorage({storage:fakeStorage(objects)});
  const list=await store.list();
  const see=list.find(f=>f.name==='DJI_202504271730_001_SeeRutsche'),hall=list.find(f=>f.name==='DJI_202610021756_005_Hall');
  assert.equal(see.usable,true);assert.equal(see.photos,3);assert.equal(see.droppedMrkLines,1);assert.equal(see.rover,'DJI_20250427173642_0002_D.RTK');
  assert.equal(hall.usable,false);assert.match(hall.issues.join(),/keine Satellitenposition/);
  await assert.rejects(store.resolve([hall.id]),/Satellitenposition/);
  await assert.rejects(store.resolve(['../etc']),/ungültig/);
  await assert.rejects(store.resolve(['0'.repeat(16)]),/nicht gefunden/);
  const added=[];
  const r=await store.pack(await store.resolve([see.id]),{add:(name,data)=>added.push([name,data])});
  assert.equal(r.skipped,0);
  assert.deepEqual(added.map(a=>a[0]),['flights/DJI_202504271730_001_SeeRutsche/DJI_20250427173642_0002_D.MRK',
    'flights/DJI_202504271730_001_SeeRutsche/DJI_20250427173642_0002_D.RTK',
    'flights/DJI_202504271730_001_SeeRutsche/DJI_20250427173642_0001_V.JPG',
    'flights/DJI_202504271730_001_SeeRutsche/DJI_20250427173644_0002_V.JPG',
    'flights/DJI_202504271730_001_SeeRutsche/DJI_20250427173646_0003_V.JPG']);
  assert.equal(added[0][1].toString('latin1').split('\r\n').filter(Boolean).length,3,'aborted MRK line removed');
  assert.ok(added[2][1].length<photo.length,'only the header travels');
});
