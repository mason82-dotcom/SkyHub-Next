'use strict';
// PPK geotagging relay: configuration and parameter validation (the service checks again).
const test=require('node:test');
const assert=require('node:assert/strict');
const {ppkConfig,validParams}=require('../ppk');

test('config: off by default, internal http URL and a 32+ character token required',()=>{
  assert.equal(ppkConfig({}).enabled,false);
  assert.match(ppkConfig({SKYHUB_PPK_URL:'https://ppk:8090',SKYHUB_PPK_TOKEN:'x'.repeat(40)}).issue,/http/);
  assert.match(ppkConfig({SKYHUB_PPK_URL:'http://ppk:8090',SKYHUB_PPK_TOKEN:'short'}).issue,/TOKEN/);
  assert.equal(ppkConfig({SKYHUB_PPK_URL:'http://ppk:8090',SKYHUB_PPK_TOKEN:'x'.repeat(40)}).enabled,true);
});

test('parameters: header or manual base, ranges checked, unknown fields dropped',()=>{
  assert.deepEqual(JSON.parse(validParams(JSON.stringify({base:{mode:'header',sigma_e:'0.01',sigma_n:0.01,sigma_u:0.02,frame:'ETRS89 (SAPOS)',evil:'x'}}))),
    {base:{mode:'header',sigma_e:0.01,sigma_n:0.01,sigma_u:0.02,frame:'ETRS89 (SAPOS)'}});
  assert.ok(validParams(JSON.stringify({base:{mode:'manual',lat:49.0,lon:8.4,height:160.2}})));
  assert.equal(validParams(JSON.stringify({base:{mode:'manual',lat:49.0,lon:8.4}})),null,'height required');
  assert.equal(validParams(JSON.stringify({base:{mode:'header',sigma_u:5}})),null);
  assert.equal(validParams(JSON.stringify({base:{mode:'online',email:'a@b.c'}})),null,'no CSRS-PPP');
  assert.equal(validParams('nope'),null);
  assert.equal(JSON.parse(validParams(JSON.stringify({base:{mode:'header',frame:'<script>'}}))).base.frame,undefined);
});
