'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');

const script=fs.readFileSync(
  path.resolve(__dirname,'../../frontend/public/pilot-login.js'),'utf8'
);
const DEVICE_TOKEN='a'.repeat(64);
const bootstrap={
  appId:'test-app',appKey:'not-a-real-key',license:'not-a-real-license',
  workspaceId:'e3dea0f5-37f2-4d79-ae58-490af3228069',
  platformName:'SkyHub Next',workspaceName:'SkyHub',description:'Test',
  mqtt:{host:'tcp://example.test:1884',username:'pilot-test',password:'test-secret'}
};
const ok=value=>JSON.stringify({code:0,data:value});

function storage(initial={}){
  const data=new Map(Object.entries(initial));
  return {data,getItem:k=>data.has(k)?data.get(k):null,
    setItem:(k,v)=>data.set(k,String(v)),removeItem:k=>data.delete(k)};
}
async function openPage({store=storage(),loaded=false,connected=false,verified=true,
  session={topologyReplyEnabled:true,topologyAckAt:null},bootstrapStatus=200,bootstrapBody=null,pairStatus='pending'}={}){
  const elements=new Map(),timers=[],requests=[];
  const calls={load:[],unload:0,verify:0,connect:0};
  function el(id){
    if(!elements.has(id))elements.set(id,{id,textContent:'',value:'',disabled:false,hidden:false,
      listeners:Object.create(null),addEventListener(event,handler){this.listeners[event]=handler;}});
    return elements.get(id);
  }
  const bridge={
    platformIsVerified:()=>ok(verified),
    platformVerifyLicense:()=>{calls.verify++;return ok(true);},
    platformSetWorkspaceId:()=>ok(true),
    platformSetInformation:()=>ok(true),
    platformIsComponentLoaded:()=>ok(loaded),
    platformLoadComponent:(...args)=>{calls.load.push(args);return ok(true);},
    platformUnloadComponent:()=>{calls.unload++;return ok(true);},
    platformGetRemoteControllerSN:()=>ok('RCSN01'),
    thingGetConnectState:()=>ok(connected),
    thingConnect:()=>{calls.connect++;return ok(true);}
  };
  const json=(status,body)=>({ok:status>=200&&status<300,status,json:async()=>body});
  const env={
    window:{djiBridge:bridge,localStorage:store},
    document:{getElementById:el},
    location:{protocol:'https:'},
    encodeURIComponent,Date,
    setTimeout(callback,ms){timers.push({callback,ms});return timers.length;},
    clearTimeout(){},
    fetch:async(url,options={})=>{
      requests.push({url,auth:options.headers?.Authorization||null});
      if(url==='/api/pilot/status')return json(200,{configured:true,missing:[]});
      if(url==='/api/pilot/bootstrap')return json(bootstrapStatus,bootstrapStatus===200?bootstrap:(bootstrapBody||{}));
      if(url==='/api/pilot/pair')return json(200,{pairingId:'b'.repeat(32),code:'123456',expiresAt:Date.now()+300000});
      if(url.startsWith('/api/pilot/pair/'))return json(200,pairStatus==='approved'?
        {status:'approved',deviceToken:DEVICE_TOKEN}:{status:pairStatus});
      if(url.startsWith('/api/pilot/session'))return json(200,session);
      throw new Error('unexpected fetch '+url);
    }
  };
  vm.runInNewContext(script,env,{filename:'pilot-login.js',timeout:1000});
  const settle=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
  await settle();
  return {el,calls,timers,requests,store,settle,bridge};
}

test('paired RC connects automatically without any manual token input',async()=>{
  const page=await openPage({store:storage({'skyhub.pilot.deviceToken':DEVICE_TOKEN}),verified:false});
  const boot=page.requests.find(r=>r.url==='/api/pilot/bootstrap');
  assert.equal(boot.auth,'Bearer '+DEVICE_TOKEN);
  assert.equal(page.calls.verify,1);
  assert.equal(page.calls.load.length,1);
  assert.equal(page.calls.connect,0);
  assert.equal(page.requests.some(r=>r.url==='/api/pilot/pair'),false);
  assert.doesNotMatch(page.el('result').textContent,new RegExp(DEVICE_TOKEN+'|test-secret'));
});

test('reopened page keeps a working, acknowledged session and does not reload thing',async()=>{
  const page=await openPage({store:storage({'skyhub.pilot.deviceToken':DEVICE_TOKEN}),
    loaded:true,connected:true,session:{topologyReplyEnabled:true,topologyAckAt:Date.now()-5000}});
  assert.equal(page.calls.verify,0);
  assert.equal(page.calls.load.length,0);
  assert.equal(page.calls.unload,0);
  assert.match(page.el('result').textContent,/Topologie bestätigt/);
  const session=page.requests.find(r=>r.url.startsWith('/api/pilot/session'));
  assert.equal(session.url,'/api/pilot/session?gateway=RCSN01');
});

test('connected but unacknowledged session is rebuilt once, throttled across reloads',async()=>{
  const store=storage({'skyhub.pilot.deviceToken':DEVICE_TOKEN});
  const page=await openPage({store,loaded:true,connected:true});
  assert.equal(page.calls.unload,0,'no rebuild before update_topo had time to arrive');
  const delayed=page.timers.find(t=>t.ms===15000);
  await delayed.callback();
  await page.settle();
  assert.equal(page.calls.unload,1);
  assert.equal(page.calls.load.length,1);
  const reopened=await openPage({store,loaded:true,connected:true});
  await reopened.timers.find(t=>t.ms===15000).callback();
  await reopened.settle();
  assert.equal(reopened.calls.unload,0);
  assert.equal(reopened.el('rebuild').hidden,false);
  assert.match(reopened.el('result').textContent,/nicht bestätigt/);
});

test('loaded but disconnected thing gets one automatic reconnect per minute',async()=>{
  const store=storage({'skyhub.pilot.deviceToken':DEVICE_TOKEN});
  const page=await openPage({store,loaded:true,connected:false});
  assert.equal(page.calls.connect,1);
  assert.equal(page.calls.load.length,0);
  const again=await openPage({store,loaded:true,connected:false});
  assert.equal(again.calls.connect,0);
  assert.equal(again.el('retry').hidden,false);
});

test('revoked device token is discarded and a new pairing starts',async()=>{
  const store=storage({'skyhub.pilot.deviceToken':DEVICE_TOKEN});
  const page=await openPage({store,bootstrapStatus:401});
  assert.equal(store.data.has('skyhub.pilot.deviceToken'),false);
  assert.equal(page.requests.some(r=>r.url==='/api/pilot/pair'),true);
  assert.equal(page.el('pairCode').textContent,'123 456');
});

test('legacy pairing without workspace binding: no modules, token dropped, re-pairing with a hint (05.11.2026)',async()=>{
  // RC Pro Enterprise: bootstrap used to succeed, then every DJI API call got 401 and Pilot 2 closed the page.
  const store=storage({'skyhub.pilot.deviceToken':DEVICE_TOKEN});
  const page=await openPage({store,bootstrapStatus:409,bootstrapBody:{error:'Re-pairing required',code:'repair_required'}});
  assert.equal(page.calls.load.length,0);                                   // nothing that could fail with 401
  assert.equal(page.calls.verify,0);
  assert.equal(store.data.has('skyhub.pilot.deviceToken'),false);
  assert.equal(page.requests.some(r=>r.url==='/api/pilot/pair'),true);
  assert.equal(page.el('pairCode').textContent,'123 456');
  assert.match(page.el('result').textContent,/vor der Arbeitsbereich-Bindung/);
  assert.match(page.el('result').textContent,/Code auf dem Pi bestätigen/);
});

test('a 409 without repair_required is an ordinary bootstrap error, the token stays',async()=>{
  const store=storage({'skyhub.pilot.deviceToken':DEVICE_TOKEN});
  const page=await openPage({store,bootstrapStatus:409,bootstrapBody:{error:'Conflict'}});
  assert.equal(store.data.get('skyhub.pilot.deviceToken'),DEVICE_TOKEN);
  assert.equal(page.requests.some(r=>r.url==='/api/pilot/pair'),false);
  assert.match(page.el('result').textContent,/HTTP 409/);
});

test('unpaired RC shows a code and connects after approval with the new device token',async()=>{
  const store=storage();
  const page=await openPage({store,pairStatus:'approved'});
  assert.equal(page.el('pairing').hidden,false);
  assert.equal(page.el('pairCode').textContent,'123 456');
  assert.equal(page.requests.some(r=>r.url==='/api/pilot/bootstrap'),false);
  await page.timers.find(t=>t.ms===2000).callback();
  await page.settle();
  assert.equal(store.data.get('skyhub.pilot.deviceToken'),DEVICE_TOKEN);
  assert.equal(page.requests.find(r=>r.url==='/api/pilot/bootstrap').auth,'Bearer '+DEVICE_TOKEN);
  assert.equal(page.el('pairing').hidden,true);
  assert.equal(page.calls.load.length,1);
});

test('fresh OSD after a SkyHub restart counts as an active session, no rebuild',async()=>{
  const page=await openPage({store:storage({'skyhub.pilot.deviceToken':DEVICE_TOKEN}),loaded:true,connected:true,
    session:{topologyReplyEnabled:true,topologyAckAt:null,lastTelemetryAt:Date.now()-2000}});
  await page.timers.find(t=>t.ms===15000).callback();
  await page.settle();
  assert.equal(page.calls.unload,0);
  assert.match(page.el('result').textContent,/Sitzung aktiv · OSD empfangen/);
});

test('second Pilot page instance uses the token its sibling already stored',async()=>{
  const store=storage();
  const page=await openPage({store,pairStatus:'expired'});
  store.setItem('skyhub.pilot.deviceToken',DEVICE_TOKEN);
  await page.timers.find(t=>t.ms===2000).callback();
  await page.settle();
  assert.equal(page.requests.find(r=>r.url==='/api/pilot/bootstrap').auth,'Bearer '+DEVICE_TOKEN);
  assert.doesNotMatch(page.el('result').textContent,/abgelaufen/);
});

test('rebuilding the cloud session reloads only the cloud-dependent modules the configuration uses',async()=>{
  const store=storage({'skyhub.pilot.deviceToken':DEVICE_TOKEN});
  const page=await openPage({store,loaded:true,connected:true});
  const unloaded=[];
  page.bridge.platformUnloadComponent=name=>{unloaded.push(name);return ok(true);};
  await page.timers.find(t=>t.ms===15000).callback();
  await page.settle();
  // This bootstrap enables no tsa/media/wayline: only the cloud module is rebuilt.
  assert.deepEqual(unloaded,['thing']);
});
