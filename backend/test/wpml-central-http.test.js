'use strict';
// ADR-001 step 5: HTTP wiring. Real Express app on an ephemeral port, REAL issuer + verifier + Redis session check
// against a local test OIDC provider; only the route service is a fake (SQL/RLS are covered by the integration tests).
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const express=require('express');
const {createWpmlCentralRouter,createWpmlCentralFromEnv,createSealer,LOGIN_COOKIE,SESSION_COOKIE}=require('../wpml-central-http');
const {createWpmlOperatorIssuer}=require('../wpml-operator-issuer');
const {createWpmlOperatorVerifier}=require('../wpml-operator-verifier');
const {createWpmlRedisSessionCheck}=require('../wpml-operator-session-redis');
const {RouteError}=require('../wpml-central-routes');

const PROVIDER='https://forgejo.test';
const OP_ISSUER='https://skyhub.test/wpml-operator';
const ORIGIN='https://skyhub.test:4443';
const WS='e3dea0f5-37f2-4d79-ae58-490af3228069';
const KEY_SECRET='k'.repeat(40),MAC_SECRET='m'.repeat(40);
const rsa=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
const ed=crypto.generateKeyPairSync('ed25519');

function provider(groups){
  const seen={};
  const fetch=async(url,init={})=>{
    const u=new URL(url);
    const json=obj=>({ok:true,text:async()=>JSON.stringify(obj)});
    if(u.pathname==='/.well-known/openid-configuration')return json({issuer:PROVIDER,
      authorization_endpoint:PROVIDER+'/login/oauth/authorize',token_endpoint:PROVIDER+'/login/oauth/access_token',
      jwks_uri:PROVIDER+'/login/oauth/keys'});
    if(u.pathname==='/login/oauth/keys')return json({keys:[{...rsa.publicKey.export({format:'jwk'}),kid:'idp-1',use:'sig',alg:'RS256'}]});
    if(u.pathname==='/login/oauth/access_token'){
      const body=new URLSearchParams(init.body.toString());
      if(body.get('code')!=='good-code')return {ok:false,text:async()=>'{}'};
      const now=Math.floor(Date.now()/1000);
      const part=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
      const h=part({alg:'RS256',kid:'idp-1',typ:'JWT'}),p=part({iss:PROVIDER,aud:['skyhub-wpml'],sub:'42',nonce:seen.nonce,
        iat:now,exp:now+300,groups});
      return json({id_token:h+'.'+p+'.'+crypto.sign('sha256',Buffer.from(h+'.'+p),rsa.privateKey).toString('base64url')});
    }
    return {ok:false,text:async()=>''};
  };
  return {fetch,seen};
}
function fakeService(verify){
  const calls=[];
  const check=async({credential,workspaceId})=>{
    const p=await verify(credential);
    if(!p||p.workspaceId!==workspaceId)throw new RouteError('unauthorized');
    return p;
  };
  return {calls,
    async listRoutes(req){await check(req);calls.push(['list',req.workspaceId]);return [];},
    async createRoute(req){await check(req);calls.push(['create',req.workspaceId,req.name]);
      if(req.name==='full')throw new RouteError('capacity');
      return {routeId:'b4b2a0a6-46b0-4c44-9d43-6a3a93e0c1aa',revision:1};},
    async appendRevision(req){await check(req);calls.push(['append',req.routeId,req.expectedRevision]);throw new RouteError('conflict');},
    async readRevision(req){await check(req);calls.push(['read',req.routeId,req.revision]);throw new Error('pg: password for skyhub_wpml_app');}
  };
}
async function start({groups=['skyhub','skyhub:ws-farm-operator']}={}){
  const p=provider(groups);
  const data=new Map();
  const redis={get:async k=>data.has(k)?data.get(k):null,set:async(k,v,{EX})=>{assert.ok(EX>0);data.set(k,v);return 'OK';}};
  const issuer=createWpmlOperatorIssuer({oidc:{issuer:PROVIDER,clientId:'skyhub-wpml',clientSecret:'s'.repeat(24),
    redirectUri:ORIGIN+'/wpml/oidc/callback',organization:'skyhub'},workspaces:{farm:WS},operatorIssuer:OP_ISSUER,
    signingKey:ed.privateKey,keyId:'wpml-1',redis,keySecret:KEY_SECRET,recordMacSecret:MAC_SECRET,fetch:p.fetch});
  const verify=createWpmlOperatorVerifier({issuer:OP_ISSUER,publicKeys:{'wpml-1':ed.publicKey},
    isActiveSession:createWpmlRedisSessionCheck({redis,keySecret:KEY_SECRET,recordMacSecret:MAC_SECRET})});
  const service=fakeService(verify);
  const cookieKey=crypto.randomBytes(32);
  const app=express();
  app.use(express.json({limit:'128kb'}));
  app.use(createWpmlCentralRouter({express,issuer,verify,service,cookieKey,allowedOrigins:new Set([ORIGIN])}));
  app.use((req,res)=>res.status(404).json({error:'Not found'}));
  const server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));});
  const base='http://127.0.0.1:'+server.address().port;
  const call=(pathname,{method='GET',cookie,origin,body,type='application/json'}={})=>fetch(base+pathname,{method,redirect:'manual',
    headers:{...(cookie?{cookie}:{}),...(origin?{origin}:{}),...(body!==undefined?{'content-type':type}:{})},
    body:body===undefined?undefined:(typeof body==='string'?body:JSON.stringify(body))});
  return {server,call,service,p,cookieKey,data};
}
const setCookie=(res,name)=>res.headers.getSetCookie().find(c=>c.startsWith(name+'='));
const value=c=>c.split(';')[0];

async function login(ctx){
  const res=await ctx.call('/wpml/oidc/login?workspace=farm');
  assert.equal(res.status,303);
  const auth=new URL(res.headers.get('location'));
  ctx.p.seen.nonce=auth.searchParams.get('nonce');
  const lc=setCookie(res,LOGIN_COOKIE);
  const cb=await ctx.call('/wpml/oidc/callback?code=good-code&state='+encodeURIComponent(auth.searchParams.get('state')),
    {cookie:value(lc)});
  return {loginCookie:lc,auth,cb,session:setCookie(cb,SESSION_COOKIE)};
}

test('full login: sealed cookies, redirect to planning tab, operator only sees own workspace',async t=>{
  const ctx=await start();t.after(()=>ctx.server.close());
  const {loginCookie,auth,cb,session}=await login(ctx);
  assert.equal(auth.origin+auth.pathname,PROVIDER+'/login/oauth/authorize');
  assert.match(loginCookie,/HttpOnly; Secure; SameSite=Lax/);
  assert.match(loginCookie,/Path=\/wpml\/oidc/);
  assert.equal(cb.status,303);
  assert.equal(cb.headers.get('location'),'/cloud-api2.html#planning');
  assert.match(session,/; Path=\/; HttpOnly; Secure; SameSite=Strict/);
  assert.match(setCookie(cb,LOGIN_COOKIE),/Max-Age=0/);                       // login cookie is single use
  // Cookie never carries the token, the session id or the provider identity in clear text.
  assert.doesNotMatch(session,/eyJ|42|farm|[0-9a-f]{8}-[0-9a-f]{4}-/);
  const me=await ctx.call('/wpml-central/me',{cookie:value(session)});
  assert.equal(me.status,200);
  assert.deepEqual(await me.json(),{workspaceId:WS,role:'operator',flightReady:false,dispatchAllowed:false});
  const created=await ctx.call('/wpml-central/routes',{method:'POST',cookie:value(session),origin:ORIGIN,
    body:{name:'Feld 1',plan:{},workspaceId:'00000000-0000-4000-8000-000000000000'}});
  assert.equal(created.status,201);
  // A workspace in the body is ignored: the workspace comes from the verified operator token.
  assert.deepEqual(ctx.service.calls.at(-1),['create',WS,'Feld 1']);
});

test('no or forged session cookie means 401, and the service is never reached',async t=>{
  const ctx=await start();t.after(()=>ctx.server.close());
  assert.equal((await ctx.call('/wpml-central/routes')).status,401);
  const forged=createSealer(crypto.randomBytes(32)).seal(crypto.randomUUID(),600,'session');
  assert.equal((await ctx.call('/wpml-central/routes',{cookie:SESSION_COOKIE+'='+forged})).status,401);
  // A valid login cookie must not work as a session cookie (purpose-bound AAD).
  const {loginCookie}=await login(ctx);
  assert.equal((await ctx.call('/wpml-central/me',{cookie:SESSION_COOKIE+'='+value(loginCookie).split('=')[1]})).status,401);
  // A session cookie sealed with the right key for an unknown session id is refused by Redis.
  const unknown=createSealer(ctx.cookieKey).seal(crypto.randomUUID(),600,'session');
  assert.equal((await ctx.call('/wpml-central/me',{cookie:SESSION_COOKIE+'='+unknown})).status,401);
  assert.equal(ctx.service.calls.length,0);
});

test('state-changing requests need an allowlisted Origin and a JSON body',async t=>{
  const ctx=await start();t.after(()=>ctx.server.close());
  const {session}=await login(ctx);
  const cookie=value(session);
  assert.equal((await ctx.call('/wpml-central/routes',{method:'POST',cookie,body:{name:'x',plan:{}}})).status,403);
  assert.equal((await ctx.call('/wpml-central/routes',{method:'POST',cookie,origin:'https://evil.test',body:{name:'x',plan:{}}})).status,403);
  assert.equal((await ctx.call('/wpml-central/routes',{method:'POST',cookie,origin:ORIGIN,body:'name=x',
    type:'application/x-www-form-urlencoded'})).status,415);
  assert.equal((await ctx.call('/wpml/oidc/logout',{method:'POST',cookie})).status,403);
  assert.equal(ctx.service.calls.length,0);
});

test('route errors map to stable codes without internal detail',async t=>{
  const ctx=await start();t.after(()=>ctx.server.close());
  const {session}=await login(ctx);
  const cookie=value(session);
  const full=await ctx.call('/wpml-central/routes',{method:'POST',cookie,origin:ORIGIN,body:{name:'full',plan:{}}});
  assert.deepEqual([full.status,await full.json()],[409,{error:'capacity'}]);
  const conflict=await ctx.call('/wpml-central/routes/b4b2a0a6-46b0-4c44-9d43-6a3a93e0c1aa/revisions',
    {method:'POST',cookie,origin:ORIGIN,body:{expectedRevision:1,plan:{}}});
  assert.deepEqual([conflict.status,await conflict.json()],[409,{error:'conflict'}]);
  const read=await ctx.call('/wpml-central/routes/b4b2a0a6-46b0-4c44-9d43-6a3a93e0c1aa/revisions/1',{cookie});
  const text=await read.text();
  assert.equal(read.status,503);
  assert.doesNotMatch(text,/pg|password|skyhub_wpml_app/);
});

test('logout revokes the session server-side: the old cookie is dead even if replayed',async t=>{
  const ctx=await start();t.after(()=>ctx.server.close());
  const {session}=await login(ctx);
  const cookie=value(session);
  const out=await ctx.call('/wpml/oidc/logout',{method:'POST',cookie,origin:ORIGIN});
  assert.equal(out.status,204);
  assert.match(setCookie(out,SESSION_COOKIE),/Max-Age=0/);
  assert.equal((await ctx.call('/wpml-central/me',{cookie})).status,401);
});

test('login failures: expired/missing login cookie, provider error, non-member, unknown workspace',async t=>{
  const ctx=await start({groups:['skyhub','skyhub:ws-other-admin']});t.after(()=>ctx.server.close());
  assert.equal((await ctx.call('/wpml/oidc/callback?code=good-code&state=x')).status,400);
  assert.equal((await ctx.call('/wpml/oidc/login?workspace=unknown')).status,400);
  const res=await ctx.call('/wpml/oidc/login?workspace=farm');
  const auth=new URL(res.headers.get('location'));
  ctx.p.seen.nonce=auth.searchParams.get('nonce');
  const lc=value(setCookie(res,LOGIN_COOKIE));
  const state=encodeURIComponent(auth.searchParams.get('state'));
  assert.equal((await ctx.call('/wpml/oidc/callback?error=access_denied&state='+state,{cookie:lc})).status,403);
  assert.equal((await ctx.call('/wpml/oidc/callback?code=bad&state='+state,{cookie:lc})).status,401);
  const member=await ctx.call('/wpml/oidc/callback?code=good-code&state='+state,{cookie:lc});
  assert.equal(member.status,403);
  assert.equal(setCookie(member,SESSION_COOKIE),undefined);
  assert.equal((await ctx.call('/wpml/oidc/callback?code=good-code&state=forged',{cookie:lc})).status,401);
});

test('sealer rejects tampering, expiry and wrong purpose',()=>{
  const s=createSealer(crypto.randomBytes(32));
  const v=s.seal({a:1},60,'login');
  assert.deepEqual(s.open(v,'login'),{a:1});
  assert.equal(s.open(v,'session'),null);
  const raw=Buffer.from(v,'base64url');raw[raw.length-1]^=1;
  assert.equal(s.open(raw.toString('base64url'),'login'),null);
  assert.equal(s.open(s.seal({a:1},-1,'login'),'login'),null);
  assert.throws(()=>createSealer(Buffer.alloc(16)),/32-byte/);
});

test('router refuses unsafe configuration',()=>{
  const ok={express,issuer:{},verify:async()=>null,service:{},cookieKey:crypto.randomBytes(32),allowedOrigins:new Set([ORIGIN])};
  assert.doesNotThrow(()=>createWpmlCentralRouter(ok));
  assert.throws(()=>createWpmlCentralRouter({...ok,allowedOrigins:new Set(['http://skyhub.test'])}),/HTTPS origin/);
  assert.throws(()=>createWpmlCentralRouter({...ok,allowedOrigins:new Set()}),/HTTPS origin/);
  assert.throws(()=>createWpmlCentralRouter({...ok,afterLoginPath:'//evil.test/'}),/local path/);
  assert.throws(()=>createWpmlCentralRouter({...ok,cookieKey:undefined}),/32-byte/);
});

test('start-up from env: secrets files must be 0600 and parse errors never quote content',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wpml-central-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const client=path.join(dir,'client.json'),secrets=path.join(dir,'secrets.json');
  fs.writeFileSync(client,JSON.stringify({client_id:'skyhub-wpml',client_secret:'s'.repeat(24)}),{mode:0o600});
  fs.writeFileSync(secrets,'{"keySecret":"TOP-SECRET-VALUE"',{mode:0o600});
  const env={SKYHUB_WPML_OIDC_CONFIG_FILE:client,SKYHUB_WPML_CENTRAL_SECRETS_FILE:secrets,SKYHUB_WPML_WORKSPACES:'farm='+WS,
    SKYHUB_WPML_CENTRAL_ORIGINS:ORIGIN,SKYHUB_WPML_OPERATOR_ISSUER:OP_ISSUER,SKYHUB_WPML_OIDC_ISSUER:PROVIDER,
    SKYHUB_WPML_OIDC_REDIRECT_URI:ORIGIN+'/wpml/oidc/callback',SKYHUB_WPML_OIDC_ORG:'skyhub'};
  const redis={get:async()=>null,set:async()=>'OK'};
  class Pool{constructor(o){this.o=o;}on(){}connect(){throw new Error("no db in unit test");}}
  assert.throws(()=>createWpmlCentralFromEnv({express,env,redis,Pool}),err=>
    /not valid JSON/.test(err.message)&&!err.message.includes('TOP-SECRET'));
  fs.writeFileSync(secrets,JSON.stringify({signingKeyPem:ed.privateKey.export({format:'pem',type:'pkcs8'}),keyId:'wpml-1',
    keySecret:KEY_SECRET,recordMacSecret:MAC_SECRET,cookieKey:crypto.randomBytes(32).toString('base64'),
    databaseUrl:'postgresql://skyhub_wpml_app@db/skyhub'}));
  const out=createWpmlCentralFromEnv({express,env,redis,Pool});
  assert.equal(typeof out.router,'function');
  assert.equal(out.pool.o.application_name,'skyhub-wpml-central');
  fs.chmodSync(secrets,0o644);
  assert.throws(()=>createWpmlCentralFromEnv({express,env,redis,Pool}),/0600/);
  fs.chmodSync(secrets,0o600);
  assert.throws(()=>createWpmlCentralFromEnv({express,env:{...env,SKYHUB_WPML_WORKSPACES:'farm=nope'},redis,Pool}),/name=uuid/);
});

test('server.js loads the HTTP wiring only behind SKYHUB_WPML_CENTRAL=1, before the /api view-token gate',()=>{
  const server=fs.readFileSync(path.resolve(__dirname,'../server.js'),'utf8');
  const flag=server.indexOf("process.env.SKYHUB_WPML_CENTRAL==='1'");
  const req=server.indexOf("require('./wpml-central-http')");
  assert.ok(flag>0&&req>flag&&req-flag<200,'require must sit inside the flag block');
  assert.equal(server.split("wpml-central-http").length-1,1);
  assert.doesNotMatch(server,/wpml-central-routes|wpml-operator-(?:issuer|verifier|session-redis)/);
  assert.ok(req<server.indexOf("app.use('/api',auth);"));
});
