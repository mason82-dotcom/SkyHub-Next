'use strict';
// ADR-001 step 3: issuer against a local test OIDC provider, verified end-to-end by the EXISTING
// wpml-operator-verifier.js + wpml-operator-session-redis.js (no network, no real Forgejo).
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {createWpmlOperatorIssuer,IssuerError,uuidV5}=require('../wpml-operator-issuer');
const {createWpmlOperatorVerifier}=require('../wpml-operator-verifier');
const {createWpmlRedisSessionCheck}=require('../wpml-operator-session-redis');

const PROVIDER='https://forgejo.test/';
const OPERATOR_ISSUER='https://skyhub.test/wpml-operator';
const WS='e3dea0f5-37f2-4d79-ae58-490af3228069';
const KEY_SECRET='k'.repeat(40),MAC_SECRET='m'.repeat(40);
const rsa=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
const ed=crypto.generateKeyPairSync('ed25519');

function provider({groups=['skyhub','skyhub:ws-farm-operator'],claims={},alg='RS256',key=rsa.privateKey,discoveryOverride}={}){
  const seen={token:[]};
  const sign=(payload,header={alg,kid:'idp-1',typ:'JWT'})=>{
    const h=Buffer.from(JSON.stringify(header)).toString('base64url');
    const p=Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig=alg==='none'?Buffer.alloc(0):crypto.sign('sha256',Buffer.from(h+'.'+p),key);
    return h+'.'+p+'.'+(sig.length?sig.toString('base64url'):'AA');
  };
  const fetch=async(url,init={})=>{
    const u=new URL(url);
    const json=obj=>({ok:true,text:async()=>JSON.stringify(obj)});
    if(u.pathname==='/.well-known/openid-configuration')return json(discoveryOverride||{issuer:PROVIDER,
      authorization_endpoint:PROVIDER+'login/oauth/authorize',token_endpoint:PROVIDER+'login/oauth/access_token',
      jwks_uri:PROVIDER+'login/oauth/keys'});
    if(u.pathname==='/login/oauth/keys')return json({keys:[{...rsa.publicKey.export({format:'jwk'}),kid:'idp-1',use:'sig',alg:'RS256'}]});
    if(u.pathname==='/login/oauth/access_token'){
      const body=new URLSearchParams(init.body.toString());
      seen.token.push(Object.fromEntries(body));
      const now=Math.floor(Date.now()/1000);
      return json({id_token:sign({iss:PROVIDER,aud:'skyhub-wpml',sub:'42',nonce:seen.nonce,iat:now,exp:now+300,groups,...claims})});
    }
    return {ok:false,text:async()=>''};
  };
  return {fetch,seen};
}
function redisMock(){
  const data=new Map();
  return {data,get:async k=>data.has(k)?data.get(k):null,set:async(k,v,opts)=>{assert.ok(opts.EX>0);data.set(k,v);return 'OK';}};
}
function setup(opts={}){
  const p=provider(opts);
  const redis=redisMock();
  const issuer=createWpmlOperatorIssuer({oidc:{issuer:PROVIDER,clientId:'skyhub-wpml',clientSecret:'s'.repeat(24),
    redirectUri:'https://skyhub.test/wpml/oidc/callback',organization:'skyhub'},workspaces:{farm:WS},
    operatorIssuer:OPERATOR_ISSUER,signingKey:ed.privateKey,keyId:'wpml-1',redis,keySecret:KEY_SECRET,
    recordMacSecret:MAC_SECRET,fetch:p.fetch});
  const verify=createWpmlOperatorVerifier({issuer:OPERATOR_ISSUER,publicKeys:{'wpml-1':ed.publicKey},
    isActiveSession:createWpmlRedisSessionCheck({redis,keySecret:KEY_SECRET,recordMacSecret:MAC_SECRET})});
  return {issuer,verify,redis,p};
}
async function login(ctx,{state,mutatePending}={}){
  const {authorizationUrl,pending}=await ctx.issuer.beginLogin({workspace:'farm'});
  ctx.p.seen.nonce=pending.nonce;
  ctx.p.seen.authorizationUrl=new URL(authorizationUrl);
  const p=mutatePending?mutatePending(pending):pending;
  return ctx.issuer.completeLogin({code:'abc',state:state??pending.state,pending:p});
}
const code=c=>e=>e instanceof IssuerError&&e.code===c;

test('login yields a token the existing verifier accepts as human operator of the workspace',async()=>{
  const ctx=setup();
  const out=await login(ctx);
  assert.equal(out.role,'operator');
  const principal=await ctx.verify(out.token);
  assert.deepEqual(principal,{id:uuidV5('5c1d6f0e-3b0a-4d7e-9a51-6f1b2c3d4e5f',PROVIDER+'\u000042'),workspaceId:WS,
    role:'operator',kind:'human',source:'independent-operator-auth'});
  const payload=JSON.parse(Buffer.from(out.token.split('.')[1],'base64url').toString());
  assert.ok(payload.exp-payload.iat<=900);
  assert.equal(payload.jti,out.sessionId);
});

test('PKCE S256 and confidential client: token request carries the matching verifier',async()=>{
  const ctx=setup();
  await login(ctx);
  const auth=ctx.p.seen.authorizationUrl.searchParams;
  assert.equal(auth.get('code_challenge_method'),'S256');
  assert.match(auth.get('scope'),/\bgroups\b/);
  const sent=ctx.p.seen.token[0];
  assert.equal(crypto.createHash('sha256').update(sent.code_verifier).digest('base64url'),auth.get('code_challenge'));
  assert.equal(sent.grant_type,'authorization_code');
});

test('admin team wins, no team means no login',async()=>{
  assert.equal((await login(setup({groups:['skyhub:ws-farm-operator','skyhub:ws-farm-admin']}))).role,'admin');
  await assert.rejects(login(setup({groups:['skyhub','other:ws-farm-admin','skyhub:ws-other-admin']})),code('not_a_workspace_member'));
});

test('state, nonce, audience, expiry and signature are all enforced',async()=>{
  await assert.rejects(login(setup(),{state:'forged'}),code('state'));
  await assert.rejects(login(setup({claims:{nonce:'replayed'}})),code('id_token_claims'));
  await assert.rejects(login(setup({claims:{aud:'other-client'}})),code('id_token_claims'));
  await assert.rejects(login(setup({claims:{exp:1}})),code('id_token_claims'));
  await assert.rejects(login(setup({claims:{iss:'https://evil.test/'}})),code('id_token_claims'));
  const forgedKey=crypto.generateKeyPairSync('rsa',{modulusLength:2048}).privateKey;
  await assert.rejects(login(setup({key:forgedKey})),code('id_token_signature'));
  await assert.rejects(login(setup({alg:'HS256'})),code('id_token_alg'));
  await assert.rejects(login(setup({alg:'none'})),code('id_token_alg'));
  await assert.rejects(login(setup(),{mutatePending:p=>({...p,createdAt:p.createdAt-3600})}),code('pending_expired'));
});

test('endpoints outside the pinned provider origin are refused',async()=>{
  const ctx=setup({discoveryOverride:{issuer:PROVIDER,authorization_endpoint:PROVIDER+'a',
    token_endpoint:'https://evil.test/token',jwks_uri:PROVIDER+'k'}});
  await assert.rejects(ctx.issuer.beginLogin({workspace:'farm'}),code('discovery_endpoint'));
  await assert.rejects(setup().issuer.beginLogin({workspace:'unknown'}),code('unknown_workspace'));
});

test('reissue renews the short token, revoke ends the session for verifier and issuer',async()=>{
  const ctx=setup();
  const out=await login(ctx);
  const again=await ctx.issuer.reissue({sessionId:out.sessionId});
  assert.ok(await ctx.verify(again.token));
  assert.equal(await ctx.issuer.revoke({sessionId:out.sessionId}),true);
  assert.equal(await ctx.verify(out.token),null);
  await assert.rejects(ctx.issuer.reissue({sessionId:out.sessionId}),code('session'));
  // A tampered record (e.g. role raised in Redis without the MAC secret) is rejected.
  const [k,v]=[...ctx.redis.data][0];
  ctx.redis.data.set(k,JSON.stringify({...JSON.parse(v),status:'active',role:'admin'}));
  await assert.rejects(ctx.issuer.reissue({sessionId:out.sessionId}),code('session'));
});

test('configuration fails at start-up, not at login',()=>{
  const base={oidc:{issuer:PROVIDER,clientId:'c',redirectUri:'https://skyhub.test/cb',organization:'skyhub'},
    workspaces:{farm:WS},operatorIssuer:OPERATOR_ISSUER,signingKey:ed.privateKey,keyId:'k',redis:redisMock(),
    keySecret:KEY_SECRET,recordMacSecret:MAC_SECRET,fetch:async()=>({ok:false})};
  assert.doesNotThrow(()=>createWpmlOperatorIssuer(base));
  assert.throws(()=>createWpmlOperatorIssuer({...base,recordMacSecret:KEY_SECRET}),/must differ/);
  assert.throws(()=>createWpmlOperatorIssuer({...base,oidc:{...base.oidc,issuer:'http://forgejo.test/'}}),/HTTPS/);
  assert.throws(()=>createWpmlOperatorIssuer({...base,signingKey:rsa.privateKey}),/Ed25519/);
  assert.throws(()=>createWpmlOperatorIssuer({...base,tokenSeconds:3600}),/60..900/);
  assert.throws(()=>createWpmlOperatorIssuer({...base,operatorIssuer:OPERATOR_ISSUER+'/'}),/trailing slash/);
  assert.throws(()=>createWpmlOperatorIssuer({...base,workspaces:{'Bad Name':WS}}),/Invalid workspace/);
});

test('real Forgejo 17 shape (probed 07.11.2026): iss without trailing slash, aud as one-element list',async()=>{
  const bare=PROVIDER.replace(/\/$/,'');
  const ctx=setup({claims:{iss:bare,aud:['skyhub-wpml']},groups:['skyhub','skyhub:ws-farm-operator'],
    discoveryOverride:{issuer:bare,authorization_endpoint:bare+'/login/oauth/authorize',
      token_endpoint:bare+'/login/oauth/access_token',jwks_uri:bare+'/login/oauth/keys'}});
  const out=await login(ctx);
  assert.equal(out.role,'operator');
  assert.ok(await ctx.verify(out.token));
});
