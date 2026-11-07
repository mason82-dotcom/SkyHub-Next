'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {isLoopbackPeer,allowsCatalogTransport,requireCatalogTransport} =
  require('../m3m-catalog-transport');

function request(address,opts={}) {
  return {socket:{remoteAddress:address,encrypted:Boolean(opts.encrypted)},
    secure:Boolean(opts.secure),headers:opts.headers||{}};
}
test('loopback identification rejects all remote peers and malformed forms',()=>{
  for(const address of ['127.0.0.1','127.25.16.12','::1','::ffff:127.0.0.1'])
    assert.equal(isLoopbackPeer(address),true,address);
  for(const address of ['192.168.178.63','10.0.0.2','172.16.0.1','8.8.8.8',
    '::2','::ffff:192.168.178.63','127.0.0.999','127.0.0.1:4001',null,'localhost',''])
    assert.equal(isLoopbackPeer(address),false,String(address));
});
test('real TLS socket is allowed without reliance on forged proxy headers',()=>{
  assert.equal(allowsCatalogTransport(request('192.168.178.63',{encrypted:true})),true);
});
test('SSH tunnel loopback HTTP is allowed without forwarded headers',()=>{
  assert.equal(allowsCatalogTransport(request('127.0.0.1')),true);
  assert.equal(allowsCatalogTransport(request('::1')),true);
  assert.equal(allowsCatalogTransport(request('::ffff:127.0.0.1')),true);
});
test('direct HTTP from LAN is rejected with or without spoofed headers',()=>{
  for(const headers of [{},{'x-forwarded-proto':'https'},
    {'x-forwarded-proto':'http'},{'x-forwarded-proto':'https','x-forwarded-for':'127.0.0.1'}]){
    assert.equal(allowsCatalogTransport(request('192.168.178.63',
      {secure:true,headers})),false,JSON.stringify(headers));
  }
});
test('loopback proxy requires trusted HTTPS forwarding, never plaintext',()=>{
  assert.equal(allowsCatalogTransport(request('127.0.0.1',{
    secure:true,headers:{'x-forwarded-proto':'https','x-forwarded-for':'203.0.113.5'}})),true);
  assert.equal(allowsCatalogTransport(request('127.0.0.1',{
    secure:false,headers:{'x-forwarded-proto':'https'}})),false);
  assert.equal(allowsCatalogTransport(request('127.0.0.1',{
    secure:true,headers:{'x-forwarded-proto':'http'}})),false);
});
test('malformed, ambiguous or incomplete proxy forwarding is rejected',()=>{
  for(const headers of [
    {'x-forwarded-for':'203.0.113.2'},
    {forwarded:'for=203.0.113.2;proto=https'},
    {'x-forwarded-proto':'https,http'},
    {'x-forwarded-proto':['https','http']},
    {'x-forwarded-proto':'HTTPS'},
    {'x-forwarded-proto':'https '},
    {'x-forwarded-proto':'http','x-forwarded-for':'127.0.0.1'}
  ])assert.equal(allowsCatalogTransport(request('::1',{secure:true,headers})),false,
    JSON.stringify(headers));
});
test('missing network identity is denied instead of guessed',()=>{
  for(const req of [null,{},request(undefined),request('')])
    assert.equal(allowsCatalogTransport(req),false);
});
test('transport middleware returns generic 403 with no private paths or tokens',()=>{
  let nextCalls=0;
  const next=()=>{nextCalls++};
  const response={
    code:200,headers:{},payload:null,
    set(k,v){this.headers[k]=v;return this},
    status(code){this.code=code;return this},
    json(payload){this.payload=payload;return this}
  };
  requireCatalogTransport(request('10.0.0.4',{secure:true,
    headers:{'x-forwarded-proto':'https'}}),response,next);
  assert.equal(response.code,403);
  assert.equal(response.headers['Cache-Control'],'no-store');
  assert.equal(nextCalls,0);
  assert.deepEqual(Object.keys(response.payload),['error']);
  assert.equal(JSON.stringify(response.payload).includes('10.0.0.4'),false);
  requireCatalogTransport(request('127.0.0.1'),response,next);
  assert.equal(nextCalls,1);
});
