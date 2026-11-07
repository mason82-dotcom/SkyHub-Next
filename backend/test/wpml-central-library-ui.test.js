'use strict';
// Planning tab: central route library UI (ADR-001). Client, helpers and wiring; the end-to-end
// browser flow (login state, create, conflict, copy to local, 375 px) is covered by tests/cloud_api2_planning_browser_smoke.py.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const lib=require('../../frontend/public/wpml-route-library-core');
const pub=path.resolve(__dirname,'../../frontend/public');
const mod=()=>import('../../frontend/public/wpml-central-library.mjs');

function fakeFetch(responses){
  const calls=[];
  const fetch=async(url,init)=>{
    calls.push({url,...init});
    const r=responses.shift();
    if(r instanceof Error)throw r;
    return {ok:r.status>=200&&r.status<300,status:r.status,json:async()=>{if(r.body===undefined)throw new Error('no json');return r.body;}};
  };
  return {fetch,calls};
}

test('client maps server answers to stable codes and never sends identity or workspace',async()=>{
  const {createCentralClient,CentralError}=await mod();
  const {fetch,calls}=fakeFetch([
    {status:404},                                   // feature switched off: plain 404 page
    {status:401,body:{error:'login_required'}},
    {status:409,body:{error:'conflict'}},
    new TypeError('offline'),
    {status:200,body:{routes:[{routeId:'r',name:'A',latestRevision:1}]}},
    {status:201,body:{revision:1}},
  ]);
  const c=createCentralClient({fetch});
  const code=async p=>{try{await p;return 'ok';}catch(e){assert.ok(e instanceof CentralError);return e.code;}};
  assert.equal(await code(c.me()),'disabled');
  assert.equal(await code(c.me()),'login_required');
  assert.equal(await code(c.append('r',1,{})),'conflict');
  assert.equal(await code(c.list()),'network');
  assert.deepEqual(await c.list(),[{routeId:'r',name:'A',latestRevision:1}]);
  await c.create('Feld',{name:'Feld'});
  const post=calls.at(-1);
  assert.equal(post.method,'POST');
  assert.equal(post.credentials,'same-origin');
  assert.equal(post.headers['content-type'],'application/json');
  assert.deepEqual(Object.keys(JSON.parse(post.body)).sort(),['name','plan']);
  assert.ok(calls.every(x=>x.url.startsWith('/wpml-central/')||x.url.startsWith('/wpml/oidc/')));
});

test('every error code has a blame-free message with a way forward',async()=>{
  const {errorMessage}=await mod();
  for(const c of ['login_required','invalid','not-found','conflict','capacity','origin','rate_limited','unavailable','network','x'])
    assert.match(errorMessage(c),/\.$/);
  assert.doesNotMatch(Object.values(['invalid','conflict']).map(errorMessage).join(' '),/du hast|falsch eingegeben|fehlerhaft/i);
  assert.match(errorMessage('unavailable'),/lokalen Routen sind davon nicht betroffen/);
});

test('search is case-insensitive, sorted by name, and local storage defects never overwrite data',async()=>{
  const {sortAndFilter,readLocalLibrary}=await mod();
  const rows=[{name:'zeta'},{name:'Äcker Nord'},{name:'acker süd'}];
  assert.deepEqual(sortAndFilter(rows,'').map(r=>r.name),['Äcker Nord','acker süd','zeta']);
  assert.deepEqual(sortAndFilter(rows,'SÜD').map(r=>r.name),['acker süd']);
  assert.equal(readLocalLibrary({getItem:()=>'{broken'},lib),null);
  assert.equal(readLocalLibrary({getItem:()=>{throw new Error('blocked');}},lib),null);
  assert.deepEqual(readLocalLibrary({getItem:()=>null},lib),lib.blank());
});

test('planning tab wires the central library as a framed list without flight or DJI paths',()=>{
  const html=fs.readFileSync(path.join(pub,'cloud-api2.html'),'utf8');
  const src=fs.readFileSync(path.join(pub,'wpml-central-library.mjs'),'utf8').replace(/^\s*\/\/.*$/gm,'');
  for(const id of ['centralLibrary','centralLogin','centralLogout','centralSource','centralUpload','centralSearch',
    'centralRows','centralStatus','centralCount','centralPrev','centralNext','centralReload'])
    assert.match(html,new RegExp(`id="${id}"`),id);
  assert.match(html,/<label for="centralSearch">Suche<\/label>/);
  assert.match(html,/id="centralStatus"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(html,/wpml-route-library-core\.js[\s\S]*wpml-central-library\.mjs/);
  // Names from the server only ever reach the DOM as text.
  assert.doesNotMatch(src,/innerHTML|insertAdjacentHTML|outerHTML|document\.write/);
  assert.doesNotMatch(src,/\b(?:mqtt|publish|dispatchFlight|sendCommand|missionDispatch|flighttask)\b/i);
  assert.doesNotMatch(src,/\/api\//);
  // The planning navigator itself stays network-free.
  assert.doesNotMatch(fs.readFileSync(path.join(pub,'cloud-api2-planning.mjs'),'utf8'),/fetch\s*\(/);
});
