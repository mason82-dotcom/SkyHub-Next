'use strict';
// Read-only adapter for a FUTURE independently provisioned, revocable
// operator-session registry. Not mounted or provisioned in production.
// This module never creates sessions, grants roles, refreshes TTLs, or
// accepts operator claims directly from a client.
const crypto=require('node:crypto');
const {parseJson}=require('../frontend/public/wpml-waylines-reference');
const SESSION_SCHEMA='skyhub-wpml-operator-session-v1';
const KEY_PREFIX='skyhub:wpml:operator-session:v1:';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEYS=['schema','issuer','subject','workspaceId','role',
  'sessionId','expiresAt','status'];
function strictObject(x){
  return !!x&&typeof x==='object'&&!Array.isArray(x)&&
    Object.getPrototypeOf(x)===Object.prototype&&
    Object.keys(x).length===KEYS.length&&
    KEYS.every(key=>Object.hasOwn(x,key));
}
function validClaim(x){
  return !!x&&typeof x==='object'&&!Array.isArray(x)&&
    typeof x.issuer==='string'&&x.issuer.length>0&&
    typeof x.subject==='string'&&UUID.test(x.subject)&&
    typeof x.workspaceId==='string'&&UUID.test(x.workspaceId)&&
    typeof x.sessionId==='string'&&UUID.test(x.sessionId)&&
    ['operator','admin'].includes(x.role)&&
    Number.isSafeInteger(x.expiresAt)&&x.expiresAt>0;
}
function createWpmlRedisSessionCheck({
  redis,keySecret,clock=()=>Date.now(),lookupTimeoutMs=300,
  maxConcurrentLookups=32
}={}){
  if(!redis||typeof redis.get!=='function')
    throw new TypeError('A read-only Redis GET adapter is required');
  if(!(Buffer.isBuffer(keySecret)||typeof keySecret==='string')||
     Buffer.byteLength(keySecret)<32)
    throw new TypeError('Dedicated 32+ byte operator session key secret required');
  if(typeof clock!=='function')throw new TypeError('Clock required');
  if(!Number.isSafeInteger(lookupTimeoutMs)||lookupTimeoutMs<25||
     lookupTimeoutMs>2000)
    throw new TypeError('Bounded Redis lookup timeout (25-2000 ms) required');
  if(!Number.isSafeInteger(maxConcurrentLookups)||maxConcurrentLookups<1||
     maxConcurrentLookups>128)
    throw new TypeError('Bounded Redis session concurrency (1-128) required');
  // Count live Redis I/O, not only callers still awaiting a result.
  // A timed-out lookup can continue inside the Redis driver; releasing
  // its slot immediately would let an attacker accumulate unbounded
  // background GET operations during an outage.
  let inFlight=0;
  const key=Buffer.from(keySecret); // Never reuse a mutable caller buffer.
  function lookupKey(sessionId){
    return KEY_PREFIX+crypto.createHmac('sha256',key)
      .update(sessionId,'ascii').digest('hex');
  }
  return async function isActiveSession(assertion){
    if(!validClaim(assertion))return false;
    const now=Math.floor(clock()/1000);
    if(!Number.isSafeInteger(now)||now<1||assertion.expiresAt<=now)return false;
    // Fail closed under an exhausted Redis pool instead of allowing
    // unbounded pending promises to accumulate during an outage.
    if(inFlight>=maxConcurrentLookups)return false;
    inFlight++;
    // Only a verified JWT assertion is suitable input. The Redis key
    // intentionally contains no raw UUID, user name, GPS or bearer token.
    // The I/O slot is released only once Redis actually settles, not when
    // a caller deadline expires. A permanently stuck Redis pool leaves
    // authentication unavailable (fail closed) until recovery/restart.
    let value,timeout;
    const lookup=Promise.resolve().then(()=>
      redis.get(lookupKey(assertion.sessionId)));
    lookup.then(()=>{inFlight--;},()=>{inFlight--;});
    try{
      // A missing or stuck Redis response MUST NOT leave operator requests
      // pending indefinitely. No fallback token/session is permitted.
      value=await Promise.race([
        lookup,
        new Promise(resolve=>{
          timeout=setTimeout(()=>resolve(null),lookupTimeoutMs);
        })
      ]);
    }catch{return false;}
    finally{
      if(timeout!==undefined)clearTimeout(timeout);
    }
    // A lookup may cross the JWT expiry boundary even if it started before
    // expiry. Re-check against the clock after I/O, never trust only 'now'
    // captured before awaiting an externally controlled Redis response.
    let afterLookup;
    try{afterLookup=Math.floor(clock()/1000);}catch{return false;}
    if(!Number.isSafeInteger(afterLookup)||afterLookup<1||
       assertion.expiresAt<=afterLookup)return false;
    if(typeof value!=='string'||Buffer.byteLength(value,'utf8')>2048)return false;
    let record;
    try{record=parseJson(value,2048);}catch{return false;}
    if(!strictObject(record)||record.schema!==SESSION_SCHEMA||
       record.status!=='active'||record.issuer!==assertion.issuer||
       record.subject!==assertion.subject||
       record.workspaceId!==assertion.workspaceId||
       record.role!==assertion.role||
       record.sessionId!==assertion.sessionId||
       !Number.isSafeInteger(record.expiresAt)||
       record.expiresAt<assertion.expiresAt||
       record.expiresAt<=afterLookup)return false;
    return true;
  };
}
module.exports={createWpmlRedisSessionCheck,SESSION_SCHEMA};
