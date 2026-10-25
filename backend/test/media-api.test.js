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
