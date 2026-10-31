'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const {createMediaRouter}=require('../media-api');

async function withServer(storage,callback){
  const app=express();
  app.use('/api/media',createMediaRouter(storage));
  const server=app.listen(0,'127.0.0.1');
  try{
    await new Promise(resolve=>server.once('listening',resolve));
    const address=server.address();
    await callback(`http://127.0.0.1:${address.port}`);
  }finally{
    await new Promise((resolve,reject)=>
      server.close(err=>err?reject(err):resolve())
    );
  }
}

test('media status reports read-only availability',async()=>{
  await withServer({
    buckets:async()=>['dji-cloud'],
    objects:async()=>({objects:[]})
  },async base=>{
    const response=await fetch(base+'/api/media/status');
    assert.equal(response.status,200);
    const body=await response.json();
    assert.equal(body.readOnly,true);
    assert.equal(body.bucketCount,1);
  });
});

test('invalid object queries return HTTP 400',async()=>{
  await withServer({
    buckets:async()=>[],
    objects:async()=>{throw Object.assign(
      new Error('Invalid bucket'),{status:400}
    );}
  },async base=>{
    for(const query of [
      '?bucket=private',
      '?bucket=dji-cloud&limit=201',
      '?bucket=dji-cloud&limit=0',
      '?bucket=dji-cloud&limit=abc'
    ]){
      const response=await fetch(
        base+'/api/media/objects'+query
      );
      assert.equal(response.status,400);
    }
  });
});

test('S3 failures do not expose internal errors',async()=>{
  await withServer({
    buckets:async()=>{
      throw new Error('Internal storage credential detail');
    }
  },async base=>{
    const response=await fetch(base+'/api/media/buckets');
    assert.equal(response.status,503);
    const body=await response.text();
    assert.ok(!body.includes('credential detail'));
  });
});

test('media router has no write endpoints',async()=>{
  await withServer({
    buckets:async()=>[],
    objects:async()=>({objects:[]})
  },async base=>{
    const response=await fetch(
      base+'/api/media/objects',
      {method:'DELETE'}
    );
    assert.equal(response.status,404);
  });
});

test('M3M HTTP inventory returns aggregate data only',async()=>{
  const capture='DJI_20261021190530_0001';
  const prefix='missions/flight-001/';
  const names=[
    `${capture}_D.JPG`,
    ...['G','R','RE','NIR'].map(
      band=>`${capture}_MS_${band}.TIF`
    )
  ];

  await withServer({
    buckets:async()=>['dji-cloud'],
    objects:async(bucket,options)=>{
      assert.equal(bucket,'dji-cloud');
      assert.equal(options.prefix,prefix);
      return {
        objects:names.map(name=>({
          key:prefix+name
        })),
        truncated:false,
        nextCursor:null
      };
    }
  },async base=>{
    const response=await fetch(
      base+'/api/media/m3m/inventory?prefix='+
      encodeURIComponent(prefix)
    );

    assert.equal(response.status,200);

    const report=await response.json();

    assert.equal(report.fiveChannelSets,1);
    assert.equal(report.spectralSets,1);
    assert.equal(report.ndviReady,false);
    assert.equal(report.ndreReady,false);

    assert.doesNotMatch(
      JSON.stringify(report),
      /missions|flight-001|20261021190530/
    );
  });
});

test('M3M HTTP inventory rejects missing prefix',async()=>{
  await withServer({
    objects:async()=>{
      throw new Error('S3 must not be called');
    }
  },async base=>{
    const response=await fetch(
      base+'/api/media/m3m/inventory'
    );

    assert.equal(response.status,400);
  });
});

test('M3M HTTP inventory sanitizes S3 errors',async()=>{
  await withServer({
    objects:async()=>{
      throw new Error(
        'SECRET_ACCESS_KEY internal MinIO failure'
      );
    }
  },async base=>{
    const response=await fetch(
      base+'/api/media/m3m/inventory?prefix='+
      encodeURIComponent('missions/flight-001/')
    );

    assert.equal(response.status,503);

    const body=await response.text();

    assert.doesNotMatch(
      body,
      /SECRET_ACCESS_KEY|MinIO failure/
    );
  });
});

test('M3M HTTP inventory rejects write requests',async()=>{
  await withServer({
    objects:async()=>({
      objects:[],
      truncated:false
    })
  },async base=>{
    const response=await fetch(
      base+'/api/media/m3m/inventory?prefix='+
      encodeURIComponent('missions/flight-001/'),
      {method:'DELETE'}
    );

    assert.equal(response.status,404);
  });
});

// ---- LAN media viewer: summary, complete index, payload and EXIF thumbnail ----
const {Readable}=require('node:stream');
const {exifThumbnail}=require('../media-preview');

// Minimal JPEG with an EXIF APP1 whose IFD1 points to an embedded JPEG thumbnail.
function jpegWithThumb(){
  const thumb=Buffer.from([0xFF,0xD8,0xFF,0xD9]);
  const tiff=Buffer.alloc(8+2+0+4+2+2*12+4+thumb.length);
  tiff.write('II',0,'latin1');tiff.writeUInt16LE(42,2);tiff.writeUInt32LE(8,4);
  tiff.writeUInt16LE(0,8);tiff.writeUInt32LE(14,10);            // IFD0: no tags, next = IFD1 at 14
  tiff.writeUInt16LE(2,14);
  const thumbOffset=14+2+2*12+4;
  tiff.writeUInt16LE(0x0201,16);tiff.writeUInt16LE(4,18);tiff.writeUInt32LE(1,20);tiff.writeUInt32LE(thumbOffset,24);
  tiff.writeUInt16LE(0x0202,28);tiff.writeUInt16LE(4,30);tiff.writeUInt32LE(1,32);tiff.writeUInt32LE(thumb.length,36);
  tiff.writeUInt32LE(0,40);
  thumb.copy(tiff,thumbOffset);
  const payload=Buffer.concat([Buffer.from('Exif\0\0','latin1'),tiff]);
  const app1=Buffer.alloc(4);app1[0]=0xFF;app1[1]=0xE1;app1.writeUInt16BE(payload.length+2,2);
  return {jpeg:Buffer.concat([Buffer.from([0xFF,0xD8]),app1,payload,Buffer.from([0xFF,0xDA,0,2]),Buffer.alloc(64)]),thumb};
}
function viewerStorage(objects,payloads={}){
  const calls={objects:0,get:[]};
  return {calls,
    buckets:async()=>['dji-cloud','farming'],
    objects:async(bucket,{cursor})=>{
      calls.objects++;
      const all=objects[bucket]||[];
      const start=cursor?Number(cursor):0;
      const page=all.slice(start,start+2);
      const next=start+2<all.length?String(start+2):null;
      return {bucket,prefix:'',objects:page,truncated:Boolean(next),nextCursor:next};
    },
    getObject:async(bucket,key,{range}={})=>{
      calls.get.push({bucket,key,range});
      const body=payloads[key];
      if(!body)throw Object.assign(new Error('Not found'),{status:404});
      return {body:Readable.from([body]),contentLength:body.length,
        contentRange:range?'bytes 0-'+(body.length-1)+'/'+body.length:null,etag:'"e"',lastModified:null};
    }
  };
}

test('EXIF thumbnail parser returns the embedded JPEG and tolerates garbage',()=>{
  const {jpeg,thumb}=jpegWithThumb();
  assert.deepEqual(exifThumbnail(jpeg),thumb);
  assert.equal(exifThumbnail(Buffer.from('not a jpeg')),null);
  assert.equal(exifThumbnail(jpeg.subarray(0,20)),null);
  assert.equal(exifThumbnail(null),null);
});

test('summary and index cover every object across all S3 pages',async()=>{
  const storage=viewerStorage({'dji-cloud':[
    {key:'a/DJI_1.JPG',size:10,lastModified:'2026-10-01T00:00:00.000Z'},
    {key:'a/b.mp4',size:20,lastModified:'2026-10-02T00:00:00.000Z'},
    {key:'c.TIF',size:30,lastModified:null},
    {key:'d.json',size:5,lastModified:null},
    {key:'e.png',size:1,lastModified:null}
  ]});
  await withServer(storage,async base=>{
    const summary=await (await fetch(base+'/api/media/summary')).json();
    const dji=summary.buckets.find(b=>b.bucket==='dji-cloud');
    assert.equal(dji.objects,5);
    assert.equal(dji.bytes,66);
    assert.deepEqual(dji.kinds,{image:2,tiff:1,video:1,other:1});
    const index=await (await fetch(base+'/api/media/index?bucket=dji-cloud')).json();
    assert.equal(index.items.length,5);
    assert.equal(storage.calls.objects,3+1);   // dji-cloud: 3 pages (cached afterwards), farming: 1
    assert.equal((await fetch(base+'/api/media/index?bucket=secret')).status,404);
    assert.equal((await fetch(base+'/api/media/index')).status,400);
  });
});

test('file endpoint streams inline media, downloads others and passes ranges',async()=>{
  const storage=viewerStorage({},{'v/clip.mp4':Buffer.from('video-bytes'),'x/plan.kmz':Buffer.from('zip')});
  await withServer(storage,async base=>{
    const video=await fetch(base+'/api/media/file?bucket=dji-cloud&key=v%2Fclip.mp4',{headers:{Range:'bytes=0-'}});
    assert.equal(video.status,206);
    assert.equal(video.headers.get('content-type'),'video/mp4');
    assert.match(video.headers.get('content-disposition'),/^inline/);
    assert.equal(await video.text(),'video-bytes');
    assert.equal(storage.calls.get[0].range,'bytes=0-');
    const kmz=await fetch(base+'/api/media/file?bucket=dji-cloud&key=x%2Fplan.kmz');
    assert.equal(kmz.status,200);
    assert.match(kmz.headers.get('content-disposition'),/^attachment; filename\*=UTF-8''plan\.kmz/);
    assert.match(kmz.headers.get('content-security-policy'),/sandbox/);
    const forced=await fetch(base+'/api/media/file?bucket=dji-cloud&key=v%2Fclip.mp4&download=1');
    assert.match(forced.headers.get('content-disposition'),/^attachment/);
    assert.equal((await fetch(base+'/api/media/file?bucket=dji-cloud&key=missing.jpg')).status,404);
    assert.equal((await fetch(base+'/api/media/file?bucket=dji-cloud')).status,400);
    assert.equal((await fetch(base+'/api/media/file?bucket=dji-cloud&key=v%2Fclip.mp4',{method:'DELETE'})).status,404);
  });
});

test('thumb endpoint reads only the JPEG head and serves the EXIF preview',async()=>{
  const {jpeg,thumb}=jpegWithThumb();
  const storage=viewerStorage({},{'p/DJI_0001.JPG':jpeg,'p/plain.jpg':Buffer.from([0xFF,0xD8,0xFF,0xD9])});
  await withServer(storage,async base=>{
    const response=await fetch(base+'/api/media/thumb?bucket=dji-cloud&key=p%2FDJI_0001.JPG');
    assert.equal(response.status,200);
    assert.equal(response.headers.get('content-type'),'image/jpeg');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()),thumb);
    assert.equal(storage.calls.get[0].range,'bytes=0-262143');
    await fetch(base+'/api/media/thumb?bucket=dji-cloud&key=p%2FDJI_0001.JPG');
    assert.equal(storage.calls.get.length,1);                 // cached
    assert.equal((await fetch(base+'/api/media/thumb?bucket=dji-cloud&key=p%2Fplain.jpg')).status,404);
    assert.equal((await fetch(base+'/api/media/thumb?bucket=dji-cloud&key=p%2Fa.tif')).status,404);
  });
});
