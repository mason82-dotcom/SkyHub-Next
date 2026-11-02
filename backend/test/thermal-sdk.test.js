'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const http=require('node:http');
const {createHash}=require('node:crypto');
const {Readable}=require('node:stream');
const {createThermalSdkClient,sdkParameters,RANGES}=require('../thermal-sdk');
const {createThermalRouter}=require('../thermal');

const TOKEN='s'.repeat(40);
const K=t=>Math.round((t+273.15)*64);
function segment(marker,data){
  const head=Buffer.alloc(4);head[0]=0xFF;head[1]=marker;head.writeUInt16BE(data.length+2,2);
  return Buffer.concat([head,data]);
}
function rjpeg(fill=20){
  const raw=Buffer.alloc(640*512*2);
  for(let i=0;i<640*512;i++)raw.writeUInt16LE(K(fill),i*2);
  const parts=[Buffer.from([0xFF,0xD8]),segment(0xE1,Buffer.from('<x:xmpmeta><rdf:Description drone-dji:ImageSource="InfraredCamera"/></x:xmpmeta>','latin1'))];
  for(let off=0;off<raw.length;off+=65000)parts.push(segment(0xE3,raw.subarray(off,off+65000)));
  const app4=Buffer.alloc(64);app4.write('\xff\xd2\xd1\xffiirp',0,'latin1');app4.writeFloatLE(0.95,40);
  parts.push(segment(0xE4,app4),Buffer.from([0xFF,0xDA,0,2,0xFF,0xD9]));
  return Buffer.concat(parts);
}
// Fake thermal-sdk service: answers like sdk_server.py.
async function fakeSdk(handler){
  const calls=[];
  const server=http.createServer((req,res)=>{
    const chunks=[];req.on('data',c=>chunks.push(c));
    req.on('end',()=>{calls.push({method:req.method,url:req.url,auth:req.headers.authorization,body:Buffer.concat(chunks)});
      handler(req,res,Buffer.concat(chunks));});
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  return {server,calls,url:'http://127.0.0.1:'+server.address().port};
}
function okHandler(req,res){
  if(req.url==='/health'){res.end(JSON.stringify({status:'ok'}));return;}
  const p=new URL(req.url,'http://x').searchParams;
  const t=Number(p.get('emissivity'))*10+Number(p.get('distance'));
  const body=Buffer.alloc(640*512*4);for(let i=0;i<640*512;i++)body.writeFloatLE(t,i*4);
  res.writeHead(200,{'X-Thermal-Width':'640','X-Thermal-Height':'512'});res.end(body);
}

test('SDK parameters follow the dji_irp ranges and reject instead of clamping',()=>{
  assert.deepEqual(sdkParameters({}),{emissivity:0.95,distance:5,humidity:70,ambient:25,reflection:23});
  assert.equal(sdkParameters({distance:'12.5'}).distance,12.5);
  for(const bad of [{distance:'0.5'},{distance:'26'},{emissivity:'0'},{humidity:'1e2'},{ambient:'x'},{reflection:'600'}])
    assert.throws(()=>sdkParameters(bad),e=>e.status===400,JSON.stringify(bad));
  assert.deepEqual(RANGES.reflection,[-40,500,23]);
});

test('client requires an internal URL and token, validates SDK output',async()=>{
  assert.throws(()=>createThermalSdkClient({url:'https://x',token:TOKEN}),/http/);
  assert.throws(()=>createThermalSdkClient({url:'http://u:p@x',token:TOKEN}),/credentials/);
  assert.throws(()=>createThermalSdkClient({url:'http://x',token:'short'}),/token/);
  const ok=await fakeSdk(okHandler);
  try{
    const client=createThermalSdkClient({url:ok.url,token:TOKEN});
    assert.equal(await client.available(),true);
    const out=await client.measure(Buffer.from([0xFF,0xD8,1,2]),{emissivity:'0.9',distance:'10'});
    assert.equal(out.width,640);
    assert.ok(Math.abs(out.temps[0]-19)<1e-4);
    assert.equal(ok.calls.at(-1).auth,'Bearer '+TOKEN);
    assert.match(ok.calls.at(-1).url,/emissivity=0\.9&distance=10&humidity=70&ambient=25&reflection=23/);
  }finally{ok.server.close();}
  const bad=await fakeSdk((req,res)=>{res.writeHead(200,{'X-Thermal-Width':'640','X-Thermal-Height':'512'});res.end(Buffer.alloc(8));});
  try{
    const client=createThermalSdkClient({url:bad.url,token:TOKEN});
    assert.equal(await client.available(),false);
    await assert.rejects(client.measure(Buffer.from([0xFF,0xD8,1,2]),{}),e=>e.status===502);
  }finally{bad.server.close();}
  const unsupported=await fakeSdk((req,res)=>{res.writeHead(422);res.end('{}');});
  try{
    await assert.rejects(createThermalSdkClient({url:unsupported.url,token:TOKEN}).measure(Buffer.from([0xFF,0xD8,1,2]),{}),
      e=>e.status===422);
  }finally{unsupported.server.close();}
});

test('/api/thermal/measure serves SDK temperatures for exactly the displayed version',async()=>{
  const objects={'a/T.JPG':rjpeg(20)};
  const storage={getObject:async(_b,key)=>{
    const body=objects[key];if(!body)throw Object.assign(new Error('nf'),{status:404});
    return {body:Readable.from([body]),contentLength:body.length};}};
  const sdk=await fakeSdk(okHandler);
  const app=express();
  app.use('/api/thermal',createThermalRouter({storage,bucketIndex:async()=>({objects:[]}),buckets:async()=>['dji-cloud'],
    sdk:createThermalSdkClient({url:sdk.url,token:TOKEN})}));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const base='http://127.0.0.1:'+server.address().port+'/api/thermal';
  const q='bucket=dji-cloud&key=a%2FT.JPG';
  try{
    const meta=await (await fetch(base+'/meta?'+q)).json();
    assert.equal(meta.sdk.available,true);
    assert.equal(meta.sdk.calibration,'dji-tsdk');
    const version=createHash('sha256').update(objects['a/T.JPG']).digest('hex');
    assert.equal(meta.version,version);
    let r=await fetch(base+'/measure?'+q+'&version='+version+'&emissivity=0.8&distance=3');
    assert.equal(r.status,200);
    assert.equal(r.headers.get('x-thermal-calibration'),'dji-tsdk');
    assert.equal(JSON.parse(r.headers.get('x-thermal-parameters')).emissivity,0.8);
    const body=Buffer.from(await r.arrayBuffer());
    assert.equal(body.length,640*512*4);
    assert.ok(Math.abs(body.readFloatLE(0)-11)<1e-4);
    // Cached: same version + parameters does not call the SDK again.
    const before=sdk.calls.filter(c=>c.method==='POST').length;
    await (await fetch(base+'/measure?'+q+'&version='+version+'&emissivity=0.8&distance=3')).arrayBuffer();
    assert.equal(sdk.calls.filter(c=>c.method==='POST').length,before);
    // The JPEG bytes reach the SDK unchanged.
    assert.ok(sdk.calls.find(c=>c.method==='POST').body.equals(objects['a/T.JPG']));
    for(const bad of ['&version=abc','&version='+version+'&distance=99','&version='+version+'&foo=1'])
      assert.equal((await fetch(base+'/measure?'+q+bad)).status,400,bad);
    // Source changed after the user loaded it: never measured under the old version.
    objects['a/T.JPG']=rjpeg(30);
    assert.equal((await fetch(base+'/measure?'+q+'&version='+version+'&distance=4')).status,409);
  }finally{server.close();sdk.server.close();}
});

test('without an SDK service the route is absent and meta says unavailable',async()=>{
  const objects={'a/T.JPG':rjpeg(20)};
  const storage={getObject:async(_b,key)=>({body:Readable.from([objects[key]]),contentLength:objects[key].length})};
  const app=express();
  app.use('/api/thermal',createThermalRouter({storage,bucketIndex:async()=>({objects:[]}),buckets:async()=>[]}));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const base='http://127.0.0.1:'+server.address().port+'/api/thermal';
  try{
    const meta=await (await fetch(base+'/meta?bucket=b&key=a%2FT.JPG')).json();
    assert.deepEqual(meta.sdk,{available:false});
    assert.equal((await fetch(base+'/measure?bucket=b&key=a%2FT.JPG&version='+meta.version)).status,404);
  }finally{server.close();}
});
