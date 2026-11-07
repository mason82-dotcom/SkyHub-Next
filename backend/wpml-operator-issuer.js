'use strict';
// ADR-001 step 3: isolated operator token issuer. NOT required by backend/server.js and exposes no HTTP route.
// Flow: OIDC Authorization Code + PKCE against Forgejo (or any OIDC provider) -> verified ID token -> team membership
// -> workspace and role -> v2 Redis session record (MAC, readable by wpml-operator-session-redis.js) -> short-lived
// Ed25519 operator JWT (verifiable by wpml-operator-verifier.js). The caller keeps the pending login and the session id
// server-side (e.g. an encrypted httpOnly cookie); this module never trusts claims sent by the browser.
const crypto=require('node:crypto');
const {AUDIENCE}=require('./wpml-operator-verifier');
const {SESSION_SCHEMA}=require('./wpml-operator-session-redis');

const KEY_PREFIX='skyhub:wpml:operator-session:v2:';
const RECORD_CONTEXT='skyhub:wpml:operator-session:record:v2\u0000';
const SUBJECT_NAMESPACE='5c1d6f0e-3b0a-4d7e-9a51-6f1b2c3d4e5f';   // fixed UUIDv5 namespace for operator subjects
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WORKSPACE_NAME=/^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/;
const ALGS={RS256:{kty:'RSA',hash:'sha256'},ES256:{kty:'EC',hash:'sha256',crv:'P-256'},EdDSA:{kty:'OKP',crv:'Ed25519'}};
const MAX_TOKEN_SECONDS=900;

class IssuerError extends Error{
  constructor(code){super('WPML operator login '+code);this.name='IssuerError';this.code=code;}
}
const fail=code=>{throw new IssuerError(code);};
const b64url=buf=>Buffer.from(buf).toString('base64url');
const nowSeconds=clock=>{const n=Math.floor(clock()/1000);if(!Number.isSafeInteger(n)||n<1)fail('clock');return n;};

function httpsUrl(value,name){
  let url;
  try{url=new URL(value);}catch{throw new TypeError(name+' must be an absolute HTTPS URL');}
  if(url.protocol!=='https:'||url.username||url.password||url.hash)throw new TypeError(name+' must be an absolute HTTPS URL');
  return url;
}
function safeEqual(a,b){
  if(typeof a!=='string'||typeof b!=='string')return false;
  const x=crypto.createHash('sha256').update(a).digest(),y=crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(x,y)&&a.length===b.length;
}
// RFC 4122 version 5: stable UUID for an external subject, so the verifier's UUID-only `sub` keeps working.
function uuidV5(namespace,name){
  const ns=Buffer.from(namespace.replace(/-/g,''),'hex');
  const h=crypto.createHash('sha1').update(Buffer.concat([ns,Buffer.from(name,'utf8')])).digest().subarray(0,16);
  h[6]=(h[6]&0x0f)|0x50;h[8]=(h[8]&0x3f)|0x80;
  const s=h.toString('hex');
  return `${s.slice(0,8)}-${s.slice(8,12)}-${s.slice(12,16)}-${s.slice(16,20)}-${s.slice(20)}`;
}
function sessionMac(macKey,record){
  const fields=[record.schema,record.issuer,record.subject,record.workspaceId,record.role,
    record.sessionId,record.expiresAt,record.status];
  return crypto.createHmac('sha256',macKey).update(Buffer.from(RECORD_CONTEXT+JSON.stringify(fields),'utf8')).digest('hex');
}
function parseJwt(compact){
  if(typeof compact!=='string'||compact.length>16384)fail('id_token');
  const parts=compact.split('.');
  if(parts.length!==3||parts.some(p=>!/^[A-Za-z0-9_-]+$/.test(p)))fail('id_token');
  let header,payload;
  try{
    header=JSON.parse(Buffer.from(parts[0],'base64url').toString('utf8'));
    payload=JSON.parse(Buffer.from(parts[1],'base64url').toString('utf8'));
  }catch{fail('id_token');}
  if(!header||typeof header!=='object'||!payload||typeof payload!=='object'||Array.isArray(payload))fail('id_token');
  return {header,payload,signed:Buffer.from(parts[0]+'.'+parts[1],'ascii'),signature:Buffer.from(parts[2],'base64url')};
}

function createWpmlOperatorIssuer({
  oidc,workspaces,operatorIssuer,signingKey,keyId,redis,keySecret,recordMacSecret,
  sessionSeconds=8*3600,tokenSeconds=MAX_TOKEN_SECONDS,fetch=globalThis.fetch,clock=()=>Date.now(),
  httpTimeoutMs=5000
}={}){
  // ---- configuration (fail at start-up, never at login time) ----
  if(!oidc||typeof oidc!=='object')throw new TypeError('OIDC configuration required');
  const providerIssuer=httpsUrl(oidc.issuer,'oidc.issuer').href;
  const redirectUri=httpsUrl(oidc.redirectUri,'oidc.redirectUri').href;
  if(typeof oidc.clientId!=='string'||!/^[A-Za-z0-9_.:-]{1,128}$/.test(oidc.clientId))throw new TypeError('oidc.clientId required');
  if(oidc.clientSecret!==undefined&&(typeof oidc.clientSecret!=='string'||oidc.clientSecret.length<16))
    throw new TypeError('oidc.clientSecret must be a 16+ character string when set');
  if(typeof oidc.organization!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,38}$/.test(oidc.organization))
    throw new TypeError('oidc.organization (Forgejo organization holding the workspace teams) required');
  if(!workspaces||Object.getPrototypeOf(workspaces)!==Object.prototype||!Object.keys(workspaces).length)
    throw new TypeError('workspaces {name: uuid} required');
  const workspaceByName=new Map();
  for(const [name,id] of Object.entries(workspaces)){
    if(!WORKSPACE_NAME.test(name)||typeof id!=='string'||!UUID.test(id))throw new TypeError('Invalid workspace mapping: '+name);
    workspaceByName.set(name,id.toLowerCase());
  }
  const tokenIssuer=httpsUrl(operatorIssuer,'operatorIssuer').href.replace(/\/$/,'');
  if(tokenIssuer!==operatorIssuer)throw new TypeError('operatorIssuer must be given exactly as the verifier pins it (no trailing slash)');
  if(!(signingKey instanceof crypto.KeyObject)||signingKey.type!=='private'||signingKey.asymmetricKeyType!=='ed25519')
    throw new TypeError('Ed25519 private signing key required');
  if(typeof keyId!=='string'||!/^[A-Za-z0-9_-]{1,48}$/.test(keyId))throw new TypeError('keyId required');
  if(!redis||typeof redis.get!=='function'||typeof redis.set!=='function')throw new TypeError('Redis GET/SET adapter required');
  for(const [secret,name] of [[keySecret,'keySecret'],[recordMacSecret,'recordMacSecret']])
    if(!(Buffer.isBuffer(secret)||typeof secret==='string')||Buffer.byteLength(secret)<32)throw new TypeError(name+': 32+ bytes required');
  if(Buffer.from(keySecret).equals(Buffer.from(recordMacSecret)))throw new TypeError('Session lookup and integrity secrets must differ');
  if(!Number.isSafeInteger(sessionSeconds)||sessionSeconds<MAX_TOKEN_SECONDS||sessionSeconds>24*3600)
    throw new TypeError('sessionSeconds must be 900..86400');
  if(!Number.isSafeInteger(tokenSeconds)||tokenSeconds<60||tokenSeconds>MAX_TOKEN_SECONDS)
    throw new TypeError('tokenSeconds must be 60..900');
  if(typeof fetch!=='function'||typeof clock!=='function')throw new TypeError('fetch and clock required');
  const lookupKeySecret=Buffer.from(keySecret),macKey=Buffer.from(recordMacSecret);
  const lookupKey=sessionId=>KEY_PREFIX+crypto.createHmac('sha256',lookupKeySecret).update(sessionId,'ascii').digest('hex');

  // ---- OIDC discovery and JWKS, only from the pinned provider origin ----
  async function getJson(url,init){
    const target=new URL(url);
    if(target.protocol!=='https:'||target.origin!==new URL(providerIssuer).origin)fail('provider_origin');
    let res;
    try{res=await fetch(target.href,{...init,redirect:'error',signal:AbortSignal.timeout(httpTimeoutMs)});}
    catch{fail('provider_unreachable');}
    if(!res||!res.ok)fail('provider_status');
    let text;
    try{text=await res.text();}catch{fail('provider_body');}
    if(typeof text!=='string'||text.length>65536)fail('provider_body');
    try{return JSON.parse(text);}catch{fail('provider_body');}
  }
  let metadata=null;
  async function discovery(){
    if(metadata)return metadata;
    const meta=await getJson(providerIssuer.replace(/\/?$/,'/')+'.well-known/openid-configuration');
    if(!meta||meta.issuer!==providerIssuer&&meta.issuer!==providerIssuer.replace(/\/$/,''))fail('discovery_issuer');
    for(const k of ['authorization_endpoint','token_endpoint','jwks_uri'])
      if(typeof meta[k]!=='string'||new URL(meta[k]).origin!==new URL(providerIssuer).origin)fail('discovery_endpoint');
    metadata=Object.freeze({issuer:meta.issuer,authorization:meta.authorization_endpoint,
      token:meta.token_endpoint,jwks:meta.jwks_uri});
    return metadata;
  }
  async function publicKeyFor(header){
    const alg=ALGS[header.alg];
    if(!alg||typeof header.kid!=='string'||!header.kid||header.kid.length>256)fail('id_token_alg');
    const set=await getJson((await discovery()).jwks);
    const jwk=Array.isArray(set?.keys)&&set.keys.find(k=>k&&k.kid===header.kid);
    if(!jwk||jwk.kty!==alg.kty||(alg.crv&&jwk.crv!==alg.crv)||(jwk.use&&jwk.use!=='sig')||(jwk.alg&&jwk.alg!==header.alg))
      fail('id_token_key');
    try{return {key:crypto.createPublicKey({key:jwk,format:'jwk'}),alg};}catch{fail('id_token_key');}
  }

  // ---- step 1: start login (caller stores the returned pending object server-side) ----
  async function beginLogin({workspace}={}){
    if(typeof workspace!=='string'||!workspaceByName.has(workspace))fail('unknown_workspace');
    const meta=await discovery();
    const pending=Object.freeze({workspace,state:b64url(crypto.randomBytes(32)),nonce:b64url(crypto.randomBytes(32)),
      codeVerifier:b64url(crypto.randomBytes(48)),createdAt:nowSeconds(clock)});
    const url=new URL(meta.authorization);
    url.search=new URLSearchParams({response_type:'code',client_id:oidc.clientId,redirect_uri:redirectUri,
      scope:'openid profile groups',state:pending.state,nonce:pending.nonce,
      code_challenge:b64url(crypto.createHash('sha256').update(pending.codeVerifier).digest()),
      code_challenge_method:'S256'}).toString();
    return Object.freeze({authorizationUrl:url.href,pending});
  }

  async function verifyIdToken(idToken,pending){
    const {header,payload,signed,signature}=parseJwt(idToken);
    const {key,alg}=await publicKeyFor(header);
    const ok=alg.kty==='OKP'?crypto.verify(null,signed,key,signature)
      :crypto.verify(alg.hash,signed,alg.kty==='EC'?{key,dsaEncoding:'ieee-p1363'}:key,signature);
    if(!ok)fail('id_token_signature');
    const now=nowSeconds(clock);
    const aud=Array.isArray(payload.aud)?payload.aud:[payload.aud];
    if(payload.iss!==(await discovery()).issuer||!aud.includes(oidc.clientId)||
       (aud.length>1&&payload.azp!==oidc.clientId)||!safeEqual(payload.nonce,pending.nonce)||
       !Number.isSafeInteger(payload.exp)||payload.exp<=now||
       !Number.isSafeInteger(payload.iat)||payload.iat>now+60||
       typeof payload.sub!=='string'||!payload.sub||payload.sub.length>256)fail('id_token_claims');
    return payload;
  }
  // Forgejo groups claim: "org" and "org:team". Team names: ws-<workspace>-operator | ws-<workspace>-admin.
  function roleFor(groups,workspace){
    if(!Array.isArray(groups))return null;
    const has=team=>groups.includes(oidc.organization+':ws-'+workspace+'-'+team);
    return has('admin')?'admin':has('operator')?'operator':null;
  }

  async function storeSession(record,ttlSeconds){
    const value=JSON.stringify({...record,mac:sessionMac(macKey,record)});
    let res;
    try{res=await redis.set(lookupKey(record.sessionId),value,{EX:ttlSeconds});}catch{fail('session_store');}
    if(res!=='OK'&&res!==true)fail('session_store');
  }
  async function readSession(sessionId){
    if(typeof sessionId!=='string'||!UUID.test(sessionId))fail('session');
    let raw;
    try{raw=await redis.get(lookupKey(sessionId));}catch{fail('session_store');}
    if(typeof raw!=='string'||raw.length>2048)fail('session');
    let record;
    try{record=JSON.parse(raw);}catch{fail('session');}
    if(!record||typeof record!=='object'||Array.isArray(record))fail('session');
    const {mac,...fields}=record;
    const expectedKeys=['schema','issuer','subject','workspaceId','role','sessionId','expiresAt','status'];
    if(Object.keys(fields).length!==expectedKeys.length||!expectedKeys.every(k=>Object.hasOwn(fields,k))||
       fields.schema!==SESSION_SCHEMA||fields.sessionId!==sessionId||
       typeof mac!=='string'||!/^[0-9a-f]{64}$/.test(mac))fail('session');
    if(!crypto.timingSafeEqual(Buffer.from(sessionMac(macKey,fields),'hex'),Buffer.from(mac,'hex')))fail('session');
    return fields;
  }
  function signToken(record){
    const now=nowSeconds(clock);
    const exp=Math.min(now+tokenSeconds,record.expiresAt);
    if(exp<=now)fail('session_expired');
    const header=b64url(JSON.stringify({alg:'EdDSA',typ:'JWT',kid:keyId}));
    const payload=b64url(JSON.stringify({iss:tokenIssuer,aud:AUDIENCE,sub:record.subject,workspaceId:record.workspaceId,
      role:record.role,kind:'human',iat:now,nbf:now,exp,jti:record.sessionId}));
    const sig=crypto.sign(null,Buffer.from(header+'.'+payload,'ascii'),signingKey);
    return Object.freeze({token:header+'.'+payload+'.'+b64url(sig),expiresAt:exp});
  }

  // ---- step 2: callback from the provider ----
  async function completeLogin({code,state,pending}={}){
    if(!pending||typeof pending!=='object'||!workspaceByName.has(pending.workspace))fail('pending');
    if(!safeEqual(state,pending.state))fail('state');
    const now=nowSeconds(clock);
    if(!Number.isSafeInteger(pending.createdAt)||now-pending.createdAt>600||pending.createdAt>now+60)fail('pending_expired');
    if(typeof code!=='string'||!code||code.length>2048)fail('code');
    const meta=await discovery();
    const body=new URLSearchParams({grant_type:'authorization_code',code,redirect_uri:redirectUri,
      client_id:oidc.clientId,code_verifier:pending.codeVerifier});
    if(oidc.clientSecret)body.set('client_secret',oidc.clientSecret);
    const tokens=await getJson(meta.token,{method:'POST',body,
      headers:{'content-type':'application/x-www-form-urlencoded',accept:'application/json'}});
    const claims=await verifyIdToken(tokens?.id_token,pending);
    const role=roleFor(claims.groups,pending.workspace);
    if(!role)fail('not_a_workspace_member');
    const record=Object.freeze({schema:SESSION_SCHEMA,issuer:tokenIssuer,
      subject:uuidV5(SUBJECT_NAMESPACE,claims.iss+'\u0000'+claims.sub),
      workspaceId:workspaceByName.get(pending.workspace),role,sessionId:crypto.randomUUID(),
      expiresAt:now+sessionSeconds,status:'active'});
    await storeSession(record,sessionSeconds);
    return Object.freeze({sessionId:record.sessionId,role,workspace:pending.workspace,
      sessionExpiresAt:record.expiresAt,...signToken(record)});
  }

  // ---- short token renewal from the server-side session id ----
  async function reissue({sessionId}={}){
    const record=await readSession(sessionId);
    if(record.status!=='active'||record.issuer!==tokenIssuer||record.expiresAt<=nowSeconds(clock))fail('session');
    return signToken(record);
  }

  // ---- logout: mark revoked (the reader denies anything but status:"active") ----
  async function revoke({sessionId}={}){
    const record=await readSession(sessionId);
    const ttl=record.expiresAt-nowSeconds(clock);
    if(ttl<=0)return false;
    await storeSession(Object.freeze({...record,status:'revoked'}),ttl);
    return true;
  }

  return Object.freeze({beginLogin,completeLogin,reissue,revoke});
}

module.exports={createWpmlOperatorIssuer,IssuerError,uuidV5};
