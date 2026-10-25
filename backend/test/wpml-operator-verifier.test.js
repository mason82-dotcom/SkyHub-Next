'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const {createWpmlOperatorVerifier,AUDIENCE}=require('../wpml-operator-verifier');
const {createWpmlRouteService}=require('../wpml-central-routes');
const ISSUER='https://idp.skyhub.example';
const WORKSPACE='e3dea0f5-37f2-4d79-ae58-490af3228069';
const OTHER='203cc94c-aef1-4e0e-a520-05a24be33a31';
const HUMAN='69ecb38c-04f2-44d0-adc6-3441cb4f9449';
const JTI='4d8779ac-4573-444d-ab9c-23ac0814f8b1';
const NOW=1800000000;
const {privateKey,publicKey}=crypto.generateKeyPairSync('ed25519');
const base=()=>({iss:ISSUER,aud:AUDIENCE,sub:HUMAN,workspaceId:WORKSPACE,
  role:'operator',kind:'human',iat:NOW-100,nbf:NOW-100,exp:NOW+300,jti:JTI});
function token(payload=base(),header={alg:'EdDSA',typ:'JWT',kid:'keyA'}){
  const h=Buffer.from(JSON.stringify(header)).toString('base64url');
  const p=Buffer.from(JSON.stringify(payload)).toString('base64url');
  const input=h+'.'+p;
  return input+'.'+crypto.sign(null,Buffer.from(input,'ascii'),privateKey)
    .toString('base64url');
}
function verifier(isActiveSession=async()=>true){
  return createWpmlOperatorVerifier({issuer:ISSUER,publicKeys:{keyA:publicKey},
    isActiveSession,clock:()=>NOW*1000});
}
test('verifier fails to initialize without pinned Ed25519 public keys and session backend',()=>{
  assert.throws(()=>createWpmlOperatorVerifier({}),/Pinned HTTPS/);
  assert.throws(()=>createWpmlOperatorVerifier({issuer:'http://idp.local',
    publicKeys:{keyA:publicKey},isActiveSession:async()=>true}),/Pinned HTTPS/);
  assert.throws(()=>createWpmlOperatorVerifier({issuer:ISSUER,
    publicKeys:{keyA:privateKey},isActiveSession:async()=>true}),/Ed25519/);
  assert.throws(()=>createWpmlOperatorVerifier({issuer:ISSUER,
    publicKeys:{keyA:crypto.generateKeyPairSync('rsa',{modulusLength:2048}).publicKey},
    isActiveSession:async()=>true}),/Ed25519/);
  assert.throws(()=>createWpmlOperatorVerifier({issuer:ISSUER,
    publicKeys:{keyA:publicKey}}),/session lookup/);
});
test('signed role and workspace are supplied only after active server session check',async()=>{
  let calls=0;
  const verify=verifier(async claim=>{
    calls++;
    assert.deepEqual(Object.keys(claim),['issuer','subject','workspaceId','role',
      'sessionId','expiresAt','keyId']);
    assert.equal(claim.subject,HUMAN);
    assert.equal(claim.workspaceId,WORKSPACE);
    assert.equal(claim.sessionId,JTI);
    return true;
  });
  assert.deepEqual(await verify(token()),{
    id:HUMAN,workspaceId:WORKSPACE,role:'operator',
    kind:'human',source:'independent-operator-auth'});
  assert.equal(calls,1);
  assert.equal(Object.isFrozen(await verify(token())),true);
  assert.deepEqual(await verify(token({...base(),role:'admin'})),{
    id:HUMAN,workspaceId:WORKSPACE,role:'admin',
    kind:'human',source:'independent-operator-auth'});
});
test('rejects algorithm confusion, untrusted key locators, unsigned and manipulated tokens',async()=>{
  const verify=verifier();
  for(const invalid of [
    '',null,'invalid', 'a.b', 'a.b.c.d',
    token(base(),{alg:'none',typ:'JWT',kid:'keyA'}),
    token(base(),{alg:'HS256',typ:'JWT',kid:'keyA'}),
    token(base(),{alg:'EdDSA',typ:'JWT',kid:'untrusted'}),
    token(base(),{alg:'EdDSA',typ:'JWT',kid:'keyA',jku:'https://attacker'}),
    token(base(),{alg:'EdDSA',kid:'keyA'}),
    token(base(),{alg:'EdDSA',typ:'JWT',kid:'keyA',crit:['x']}),
    token().slice(0,-2)+'xx',
    token().replace(/^[^.]+/,Buffer.from(JSON.stringify({alg:'none',typ:'JWT',
      kid:'keyA'})).toString('base64url')),
    token().replace(/^([^.]+)\.[^.]+/,(_,h)=>h+'.'+Buffer.from(JSON.stringify(
      {...base(),role:'admin'})).toString('base64url')),
    'x'.repeat(4097),
    token(base()).replace(/\.[^.]+$/,'.='),
  ])assert.equal(await verify(invalid),null);
});
test('rejects stale, expired, mismatched, non-human and ambiguous signed claims',async()=>{
  let calls=0;
  const verify=verifier(async()=>{calls++;return true;});
  for(const claims of [
    {aud:'skyhub-view'}, {iss:'https://evil.example'},
    {role:'pilot'},{role:'viewer'},{kind:'pilot'},
    {sub:'pilot-serial'},{workspaceId:'not-uuid'},{jti:'not-uuid'},
    {iat:NOW+1}, {nbf:NOW+1}, {nbf:NOW-110},
    {exp:NOW},{exp:NOW-1},{exp:NOW+1000},
    {iat:'not-numeric'},{exp:NaN},{extraAuthority:true}
  ])assert.equal(await verify(token({...base(),...claims})),null,
    JSON.stringify(claims));
  // Sign the duplicate key itself: even authentic signatures never resolve
  // ambiguous role claims by silently selecting the last JSON occurrence.
  const h=Buffer.from(JSON.stringify({alg:'EdDSA',typ:'JWT',kid:'keyA'}))
    .toString('base64url');
  const body=JSON.stringify(base()).replace('"role":"operator"',
    '"role":"operator","role":"admin"');
  const p=Buffer.from(body).toString('base64url'),input=h+'.'+p;
  const signed=input+'.'+crypto.sign(null,Buffer.from(input),privateKey)
    .toString('base64url');
  assert.equal(await verify(signed),null);
  assert.equal(calls,0);
});
test('slow independent session approval cannot resurrect an expired signed JWT',async()=>{
  let now=NOW;
  let approve;
  const gate=new Promise(resolve=>{approve=resolve;});
  const verify=createWpmlOperatorVerifier({
    issuer:ISSUER,publicKeys:{keyA:publicKey},
    isActiveSession:()=>gate,clock:()=>now*1000
  });
  const pending=verify(token());
  now=NOW+301; // expires while the remote revocation lookup is pending
  approve(true);
  assert.equal(await pending,null);
  const instant=createWpmlOperatorVerifier({
    issuer:ISSUER,publicKeys:{keyA:publicKey},
    isActiveSession:async()=>{now=NOW+301;return true;},
    clock:()=>now*1000
  });
  now=NOW;
  assert.equal(await instant(token()),null);
});
test('revoked sessions, session outage and unknown-session results fail closed',async()=>{
  for(const session of [async()=>false,async()=>null,async()=>({active:true}),
    async()=>{throw Error('private session-store failure');}]){
    assert.equal(await verifier(session)(token()),null);
  }
});
test('independently verified token can read only its own workspace through isolated route service',async()=>{
  const dbCalls=[];
  const pool={connect:async()=>({query:async(sql,params=[])=>{
    dbCalls.push({sql,params});
    if(sql.includes('SELECT route_id,route_name'))return {rows:[],rowCount:0};
    return {rows:[],rowCount:0};
  },release(){}})};
  const session=verifier();
  const service=createWpmlRouteService({pool,authorize:session});
  assert.deepEqual(await service.listRoutes({
    credential:token(),workspaceId:WORKSPACE}),[]);
  assert.ok(dbCalls.some(x=>x.sql.includes('SELECT route_id,route_name')));
  const count=dbCalls.length;
  await assert.rejects(service.listRoutes({credential:token(),workspaceId:OTHER}),
    {code:'unauthorized'});
  assert.equal(dbCalls.length,count);
});
test('verifier is not wired to production server or network transports',()=>{
  const source=fs.readFileSync(path.resolve(__dirname,'../wpml-operator-verifier.js'),
    'utf8');
  const server=fs.readFileSync(path.resolve(__dirname,'../server.js'),'utf8');
  assert.doesNotMatch(server,/wpml-operator-verifier|wpml-central-routes/);
  assert.doesNotMatch(source,/fetch\s*\(|https\.get|axios|mqtt|SKYHUB_VIEW_TOKEN/);
  assert.match(source,/isActiveSession/);
});
