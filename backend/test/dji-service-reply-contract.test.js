'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {parseServiceReply,correlateServiceReply,MAX_REPLY_BYTES,MAX_REPLY_AGE_MS,
  MAX_FUTURE_SKEW_MS}=require('../dji-service-reply-contract');

const now=1792670400000;
const topic='thing/product/RC-PRO-01/services_reply';
const ids={tid:'2b166c9c-1e03-4375-8924-019d06d647f7',bid:'e8513a6c-0dbb-4883-b750-b9eec7d4d330'};
function raw(data={result:0},other={}){
  return Buffer.from(JSON.stringify({...ids,timestamp:now,method:'some_method',data,...other}));
}
const expectation={gatewaySn:'RC-PRO-01',...ids,method:'some_method',sentAt:now-2000};

test('correlates completed reply to exact gateway, tid, bid and method',()=>{
  const reply=parseServiceReply(topic,raw(),{now});
  assert.deepEqual(correlateServiceReply(expectation,reply,{now}),{
    matched:true,terminal:true,success:true,status:null,result:0
  });
  assert.equal(Object.isFrozen(reply),true);
});

test('accepts replies without optional method and nested result codes',()=>{
  const reply=parseServiceReply(topic,raw({result:{code:0}}, {method:undefined}),{now});
  assert.equal(reply.method,null);
  assert.equal(correlateServiceReply(expectation,reply,{now}).success,true);
});

test('intermediate status must not complete a running task',()=>{
  const reply=parseServiceReply(topic,raw({result:0,status:'in_progress',progress:{percent:20}}),{now});
  assert.equal(reply.terminal,false);
  assert.equal(correlateServiceReply(expectation,reply,{now}).success,false);
  assert.equal(JSON.stringify(reply).includes('percent'),false);
});

test('DJI failure is terminal but never successful',()=>{
  const reply=parseServiceReply(topic,raw({result:2003,status:'failed'}),{now});
  assert.equal(correlateServiceReply(expectation,reply,{now}).terminal,true);
  assert.equal(correlateServiceReply(expectation,reply,{now}).success,false);
});

test('invalid, retained, stale, future and oversized envelopes fail closed',()=>{
  for(const input of [
    [topic,raw(),{retained:true,now}],
    ['thing/product/RC-PRO-01/services',raw(),{now}],
    ['thing/product/RC/EVIL/services_reply',raw(),{now}],
    [topic,Buffer.from('not json'),{now}],
    [topic,raw({}, {tid:'bad/id'}),{now}],
    [topic,raw({}, {gateway:'OTHER'}),{now}],
    [topic,raw({}, {timestamp:now-MAX_REPLY_AGE_MS-1}),{now}],
    [topic,raw({}, {timestamp:now+MAX_FUTURE_SKEW_MS+1}),{now}],
    [topic,raw({}, {timestamp:'1792670400000'}),{now}],
    [topic,raw({status:'success',result:0}),{now}],
    [topic,raw({secret:'should not be accepted'}),{now}],
    [topic,Buffer.alloc(MAX_REPLY_BYTES+1,0),{now}]
  ]) assert.throws(()=>parseServiceReply(...input),/Invalid DJI service reply/);
});

test('unexpected gateway, tid, bid, and method cannot resolve a request',()=>{
  for(const changed of [
    {gatewaySn:'RC-PRO-02'}, {tid:'other'}, {bid:'other'}, {method:'other_method'}
  ]){
    const reply={...parseServiceReply(topic,raw(),{now}),...changed};
    assert.equal(correlateServiceReply(expectation,reply,{now}).reason,'mismatch');
  }
});

test('expiration and replies pre-dating the request are rejected',()=>{
  const reply=parseServiceReply(topic,raw(),{now});
  assert.equal(correlateServiceReply(expectation,reply,{now:now+30000,ttlMs:10000}).reason,'expired');
  assert.equal(correlateServiceReply({...expectation,sentAt:now+40000},reply,{now:now+40000}).reason,'stale');
});

test('no secret or raw DJI data crosses the parser boundary',()=>{
  const reply=parseServiceReply(topic,raw({result:0,credentials:{access_key_secret:'PRIVATE'},
    fingerprint:'PRIVATE',output:{security_token:'PRIVATE'}}),{now});
  assert.deepEqual(Object.keys(reply),['gatewaySn','tid','bid','method','timestamp','status','result','terminal']);
  assert.equal(JSON.stringify(reply).includes('PRIVATE'),false);
});

test('correlation rejects invalid TTL and invalid pending metadata',()=>{
  const reply=parseServiceReply(topic,raw(),{now});
  assert.equal(correlateServiceReply(expectation,reply,{now,ttlMs:0}).reason,'invalid');
  assert.equal(correlateServiceReply({...expectation,sentAt:NaN},reply,{now}).reason,'invalid');
});
