'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');

const script=fs.readFileSync(
  path.resolve(__dirname,'../../frontend/public/pilot-login.js'),'utf8'
);
const bootstrap={
  appId:'test-app',appKey:'not-a-real-key',license:'not-a-real-license',
  workspaceId:'e3dea0f5-37f2-4d79-ae58-490af3228069',
  platformName:'SkyHub Next',workspaceName:'SkyHub',description:'Test',
  mqtt:{host:'tcp://example.test:1884',username:'pilot-test',password:'test-secret'}
};
async function createPilot(options={}){
  const elements=new Map(),timers=[],calls={retry:[],load:[]};
  function el(id){
    if(!elements.has(id)){
      elements.set(id,{
        id,textContent:'',value:'',disabled:false,hidden:id==='retry',
        listeners:Object.create(null),
        addEventListener(event,handler){this.listeners[event]=handler;}
      });
    }
    return elements.get(id);
  }
  let response=options.mqttState??JSON.stringify({code:0,data:false});
  const bridge={
    platformVerifyLicense:()=>JSON.stringify({code:0}),
    platformSetWorkspaceId:()=>JSON.stringify({code:0}),
    platformSetInformation:()=>JSON.stringify({code:0}),
    platformLoadComponent(...args){calls.load.push(args);
      return JSON.stringify({code:options.loadFails?.includes(args[0])?17:0});},
    ...(options.loaded?{platformIsComponentLoaded:name=>JSON.stringify({code:0,data:options.loaded.includes(name)})}:{}),
    wsGetConnectState:()=>JSON.stringify({code:0,data:true}),
    thingGetConnectState(){return response;},
    thingConnect(...args){calls.retry.push(args);return JSON.stringify({code:0});}
  };
  const win={djiBridge:bridge};
  const env={
    window:win,
    document:{getElementById:el},
    location:{protocol:'https:'},
    setTimeout(callback,ms){timers.push({callback,ms});return timers.length;},
    fetch:async function(url){
      if(url==='/api/pilot/status')return {ok:true,json:async()=>({configured:true,missing:[]})};
      if(url==='/api/pilot/bootstrap')return {ok:true,json:async()=>options.bootstrap||bootstrap};
      throw new Error('unexpected fetch');
    }
  };
  vm.runInNewContext(script,env,{filename:'pilot-login.js',timeout:1000});
  for(let i=0;i<8;i++)await Promise.resolve();
  return {
    el,win,bridge,calls,timers,
    setMqttState(value){response=value;},
    async connect(){
      el('access').value='placeholder-test-token';
      await el('start').listeners.click();
    },
    fireTimer(){assert.equal(timers.length,1);timers[0].callback();}
  };
}

test('loading DJI component does not call thingConnect automatically',async()=>{
  const pilot=await createPilot();
  await pilot.connect();
  assert.equal(pilot.calls.load.length,1);
  assert.equal(pilot.calls.retry.length,0);
  assert.equal(pilot.el('access').value,'');
  assert.equal(pilot.el('retry').hidden,true);
  pilot.fireTimer();
  assert.equal(pilot.el('retry').hidden,false);
  assert.match(pilot.el('result').textContent,/NICHT VERBUNDEN/);
});

test('manual reconnect passes previously authenticated pilot credentials only to bridge',async()=>{
  const pilot=await createPilot();
  await pilot.connect();
  pilot.fireTimer();
  pilot.el('retry').listeners.click();
  assert.equal(pilot.calls.retry.length,1);
  assert.equal(pilot.calls.retry[0][0],'pilot-test');
  assert.equal(pilot.calls.retry[0][1],'test-secret');
  assert.equal(pilot.calls.retry[0][2],'skyhubPilotMqttState');
  assert.equal(pilot.el('retry').hidden,true);
  assert.doesNotMatch(pilot.el('result').textContent,/test-secret|not-a-real-key/);
});

test('a positive DJI JSON state hides retry and clears cached credentials',async()=>{
  const pilot=await createPilot();
  await pilot.connect();
  pilot.setMqttState(JSON.stringify({code:0,data:true}));
  pilot.fireTimer();
  assert.match(pilot.el('result').textContent,/VERBUNDEN/);
  assert.equal(pilot.el('retry').hidden,true);
  pilot.el('retry').listeners.click();
  assert.equal(pilot.calls.retry.length,0);
});

test('failed DJI JSBridge response must not be treated as MQTT connected',async()=>{
  const pilot=await createPilot();
  await pilot.connect();
  pilot.setMqttState(JSON.stringify({code:17,data:true}));
  pilot.fireTimer();
  assert.match(pilot.el('result').textContent,/nicht eindeutig/i);
  assert.equal(pilot.el('retry').hidden,false);
});

test('raw callback payload is not rendered into the Pilot UI',async()=>{
  const pilot=await createPilot();
  await pilot.connect();
  pilot.win.skyhubPilotMqttState({password:'SHOULD_NOT_DISPLAY',sn:'PRIVATE_SN'});
  const result=pilot.el('result').textContent;
  assert.doesNotMatch(result,/SHOULD_NOT_DISPLAY|PRIVATE_SN/);
});

test('successful thingConnect result alone does not claim MQTT online',async()=>{
  const pilot=await createPilot();
  await pilot.connect();
  pilot.fireTimer();
  pilot.el('retry').listeners.click();
  assert.doesNotMatch(pilot.el('result').textContent,/VERBUNDEN\./);
  assert.match(pilot.el('result').textContent,/gestartet/);
});

test('reconnect schedules a status check even without a DJI callback',async()=>{
  const pilot=await createPilot();
  await pilot.connect();
  pilot.fireTimer();
  pilot.el('retry').listeners.click();
  assert.equal(pilot.timers.length,2);
  pilot.setMqttState(JSON.stringify({code:0,data:true}));
  pilot.timers[1].callback();
  assert.equal(pilot.el('retry').hidden,true);
  assert.match(pilot.el('result').textContent,/VERBUNDEN/);
});

test('DJI Bridge error messages cannot expose vendor-supplied secrets in status',async()=>{
  const pilot=await createPilot();
  pilot.bridge.platformVerifyLicense=()=>JSON.stringify({
    code:401,message:'PRIVATE_KEY_SHOULD_NOT_DISPLAY'
  });
  await pilot.connect();
  assert.match(pilot.el('result').textContent,/DJI Bridge-Code 401/);
  assert.doesNotMatch(pilot.el('result').textContent,/PRIVATE_KEY_SHOULD_NOT_DISPLAY/);
});

test('diagnostics distinguishes license verification, thing module, and MQTT state',async()=>{
  const pilot=await createPilot();
  pilot.bridge.platformIsVerified=()=>JSON.stringify({code:0,data:true});
  pilot.bridge.platformIsComponentLoaded=name=>{
    assert.equal(name,'thing');
    return JSON.stringify({code:0,data:true});
  };
  pilot.el('diagnose').listeners.click();
  const details=pilot.el('diagnostics').textContent;
  assert.match(details,/SkyHub-Seite geladen: ja/);
  assert.match(details,/DJI Pilot 2 JSBridge: verfügbar/);
  assert.match(details,/DJI-Lizenz geprüft: ja/);
  assert.match(details,/Thing-Modul geladen: ja/);
  assert.match(details,/MQTT verbunden \(DJI\): nein/);
});

test('diagnostics redacts vendor errors and never reads thingGetConfigs credentials',async()=>{
  const pilot=await createPilot();
  let configReads=0;
  pilot.bridge.platformIsVerified=()=>JSON.stringify({
    code:32,data:true,message:'SECRET_VENDOR_MESSAGE'
  });
  pilot.bridge.platformIsComponentLoaded=()=>true;
  pilot.bridge.thingGetConfigs=()=>{configReads++;return 'SECRET_MQTT_PASSWORD';};
  pilot.el('diagnose').listeners.click();
  const details=pilot.el('diagnostics').textContent;
  assert.match(details,/DJI-Lizenz geprüft: DJI-Fehlercode 32/);
  assert.match(details,/Thing-Modul geladen: ja/);
  assert.equal(configReads,0);
  assert.doesNotMatch(details,/SECRET_VENDOR_MESSAGE|SECRET_MQTT_PASSWORD/);
});

test('HTTPS advisory hidden on secure Pilot 2 page',async()=>{
  const pilot=await createPilot();
  assert.equal(pilot.el('security').hidden,true);
});

const withTsa={...bootstrap,tsa:{apiHost:'https://rpi5.fritz.box',wsHost:'wss://rpi5.fritz.box/ws/tsa'}};

test('without a TSA configuration only the cloud module is loaded',async()=>{
  const pilot=await createPilot();
  await pilot.connect();
  assert.deepEqual(pilot.calls.load.map(call=>call[0]),['thing']);
  assert.doesNotMatch(pilot.el('diagnostics').textContent,/Lagebild/);
});

test('situation awareness loads api and ws before tsa, after the cloud module, with the session token',async()=>{
  const pilot=await createPilot({bootstrap:withTsa});
  await pilot.connect();
  assert.deepEqual(pilot.calls.load.map(call=>call[0]),['thing','api','ws','tsa']);
  assert.deepEqual(JSON.parse(pilot.calls.load[1][1]),{host:'https://rpi5.fritz.box',token:'placeholder-test-token'});
  assert.deepEqual(JSON.parse(pilot.calls.load[2][1]),
    {host:'wss://rpi5.fritz.box/ws/tsa',token:'placeholder-test-token',connectCallback:'skyhubPilotWsState'});
  assert.equal(pilot.calls.load[3][1],'{}');
  assert.equal(typeof pilot.win.skyhubPilotWsState,'function');
  assert.match(pilot.el('diagnostics').textContent,/Lagebild \(TSA\): Module geladen/);
  // The token goes to the bridge only, never into the visible page.
  assert.doesNotMatch(pilot.el('diagnostics').textContent+pilot.el('result').textContent,/placeholder-test-token/);
});

test('modules Pilot 2 already holds are not loaded twice',async()=>{
  const pilot=await createPilot({bootstrap:withTsa,loaded:['api','ws','tsa']});
  await pilot.connect();
  assert.deepEqual(pilot.calls.load.map(call=>call[0]),['thing']);
});

test('a failing TSA module never breaks the MQTT onboarding',async()=>{
  const pilot=await createPilot({bootstrap:withTsa,loadFails:['ws']});
  await pilot.connect();
  assert.deepEqual(pilot.calls.load.map(call=>call[0]),['thing','api','ws']);
  assert.match(pilot.el('diagnostics').textContent,/Lagebild \(TSA\): nicht geladen \(platformLoadComponent: DJI Bridge-Code 17\)/);
  // The MQTT status check is still scheduled and works as before.
  pilot.setMqttState(JSON.stringify({code:0,data:true}));
  pilot.fireTimer();
  assert.match(pilot.el('result').textContent,/VERBUNDEN/);
});

test('the ws state callback ignores its payload',async()=>{
  const pilot=await createPilot({bootstrap:withTsa});
  await pilot.connect();
  pilot.win.skyhubPilotWsState({token:'SHOULD_NOT_DISPLAY'});
  assert.doesNotMatch(pilot.el('diagnostics').textContent+pilot.el('result').textContent,/SHOULD_NOT_DISPLAY/);
});
