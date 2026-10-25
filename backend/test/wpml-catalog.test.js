'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const catalog=require('../data/dji-wpml-fields.json');
test('complete DJI WPML English reference inventory with source provenance',()=>{
  assert.equal(catalog.count,250);
  assert.equal(catalog.fields.length,catalog.count);
  assert.equal(new Set(catalog.fields.map(r=>r.field)).size,160);
  assert.deepEqual(
    Object.fromEntries(catalog.provenance.map(p=>[p.file,catalog.fields.filter(r=>r.source===p.file).length])),
    {'20.template-kml.md':99,'30.waylines-wpml.md':22,'40.common-element.md':129});
  const keys=new Set();
  for(const entry of catalog.fields){
    assert.match(entry.field,/^wpml:[A-Za-z]\w*$/);
    assert.ok(entry.context&&entry.context.length<200);
    assert.ok(['yes','no','conditional','unspecified'].includes(entry.required));
    assert.ok(Number.isInteger(entry.line)&&entry.line>0);
    const key=entry.source+':'+entry.line;
    assert.ok(!keys.has(key),'duplicate documentation row '+key);
    keys.add(key);
  }
});
test('WPML inventory includes mission, mapping, wayline and camera semantics',()=>{
  const names=new Set(catalog.fields.map(e=>e.field));
  for(const name of ['wpml:droneEnumValue','wpml:payloadEnumValue',
    'wpml:templateId','wpml:waylineId','wpml:executeHeightMode',
    'wpml:globalTransitionalSpeed','wpml:waypointHeadingMode',
    'wpml:waypointTurnMode','wpml:actionActuatorFunc',
    'wpml:actionTriggerType']){
    assert.ok(names.has(name),name);
  }
  assert.ok(catalog.fields.some(x=>x.field==='wpml:templateId'&&x.source==='20.template-kml.md'));
  assert.ok(catalog.fields.some(x=>x.field==='wpml:templateId'&&x.source==='30.waylines-wpml.md'));
});
