'use strict';
const {before,after,test}=require('node:test');
const assert=require('node:assert/strict');
const {once}=require('node:events');
const {io}=require('socket.io-client');
const {createDrFixture}=require('./helpers/dr-fixture');

// Synthetic DR evidence; the real, git-ignored dr-status/ is never required.
const drFixture=createDrFixture();
process.once('exit',()=>drFixture.cleanup());

// This process starts the real app on an ephemeral port. External services point
// to the local closed port 1, so the test cannot contact the Pi broker or Redis.
const VIEW_TOKEN='test-view-token-abcdefghijklmnopqrstuvwxyz';
const PILOT_TOKEN='test-pilot-token-abcdefghijklmnopqrstuvwxyz';
const LICENSE='test-license-marker';
Object.assign(process.env,{
  NODE_ENV:'test',
  PORT:'0',SKYHUB_BIND_ADDRESS:'127.0.0.1',
  SKYHUB_VIEW_TOKEN:VIEW_TOKEN,
  SKYHUB_LAN_VIEW_CIDR:'192.168.178.0/24',
  MQTT_BROKER_URL:'mqtt://127.0.0.1:1',
  REDIS_URL:'redis://127.0.0.1:1',
  SKYHUB_TOPOLOGY_ACK_ENABLED:'false',
  SKYHUB_PILOT_ENABLED:'true',
  SKYHUB_PILOT_ACCESS_TOKEN:PILOT_TOKEN,
  SKYHUB_DJI_APP_ID:'test-app-id',
  SKYHUB_DJI_APP_KEY:'test-app-key',
  SKYHUB_DJI_APP_LICENSE:LICENSE,
  SKYHUB_PILOT_MQTT_URL:'mqtt://192.168.178.63:1884',
  SKYHUB_PILOT_MQTT_USER:'test-pilot-user',
  SKYHUB_PILOT_MQTT_PASSWORD:'test-pilot-password',
  SKYHUB_PILOT_WORKSPACE_ID:'123e4567-e89b-42d3-a456-426614174000',
  SKYHUB_DJI_MAP_ELEMENTS_ENABLED:'true',
  SKYHUB_MINIO_DR_ENABLED:'true',
  SKYHUB_MINIO_DR_REPORT_DIR:drFixture.status
});
delete process.env.DATABASE_URL;
const {server,stop}=require('../server');
let base;
before(async()=>{
  if(!server.listening)await once(server,'listening');
  base='http://127.0.0.1:'+server.address().port;
});
after(()=>stop());

async function request(path,{method='GET',token,xAuthToken,lan,https}={}){
  const headers={};
  if(token)headers.authorization='Bearer '+token;
  if(xAuthToken)headers['x-auth-token']=xAuthToken;
  if(lan)headers['x-forwarded-for']=lan;
  if(https)headers['x-forwarded-proto']='https';
  return fetch(base+path,{method,headers});
}
function socketOutcome({token,lan}={}){
  return new Promise((resolve,reject)=>{
    const options={transports:['polling'],reconnection:false,timeout:2000};
    if(token)options.auth={token};
    if(lan)options.extraHeaders={'x-forwarded-for':lan};
    const client=io(base,options);
    const timer=setTimeout(()=>{client.disconnect();reject(Error('Socket.IO timeout'));},3000);
    function finish(value){clearTimeout(timer);client.disconnect();resolve(value);}
    client.once('connect',()=>finish('connected'));
    client.once('connect_error',error=>finish(error.message));
  });
}

test('public health does not reveal Pilot credentials',async()=>{
  const response=await request('/api/health');
  assert.equal(response.status,200);
  const health=await response.json();
  assert.equal(health.postgresConfigured,false);
  assert.equal(health.postgresMigrationReady,false);
  const body=JSON.stringify(health);
  assert.equal(body.includes(LICENSE),false);
  assert.equal(body.includes('test-pilot-password'),false);
  assert.equal(body.includes(VIEW_TOKEN),false);
});

test('LAN view is read-only; pairing administration still needs the view token',async()=>{
  assert.equal((await request('/api/devices')).status,401);
  assert.equal((await request('/api/devices',{lan:'192.168.178.70'})).status,200);
  assert.equal((await request('/api/devices',{lan:'203.0.113.9'})).status,401);
  assert.equal((await request('/api/diagnostics/mqtt-shapes',{lan:'192.168.178.70'})).status,200);
  assert.equal((await request('/api/drone/AIR01/track',{lan:'192.168.178.70'})).status,200);
  assert.equal((await request('/api/drone/AIR01/telemetry',{lan:'192.168.178.70'})).status,404);
  assert.equal((await request('/api/drone/AIR01/secrets',{lan:'192.168.178.70'})).status,401);
  assert.equal((await request('/api/pilot-admin/pairings',{lan:'192.168.178.70'})).status,401);
  assert.equal((await request('/api/unknown-future-route',{lan:'192.168.178.70'})).status,401);
  assert.equal((await request('/api/mission/create',{method:'POST',lan:'192.168.178.70'})).status,401);
  assert.equal((await request('/api/mission/create',{method:'POST',token:VIEW_TOKEN})).status,404);
});

test('Pilot bootstrap requires HTTPS and the Pilot token',async()=>{
  assert.equal((await request('/api/pilot/bootstrap',{method:'POST',token:PILOT_TOKEN})).status,403);
  assert.equal((await request('/api/pilot/bootstrap',{method:'POST',https:true})).status,401);
  const response=await request('/api/pilot/bootstrap',{method:'POST',token:PILOT_TOKEN,https:true});
  assert.equal(response.status,200);
  assert.equal((await response.json()).license,LICENSE);
  const status=await request('/api/pilot/status');
  const statusText=await status.text();
  assert.equal(statusText.includes(LICENSE),false);
  // Reports the port actually configured for the RC, not a fixed number.
  assert.equal(JSON.parse(statusText).mqttPort,1884);
});

test('DJI map-group route requires HTTPS, the configured workspace and x-auth-token',async()=>{
  const path='/map/api/v1/workspaces/123e4567-e89b-42d3-a456-426614174000/element-groups';
  assert.equal((await request(path,{xAuthToken:PILOT_TOKEN})).status,403);
  assert.equal((await request(path,{https:true})).status,401);
  assert.equal((await request('/map/api/v1/workspaces/e3dea0f5-37f2-4d79-ae58-490af3228069/element-groups',
    {https:true,xAuthToken:PILOT_TOKEN})).status,404);
  assert.equal((await request(path+'?is_distributed=unknown',
    {https:true,xAuthToken:PILOT_TOKEN})).status,400);
  // The shared Pilot credential is not an operator/admin grant.
  assert.equal((await request(path+'?is_distributed=false',
    {https:true,xAuthToken:PILOT_TOKEN})).status,403);
  assert.equal((await request(path+'?is_distributed=false&role=admin',
    {https:true,xAuthToken:PILOT_TOKEN})).status,403);
  assert.equal((await request(path,{https:true,xAuthToken:VIEW_TOKEN})).status,401);
  assert.equal((await request(path,{https:true,lan:'192.168.178.70'})).status,401);
  assert.equal((await request(path,{method:'POST',https:true,xAuthToken:PILOT_TOKEN})).status,404);
  // DATABASE_URL is unset in this suite, so the guarded route cannot contact Postgres.
  assert.equal((await request(path,{https:true,xAuthToken:PILOT_TOKEN})).status,503);
});

test('Socket.IO admits only the view token or a configured LAN viewer',async()=>{
  assert.equal(await socketOutcome(),'Unauthorized');
  assert.equal(await socketOutcome({lan:'203.0.113.9'}),'Unauthorized');
  assert.equal(await socketOutcome({lan:'192.168.178.70'}),'connected');
  assert.equal(await socketOutcome({token:VIEW_TOKEN}),'connected');
});

test('MinIO DR requires the actual SkyHub view token', async () => {
  const endpoint = '/api/dr/minio/status';

  assert.equal(
    (await request(endpoint)).status,
    401
  );

  assert.equal(
    (await request(endpoint, {
      token: 'invalid-token'
    })).status,
    401
  );

  assert.equal(
    (await request(endpoint, {
      lan: '192.168.178.70'
    })).status,
    401
  );

  const response = await request(endpoint, {
    token: VIEW_TOKEN
  });

  assert.equal(response.status, 200);

  const result = await response.json();

  assert.equal(result.status, 'incomplete');
  assert.equal(result.readOnly, true);
  assert.equal(result.latest.metrics.verifiedFiles, 54887);
  assert.equal(result.latest.checks.iamReadOnly, 'unknown');

  const reports = await request(
    '/api/dr/minio/reports',
    {token: VIEW_TOKEN}
  );

  assert.equal(reports.status, 200);
  assert.equal((await reports.json()).count, 1);

  assert.equal(
    (await request(endpoint, {
      method: 'POST',
      token: VIEW_TOKEN
    })).status,
    404
  );
});

test('DJI field definitions are served for catalogued models and reject everything else',async()=>{
  const get=model=>request('/api/diagnostics/dji-fields?model='+encodeURIComponent(model),{token:VIEW_TOKEN});
  for(const [model,profile] of [['0:77:2','mavic3m'],['2:174:0','rcPlus2'],['3:2:0','dock2'],['0:100:1','matrice4D']]){
    const response=await get(model);
    assert.equal(response.status,200,model);
    const body=await response.json();
    assert.equal(body.profile,profile);
    assert.ok(body.fields.length>0);
  }
  assert.equal((await get('0:67:0')).status,404);
  assert.equal((await get('3:9:0')).status,404);
  for(const bad of ['','abc','0:77','4:1:0','0:1000:0','0:77:2;x','0:77:2\\d'])
    assert.equal((await get(bad)).status,400,bad);
  assert.equal((await request('/api/diagnostics/dji-fields?model=0:77:2')).status,401);
});
