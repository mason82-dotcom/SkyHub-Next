'use strict';

// Atomic workspace/action rate limiter for the opt-in DJI Pilot 2 media API.
// No personal token, serial or request-specific identifier is stored in Redis.
const {workspaceId}=require('./media-upload-contract');
const ACTION_LIMITS=Object.freeze({
  tiny_fingerprints:60,
  fast_upload:120,
  upload_callback:120,
  group_upload_callback:30,
  library_list:60,
  library_detail:120,
  library_m3m_group:30
});
const LUA=String.raw`local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1]))
end
return count`;
function createPilotMediaRateLimiter(redis,{clock=()=>Date.now()}={}){
  if(!redis||typeof redis.eval!=='function'||typeof clock!=='function')
    throw new TypeError('Dedicated Redis rate limiter required');
  return async function allowRequest({workspace,principal,operation}={}){
    if(!workspaceId(workspace)||!principal||
      principal.workspaceId!==workspace||
      !Object.prototype.hasOwnProperty.call(ACTION_LIMITS,operation)||
      !(operation.startsWith('library_')?
        ['pilot','operator'].includes(principal.role):principal.role==='pilot'))
      throw new TypeError('Invalid Pilot media rate limit scope');
    if(redis.status!=='ready')throw new Error('Rate limiter unavailable');
    const time=clock();
    if(!Number.isSafeInteger(time)||time<1e12)
      throw new TypeError('Invalid rate limiter clock');
    const epochMinute=Math.floor(time/60000);
    const key='skyhub:pilot2:media:limit:'+workspace+':'+operation+':'+epochMinute;
    // The single Lua execution atomically initializes TTL and increments.
    const count=await redis.eval(LUA,1,key,120);
    if(!Number.isSafeInteger(Number(count))||Number(count)<1)
      throw new Error('Invalid Redis rate limit counter');
    return Number(count)<=ACTION_LIMITS[operation];
  };
}
module.exports={createPilotMediaRateLimiter,ACTION_LIMITS};
