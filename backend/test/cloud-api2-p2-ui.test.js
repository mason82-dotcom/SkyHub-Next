'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const base=path.resolve(__dirname,'../../frontend/public');
const html=readFileSync(path.join(base,'cloud-api2.html'),'utf8');
const css=readFileSync(path.join(base,'cloud-api2-p2.css'),'utf8');
const script=readFileSync(path.join(base,'cloud-api2-p2-ui.mjs'),'utf8');

test('P2 assets are wired and manual read-only P1 inspection remains',()=>{
  for(const asset of ['cloud-api2-p2.css','cloud-api2-p2-ui.mjs'])assert.ok(html.includes('/'+asset));
  for(const id of ['p2-language','p2-mock-banner','p2-provenance','p2-compare-title','inspectReadOnlyAdapter'])
    assert.ok(html.includes('id="'+id+'"'),id);
});
test('P2 has no transport, browser storage, credentials or device dispatch',()=>{
  assert.doesNotMatch(script,/\b(fetch|XMLHttpRequest|WebSocket|EventSource|localStorage|sessionStorage|postMessage|setInterval|setTimeout)\s*\(/);
  // Inspect executable call patterns, not legitimate warning words in UI copy.
  assert.doesNotMatch(script,/\b(MQTT|publish|dispatch|sendFlightCommand|sendDeviceCommand)\s*\(/i);
  assert.doesNotMatch(script,/\b(Authorization|password|token)\s*:/i);
  assert.match(script,/replaceChildren\(wrap/);
  assert.match(script,/textContent/);
});
test('P2 explicitly separates simulated DJI and SkyHub sources',()=>{
  for(const phrase of ['MOCK','128 demo','SkyHub-Next','no live','No automated cross-system'])
    assert.ok(script.includes(phrase),phrase);
});
test('P2 has responsive 900 and 520 breakpoints and keyboard focus',()=>{
  assert.match(css,/@media\(max-width:900px\)/);
  assert.match(css,/@media\(max-width:520px\)/);
  assert.match(css,/focus-visible/);
  assert.match(css,/overflow-x:auto/);
});
test('partial localization switches only P2 content and leaves German portal language intact',()=>{
  function element(tag='div'){
    return {
      tag,textContent:'',lang:'',value:'',children:[],attributes:{},listeners:{},
      append(...items){this.children.push(...items);},
      replaceChildren(...items){this.children=items;},
      setAttribute(name,value){this.attributes[name]=value;},
      getAttribute(name){return this.attributes[name]??null;},
      addEventListener(name,fn){this.listeners[name]=fn;}
    };
  }
  const ids=['p2-provenance','p2-language','p2-mock-banner','p2-compare-title','p2-compare-intro','p2-compare-status'];
  const nodes=Object.fromEntries(ids.map(id=>[id,element()]));
  const nav=element('button');
  nav.attributes['data-p2-nav']='devices';
  const doc={
    documentElement:{lang:'de'},
    getElementById(id){return nodes[id]??null;},
    createElement:element,
    querySelectorAll(selector){assert.equal(selector,'[data-p2-nav]');return [nav];}
  };
  const executable=script.replace('export function renderP2(locale)', 'function renderP2(locale)');
  assert.notEqual(executable,script,'P2 render export is required');
  vm.runInNewContext(executable,{document:doc,location:{search:'?lang=en'},URLSearchParams},
    {timeout:2000,filename:'cloud-api2-p2-ui.mjs'});
  const root=nodes['p2-provenance'],chooser=nodes['p2-language'];
  assert.equal(doc.documentElement.lang,'de','untranslated portal must remain correctly marked German');
  assert.equal(root.lang,'en');
  assert.equal(nodes['p2-mock-banner'].lang,'en');
  assert.match(nodes['p2-mock-banner'].textContent,/MOCK.*no live/i);
  assert.equal(nav.textContent,'Devices');
  assert.equal(chooser.value,'en');
  assert.equal(root.children[0].children[0].tag,'table');
  assert.equal(root.children[0].children[0].children[0].tag,'caption');
  assert.equal(root.children[0].attributes['aria-label'],'Data provenance & comparison');
  chooser.value='de';
  chooser.listeners.change();
  assert.equal(doc.documentElement.lang,'de');
  assert.equal(root.lang,'de');
  assert.equal(nav.textContent,'Geräte');
  assert.equal(chooser.value,'de');
  assert.match(nodes['p2-mock-banner'].textContent,/keine Live-Geräte/);
  assert.equal(root.children.length,2,'table and disclaimer must be replaced, not stacked');
});
