'use strict';
// Keine Dock-Hardware vor Ort: die Oberfläche blendet Docks und Dock-Fluggeräte aus, das Backend bleibt unverändert.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const html=fs.readFileSync(path.join(__dirname,'../../frontend/public/index.html'),'utf8');
const start=html.indexOf('const DOCK_AIRCRAFT_TYPES');
const end=html.indexOf('function putDevice');
assert.ok(start>0&&end>start,'Filter im Dashboard gefunden');
const context={};
vm.runInNewContext(html.slice(start,end)+';this.shownDevice=shownDevice;',context);
const shown=d=>context.shownDevice(d);

test('docks and dock-only aircraft are hidden, RC-flown aircraft and controllers stay visible',()=>{
  assert.equal(shown({sn:'d',model:{domain:'3',type:2,subType:0}}),false);          // DJI Dock 2
  assert.equal(shown({sn:'d',model:{domain:3,type:3,subType:0}}),false);            // Domäne als Zahl
  assert.equal(shown({sn:'a',model:{domain:'0',type:91,subType:1}}),false);         // Matrice 3TD
  assert.equal(shown({sn:'a',model:{domain:'0',type:100,subType:0}}),false);        // Matrice 4D
  assert.equal(shown({sn:'a',model:{domain:'0',type:77,subType:2}}),true);          // Mavic 3M
  assert.equal(shown({sn:'a',model:{domain:'0',type:99,subType:1}}),true);          // Matrice 4T
  assert.equal(shown({sn:'r',model:{domain:'2',type:174,subType:0}}),true);         // RC Plus 2
  assert.equal(shown({sn:'u',model:{domain:null,type:null,subType:null}}),true);    // noch unbekannt
});

test('every device ingestion path goes through the filter',()=>{
  assert.equal((html.match(/records\.set\(d\.sn,d\)/g)||[]).length,1,'nur putDevice setzt direkt');
  assert.ok(/for\(const d of devices\)putDevice\(d\)/.test(html));
  assert.ok(/for\(const d of list\)putDevice\(d\)/.test(html));
  assert.ok(/device_update',d=>\{if\(socket!==current\)return;putDevice\(d\)/.test(html));
});
