'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createPilotMediaRateLimiter,ACTION_LIMITS}=require('../pilot-media-rate-limit');

const WS='e3dea0f5-37f2-4d79-ae58-490af3228069';
const OTHER='203cc94c-aef1-4e0e-a520-05a24be33a31';
const PRINCIPAL={role:'pilot',workspaceId:WS};
const NOW=Date.parse('2026-10-22T15:00:00Z');
function redis(){
  const counters=new Map(),calls=[];
  return {status:'ready',counters,calls,
    async eval(script,count,key,ttl){
      calls.push({script,count,key,ttl});
      counters.set(key,(counters.get(key)??0)+1);
      return counters.get(key);
    }
  };
}
test('a per-action, per-workspace Redis window is atomic and bounded',async()=>{
  const r=redis(),allow=createPilotMediaRateLimiter(r,{clock:()=>NOW});
  const args={workspace:WS,principal:PRINCIPAL,operation:'group_upload_callback'};
  for(let i=0;i<ACTION_LIMITS.group_upload_callback;i++)
    assert.equal(await allow(args),true);
  assert.equal(await allow(args),false);
  assert.equal(r.calls.length,31);
  assert.ok(r.calls.every(v=>v.count===1&&v.ttl===120));
  assert.ok(r.calls.every(v=>v.key.includes(WS)&&
    !v.key.includes('private')&&!v.key.includes('TOKEN')));
  assert.match(r.calls[0].script,/redis\.call\('INCR'/);
});

test('each action gets its own bounded quota, and a subsequent minute resets the key',async()=>{
  const r=redis();let time=NOW;
  const allow=createPilotMediaRateLimiter(r,{clock:()=>time});
  const principal={role:'pilot',workspaceId:WS};
  const base={workspace:WS,principal};
  for(let i=0;i<60;i++)
    assert.equal(await allow({...base,operation:'tiny_fingerprints'}),true);
  assert.equal(await allow({...base,operation:'tiny_fingerprints'}),false);
  assert.equal(await allow({...base,operation:'fast_upload'}),true);
  time+=61000;
  assert.equal(await allow({...base,operation:'tiny_fingerprints'}),true);
  assert.equal(r.counters.size,3);
});

test('Redis outage or client-crafted principal cannot bypass rate limit',async()=>{
  const r=redis(),allow=createPilotMediaRateLimiter(r,{clock:()=>NOW});
  for(const input of [
    {workspace:OTHER,principal:PRINCIPAL,operation:'tiny_fingerprints'},
    {workspace:WS,principal:{role:'admin',workspaceId:WS},operation:'tiny_fingerprints'},
    {workspace:WS,principal:true,operation:'tiny_fingerprints'},
    {workspace:WS,principal:PRINCIPAL,operation:'arbitrary'}
  ])await assert.rejects(()=>allow(input));
  assert.equal(r.calls.length,0);
  r.status='reconnecting';
  await assert.rejects(()=>allow({workspace:WS,principal:PRINCIPAL,
    operation:'tiny_fingerprints'}),/unavailable/);
  assert.equal(r.calls.length,0);
});

test('corrupt/non-positive counters fail closed',async()=>{
  for(const value of [0,-1,'nope',NaN]){
    const allow=createPilotMediaRateLimiter({
      status:'ready',eval:async()=>value},{clock:()=>NOW});
    await assert.rejects(()=>allow({workspace:WS,principal:PRINCIPAL,
      operation:'tiny_fingerprints'}));
  }
});
