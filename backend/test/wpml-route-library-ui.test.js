'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const planner=require('../../frontend/public/wpml-editor-core');
const library=require('../../frontend/public/wpml-route-library-core');
const actions=require('../../frontend/public/wpml-action-draft');
const backup=require('../../frontend/public/wpml-route-library-backup');
const script=fs.readFileSync(path.join(__dirname,
  '../../frontend/public/wpml-route-library.js'),'utf8');
const STORAGE='skyhub.wpml.local-route-library.v1';
function plan(){
  return {name:'Private waypoint mission',model:'matrice4t',speed:5,
    takeoffHeight:30,finishAction:'goHome',timestamp:1792573200000,
    waypoints:[{lat:49.12,lon:8.61,height:50,photo:false},
      {lat:49.13,lon:8.62,height:50,photo:false},
      {lat:49.14,lon:8.63,height:50,photo:false}]};
}
function harness(input=plan()){
  const saved=library.save(library.blank(),{name:input.name,plan:input,
    savedAt:1792573200000});
  const store=new Map([[STORAGE,library.serialize(saved.library)]]);
  const nodes=new Map();
  let writes=0,confirms=0,allow=true;
  function make(tag='div'){
    return {tag,textContent:'',value:'',style:{},children:[],listeners:{},
      appendChild(c){this.children.push(c);return c;},
      append(...items){this.children.push(...items);},
      replaceChildren(...items){this.children=items;},
      addEventListener(type,callback){this.listeners[type]=callback;},
      click(){this.listeners.click?.();}
    };
  }
  function get(id){
    if(!nodes.has(id))nodes.set(id,make('input'));
    return nodes.get(id);
  }
  get('route-name').value='Private waypoint mission';
  get('route-folder').value='Allgemein';
  get('model').value='matrice4t';
  get('speed').value='5';
  get('height').value='50';
  get('takeoff').value='30';
  get('finish').value='goHome';
  get('batch-indices').value='alle';
  get('batch-template').value='photo';
  get('batch-mode').value='replace';
  const window={
    SkyHubWpmlPlanner:planner,SkyHubWpmlRouteLibrary:library,
    SkyHubWpmlActionDraft:actions,SkyHubWpmlRouteBackup:backup,
    localStorage:{
      getItem:key=>store.get(key)??null,
      setItem(key,value){writes++;store.set(key,value);},
      removeItem:key=>store.delete(key)
    },
    confirm(){confirms++;return allow;}
  };
  const document={getElementById:get,createElement:make,body:make('body')};
  vm.runInNewContext(script,{window,document,console,Blob,URL,setTimeout},{timeout:2500});
  return {get,store,seed:saved,writes:()=>writes,confirms:()=>confirms,
    setConfirm(value){allow=value;},
    selectedRoute(){get('routes').children[0].children[0].click();},
    current(){return library.load(store.get(STORAGE));}
  };
}
test('selection alone cannot turn an unrelated current draft into selected route revision',()=>{
  const app=harness();assert.equal(app.writes(),0);
  app.selectedRoute();
  app.get('save').click();
  assert.equal(app.writes(),0);
  assert.equal(app.current().routes[0].revisions.length,1);
  assert.match(app.get('library-status').textContent,/Ausgewählte Route zuerst/);
});
test('batch templates require explicit save, emit ordered groups, and keep revision 1 immutable',()=>{
  const app=harness();app.selectedRoute();app.get('load').click();
  assert.equal(app.writes(),0);
  app.get('batch-indices').value='1,3';
  app.get('batch-template').value='hoverPhoto';
  app.get('batch-apply').click();
  assert.equal(app.get('groups').children.length,2);
  assert.equal(app.writes(),0);
  app.get('review').click();
  assert.match(app.get('status').textContent,/2 Action Groups/);
  app.get('save').click();
  assert.equal(app.writes(),1);
  assert.equal(app.current().routes[0].revisions.length,2);
  const old=library.find(app.current(),1,1).plan;
  const current=library.find(app.current(),1,2).plan;
  assert.ok(!old.actionGroups);
  assert.deepEqual(current.actionGroups.map(g=>g.index),[0,2]);
  assert.equal(planner.build(current).flightReady,false);
});
test('invalid batch selection and append overflow never partially mutate active groups',()=>{
  const app=harness();app.selectedRoute();app.get('load').click();
  app.get('batch-indices').value='1,1';
  app.get('batch-apply').click();
  assert.equal(app.get('groups').children.length,0);
  assert.match(app.get('status').textContent,/abgelehnt/);
  app.get('batch-indices').value='1';
  app.get('batch-template').value='photo';
  app.get('batch-apply').click();
  assert.equal(app.get('groups').children.length,1);
  app.get('batch-indices').value='1,7';
  app.get('batch-apply').click();
  assert.equal(app.get('groups').children.length,1);
  assert.equal(app.writes(),0);
});
test('route reversal requires confirmation and remaps group indexes without saving implicitly',()=>{
  const app=harness();app.selectedRoute();app.get('load').click();
  app.get('batch-indices').value='1';
  app.get('batch-apply').click();
  app.setConfirm(false);
  app.get('reverse').click();
  assert.equal(app.confirms(),1);
  assert.equal(app.writes(),0);
  app.setConfirm(true);
  app.get('reverse').click();
  assert.equal(app.confirms(),2);
  assert.match(app.get('status').textContent,/NEUE Sicht/);
  app.get('save').click();
  const current=library.find(app.current(),1,2).plan;
  assert.equal(current.waypoints[0].lat,49.14);
  assert.equal(current.actionGroups[0].index,2);
  assert.equal(planner.build(current).flightReady,false);
});
test('recording groups prohibit reversal even when a user would approve',()=>{
  const p=plan();
  p.actionGroups=[{index:0,actions:[{type:'startRecord'}]},
    {index:2,actions:[{type:'stopRecord'}]}];
  const app=harness(p);
  app.selectedRoute();app.get('load').click();
  app.get('reverse').click();
  assert.equal(app.confirms(),0);
  assert.equal(app.writes(),0);
  assert.match(app.get('status').textContent,/blockiert/);
});

test('route revision compare is redacted; restoring requires confirmation and appends history',()=>{
  const app=harness();
  app.selectedRoute();
  app.get('compare-revision').click();
  assert.match(app.get('revision-diff').textContent,/Positionsänderungen 0/);
  assert.doesNotMatch(app.get('revision-diff').textContent,/49\.12|8\.61|Private waypoint/);
  assert.equal(app.writes(),0);
  app.setConfirm(false);
  app.get('restore-revision').click();
  assert.equal(app.writes(),0);
  assert.equal(app.current().routes[0].revisions.length,1);
  app.setConfirm(true);
  app.get('restore-revision').click();
  assert.equal(app.writes(),1);
  assert.equal(app.current().routes[0].revisions.length,2);
  assert.deepEqual(library.find(app.current(),1,1).plan,
    library.find(app.current(),1,2).plan);
  // Restoring a version does not grant permission to save the old draft.
  app.get('save').click();
  assert.equal(app.writes(),1);
  assert.equal(app.current().routes[0].revisions.length,2);
});

test('backup preview remains uncommitted until explicit replacement confirmation',async()=>{
  const app=harness();
  const other=library.save(library.blank(),{
    name:'Private second route',plan:{...plan(),name:'Private second route'},savedAt:100
  });
  const json=backup.exportBackup(other.library).content;
  const input=app.get('backup-file');
  input.files=[{size:new TextEncoder().encode(json).length,text:async()=>json}];
  await input.listeners.change({currentTarget:input});
  assert.equal(app.writes(),0);
  assert.equal(app.get('backup-apply').disabled,false);
  assert.match(app.get('backup-preview').textContent,/1 Routen, 1 Revisionen/);
  assert.doesNotMatch(app.get('backup-preview').textContent,/Private second route|49\.12|8\.61/);
  app.setConfirm(false);
  app.get('backup-apply').click();
  assert.equal(app.writes(),0);
  app.setConfirm(true);
  app.get('backup-apply').click();
  assert.equal(app.writes(),1);
  assert.equal(app.current().routes[0].name,'Private second route');
  assert.equal(app.get('backup-apply').disabled,true);
  assert.match(app.get('library-status').textContent,/ersetzt/);
  assert.equal(app.current().routes[0].revisions[0].flightReady,false);
});
test('discarding a slow or corrupt backup never overwrites the current library',async()=>{
  const app=harness();
  let release;
  const file=app.get('backup-file');
  file.files=[{size:100,text:()=>new Promise(resolve=>{release=resolve;})}];
  const running=file.listeners.change({currentTarget:file});
  app.get('backup-discard').click();
  release(backup.exportBackup(app.current()).content);
  await running;
  assert.equal(app.get('backup-apply').disabled,true);
  assert.equal(app.writes(),0);
  assert.match(app.get('backup-preview').textContent,/verworfen/);
  file.files=[{size:40,text:async()=>'{invalid'}];
  await file.listeners.change({currentTarget:file});
  assert.equal(app.writes(),0);
  assert.equal(app.get('backup-apply').disabled,true);
  assert.match(app.get('backup-preview').textContent,/abgelehnt/);
  assert.equal(app.current().routes[0].revisions.length,1);
});
