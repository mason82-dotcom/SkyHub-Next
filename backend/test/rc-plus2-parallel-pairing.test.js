'use strict';
// Confirm that SkyHub supports two independently paired Pilot 2 controllers.
// This is an offline contract test; it does not create a DJI user account.
const test=require('node:test');
const assert=require('node:assert/strict');
const {createPilotPairing,deviceModel}=require('../pilot-pairing');

function store(){
  const entries=new Map();
  return {
    get:async key=>entries.get(key)??null,
    set:async(key,value)=>{entries.set(key,value);},
    del:async key=>{entries.delete(key);},
    all:async()=>Object.fromEntries(entries),
    serialized:()=>JSON.stringify([...entries])
  };
}
const proUA='Mozilla/5.0 (Linux; Android 10; DJI RC Pro Enterprise Build/V1; wv)';
const plus2UA='Mozilla/5.0 (Linux; Android 12; DJI RC Plus 2 Enterprise Build/V1; wv)';
const workspaceId='e3dea0f5-37f2-4d79-ae58-490af3228069';

test('RC Plus 2 can pair in an existing workspace alongside RC Pro',async()=>{
  const persistence=store();
  const pairing=createPilotPairing({store:persistence,workspaceId});
  assert.equal(deviceModel(plus2UA),'DJI RC Plus 2 Enterprise');
  const pro=pairing.start(proUA,100,'old-rc-browser');
  const plus=pairing.start(plus2UA,101,'new-rc-browser');
  assert.notEqual(pro.pairingId,plus.pairingId);
  assert.notEqual(pro.code,plus.code);
  assert.equal(pairing.approve(pro.code,150),true);
  assert.equal(pairing.approve(plus.code,151),true);
  const proToken=(await pairing.poll(pro.pairingId,200)).deviceToken;
  const plusToken=(await pairing.poll(plus.pairingId,201)).deviceToken;
  assert.match(proToken,/^[0-9a-f]{64}$/);
  assert.match(plusToken,/^[0-9a-f]{64}$/);
  assert.notEqual(proToken,plusToken);
  const proDevice=await pairing.verify(proToken,250);
  const plusDevice=await pairing.verify(plusToken,251);
  assert.equal(proDevice.model,'DJI RC Pro Enterprise');
  assert.equal(plusDevice.model,'DJI RC Plus 2 Enterprise');
  assert.equal(proDevice.workspaceId,workspaceId);
  assert.equal(plusDevice.workspaceId,workspaceId);
  assert.equal((await pairing.devices()).length,2);
  assert.ok(!persistence.serialized().includes(proToken));
  assert.ok(!persistence.serialized().includes(plusToken));

  // Revoking only the new RC must never invalidate the previously paired RC.
  assert.equal(await pairing.revoke(plusDevice.id),true);
  assert.equal(await pairing.verify(plusToken,300),null);
  assert.ok(await pairing.verify(proToken,301));
  assert.equal((await pairing.devices()).length,1);
});
