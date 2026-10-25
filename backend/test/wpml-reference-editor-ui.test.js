'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const planner=require('../../frontend/public/wpml-editor-core');
const reference=require('../../frontend/public/wpml-waylines-reference');
const review=require('../../frontend/public/wpml-mission-review');

const script=fs.readFileSync(path.resolve(__dirname,'../../frontend/public/wpml-editor.js'),'utf8');
function sample(){
  return {name:'Externer Referenzentwurf',drone_model:77,payload_model:66,
    template_type:'waypoint',global_height:50,global_speed:5,
    waypoints:[{latitude:49.1,longitude:8.6,height:50},
      {latitude:49.2,longitude:8.7,height:50,actions:[{type:'takePhoto'}]}]};
}
function makeHarness(){
  const nodes=new Map();
  const make=()=>({
    value:'',textContent:'',checked:false,disabled:false,hidden:false,style:{},
    files:null,children:[],listeners:{},
    setAttribute(){},addEventListener(type,callback){this.listeners[type]=callback;},
    replaceChildren(...parts){this.children=[...parts];},
    appendChild(part){this.children.push(part);},
    append(...parts){this.children.push(...parts);},
    reportValidity(){return true;}
  });
  function get(id){
    if(!nodes.has(id))nodes.set(id,make());
    return nodes.get(id);
  }
  get('name').value='Bestehender Missionsentwurf';
  get('height').value='45';
  get('speed').value='4';
  get('takeoff').value='30';
  get('model').value='mavic3m';
  get('finish').value='goHome';
  get('photo-interval').value='12';
  get('photo-camera-min').value='';
  get('photo-trigger').value='reachPoint';
  get('latitude').value='49.5';
  get('longitude').value='8.5';
  let confirmResult=true,confirmCount=0;
  const window={
    SkyHubWpmlPlanner:planner,SkyHubWpmlWaylinesReference:reference,
    SkyHubWpmlMissionReview:review,
    confirm(){confirmCount++;return confirmResult;}
  };
  const document={getElementById:get,createElement:make,
    createTextNode:value=>({textContent:value})};
  vm.runInNewContext(script,{window,document,console},{timeout:1500});
  async function load(data,size){
    const input=get('waylines-reference-file');
    const content=typeof data==='string'?data:JSON.stringify(data);
    input.files=[{size:size===undefined?content.length:size,text:async()=>content}];
    await input.listeners.change({currentTarget:input});
  }
  return {get,load,setConfirm(value){confirmResult=value;},
    confirmations(){return confirmCount;}};
}
test('browser import stages preview without changing active route or fields',async()=>{
  const app=makeHarness();
  await app.load(sample());
  assert.equal(app.get('name').value,'Bestehender Missionsentwurf');
  assert.equal(app.get('model').value,'mavic3m');
  assert.equal(app.get('waypoints').children.length,0);
  assert.equal(app.get('waylines-reference-apply').disabled,false);
  assert.equal(app.get('waylines-reference-discard').disabled,false);
  assert.match(app.get('waylines-reference-preview').textContent,/2 Wegpunkte, 1 Fotoaktionen/);
  assert.match(app.get('waylines-reference-preview').textContent,/nicht semantisch äquivalent/);
  assert.doesNotMatch(app.get('waylines-reference-preview').textContent,/49\.1|8\.6/);
  assert.match(app.get('message').textContent,/unverändert/);
});
test('explicit apply replaces previewed draft but never enables dispatch',async()=>{
  const app=makeHarness();
  await app.load(sample());
  app.get('waylines-reference-apply').listeners.click();
  assert.equal(app.get('name').value,'Externer Referenzentwurf');
  assert.equal(app.get('model').value,'mavic3e');
  assert.equal(app.get('speed').value,'5');
  assert.equal(app.get('waypoints').children.length,2);
  assert.equal(app.get('waylines-reference-apply').disabled,true);
  assert.match(app.get('message').textContent,/Kein Flugauftrag/);
});
test('discard and malformed or oversized imports leave existing mission unchanged',async()=>{
  const app=makeHarness();
  await app.load(sample());
  app.get('waylines-reference-discard').listeners.click();
  assert.equal(app.get('waylines-reference-apply').disabled,true);
  app.get('waylines-reference-apply').listeners.click();
  assert.equal(app.get('name').value,'Bestehender Missionsentwurf');
  await app.load('{not valid json');
  assert.equal(app.get('waylines-reference-apply').disabled,true);
  assert.match(app.get('message').textContent,/Ungültiges Waylines-JSON/);
  await app.load(sample(),128*1024+1);
  assert.equal(app.get('waylines-reference-apply').disabled,true);
  assert.match(app.get('message').textContent,/128 KiB/);
  assert.equal(app.get('waypoints').children.length,0);
  assert.equal(app.get('model').value,'mavic3m');
});
test('duplicate JSON mission fields cannot shadow previously reviewed data',async()=>{
  const app=makeHarness();
  const duplicate='{"name":"Draft","name":"Override","drone_model":77}';
  await app.load(duplicate);
  assert.equal(app.get('name').value,'Bestehender Missionsentwurf');
  assert.equal(app.get('waylines-reference-apply').disabled,true);
  assert.match(app.get('waylines-reference-preview').textContent,/doppelter JSON-Schlüssel/);
  assert.equal(app.get('waypoints').children.length,0);
});
test('a pending slow file read cannot reactivate after discard',async()=>{
  const app=makeHarness();
  let resolveFile;
  const fileInput=app.get('waylines-reference-file');
  fileInput.files=[{size:100,text:()=>new Promise(resolve=>{resolveFile=resolve;})}];
  const pending=fileInput.listeners.change({currentTarget:fileInput});
  app.get('waylines-reference-discard').listeners.click();
  resolveFile(JSON.stringify(sample()));
  await pending;
  assert.equal(app.get('waylines-reference-apply').disabled,true);
  assert.match(app.get('waylines-reference-preview').textContent,/Import verworfen/);
  assert.equal(app.get('name').value,'Bestehender Missionsentwurf');
});
test('active route overwrite requires explicit confirmation',async()=>{
  const app=makeHarness();
  // Add an existing local point before importing an unrelated external mission.
  app.get('add').listeners.click();
  assert.equal(app.get('waypoints').children.length,1);
  await app.load(sample());
  app.setConfirm(false);
  app.get('waylines-reference-apply').listeners.click();
  assert.equal(app.confirmations(),1);
  assert.equal(app.get('waypoints').children.length,1);
  assert.equal(app.get('name').value,'Bestehender Missionsentwurf');
  assert.equal(app.get('waylines-reference-apply').disabled,false);
  app.setConfirm(true);
  app.get('waylines-reference-apply').listeners.click();
  assert.equal(app.confirmations(),2);
  assert.equal(app.get('waypoints').children.length,2);
  assert.equal(app.get('name').value,'Externer Referenzentwurf');
});
test('invalid Waylines schema never replaces an active draft',async()=>{
  const app=makeHarness();
  app.get('add').listeners.click();
  const unsupported=sample();
  unsupported.global_rth_height=120;
  await app.load(unsupported);
  assert.equal(app.get('waylines-reference-apply').disabled,true);
  assert.match(app.get('waylines-reference-preview').textContent,/nicht unterstütztes Feld/);
  assert.equal(app.get('name').value,'Bestehender Missionsentwurf');
  assert.equal(app.get('waypoints').children.length,1);
});

test('offline mission review updates after import and speed edits without leaking GPS',async()=>{
  const app=makeHarness();
  assert.match(app.get('mission-review').textContent,/UNVOLLSTÄNDIG/);
  await app.load(sample());
  // Staging must not mutate active route or its review.
  assert.match(app.get('mission-review').textContent,/UNVOLLSTÄNDIG/);
  app.get('waylines-reference-apply').listeners.click();
  const summary=app.get('mission-review').textContent;
  assert.match(summary,/2 Wegpunkte/);
  assert.match(summary,/2D-Luftliniensegmente/);
  assert.match(summary,/KEINE Flugfreigabe/);
  assert.doesNotMatch(summary,/49\.1|49\.2|8\.6|8\.7|Externer Referenzentwurf/);
  app.get('speed').value='0';
  app.get('speed').listeners.input();
  assert.match(app.get('mission-review').textContent,/EINGABEN PRÜFEN/);
  assert.match(app.get('mission-review').textContent,/Sollgeschwindigkeit/);
});
test('local-height input changes invalidate preview when measured ellipsoid is absent',async()=>{
  const app=makeHarness();
  await app.load(sample());
  app.get('waylines-reference-apply').listeners.click();
  app.get('local-heights').checked=true;
  app.get('local-heights').listeners.change();
  assert.match(app.get('mission-review').textContent,/EINGABEN PRÜFEN/);
  assert.match(app.get('mission-review').textContent,/WGS84-Ellipsoidhöhe/);
  assert.match(app.get('mission-review').textContent,/KEINE Flugfreigabe/);
});

test('live review catches unsafe takeoff and finish action changes',async()=>{
  const app=makeHarness();
  await app.load(sample());
  app.get('waylines-reference-apply').listeners.click();
  assert.match(app.get('mission-review').textContent,/ENTWURF/);
  app.get('takeoff').value='0';
  app.get('takeoff').listeners.input();
  assert.match(app.get('mission-review').textContent,/EINGABEN PRÜFEN/);
  assert.match(app.get('mission-review').textContent,/Sicherheitssteighöhe/);
  app.get('takeoff').value='30';
  app.get('takeoff').listeners.input();
  app.get('finish').value='autoLand';
  app.get('finish').listeners.change();
  assert.match(app.get('mission-review').textContent,/Abschlussaktion nicht unterstützt/);
  assert.match(app.get('mission-review').textContent,/KEINE Flugfreigabe/);
});
test('live review shows camera timing mismatch and unknown camera minimum',async()=>{
  const app=makeHarness();
  await app.load(sample());
  app.get('waylines-reference-apply').listeners.click();
  // Replacing per-point photo actions with periodic mode also clears photo flags.
  app.get('photo-trigger').value='multipleDistance';
  app.get('photo-trigger').listeners.change();
  assert.match(app.get('mission-review').textContent,/Kamera-Minimalintervall/);
  assert.match(app.get('mission-review').textContent,/ENTWURF/);
  app.get('photo-camera-min').value='4';
  app.get('photo-camera-min').listeners.input();
  assert.match(app.get('mission-review').textContent,/EINGABEN PRÜFEN/);
  assert.match(app.get('mission-review').textContent,/Fotoauslöseintervall/);
  app.get('photo-camera-min').value='1';
  app.get('photo-camera-min').listeners.input();
  assert.match(app.get('mission-review').textContent,/ENTWURF/);
  app.get('photo-interval').value='1e2';
  app.get('photo-interval').listeners.input();
  assert.match(app.get('mission-review').textContent,/Fotointervall außerhalb/);
});
