'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createHttpAuth}=require('../http-auth');
const {createLanAccess}=require('../lan-access');
const {parseTrustedProxyIps}=require('../proxy-trust');
const {parseWpmlLanOrigins}=require('../wpml-lan-auth');
const SECRET='s'.repeat(32),ORIGIN='https://rpi5.fritz.box:4443';
const UUID='aaaaaaaa-aaaa-8aaa-8aaa-aaaaaaaaaaaa';
function auth(enabled=true){
  return createHttpAuth({secret:SECRET,
    lanAccess:createLanAccess('192.168.178.0/24',parseTrustedProxyIps('172.25.0.1')),
    wpmlLanAuth:{enabled,origins:ORIGIN+',https://192.168.178.63:4443'}
  }).auth;
}
function request(authFn,change={}){
  const req={method:'POST',path:'/wpml/missions',secure:true,
    socket:{remoteAddress:'172.25.0.1'},
    headers:{host:'rpi5.fritz.box:4443','x-forwarded-for':'192.168.178.70',
      origin:ORIGIN,'sec-fetch-site':'same-origin'}};
  Object.assign(req,change);
  req.headers={host:'rpi5.fritz.box:4443','x-forwarded-for':'192.168.178.70',
    origin:ORIGIN,'sec-fetch-site':'same-origin',...(change.headers||{})};
  let granted=false,status=0;
  const res={status(code){status=code;return this;},json(){return this;}};
  authFn(req,res,()=>{granted=true;});
  return {granted,status};
}
test('configuration fails closed and tokenless access defaults OFF',()=>{
  assert.deepEqual(request(auth(false)),{granted:false,status:401});
  assert.throws(()=>parseWpmlLanOrigins('http://rpi5.fritz.box:4443'),/HTTPS/);
  assert.throws(()=>parseWpmlLanOrigins('https://rpi5.fritz.box'),/host:port/);
  assert.throws(()=>parseWpmlLanOrigins('https://rpi5.fritz.box:4443/pilot'),/host:port/);
  assert.throws(()=>createHttpAuth({secret:SECRET,lanAccess:createLanAccess(''),
    wpmlLanAuth:{enabled:true,origins:ORIGIN}}),/CIDR/);
});
test('tokenfree POST requires allowed HTTPS origin and verified LAN client',()=>{
  const handler=auth();
  assert.deepEqual(request(handler),{granted:true,status:0});
  for(const change of [
    {secure:false},{path:'/wpml/missions/'+UUID},{path:'/pilot-admin/pairings'},
    {method:'DELETE'},{method:'PUT'},
    {headers:{origin:'https://bad.example:4443'}},{headers:{origin:undefined}},
    {headers:{'sec-fetch-site':'cross-site'}},
    {headers:{host:'rpi5.fritz.box'}},{headers:{host:'evil.internal:4443'}},
    {headers:{'x-forwarded-for':'100.64.0.7'}},
    {headers:{'x-forwarded-for':'203.0.113.7'}},
    {headers:{'x-forwarded-for':'192.168.179.70'}},
    {socket:{remoteAddress:'172.25.0.2'}},
    {headers:{authorization:'Bearer bad'}}
  ])assert.deepEqual(request(handler,change),{granted:false,status:401},JSON.stringify(change));
});
test('tokenfree GET only accesses exact mission-store paths',()=>{
  const handler=auth();
  // Existing read-only LAN exemptions (e.g. drone telemetry) remain intact.
  assert.deepEqual(request(handler,{method:'GET',path:'/drone/a/telemetry'}),{granted:true,status:0});
  for(const path of ['/wpml/missions','/wpml/missions/','/wpml/missions/status',
    '/wpml/missions/'+UUID,'/wpml/missions/'+UUID+'/kmz','/wpml/release','/wpml/release/config','/wpml/release/'+UUID])
    assert.deepEqual(request(handler,{method:'GET',path}),{granted:true,status:0},path);
  // Decision 04.11.2026: release/revoke and live-control commands work token-free from the home LAN, but only with the
  // browser same-origin proof; without it (or cross-site, wrong host, outside the LAN) they stay closed.
  for(const [method,path] of [['POST','/wpml/release/'+UUID+'/release'],['DELETE','/wpml/release/'+UUID+'/release'],
    ['POST','/drc/auth/request'],['POST','/drc/payload/zoom'],['POST','/drc/payload/photo_take'],['POST','/drc/payload/ir_metering_mode'],
    ['POST','/drc/payload/look-at'],['POST','/drc/emergency-stop'],['POST','/drc/return-home/cancel'],['GET','/drc/status']]){
    assert.deepEqual(request(handler,{method,path}),{granted:true,status:0},method+' '+path);
    if(method!=='GET'){
      assert.deepEqual(request(handler,{method,path,headers:{origin:undefined}}),{granted:false,status:401},'no origin '+path);
      assert.deepEqual(request(handler,{method,path,headers:{'sec-fetch-site':'cross-site'}}),{granted:false,status:401},'cross-site '+path);
      assert.deepEqual(request(handler,{method,path,headers:{'x-forwarded-for':'100.64.0.7'}}),{granted:false,status:401},'tailscale '+path);
    }
  }
  for(const [method,path] of [['PUT','/wpml/release/'+UUID+'/release'],['DELETE','/wpml/missions'],['POST','/drc/../pilot-admin'],
    ['POST','/pilot-admin/pairings'],['POST','/wpml/release/'+UUID],['DELETE','/drc/release'],['POST','/drc/config/reset'],
    ['POST','/drc/payload/Photo'],['POST','/drc/payload/a/b']])
    assert.deepEqual(request(handler,{method,path}),{granted:false,status:401},method+' '+path);
  for(const path of ['/drone/a/not-allowed','/wpml/missions/a/../b',
    '/wpml/missions/x/extra','/wpml/missions/status/more','/pilot-admin/pairings','/wpml/release/x','/wpml/release/'+UUID+'/release'])
    assert.deepEqual(request(handler,{method:'GET',path}),{granted:false,status:401},path);
});
test('FlightHub route import (ADR-002): list token-free, take-over only with the browser same-origin proof',()=>{
  const handler=auth();
  assert.deepEqual(request(handler,{method:'GET',path:'/wpml/missions/flighthub'}),{granted:true,status:0});
  const path='/wpml/missions/import/flighthub';
  assert.deepEqual(request(handler,{path}),{granted:true,status:0});
  assert.deepEqual(request(handler,{path,headers:{origin:undefined}}),{granted:false,status:401});
  assert.deepEqual(request(handler,{path,headers:{'sec-fetch-site':'cross-site'}}),{granted:false,status:401});
  assert.deepEqual(request(handler,{path,headers:{'x-forwarded-for':'100.64.0.7'}}),{granted:false,status:401});
  for(const [method,p] of [['GET','/wpml/missions/import/flighthub'],['POST','/wpml/missions/flighthub'],
    ['POST','/wpml/missions/import/flighthub/x'],['DELETE','/wpml/missions/import/flighthub']])
    assert.deepEqual(request(handler,{method,path:p}),{granted:false,status:401},method+' '+p);
});
test('explicit valid token is accepted irrespective of the LAN no-token flag',()=>{
  assert.deepEqual(request(auth(false),{secure:false,headers:{authorization:'Bearer '+SECRET}}),
    {granted:true,status:0});
});
test('browser client sends same-origin upload without Authorization for empty token',async()=>{
  const client=require('../../frontend/public/wpml-mission-store-client.js');
  const orig=global.fetch,seen=[];
  global.fetch=async(url,opt)=>{
    seen.push({url,opt});
    return {ok:true,async json(){return {list:[],pagination:{}};}};
  };
  try{
    await client.status('');
    await client.list('');
    await client.upload('',new Uint8Array([1,2,3]),'Test');
    for(const {opt} of seen)assert.equal(opt.headers.Authorization,undefined);
    assert.equal(seen[2].opt.headers['Content-Type'],'application/vnd.google-earth.kmz');
    assert.equal(seen[2].opt.method,'POST');
    assert.equal(seen[2].opt.credentials,'same-origin');
  }finally{global.fetch=orig;}
});
