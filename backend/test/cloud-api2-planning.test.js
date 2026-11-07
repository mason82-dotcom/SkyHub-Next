'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'../..');
const publicRoot=path.join(root,'frontend/public');
const read=name=>fs.readFileSync(path.join(publicRoot,name),'utf8');

function node(id,{tool,title,url}={}) {
  const attributes=new Map();
  const listeners=new Map();
  const classes=new Set();
  return {
    id,hidden:true,dataset:tool?{planningTool:tool}:{},
    href:'',textContent:'',contentDocument:{title:title??''},
    contentWindow:{location:{href:url??''},dispatchEvent(){}},
    setAttribute(k,v){attributes.set(k,String(v));},
    getAttribute(k){return attributes.has(k)?attributes.get(k):null;},
    addEventListener(k,fn){listeners.set(k,fn);},
    emit(k){const fn=listeners.get(k);if(fn)fn();},
    classList:{toggle(k,enabled){if(enabled)classes.add(k);else classes.delete(k);},contains(k){return classes.has(k);}}
  };
}
function fixture(){
  const origin='https://skyhub.example';
  const ids=['editor','area','library'];
  const buttons=ids.map(id=>node('button-'+id,{tool:id}));
  const frames=ids.map((id,i)=>node('planningFrame-'+id,{
    title:['Missionsentwurf · SkyHub','Vermessungsvorschau · SkyHub','Routenbibliothek · SkyHub'][i],
    url:origin+['/wpml-editor.html','/wpml-survey-preview.html','/wpml-route-library.html'][i],
  }));
  const status=node('planningStatus'),open=node('planningOpenFull'),empty=node('planningEmpty');
  empty.hidden=false;
  const all=[...frames,status,open,empty];
  const doc={
    location:{href:origin+'/cloud-api2.html#planning'},
    getElementById(id){return all.find(x=>x.id===id)??null;},
    querySelectorAll(selector){
      assert.equal(selector,'[data-planning-tool]');
      return buttons;
    }
  };
  return {doc,buttons,frames,status,open,empty};
}
test('planning workbench connects exactly three original SkyHub WPML tools',async()=>{
  const {PLANNING_TOOLS}=await import('../../frontend/public/cloud-api2-planning.mjs');
  assert.deepEqual(PLANNING_TOOLS.map(x=>x.id),['editor','area','library']);
  for(const x of PLANNING_TOOLS){
    assert.equal(x.flightReady,false);
    assert.equal(x.dispatchAllowed,false);
    assert.match(x.path,/^\/wpml-(?:editor|survey-preview|route-library)\.html$/);
    assert.ok(fs.existsSync(path.join(publicRoot,x.path.slice(1))),x.path);
    assert.match(x.state,/(ENTWURF|VORSCHAU)/);
  }
});
test('portal view exists with accessible selection, no auto-loading and explicit fallback',()=>{
  const html=read('cloud-api2.html'),js=read('cloud-api2.js');
  const css=read('cloud-api2-planning.css'),mod=read('cloud-api2-planning.mjs');
  assert.match(html,/data-view="planning"/);
  assert.match(html,/id="view-planning"/);
  assert.match(js,/['"]planning['"]/);
  assert.match(html,/cloud-api2-planning\.mjs/);
  assert.match(html,/cloud-api2-planning\.css/);
  assert.equal((html.match(/data-planning-tool="/g)||[]).length,3);
  assert.equal((html.match(/class="planning-frame"/g)||[]).length,3);
  assert.match(html,/id="planningStatus" role="status" aria-live="polite"/);
  assert.match(html,/id="planningOpenFull"/);
  assert.match(html,/referrerpolicy="strict-origin-when-cross-origin"/);
  for(const frame of [...html.matchAll(/<iframe[^>]+>/g)].map(m=>m[0])){
    assert.doesNotMatch(frame,/\ssrc\s*=/,'iframes must be loaded on operator click only');
  }
  assert.match(css,/@media\(max-width:920px\)/);
  assert.match(css,/@media\(max-width:580px\)/);
  assert.match(css,/focus-visible/);
  assert.doesNotMatch(mod,/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|postMessage|localStorage|sessionStorage)\s*\(/);
  assert.doesNotMatch(mod,/\b(?:mqtt|publish|dispatchFlight|sendCommand|missionDispatch)\s*\(/i);
});
test('explicit activation lazy-loads one approved tool, retains hidden workspace state',async()=>{
  const {initPlanningWorkspace}=await import('../../frontend/public/cloud-api2-planning.mjs');
  const {doc,buttons,frames,status,open,empty}=fixture();
  const ui=initPlanningWorkspace(doc);
  assert.ok(ui);
  assert.equal(ui.getActive(),null);
  assert.equal(empty.hidden,false); // placeholder remains until explicit choice
  for(const frame of frames)assert.equal(frame.getAttribute('src'),null);
  assert.equal(ui.activate('invalid-tool'),false);
  assert.equal(ui.getActive(),null);
  buttons[0].emit('click');
  assert.equal(empty.hidden,true);
  assert.equal(ui.getActive(),'editor');
  assert.equal(open.href,'/wpml-editor.html');
  assert.equal(frames[0].getAttribute('src'),'/wpml-editor.html');
  assert.equal(frames[1].getAttribute('src'),null);
  assert.match(status.textContent,/noch kein Ergebnis bestätigt/i);
  assert.equal(buttons[0].getAttribute('aria-pressed'),'true');
  assert.equal(buttons[1].getAttribute('aria-pressed'),'false');
  frames[0].emit('load');
  assert.match(status.textContent,/geladen/);
  buttons[1].emit('click');
  assert.equal(frames[0].hidden,true);
  assert.equal(frames[1].hidden,false);
  assert.equal(frames[0].getAttribute('src'),'/wpml-editor.html');
  assert.equal(frames[1].getAttribute('src'),'/wpml-survey-preview.html');
  assert.equal(open.href,'/wpml-survey-preview.html');
  // Late frame responses cannot overwrite the currently selected planner.
  frames[0].emit('error');
  assert.match(status.textContent,/wird geladen/);
  frames[1].emit('load');
  assert.match(status.textContent,/geladen/);
  buttons[0].emit('click');
  assert.match(status.textContent,/UNBEKANNT/, 'old frame error must not be promoted to success');
});
test('inactive iframe completion is tracked without modifying visible planning status',async()=>{
  const {initPlanningWorkspace}=await import('../../frontend/public/cloud-api2-planning.mjs');
  const v=fixture();const ui=initPlanningWorkspace(v.doc);
  ui.activate('editor');
  ui.activate('area');
  v.frames[0].emit('load');
  assert.match(v.status.textContent,/wird geladen/,'inactive event must not change visible state');
  ui.activate('editor');
  assert.match(v.status.textContent,/erneut geöffnet/,'hidden completed editor must be recognized');
  assert.equal(v.frames[0].getAttribute('src'),'/wpml-editor.html','revisiting must not reload editor');
});
test('inactive redirect and stale ready state cannot be presented as trusted',async()=>{
  const {initPlanningWorkspace}=await import('../../frontend/public/cloud-api2-planning.mjs');
  const v=fixture();const ui=initPlanningWorkspace(v.doc);
  ui.activate('editor');
  v.frames[0].emit('load');
  assert.match(v.status.textContent,/geladen/);
  ui.activate('area');
  v.frames[0].contentWindow.location.href='https://external.invalid/wpml-editor.html';
  v.frames[0].emit('load');
  assert.match(v.status.textContent,/wird geladen/,'hidden redirect must not replace active status');
  ui.activate('editor');
  assert.match(v.status.textContent,/UNBEKANNT/,'inactive redirect must fail closed');
  assert.equal(v.open.href,'/wpml-editor.html','fallback remains canonical');
});
test('reselection revalidates previously ready frame even if no load event is observed',async()=>{
  const {initPlanningWorkspace}=await import('../../frontend/public/cloud-api2-planning.mjs');
  const v=fixture();const ui=initPlanningWorkspace(v.doc);
  ui.activate('editor');
  v.frames[0].emit('load');
  ui.activate('library');
  v.frames[0].contentDocument.title='404 Not Found';
  ui.activate('editor');
  assert.match(v.status.textContent,/UNBEKANNT/);
});
test('unknown content, foreign URLs and errors fail closed to direct original module',async()=>{
  const {initPlanningWorkspace}=await import('../../frontend/public/cloud-api2-planning.mjs');
  const v=fixture();const ui=initPlanningWorkspace(v.doc);
  ui.activate('area');
  v.frames[1].contentDocument.title='404 Not Found';
  v.frames[1].emit('load');
  assert.match(v.status.textContent,/UNBEKANNT/);
  ui.activate('library');
  v.frames[2].contentWindow.location.href='https://external.invalid/wpml-route-library.html';
  v.frames[2].emit('load');
  assert.match(v.status.textContent,/UNBEKANNT/);
  assert.equal(v.open.href,'/wpml-route-library.html');
  ui.activate('editor');
  v.frames[0].emit('error');
  assert.match(v.status.textContent,/UNBEKANNT/);
});
