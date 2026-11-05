'use strict';
// Every SkyHub API router is mounted after the access check (app.use('/api',auth)); Pilot 2's device-token endpoints
// are registered by registerPilotRoutes (app.get/app.post) and are the only intended exception.
// Regression: /api/map-elements and /api/pilot-logs were once mounted before the check (05.11.2026).
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('no app.use("/api/…") router before the SkyHub access check',()=>{
  const src=fs.readFileSync(path.resolve(__dirname,'../server.js'),'utf8');
  const authAt=src.indexOf("app.use('/api',auth)");
  assert.ok(authAt>0,'access check mounted');
  const early=[...src.slice(0,authAt).matchAll(/app\.use\(\s*['"`](\/api\/[^'"`]+)['"`]/g)].map(m=>m[1]);
  assert.deepEqual(early,[],'mounted before the access check: '+early.join(', '));
});
