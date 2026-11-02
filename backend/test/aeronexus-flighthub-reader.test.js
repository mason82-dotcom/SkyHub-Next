'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createFlightHubReadOnly,DEVICE_PATH}=require('../aeronexus-flighthub-reader');
const project='b9ca0d6c-ec9b-4945-8bf0-a60c53dfc000';
const origin='https://flighthub-test.example/';
const settings={origin,approvedOrigins:[origin],apiToken:'fake_token_used_only_in_tests'};
test('P3 only performs the whitelisted GET and redacts DJI identities',async()=>{
  let called=0;
  const x=createFlightHubReadOnly({...settings,fetchImpl:async(url,options)=>{
    called++;assert.ok(url.startsWith('https://flighthub-test.example'+DEVICE_PATH));
    assert.equal(options.method,'GET');assert.equal(options.redirect,'error');
    return {status:200,headers:{get:()=> 'application/json'},
      text:async()=>JSON.stringify({data:{list:[{name:'Test RC',sn:'PRIVATE-SN',
        lat:49.5,longitude:8.3,model:'M4T',online:true,token:'SECRET'}]}})};
  }});
  const result=await x.listDevices(project);
  assert.equal(called,1);assert.equal(result.devices.length,1);
  assert.equal(result.devices[0].model,'M4T');
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE|SECRET|49.5|8.3/);
  assert.equal(result.flightReady,false);
});
test('P3 enforces origin pin, project UUID and content type without request retry',async()=>{
  assert.throws(()=>createFlightHubReadOnly({...settings,origin:'http://flighthub-test.example/'}));
  const reader=createFlightHubReadOnly({...settings,fetchImpl:async()=>({status:301,headers:{get:()=> 'text/html'},text:async()=>''})});
  await assert.rejects(reader.listDevices(project),/unavailable/);
  await assert.rejects(reader.listDevices('bad id'),/Invalid project/);
});
