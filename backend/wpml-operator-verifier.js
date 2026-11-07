'use strict';
// Isolated P0 identity adapter. No network, HTTP route, DJI token, key download,
// local fallback credentials or server mount. Real IdP/session storage are absent.
const crypto=require('node:crypto');
const {parseJson}=require('../frontend/public/wpml-waylines-reference');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const AUDIENCE='skyhub-wpml-route-service';
const FIELDS=['iss','aud','sub','workspaceId','role','kind','iat','nbf','exp','jti'];
function keysExact(value,required){
  return !!value&&typeof value==='object'&&!Array.isArray(value)&&
    Object.getPrototypeOf(value)===Object.prototype&&
    Object.keys(value).length===required.length&&
    required.every(k=>Object.hasOwn(value,k));
}
function boundedJSON(part,limit){
  if(typeof part!=='string'||part.length<2||part.length>limit||
     !/^[A-Za-z0-9_-]+$/.test(part))return null;
  const raw=Buffer.from(part,'base64url');
  if(raw.toString('base64url')!==part||raw.length>limit)return null;
  try{return parseJson(raw.toString('utf8'),limit);}catch{return null;}
}
function validIssuer(issuer){
  try{
    const url=new URL(issuer);
    return url.protocol==='https:'&&url.username===''&&url.password===''&&
      url.hash===''&&url.hostname.length>0;
  }catch{return false;}
}
function createWpmlOperatorVerifier({issuer,publicKeys,isActiveSession,clock=()=>Date.now()}={}){
  if(typeof issuer!=='string'||issuer.length>255||!validIssuer(issuer))
    throw new TypeError('Pinned HTTPS operator issuer required');
  if(!publicKeys||Object.getPrototypeOf(publicKeys)!==Object.prototype||
     Object.keys(publicKeys).length<1||Object.keys(publicKeys).length>8)
    throw new TypeError('Pinned Ed25519 public keys required');
  const keys=new Map();
  for(const [kid,key] of Object.entries(publicKeys)){
    if(!/^[A-Za-z0-9_-]{1,48}$/.test(kid)||
      !(key instanceof crypto.KeyObject)||key.type!=='public'||
      key.asymmetricKeyType!=='ed25519')
      throw new TypeError('Only pinned Ed25519 verification keys are supported');
    keys.set(kid,key);
  }
  if(typeof isActiveSession!=='function')
    throw new TypeError('Independently verified session lookup required');
  if(typeof clock!=='function')throw new TypeError('Clock required');
  return async function verifyOperatorToken(compact){
    if(typeof compact!=='string'||compact.length>4096)return null;
    const parts=compact.split('.');
    if(parts.length!==3||parts.some(x=>!x||x.length>4096))return null;
    const header=boundedJSON(parts[0],512);
    const payload=boundedJSON(parts[1],2048);
    const signature=parts[2];
    if(!keysExact(header,['alg','typ','kid'])||header.alg!=='EdDSA'||
       header.typ!=='JWT'||typeof header.kid!=='string'||
       !keys.has(header.kid)||!keysExact(payload,FIELDS)|| 
       typeof signature!=='string'||!/^[A-Za-z0-9_-]+$/.test(signature))
      return null;
    const sig=Buffer.from(signature,'base64url');
    if(sig.length!==64||sig.toString('base64url')!==signature)return null;
    if(!crypto.verify(null,Buffer.from(parts[0]+'.'+parts[1],'ascii'),
       keys.get(header.kid),sig))return null;
    const now=Math.floor(clock()/1000);
    if(!Number.isSafeInteger(now)||now<1||
       payload.iss!==issuer||payload.aud!==AUDIENCE||
       payload.kind!=='human'||!['operator','admin'].includes(payload.role)||
       typeof payload.sub!=='string'||!UUID.test(payload.sub)||
       typeof payload.workspaceId!=='string'||!UUID.test(payload.workspaceId)||
       typeof payload.jti!=='string'||!UUID.test(payload.jti)||
       !Number.isSafeInteger(payload.iat)||!Number.isSafeInteger(payload.nbf)||
       !Number.isSafeInteger(payload.exp)||payload.iat<1||
       payload.iat>now||payload.nbf>now||payload.nbf<payload.iat||
       payload.exp<=now||payload.exp<=payload.iat||
       payload.exp-payload.iat>900)return null;
    const assertion=Object.freeze({issuer,subject:payload.sub,
      workspaceId:payload.workspaceId,role:payload.role,
      sessionId:payload.jti,expiresAt:payload.exp,keyId:header.kid});
    // A valid signature alone is NOT enough: revocation and membership
    // must be confirmed by a trusted server-side session store.
    try{
      if(await isActiveSession(assertion)!==true)return null;
    }catch{return null;}
    // A slow or maliciously stalled session service must not extend JWT
    // validity. The signature and active session both have to be valid
    // at the instant we grant the resulting operator principal.
    let afterSession;
    try{afterSession=Math.floor(clock()/1000);}catch{return null;}
    if(!Number.isSafeInteger(afterSession)||afterSession<1||
       afterSession<payload.nbf||afterSession>=payload.exp)return null;
    return Object.freeze({id:payload.sub,workspaceId:payload.workspaceId,
      role:payload.role,kind:'human',source:'independent-operator-auth'});
  };
}
module.exports={createWpmlOperatorVerifier,AUDIENCE};
