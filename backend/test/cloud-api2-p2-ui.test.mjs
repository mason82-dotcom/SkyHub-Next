import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const base=new URL('../../frontend/public/',import.meta.url);
const html=readFileSync(new URL('cloud-api2.html',base),'utf8');
const css=readFileSync(new URL('cloud-api2-p2.css',base),'utf8');
const script=readFileSync(new URL('cloud-api2-p2-ui.mjs',base),'utf8');
test('P2 assets are wired and manual read-only P1 inspection remains',()=>{
  for(const asset of ['cloud-api2-p2.css','cloud-api2-p2-ui.mjs'])assert.ok(html.includes('/'+asset));
  for(const id of ['p2-language','p2-mock-banner','p2-provenance','p2-compare-title','inspectReadOnlyAdapter'])assert.ok(html.includes('id="'+id+'"'));
});
test('P2 has no transport, browser storage, credentials or device dispatch',()=>{
  assert.doesNotMatch(script,/\b(fetch|XMLHttpRequest|WebSocket|EventSource|localStorage|sessionStorage|postMessage|setInterval|setTimeout)\s*\(/);
  assert.doesNotMatch(script,/\b(MQTT|publish|dispatch|Authorization|password|token)\b/i);
  assert.match(script,/replaceChildren\(wrap/);
  assert.match(script,/textContent/);
});
test('P2 explicitly separates simulated DJI and SkyHub sources',()=>{
  for(const text of ['MOCK','128 demo','SkyHub-Next','no live','No automated cross-system'])assert.ok(script.includes(text));
});
test('P2 has responsive 900 and 520 breakpoints and visible keyboard focus',()=>{
  assert.match(css,/@media\(max-width:900px\)/);
  assert.match(css,/@media\(max-width:520px\)/);
  assert.match(css, /focus-visible/);
  assert.match(css, /overflow-x:auto/);
});
