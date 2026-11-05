'use strict';
// Pilot 2 log decoder (re-implementation of DJI PlogDecoder.jar V1.1) and the viewer API.
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {decodePlog,encodeLine,KEY_PREFIX,createPilotLogRouter}=require('../pilot-log');

test('known vector: default password, fixed salt/IV (constants of the jar)',()=>{
  const key=crypto.pbkdf2Sync('DJILog@PLogEncryption',Buffer.from('2b6c8ee4bc1a4ac48ffec65548759c8a','hex'),1000,16,'sha1');
  const c=crypto.createCipheriv('aes-128-cbc',key,Buffer.from('2d8913091b2c491a93253e461d61f3ee','hex'));
  const line=Buffer.concat([c.update('I/CloudApi: MQTT connected'),c.final()]).toString('base64');
  assert.equal(line,encodeLine('I/CloudApi: MQTT connected'));
  assert.equal(decodePlog(line+'\n').lines[0].text,'I/CloudApi: MQTT connected');
});
test('lines in order, UTF-8, empty key line resets to the default key, broken lines counted',()=>{
  const text=[encodeLine('a äöü'),'',encodeLine('b'),KEY_PREFIX,encodeLine('c'),'not-base64-cipher'].join('\r\n');
  const r=decodePlog(text);
  assert.deepEqual(r.lines.filter(l=>l.text!==null).map(l=>l.text),['a äöü','b','c']);
  assert.equal(r.failed,1);
});
test('RSA key change: with the private key the new password is used, without it later lines fail',()=>{
  const {publicKey,privateKey}=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
  // Node refuses RSA PKCS#1 v1.5 private decryption by default (CVE-2023-46809); OAEP is not what DJI uses.
  let pkcs1=true;
  try{crypto.privateDecrypt({key:privateKey,padding:crypto.constants.RSA_PKCS1_PADDING},crypto.publicEncrypt({key:publicKey,padding:crypto.constants.RSA_PKCS1_PADDING},Buffer.from('x')));}
  catch{pkcs1=false;}
  const wrapped=crypto.publicEncrypt({key:publicKey,padding:crypto.constants.RSA_PKCS1_PADDING},Buffer.from('secret-pass')).toString('base64');
  const text=[encodeLine('before'),KEY_PREFIX+wrapped,encodeLine('after','secret-pass')].join('\n');
  const without=decodePlog(text);
  assert.deepEqual(without.lines.map(l=>l.text),['before',null,null]);
  if(pkcs1)assert.deepEqual(decodePlog(text,{privateKey}).lines.filter(l=>l.text).map(l=>l.text),['before','after']);
});
test('viewer: filter, paging, plain text fallback, download',async()=>{
  const express=require('express');
  const items=new Map([['11111111-1111-4111-8111-111111111111',{name:'log-1.log',body:Buffer.from([encodeLine('E/Wayline: 310013'),encodeLine('I/Map: ok')].join('\n'))}],
    ['22222222-2222-4222-8222-222222222222',{name:'plain.txt',body:Buffer.from('plain line 1\nplain line 2')}]]);
  const store={list:async()=>[...items.keys()].map(id=>({id,name:items.get(id).name})),get:async id=>items.get(id)||null,remove:async id=>items.delete(id)?1:0};
  const app=express();app.use('/l',createPilotLogRouter({express,store}));
  const srv=app.listen(0);await new Promise(r=>srv.once('listening',r));
  const base='http://127.0.0.1:'+srv.address().port+'/l/';
  try{
    let b=await (await fetch(base+'11111111-1111-4111-8111-111111111111/text?q=wayline')).json();
    assert.equal(b.total,2);assert.equal(b.matches,1);assert.deepEqual(b.lines,[{n:1,t:'E/Wayline: 310013'}]);
    b=await (await fetch(base+'22222222-2222-4222-8222-222222222222/text')).json();
    assert.equal(b.plain,true);assert.equal(b.lines[1].t,'plain line 2');
    const d=await fetch(base+'11111111-1111-4111-8111-111111111111/text?download=1');
    assert.match(d.headers.get('content-disposition'),/log-1\.log\.txt/);assert.equal(await d.text(),'E/Wayline: 310013\nI/Map: ok');
    assert.equal((await fetch(base+'nope/text')).status,400);
  }finally{srv.close();}
});
