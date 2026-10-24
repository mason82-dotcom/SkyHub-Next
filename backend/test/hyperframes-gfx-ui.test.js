'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'../../frontend/public');
const pages=['index.html','smart-farming.html','wpml-editor.html','wpml-route-library.html','wpml-survey-preview.html'];

test('GFX stylesheet and controller are present on every intended product page',()=>{
  for(const page of pages){
    const html=fs.readFileSync(path.join(root,page),'utf8');
    assert.match(html,/<body class="skyhub-gfx gfx-page-/);
    assert.match(html,/<link rel="stylesheet" href="\/hyperframes-gfx\.css">/);
    assert.match(html,/<script src="\/hyperframes-gfx\.js" defer><\/script>/);
    assert.match(html,/<button id="gfxMotionToggle"[^>]+aria-pressed="false"/);
    assert.equal((html.match(/id="gfxMotionToggle"/g)||[]).length,1);
  }
});

test('GFX is visual-only, motion is optional and Leaflet pointer events remain untouched',()=>{
  const css=fs.readFileSync(path.join(root,'hyperframes-gfx.css'),'utf8');
  const js=fs.readFileSync(path.join(root,'hyperframes-gfx.js'),'utf8');
  assert.match(css,/body\.skyhub-gfx/);
  assert.match(css,/prefers-reduced-motion: reduce/);
  assert.match(css,/forced-colors: active/);
  assert.match(css,/pointer-events: none/);
  assert.match(js,/matchMedia\('\(prefers-reduced-motion: reduce\)'\)/);
  assert.doesNotMatch(js,/\b(?:fetch|XMLHttpRequest|localStorage|sessionStorage|WebSocket|io\()\b/);
  assert.doesNotMatch(css,/pointer-events:\s*auto/);
});

test('Dashboard critical controls and warnings remain in place',()=>{
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  for(const id of ['map','token','connect','tabOperations','tabTak','showTrack','deviceSearch','deviceFilter','mapNote','healthSummary','eventsList']){
    assert.ok(html.includes('id="'+id+'"'),id);
  }
  assert.match(html,/Lesende Ansicht · keine Flugsteuerung/);
  assert.match(html,/TAK-Backend nicht integriert · Export AUS/);
});


const gfx=require('../../frontend/public/hyperframes-gfx.js');

function makeNode(tagName='div'){
  const attributes=new Map();
  const callbacks=new Map();
  const classes=new Set();
  return {
    tagName:tagName.toUpperCase(),children:[],hidden:false,disabled:false,
    attributes,callbacks,classes,
    classList:{
      contains:name=>classes.has(name),
      add:name=>classes.add(name),
      toggle:name=>{if(classes.has(name)){classes.delete(name);return false;}classes.add(name);return true;}
    },
    setAttribute(name,value){attributes.set(name,String(value));},
    getAttribute(name){return attributes.get(name)||null;},
    appendChild(child){this.children.push(child);return child;},
    addEventListener(name,callback){callbacks.set(name,callback);},
    click(){callbacks.get('click')?.();},
    focus(){this.focused=true;}
  };
}

function makeHarness({pathName='/',reduced=false,forcedColors=false}={}){
  const body=makeNode('body');
  body.classList.add('skyhub-gfx');
  body.dataset={};
  const header=makeNode('header');
  let legacyRemoved=false;
  header.querySelector=selector=>selector==='nav'?{remove(){legacyRemoved=true;}}:null;
  let inserted=null;
  header.insertAdjacentElement=(position,node)=>{inserted={position,node};};
  const motionButton=makeNode('button');
  const mapButton=makeNode('button');
  mapButton.hidden=true;
  const search=makeNode('input');
  const panel=makeNode('div');
  let keyListener=null;
  const doc={
    body,
    createElement:makeNode,
    querySelector:selector=>selector==='header'?header:null,
    getElementById:id=>({
      gfxMotionToggle:motionButton,gfxMapFocus:mapButton,
      deviceSearch:search,operationsPanel:panel
    })[id]||null,
    addEventListener:(type,fn)=>{if(type==='keydown')keyListener=fn;}
  };
  const reducedMedia={matches:reduced,addEventListener(_,callback){this.onChange=callback;}};
  const forcedMedia={matches:forcedColors,addEventListener(_,callback){this.onChange=callback;}};
  let resizeCount=0;
  const win={
    location:{pathname:pathName},
    matchMedia:query=>query.includes('reduced-motion')?reducedMedia:forcedMedia,
    requestAnimationFrame:fn=>fn(),
    dispatchEvent:()=>{resizeCount++;},
    Event:class Event{constructor(name){this.type=name;}}
  };
  gfx.init(doc,win);
  return {
    body,motionButton,mapButton,search,panel,inserted,keyListener,
    legacyRemoved:()=>legacyRemoved,reducedMedia,forcedMedia,resizeCount:()=>resizeCount
  };
}

test('shared GFX module rail has five fixed internal links and correct active route',()=>{
  const h=makeHarness({pathName:'/wpml-editor.html'});
  assert.equal(gfx.ROUTES.length,5);
  assert.ok(h.body.classList.contains('gfx-has-module-rail'));
  assert.equal(h.legacyRemoved(),true,'legacy module links are removed only after enhancement');
  assert.equal(h.inserted.position,'afterend');
  assert.equal(h.inserted.node.getAttribute('aria-label'),'SkyHub Modulnavigation');
  const links=h.inserted.node.children[1].children;
  assert.equal(links.length,5);
  assert.equal(links.filter(n=>n.getAttribute('aria-current')==='page').length,1);
  assert.equal(links[2].getAttribute('aria-current'),'page');
  for(const link of links)assert.match(link.getAttribute('href'),/^\/(?:[a-z0-9-]+\.html)?$/);
});

test('motion control respects system reduced-motion and forced-colors changes',()=>{
  const h=makeHarness();
  assert.equal(h.body.dataset.gfxMotion,'on');
  assert.equal(h.motionButton.hidden,false,'motion control becomes usable only with JS');
  h.motionButton.click();
  assert.equal(h.body.dataset.gfxMotion,'off');
  assert.equal(h.motionButton.getAttribute('aria-pressed'),'false');
  h.reducedMedia.matches=true;
  h.reducedMedia.onChange();
  assert.equal(h.motionButton.disabled,true);
  assert.equal(h.motionButton.textContent,'GFX · REDUZIERT');
  h.reducedMedia.matches=false;
  h.reducedMedia.onChange();
  assert.equal(h.body.dataset.gfxMotion,'off','explicit prior user choice retained');
  h.forcedMedia.matches=true;
  h.forcedMedia.onChange();
  assert.equal(h.body.dataset.gfxMotion,'off');
});

test('map focus only changes layout and requests Leaflet resize',()=>{
  const h=makeHarness();
  assert.equal(h.mapButton.hidden,false);
  h.mapButton.click();
  assert.equal(h.body.classList.contains('gfx-map-focus'),true);
  assert.equal(h.mapButton.getAttribute('aria-pressed'),'true');
  assert.equal(h.resizeCount(),1);
  h.mapButton.click();
  assert.equal(h.body.classList.contains('gfx-map-focus'),false);
  assert.equal(h.resizeCount(),2);
});

test('slash search shortcut ignores editable elements and inactive Operations',()=>{
  const h=makeHarness();
  let prevented=false;
  const keyboard=(target)=>h.keyListener({
    key:'/',target,defaultPrevented:false,ctrlKey:false,altKey:false,metaKey:false,shiftKey:false,
    preventDefault(){prevented=true;}
  });
  keyboard({tagName:'INPUT'});
  assert.equal(prevented,false);
  keyboard({tagName:'DIV'});
  assert.equal(prevented,true);
  assert.equal(h.search.focused,true);
  prevented=false;
  h.panel.hidden=true;
  keyboard({tagName:'DIV'});
  assert.equal(prevented,false);
});

test('all GFX pages support keyboard skip links and fixed readable labels',()=>{
  const targets=['skyhubMain','gfxMain','gfxMain','gfxMain','gfxMain'];
  for(let i=0;i<pages.length;i++){
    const html=fs.readFileSync(path.join(root,pages[i]),'utf8');
    assert.ok(html.includes('class="gfx-skip" href="#'+targets[i]+'"'));
    assert.ok(html.includes('id="'+targets[i]+'"'));
  }
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  assert.match(html,/id="gfxMapFocus"[^>]+aria-pressed="false"/);
  assert.match(html,/class="gfx-map-caption" aria-hidden="true"/);
  assert.match(html,/Zuletzt gemeldete Positionen · keine Flugsteuerung/);
});
