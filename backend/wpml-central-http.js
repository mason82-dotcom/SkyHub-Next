'use strict';
// ADR-001 step 5: HTTP wiring of the central WPML route library behind the operator login.
// Mounted by server.js ONLY when SKYHUB_WPML_CENTRAL=1 (default off). Own authentication, independent of the
// dashboard view token, the home-LAN token-free access and DJI Pilot 2 pairing.
//
//   GET  /wpml/oidc/login?workspace=<name>   start Forgejo login (pending state in a sealed, short-lived cookie)
//   GET  /wpml/oidc/callback                 finish login, set the sealed session cookie, back to the planning tab
//   POST /wpml/oidc/logout                   revoke the session
//   GET  /wpml-central/me                    current operator (workspace, role)
//   GET  /wpml-central/routes                list routes of the operator's workspace
//   POST /wpml-central/routes                create a route {name, plan}
//   POST /wpml-central/routes/:routeId/revisions               append {expectedRevision, plan}
//   GET  /wpml-central/routes/:routeId/revisions/:revision     read one revision
//
// Cookies are AES-256-GCM sealed (key only on the server), HttpOnly and Secure. The session cookie is SameSite=Strict;
// every state-changing request additionally needs an Origin from the configured allowlist and a JSON body.
// The browser never sends workspace, role or identity: they come from the verified operator token only.
const crypto=require('node:crypto');
const {RouteError}=require('./wpml-central-routes');
const {IssuerError}=require('./wpml-operator-issuer');

const LOGIN_COOKIE='skyhub_wpml_login';
const SESSION_COOKIE='skyhub_wpml_session';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROUTE_STATUS={invalid:400,unauthorized:401,'not-found':404,conflict:409,capacity:409,unavailable:503};

function createSealer(key){
  if(!Buffer.isBuffer(key)||key.length!==32)throw new TypeError('32-byte cookie sealing key required');
  return {
    seal(value,ttlSeconds,purpose){
      const iv=crypto.randomBytes(12);
      const c=crypto.createCipheriv('aes-256-gcm',key,iv);c.setAAD(Buffer.from(purpose));
      const body=Buffer.concat([c.update(JSON.stringify({v:value,exp:Math.floor(Date.now()/1000)+ttlSeconds})),c.final()]);
      return Buffer.concat([iv,c.getAuthTag(),body]).toString('base64url');
    },
    open(token,purpose){
      if(typeof token!=='string'||token.length<40||token.length>4096||!/^[A-Za-z0-9_-]+$/.test(token))return null;
      try{
        const raw=Buffer.from(token,'base64url');
        const d=crypto.createDecipheriv('aes-256-gcm',key,raw.subarray(0,12));
        d.setAAD(Buffer.from(purpose));d.setAuthTag(raw.subarray(12,28));
        const out=JSON.parse(Buffer.concat([d.update(raw.subarray(28)),d.final()]).toString('utf8'));
        return Number.isSafeInteger(out.exp)&&out.exp>Math.floor(Date.now()/1000)?out.v:null;
      }catch{return null;}
    }
  };
}
function cookies(req){
  const out=Object.create(null);
  for(const part of String(req.headers.cookie||'').split(';')){
    const i=part.indexOf('=');if(i<1)continue;
    const k=part.slice(0,i).trim();if(k===LOGIN_COOKIE||k===SESSION_COOKIE)out[k]=part.slice(i+1).trim();
  }
  return out;
}
function cookie(name,value,{maxAge,path,sameSite}){
  return `${name}=${value}; Max-Age=${maxAge}; Path=${path}; HttpOnly; Secure; SameSite=${sameSite}`;
}
// Small fixed-window limiter per client IP (req.ip honours the explicit trusted-proxy setting of server.js).
function limiter(max,windowMs){
  const hits=new Map();
  return (req,res,next)=>{
    const now=Date.now(),k=req.ip||'unknown';
    let e=hits.get(k);
    if(!e||e.reset<=now){e={n:0,reset:now+windowMs};hits.set(k,e);}
    if(hits.size>5000)for(const [key,v] of hits)if(v.reset<=now)hits.delete(key);
    if(++e.n>max){res.set('Retry-After',String(Math.ceil((e.reset-now)/1000)));return res.status(429).json({error:'rate_limited'});}
    next();
  };
}

function createWpmlCentralRouter({express,issuer,verify,service,cookieKey,allowedOrigins,afterLoginPath='/cloud-api2.html#planning',
  sessionSeconds=3600}={}){
  if(!express||!issuer||typeof verify!=='function'||!service)throw new TypeError('express, issuer, verify and service required');
  const sealer=createSealer(cookieKey);
  if(!(allowedOrigins instanceof Set)||!allowedOrigins.size||[...allowedOrigins].some(o=>!/^https:\/\/[^/]+$/.test(o)))
    throw new TypeError('HTTPS origin allowlist required');
  if(typeof afterLoginPath!=='string'||!afterLoginPath.startsWith('/')||afterLoginPath.startsWith('//'))
    throw new TypeError('afterLoginPath must be a local path');
  const router=express.Router();
  const loginLimit=limiter(20,60000),apiLimit=limiter(240,60000);

  const sameOrigin=req=>allowedOrigins.has(String(req.headers.origin||''));
  const deny=(res,status,error)=>res.status(status).json({error});

  async function operator(req){
    const sessionId=sealer.open(cookies(req)[SESSION_COOKIE],'session');
    if(typeof sessionId!=='string'||!UUID.test(sessionId))return null;
    let token;
    try{token=(await issuer.reissue({sessionId})).token;}catch{return null;}
    const principal=await verify(token);
    return principal?{token,principal}:null;
  }
  function routeError(res,err){
    if(err instanceof RouteError)return deny(res,ROUTE_STATUS[err.code]||400,err.code);
    return deny(res,503,'unavailable');
  }

  // ---- login ----
  router.get('/wpml/oidc/login',loginLimit,async(req,res)=>{
    try{
      const {authorizationUrl,pending}=await issuer.beginLogin({workspace:String(req.query.workspace||'')});
      res.append('Set-Cookie',cookie(LOGIN_COOKIE,sealer.seal(pending,600,'login'),{maxAge:600,path:'/wpml/oidc',sameSite:'Lax'}));
      res.redirect(303,authorizationUrl);
    }catch(err){deny(res,err instanceof IssuerError&&err.code==='unknown_workspace'?400:503,'login_unavailable');}
  });
  router.get('/wpml/oidc/callback',loginLimit,async(req,res)=>{
    const pending=sealer.open(cookies(req)[LOGIN_COOKIE],'login');
    res.append('Set-Cookie',cookie(LOGIN_COOKIE,'',{maxAge:0,path:'/wpml/oidc',sameSite:'Lax'}));   // single use
    if(!pending)return deny(res,400,'login_expired');
    if(typeof req.query.error==='string')return deny(res,403,'login_denied');
    try{
      const out=await issuer.completeLogin({code:String(req.query.code||''),state:String(req.query.state||''),pending});
      res.append('Set-Cookie',cookie(SESSION_COOKIE,sealer.seal(out.sessionId,sessionSeconds,'session'),
        {maxAge:sessionSeconds,path:'/',sameSite:'Strict'}));
      res.redirect(303,afterLoginPath);
    }catch(err){
      deny(res,err instanceof IssuerError&&err.code==='not_a_workspace_member'?403:401,'login_failed');
    }
  });
  router.post('/wpml/oidc/logout',loginLimit,async(req,res)=>{
    if(!sameOrigin(req))return deny(res,403,'origin');
    const sessionId=sealer.open(cookies(req)[SESSION_COOKIE],'session');
    if(typeof sessionId==='string'&&UUID.test(sessionId)){try{await issuer.revoke({sessionId});}catch{}}
    res.append('Set-Cookie',cookie(SESSION_COOKIE,'',{maxAge:0,path:'/',sameSite:'Strict'}));
    res.status(204).end();
  });

  // ---- route library API ----
  const api=express.Router();
  api.use(apiLimit,async(req,res,next)=>{
    if(req.method!=='GET'&&req.method!=='HEAD'){
      if(!sameOrigin(req))return deny(res,403,'origin');
      if(!req.is('application/json'))return deny(res,415,'json_required');
    }
    const op=await operator(req).catch(()=>null);
    if(!op)return deny(res,401,'login_required');
    req.wpmlOperator=op;
    next();
  });
  const base=req=>({credential:req.wpmlOperator.token,workspaceId:req.wpmlOperator.principal.workspaceId});
  api.get('/me',(req,res)=>{
    const p=req.wpmlOperator.principal;
    res.json({workspaceId:p.workspaceId,role:p.role,flightReady:false,dispatchAllowed:false});
  });
  api.get('/routes',async(req,res)=>{
    try{res.json({routes:await service.listRoutes(base(req))});}catch(err){routeError(res,err);}
  });
  api.post('/routes',async(req,res)=>{
    try{res.status(201).json(await service.createRoute({...base(req),name:req.body?.name,plan:req.body?.plan}));}
    catch(err){routeError(res,err);}
  });
  api.post('/routes/:routeId/revisions',async(req,res)=>{
    try{
      res.status(201).json(await service.appendRevision({...base(req),routeId:req.params.routeId,
        expectedRevision:req.body?.expectedRevision,plan:req.body?.plan}));
    }catch(err){routeError(res,err);}
  });
  api.get('/routes/:routeId/revisions/:revision',async(req,res)=>{
    const revision=Number(req.params.revision);
    try{res.json(await service.readRevision({...base(req),routeId:req.params.routeId,revision}));}
    catch(err){routeError(res,err);}
  });
  router.use('/wpml-central',api);
  return router;
}

// Redis adapter for the issuer: ioredis SET with EX.
function ioredisAdapter(client){
  return {get:key=>client.get(key),set:(key,value,{EX})=>client.set(key,value,'EX',EX)};
}

// ---- start-up from environment (server.js calls this only when SKYHUB_WPML_CENTRAL=1) ----
// Secrets come from two 0600 JSON files, never from plain env values or the repository:
//   SKYHUB_WPML_OIDC_CONFIG_FILE      {"client_id","client_secret"}           (Forgejo OAuth2 app)
//   SKYHUB_WPML_CENTRAL_SECRETS_FILE  {"signingKeyPem","keyId","keySecret","recordMacSecret","cookieKey"(base64, 32 bytes),
//                                      "databaseUrl"}                         (databaseUrl: login of skyhub_wpml_app, NOBYPASSRLS)
// Plain settings: SKYHUB_WPML_OIDC_ISSUER, SKYHUB_WPML_OIDC_REDIRECT_URI, SKYHUB_WPML_OIDC_ORG, SKYHUB_WPML_OPERATOR_ISSUER,
//   SKYHUB_WPML_WORKSPACES ("pilot=<uuid>,..."), SKYHUB_WPML_CENTRAL_ORIGINS ("https://host:port,...").
// Any defect throws here; server.js then logs ONE line and does not mount anything (fail closed, server keeps running).
function createWpmlCentralFromEnv({express,env=process.env,redis,fs=require('node:fs'),Pool=require('pg').Pool}={}){
  const need=name=>{const v=env[name];if(typeof v!=='string'||!v.trim())throw new TypeError(name+' missing');return v.trim();};
  const readJson=name=>{
    const file=need(name);
    const st=fs.statSync(file);
    if(!st.isFile()||(st.mode&0o077))throw new TypeError(name+' must be a regular file with mode 0600');
    // Never let a parser message quote file content (secrets) into the log.
    try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{throw new TypeError(name+' is not valid JSON');}
  };
  const client=readJson('SKYHUB_WPML_OIDC_CONFIG_FILE');
  const secrets=readJson('SKYHUB_WPML_CENTRAL_SECRETS_FILE');
  const workspaces={};
  for(const pair of need('SKYHUB_WPML_WORKSPACES').split(',')){
    const [name,id]=pair.split('=').map(x=>(x||'').trim());
    if(!name||!UUID.test(id||''))throw new TypeError('SKYHUB_WPML_WORKSPACES must be name=uuid[,name=uuid]');
    workspaces[name]=id.toLowerCase();
  }
  const allowedOrigins=new Set(need('SKYHUB_WPML_CENTRAL_ORIGINS').split(',').map(x=>x.trim()).filter(Boolean));
  let signingKey;
  try{signingKey=crypto.createPrivateKey(String(secrets.signingKeyPem||''));}catch{throw new TypeError('signingKeyPem invalid');}
  const cookieKey=Buffer.from(String(secrets.cookieKey||''),'base64');
  if(typeof secrets.databaseUrl!=='string'||!/^postgres(?:ql)?:\/\//.test(secrets.databaseUrl))throw new TypeError('databaseUrl missing');
  if(!redis)throw new TypeError('redis client required');
  const operatorIssuer=need('SKYHUB_WPML_OPERATOR_ISSUER');
  const {createWpmlOperatorIssuer}=require('./wpml-operator-issuer');
  const {createWpmlOperatorVerifier}=require('./wpml-operator-verifier');
  const {createWpmlRedisSessionCheck}=require('./wpml-operator-session-redis');
  const {createWpmlRouteService}=require('./wpml-central-routes');
  const redisAdapter=ioredisAdapter(redis);
  const issuer=createWpmlOperatorIssuer({oidc:{issuer:need('SKYHUB_WPML_OIDC_ISSUER'),clientId:client.client_id,
    clientSecret:client.client_secret,redirectUri:need('SKYHUB_WPML_OIDC_REDIRECT_URI'),organization:need('SKYHUB_WPML_OIDC_ORG')},
    workspaces,operatorIssuer,signingKey,keyId:secrets.keyId,redis:redisAdapter,keySecret:secrets.keySecret,
    recordMacSecret:secrets.recordMacSecret});
  const verify=createWpmlOperatorVerifier({issuer:operatorIssuer,publicKeys:{[secrets.keyId]:crypto.createPublicKey(signingKey)},
    isActiveSession:createWpmlRedisSessionCheck({redis:redisAdapter,keySecret:secrets.keySecret,recordMacSecret:secrets.recordMacSecret})});
  const pool=new Pool({connectionString:secrets.databaseUrl,max:4,idleTimeoutMillis:30000,connectionTimeoutMillis:3000,
    statement_timeout:5000,application_name:'skyhub-wpml-central'});
  pool.on('error',()=>console.error('[wpml-central] database pool error'));
  const service=createWpmlRouteService({pool,authorize:verify,workspaceRoles:true});
  return {router:createWpmlCentralRouter({express,issuer,verify,service,cookieKey,allowedOrigins}),pool};
}

module.exports={createWpmlCentralRouter,createWpmlCentralFromEnv,createSealer,ioredisAdapter,LOGIN_COOKIE,SESSION_COOKIE};
