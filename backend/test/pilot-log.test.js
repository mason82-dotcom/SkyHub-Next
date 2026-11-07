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
test('secrets of platformLoadComponent lines (as Pilot 2 logs them) are redacted, also headers and URL parameters',()=>{
  const {redactSecrets,prepareLog}=require('../pilot-log');
  const tok='a'.repeat(64),pw='Xy7_secret-Passwort-24ch';
  const line='[d][20:32:26.789]: start component module thing param : {"connectCallback":"cb","host":"tcp://192.168.178.63:1884","password":"'+pw+'","username":"pilot2"}';
  assert.equal(redactSecrets('GET /ws/tsa?x-auth-token=****').count,0,'DJI-masked values are left alone');
  const r=redactSecrets(line+'\napi param : {"host":"https://h","token":"'+tok+'"}\nAuthorization: Bearer '+tok+'\nGET /x?token='+tok+'&a=1\nX-Auth-Token='+tok);
  assert.equal(r.count,5);assert.ok(!r.text.includes(tok)&&!r.text.includes(pw));
  assert.match(r.text,/"username":"pilot2"/);assert.match(r.text,/"password":"\[geschwärzt\]"/);
  assert.equal(redactSecrets(r.text).count,0,'idempotent: already redacted values are not counted again');
  const p=prepareLog(Buffer.from([encodeLine(line),'kaputt',KEY_PREFIX+'QUJD'].join('\n')));
  const t=p.text.toString();
  assert.ok(!t.includes(pw));assert.equal(p.redacted,1);assert.equal(p.failed,1);
  assert.match(t,/\[Zeile nicht entschlüsselbar\]/);assert.match(t,/\[Schlüsselwechsel/);
});
test('viewer: stored text form is shown as is (redacted again), old encrypted rows are redacted on display',async()=>{
  const express=require('express');
  const items=new Map([['33333333-3333-4333-8333-333333333333',{name:'new.log',format:'text',redacted:1,failed:0,body:Buffer.from('a "password":"[geschwärzt]"\nb')}],
    ['44444444-4444-4444-8444-444444444444',{name:'old.log',body:Buffer.from(encodeLine('{"token":"'+'b'.repeat(64)+'"}'))}]]);
  const store={get:async id=>items.get(id)||null};
  const app=express();app.use('/l',createPilotLogRouter({express,store}));
  const srv=app.listen(0);await new Promise(r=>srv.once('listening',r));
  const base='http://127.0.0.1:'+srv.address().port+'/l/';
  try{
    let b=await (await fetch(base+'33333333-3333-4333-8333-333333333333/text')).json();
    assert.equal(b.total,2);assert.equal(b.redacted,1);
    b=await (await fetch(base+'44444444-4444-4444-8444-444444444444/text')).json();
    assert.equal(b.redacted,1);assert.equal(b.lines[0].t,'{"token":"[geschwärzt]"}');
    const d=await (await fetch(base+'44444444-4444-4444-8444-444444444444/text?download=1')).text();
    assert.ok(!d.includes('bbbb'));
  }finally{srv.close();}
});
test('redaction: Basic/Digest headers, escaped JSON, prefixed keys, JSON Authorization, key=value without ?/&',()=>{
  const {redactSecrets}=require('../pilot-log');
  const cases=[
    ['Authorization: Basic dXNlcjpwYXNz','dXNlcjpwYXNz'],
    ['Authorization: Digest username="u", response="6629fae49393a05397450978507c4ef1"','6629fae4'],
    ['param : "{\\"password\\":\\"hunter2\\"}"','hunter2'],
    ['{"mqttPassword":"mq-secret-1"}','mq-secret-1'],
    ['{"deviceToken":"dev-tok-2"}','dev-tok-2'],
    ['{"Authorization":"Bearer jwt.tok.3"}','jwt.tok.3'],
    ['connect password=abc4 user=pilot','abc4'],
    ['X-Auth-Token: tok5xyz','tok5xyz'],
    ['GET /api/v1?access_token=tok6&x=1','tok6'],
  ];
  for(const [line,secret] of cases){
    const r=redactSecrets(line);
    assert.ok(!r.text.includes(secret),'leaks '+secret+' in '+r.text);assert.ok(r.count>=1,line);
    assert.equal(redactSecrets(r.text).count,0,'idempotent: '+r.text);
  }
  assert.match(redactSecrets('connect password=abc4 user=pilot').text,/user=pilot/,'neighbouring values stay');
});
test('prepareLog: CRLF plain text is normalised, undecodable ciphertext is not labelled as plain text',()=>{
  const {prepareLog}=require('../pilot-log');
  const plain=prepareLog(Buffer.from('a\r\nb\r\n'));
  assert.equal(plain.plain,true);assert.equal(plain.text.toString(),'a\nb\n');
  const other=encodeLine('x','other-password');   // encrypted with a key we do not know
  const enc=prepareLog(Buffer.from([other,other].join('\n')));
  assert.equal(enc.plain,false);assert.equal(enc.failed,2);assert.match(enc.text.toString(),/nicht entschlüsselbar/);
});
test('prepareLogAsync runs in a worker and returns the same result plus gzip',async()=>{
  const {prepareLog,prepareLogAsync}=require('../pilot-log');
  const zlib=require('node:zlib');
  const body=Buffer.from([encodeLine('{"password":"pw-7"}'),encodeLine('ok')].join('\n'));
  const a=prepareLog(body),b=await prepareLogAsync(body);
  assert.equal(b.text.toString(),a.text.toString());assert.equal(b.redacted,1);
  assert.equal(zlib.gunzipSync(Buffer.from(b.gzip)).toString(),a.text.toString());
});
test('store: old rows (encrypted original or older rules) are rewritten once at start',async()=>{
  const zlib=require('node:zlib');
  const {createPilotLogStore,REDACT_VERSION}=require('../pilot-log');
  const rows=new Map([
    ['a',{format:'plog',redacted:0,redact_version:1,body:Buffer.from(encodeLine('{"token":"'+'c'.repeat(40)+'"}'))}],
    ['b',{format:'text',redacted:0,redact_version:1,body:zlib.gzipSync('Authorization: Basic c2VjcmV0')}],
    ['c',{format:'text',redacted:0,redact_version:REDACT_VERSION,body:zlib.gzipSync('fine')}]]);
  const pool={query:async(sql,args=[])=>{
    if(/^SELECT id FROM pilot_logs WHERE format/.test(sql))return {rows:[...rows].filter(([,r])=>r.format!=='text'||r.redact_version<args[0]).map(([id])=>({id}))};
    if(/^SELECT body,format,redacted/.test(sql))return {rows:[rows.get(args[0])]};
    if(/^UPDATE pilot_logs/.test(sql)){Object.assign(rows.get(args[0]),{body:args[1],format:'text',redacted:args[2],redact_version:args[4]});return {rowCount:1};}
    if(/^SELECT id,received_at/.test(sql))return {rows:[]};
    return {rows:[],rowCount:0};}};
  const quiet={log(){},error(){}};
  await createPilotLogStore(pool,{log:quiet}).list();
  for(const [id,r] of rows){assert.equal(r.format,'text',id);assert.equal(r.redact_version,REDACT_VERSION,id);}
  assert.ok(!zlib.gunzipSync(rows.get('a').body).toString().includes('cccc'));
  assert.ok(!zlib.gunzipSync(rows.get('b').body).toString().includes('c2VjcmV0'));
  assert.equal(rows.get('a').redacted,1);assert.equal(rows.get('b').redacted,1);
});
