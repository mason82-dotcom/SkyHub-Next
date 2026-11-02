'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {init}=require('../../frontend/public/workspace-tabs');

function harness(){
  const nodes={};
  const doc={activeElement:null,getElementById:id=>nodes[id]??null};
  for(const id of ['tabOperations','tabTak','operationsPanel','takPanel']){
    const listeners=new Map();
    nodes[id]={
      hidden:false,tabIndex:0,attrs:{},listeners,
      addEventListener:(event,fn)=>listeners.set(event,fn),
      setAttribute(name,value){this.attrs[name]=value;},
      focus(){doc.activeElement=this;},
      click(){this.listeners.get('click')?.();},
      keydown(key){let prevented=false;this.listeners.get('keydown')?.({key,preventDefault(){prevented=true;}});return prevented;}
    };
  }
  let resumes=0;
  const view=init({document:doc,onOperationsShown:()=>resumes++});
  return {nodes,doc,view,resumes:()=>resumes};
}
test('Operations is the initial selected panel and TAK is not displayed',()=>{
  const {nodes,view}=harness();
  assert.equal(view.active,'operations');
  assert.equal(nodes.operationsPanel.hidden,false);
  assert.equal(nodes.takPanel.hidden,true);
  assert.equal(nodes.tabOperations.attrs['aria-selected'],'true');
  assert.equal(nodes.tabTak.attrs['aria-selected'],'false');
  assert.equal(nodes.tabTak.tabIndex,-1);
});
test('Mouse click selects TAK without triggering Operations resume',()=>{
  const h=harness();
  h.nodes.tabTak.click();
  assert.equal(h.view.active,'tak');
  assert.equal(h.nodes.operationsPanel.hidden,true);
  assert.equal(h.nodes.takPanel.hidden,false);
  assert.equal(h.resumes(),1);
});
test('Returning to Operations notifies map layout exactly once',()=>{
  const h=harness();
  h.nodes.tabTak.click();
  h.nodes.tabOperations.click();
  h.nodes.tabOperations.click();
  assert.equal(h.view.active,'operations');
  assert.equal(h.resumes(),2);
});
test('Arrow keys and Home/End switch tabs and move keyboard focus',()=>{
  const h=harness();
  assert.equal(h.nodes.tabOperations.keydown('ArrowRight'),true);
  assert.equal(h.view.active,'tak');
  assert.equal(h.doc.activeElement,h.nodes.tabTak);
  assert.equal(h.nodes.tabTak.keydown('ArrowRight'),true);
  assert.equal(h.view.active,'operations');
  assert.equal(h.nodes.tabOperations.keydown('End'),true);
  assert.equal(h.view.active,'tak');
  assert.equal(h.nodes.tabTak.keydown('Home'),true);
  assert.equal(h.view.active,'operations');
  assert.equal(h.nodes.tabOperations.keydown('Tab'),false);
});
test('Invalid destinations and missing markup fail safely',()=>{
  const h=harness();
  assert.equal(h.view.activate('export'),false);
  assert.equal(h.view.active,'operations');
  assert.throws(()=>init({document:{getElementById:()=>null}}),/markup missing/);
  assert.throws(()=>init({document:null}),/document required/);
});
test('Dashboard has two correctly linked accessible panels',()=>{
  const html=fs.readFileSync(path.resolve(__dirname,'../../frontend/public/index.html'),'utf8');
  for(const [tab,panel] of [['tabOperations','operationsPanel'],['tabTak','takPanel']]){
    assert.match(html,new RegExp('id="'+tab+'"[^>]*role="tab"[^>]*aria-controls="'+panel+'"'));
    assert.match(html,new RegExp('id="'+panel+'"[^>]*role="tabpanel"[^>]*aria-labelledby="'+tab+'"'));
  }
  assert.match(html,/<section id="takPanel"[^>]* hidden>/);
  assert.match(html,/<script src="\/workspace-tabs\.js"><\/script>\s*<script>/);
  assert.ok(html.includes('id="map"'));
  assert.ok(html.includes('id="devices"'));
});
test('TAK placeholder has no export control, access tokens or service calls',()=>{
  const html=fs.readFileSync(path.resolve(__dirname,'../../frontend/public/index.html'),'utf8');
  const tak=html.split('<section id="takPanel"')[1].split('</section>')[0];
  assert.match(tak,/Aus · nicht integriert/);
  assert.match(tak,/Kein bestätigter Export/);
  assert.doesNotMatch(tak,/<button|<form|<script|fetch\(|mqtt|Authorization|password/i);
  const script=fs.readFileSync(path.resolve(__dirname,'../../frontend/public/workspace-tabs.js'),'utf8');
  assert.doesNotMatch(script,/fetch\(|localStorage|sessionStorage|WebSocket|\.publish\(/);
});

test('Exactly one semantic main landmark contains both tab panels',()=>{
  const html=fs.readFileSync(path.resolve(__dirname,'../../frontend/public/index.html'),'utf8');
  const mainOpens=[...html.matchAll(/<main(?:\s|>)/g)];
  const mainCloses=[...html.matchAll(/<\/main>/g)];
  assert.equal(mainOpens.length,1);
  assert.equal(mainCloses.length,1);
  const mainAnchor=/<main id="skyhubMain" tabindex="-1">/.exec(html);
  const start=mainAnchor?.index ?? -1;
  assert.ok(start>=0,'main landmark is focusable for keyboard skip navigation');
  const end=html.indexOf('</main>',start);
  assert.ok(end>start,'main landmark is closed');
  const body=html.slice(start,end);
  assert.ok(body.includes('id="operationsPanel"'),'Operations belongs inside main');
  assert.ok(body.includes('id="takPanel"'),'TAK belongs inside main');
  assert.ok(!html.slice(end).includes('id="takPanel"'),'TAK must not be outside main');
  assert.match(html,/#operationsPanel\{display:grid;grid-template-columns/);
  assert.match(html,/@media\(max-width:850px\)[^\n]+#operationsPanel\{grid-template-columns:1fr;height:auto\}/);
});
