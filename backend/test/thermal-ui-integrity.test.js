'use strict';
// Actual application functions with a minimal DOM double. Real Chromium coverage is separate.
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const T=require('../../frontend/public/thermal-core');
function harness(){
  const downloads=[],elements=new Map(),blobs=new Map(),drawn=[],encoders=[];
  class Element{
    constructor(tag='div'){Object.assign(this,{tag,value:'',checked:false,children:[],listeners:{},dataset:{},style:{},textContent:'',hidden:false});}
    append(...nodes){this.children.push(...nodes);if(this.tag==='select'&&!this.value)this.value=nodes[0]?.value||'';}
    replaceChildren(...nodes){this.children=[];this.append(...nodes);}
    addEventListener(name,fn){(this.listeners[name]??=[]).push(fn);}
    async fire(name,args={}){for(const fn of this.listeners[name]||[])await fn(args);}
    setAttribute(k,v){this[k]=v;}removeAttribute(k){delete this[k];}remove(){}setPointerCapture(){}
    getBoundingClientRect(){return {left:0,top:0,width:this.width,height:this.height};}
    click(){if(this.tag==='a')downloads.push({name:this.download,blob:blobs.get(this.href)});}
  }
  function canvas(){const c=new Element('canvas');c.width=4;c.height=3;
    const ctx={clearRect(){},putImageData(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},strokeRect(){},setLineDash(){},fillRect(){},strokeText(){},
      fillText:(text)=>drawn.push({canvas:c,text}),measureText:text=>({width:text.length*7}),drawImage(){}};
    c.getContext=()=>ctx;c.toBlob=cb=>encoders.push(()=>cb(new Blob(['synthetic-png'])));return c;}
  const el=id=>{if(!elements.has(id))elements.set(id,['thermal','histogram'].includes(id)?canvas():new Element(['palette','series-select'].includes(id)?'select':'div'));return elements.get(id);};
  for(const id of ['auto-range','show-spots','show-visual'])el(id).checked=true;
  el('reflected').value='20';el('palette').value='iron';
  const source={version:'a'.repeat(64),width:4,height:3,emissivity:.95,sourceBytes:24,meta:{},estimate:T.ESTIMATE};
  // The real UI rejects unsupported frame dimensions, so use a supported synthetic frame.
  source.width=320;source.height=256;
  const raw=new Uint16Array(320*256).fill(20000);
  let hook,mode='ok',emissivity=.95,pending;
  const sandbox={window:{SkyhubThermal:T,addEventListener(){}},document:{getElementById:el,createElement:tag=>tag==='canvas'?canvas():new Element(tag),
    createElementNS:(_ns,tag)=>new Element(tag),querySelectorAll:()=>[],body:new Element()},
    ImageData:class{},Uint16Array,DataView,Blob,AbortController,AbortSignal,Map,URLSearchParams,location:{hash:''},history:{replaceState(){}},
    setTimeout:()=>1,clearTimeout(){},URL:{createObjectURL:b=>{const id='blob:'+blobs.size;blobs.set(id,b);return id;},revokeObjectURL(){}},
    fetch:async url=>{
      const u=new URL(url,'http://offline.invalid');
      if(mode==='fail')return {ok:false,status:422};
      if(mode==='slow'&&u.searchParams.get('key')==='slow')await new Promise(r=>pending=r);
      if(u.pathname.endsWith('/meta'))return {ok:true,json:async()=>({...source,emissivity})};
      return {ok:true,arrayBuffer:async()=>mode==='short'?new ArrayBuffer(2):raw.buffer,
        headers:{get:k=>({'X-Thermal-Version':source.version,'X-Thermal-Width':'320','X-Thermal-Height':'256'})[k]}};
    },capture:x=>hook=x};
  const app=fs.readFileSync(path.join(__dirname,'../../frontend/public/thermal-app.js'),'utf8');
  vm.runInNewContext(app.replace("window.addEventListener('DOMContentLoaded',start);","capture({state,open,start,exportPng,exportCsv,recompute,params});"),sandbox);
  const item=(key='a',bucket='bucket-a')=>({bucket,key,name:key+'_T.JPG'});
  return {hook,el,drawn,downloads,encoders,item,mode:v=>mode=v,emissivity:v=>emissivity=v,release:()=>pending?.(),source};
}

test('failed image load clears data and blocks both CSV and PNG exports',async()=>{
  const h=harness();await h.hook.open(h.item());assert.equal(h.hook.state.ready,true);
  h.mode('fail');await h.hook.open(h.item('b'));
  assert.equal(h.hook.state.frame,null);assert.equal(h.hook.state.temps,null);
  h.hook.exportCsv();h.hook.exportPng();assert.equal(h.downloads.length,0);assert.equal(h.encoders.length,0);
  assert.equal(h.el('export-png').disabled,true);
});

test('short raw frame fails closed despite matching version and dimension headers',async()=>{
  const h=harness();h.mode('short');await h.hook.open(h.item());
  assert.equal(h.hook.state.ready,false);assert.equal(h.hook.state.frame,null);
  assert.match(h.el('message').textContent,/nicht zur selben Bildversion/);
});

test('recompute updates measurement labels first; zero reflection and invalid-input recovery work',async()=>{
  const h=harness();await h.hook.open(h.item());
  h.hook.state.measurements.push({type:'spot',x:1,y:1});h.hook.recompute();h.drawn.length=0;
  h.el('eps').value='.85';h.el('reflected').value='0';h.hook.recompute();
  assert.equal(h.hook.params().reflected,0);
  const expected=T.format(h.hook.state.measurements[0].stats.mean);
  assert.ok(h.drawn.some(r=>r.canvas===h.el('thermal')&&r.text==='1: '+expected));
  h.el('eps').value='2';h.hook.recompute();assert.equal(h.hook.state.ready,false);
  h.el('eps').value='.85';h.hook.recompute();assert.equal(h.hook.state.ready,true);
});

test('PNG captures source filename before async encoding; CSV contains complete provenance',async()=>{
  const h=harness();await h.hook.open(h.item());h.hook.exportPng();
  await h.hook.open(h.item('b'));h.encoders[0]();
  assert.match(h.downloads[0].name,/^a_T_aaaaaaaaaaaa_iron\.png$/);
  assert.ok(h.drawn.some(r=>r.text.includes('Schätzung')));
  h.hook.exportCsv();const csv=await h.downloads[1].blob.text();
  assert.match(csv,/Datei;b_T.JPG/);assert.match(csv,/Quellversion SHA-256;a{64}/);
  assert.match(csv,/Software-\/Berechnungsstand;skyhub-thermal-estimate-v2/);assert.match(csv,/Emissionsgrad gewählt;0,95/);
});

test('measurements are scoped by bucket, key and source version; missing emissivity is explicit',async()=>{
  const h=harness();await h.hook.open(h.item());h.hook.state.measurements.push({type:'spot',x:0,y:0});
  await h.hook.open(h.item('a','bucket-b'));assert.equal(h.hook.state.measurements.length,0);
  await h.hook.open(h.item());assert.equal(h.hook.state.measurements.length,1);
  h.source.version='b'.repeat(64);h.emissivity(null);await h.hook.open(h.item());
  assert.equal(h.hook.state.measurements.length,0);assert.equal(h.hook.params().emissivityAssumed,true);
  h.hook.exportCsv();assert.match(await h.downloads[0].blob.text(),/Ausgangswert angenommen;ja/);
});

test('late completion of an older image request cannot replace current data',async()=>{
  const h=harness();h.mode('slow');const old=h.hook.open(h.item('slow'));
  await new Promise(r=>setImmediate(r));await h.hook.open(h.item('new'));
  h.release();await old;assert.equal(h.hook.state.current.key,'new');assert.equal(h.hook.state.ready,true);
});
