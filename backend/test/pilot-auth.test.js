'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createPilotAuth}=require('../pilot-auth');

// Bootstrap decision for Pilot 2 (05.11.2026): devices paired before the workspace binding must pair again.
const WS='123e4567-e89b-42d3-a456-426614174000';
const OPERATOR='operator-token-abcdefghijklmnopqrstuvwxyz';
const TOKENS={['a'.repeat(64)]:{id:'aaaaaaaaaaaa',workspaceId:WS},['b'.repeat(64)]:{id:'bbbbbbbbbbbb'},
  ['c'.repeat(64)]:{id:'cccccccccccc',workspaceId:'00000000-0000-4000-8000-000000000000'}};
function make(status='ready'){
  return createPilotAuth({pilot:{accessToken:OPERATOR,workspaceId:WS},redis:{status},
    pairing:{verify:async t=>TOKENS[t]||null}});
}

test('bootstrapAccess: bound device and operator ok, legacy device repair, everything else denied',async()=>{
  const auth=make();
  assert.equal(await auth.bootstrapAccess(OPERATOR),'ok');
  assert.equal(await auth.bootstrapAccess('a'.repeat(64)),'ok');
  assert.equal(await auth.bootstrapAccess('b'.repeat(64)),'repair');     // paired before the workspace binding
  assert.equal(await auth.bootstrapAccess('c'.repeat(64)),'repair');     // bound to another workspace: no data access either
  assert.equal(await auth.bootstrapAccess('d'.repeat(64)),'denied');
  assert.equal(await auth.bootstrapAccess(''),'denied');
  assert.equal(await auth.bootstrapAccess(undefined),'denied');
});

test('bootstrapAccess: without Redis a device token is denied (no repair loop), the operator token still works',async()=>{
  const auth=make('connecting');
  assert.equal(await auth.bootstrapAccess('b'.repeat(64)),'denied');
  assert.equal(await auth.bootstrapAccess(OPERATOR),'ok');
});
