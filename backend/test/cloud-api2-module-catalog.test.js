'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'../..');
test('Cloud API 2 module catalog remains local navigation, without flight dispatch',async()=>{
  const {MODULES,SKILLS,VENDOR_SKILLS}=await import('../../frontend/public/cloud-api2-modules.mjs');
  assert.deepEqual(MODULES.map(m=>m.id),['mission','mapping','thermal']);
  assert.equal(new Set(MODULES.map(m=>m.href)).size,MODULES.length);
  for(const m of MODULES){
    assert.match(m.href,/^\/[a-z0-9-]+\.html$/);
    assert.doesNotMatch(m.href,/\b(drc|missionsfreigabe|pilot-login)\b/);
    assert.equal(m.flightReady,false);
    assert.equal(m.state,'BESTEHENDE SEITE');
    assert.ok(fs.existsSync(path.join(root,'frontend/public',m.href.slice(1))),m.href);
  }
  assert.ok(SKILLS.length>=4);
  assert.ok(SKILLS.every(s=>/^cloudapi2-[a-z-]+$/.test(s.id)));
  assert.match(VENDOR_SKILLS,/^https:\/\/github\.com\/dji-sdk\/Cloud-API-2\/tree\/main\/devkit\/skills$/);
});
test('portal module navigation distinguishes references from installed plugins',()=>{
  const html=fs.readFileSync(path.join(root,'frontend/public/cloud-api2.html'),'utf8');
  const js=fs.readFileSync(path.join(root,'frontend/public/cloud-api2.js'),'utf8');
  const skill=fs.readFileSync(path.join(root,'.agents/skills/skyhub-cloudapi2-keyless/SKILL.md'),'utf8');
  assert.match(html,/data-view="integrations"/);
  assert.match(html,/id="moduleCatalog"/);
  assert.match(html,/id="skillCatalog"/);
  assert.match(js,/cloud-api2-modules\.mjs/);
  assert.match(js,/renderIntegrations\(\)/);
  assert.match(html,/NICHT INSTALLIERT/);
  assert.match(skill,/not the DJI manufacturer plugin/i);
  assert.match(skill,/fh_\*/);
  for(const content of [html,js,skill]){
    assert.doesNotMatch(content,/mqtt\.publish\s*\(/i);
    assert.doesNotMatch(content,/drcSendStickControl/i);
  }
});
