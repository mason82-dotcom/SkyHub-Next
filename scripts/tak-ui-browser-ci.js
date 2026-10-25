'use strict';
/*
 * Offline browser acceptance of the delivered SkyHub frontend with REAL Leaflet,
 * REAL Socket.IO and a synthetic loopback-only HTTP API. No Pi/DJI/TAK contact.
 * Install test dependencies outside production package manifests and pass
 * SKYHUB_BROWSER_DEPS=/path/to/test/node_modules.
 */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const os=require('node:os');
const root=path.resolve(__dirname,'..');
const deps=process.env.SKYHUB_BROWSER_DEPS;
if(!deps||!path.isAbsolute(deps))throw new Error('absolute SKYHUB_BROWSER_DEPS required');
const {chromium}=require(path.join(deps,'playwright'));
const {Server}=require(path.join(deps,'socket.io'));
const output=process.env.SKYHUB_BROWSER_ARTIFACTS||path.join(os.tmpdir(),'skyhub-tabs-browser-evidence');
fs.mkdirSync(output,{recursive:true});
const get=(name)=>fs.readFileSync(path.join(root,'frontend/public',name));
const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==','base64');
const marker=()=>({
  sn:'SYNTHETIC-DEVICE-01',gatewaySn:'SYNTHETIC-RC-01',
  modelName:'Testfluggerät',role:'subdevice',aircraftConnected:true,
  topologyOnline:true,positionUnavailable:false,positionTimeVerified:true,
  lastSeenAt:Date.now(),lastTelemetryAt:Date.now(),lastPositionAt:Date.now(),
  telemetryTimeVerified:true,
  telemetry:{latitude:49.0,longitude:8.4,altitude:34,battery:82},
  hms:[]
});
let authorized=true;
const errors=[];
const requests=[];
const json=(response,data,code=200)=>{
  response.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
  response.end(JSON.stringify(data));
};
const server=http.createServer((request,response)=>{
  const url=new URL(request.url,'http://127.0.0.1');
  requests.push({method:request.method,path:url.pathname});
  if(url.pathname==='/'){response.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});response.end(get('index.html'));return;}
  if(['/workspace-tabs.js','/telemetry-freshness.js'].includes(url.pathname)){
    response.writeHead(200,{'Content-Type':'application/javascript'});response.end(get(url.pathname.slice(1)));return;
  }
  if(url.pathname==='/api/health'){
    json(response,{status:'degraded',mqtt:false,subscribed:false,trackRecordingEnabled:false,
      mqttLastObservedOsdAt:null,mqttLastTelemetryAt:null,postgresConfigured:false});
    return;
  }
  if(url.pathname==='/api/devices'){json(response,authorized?[marker()]:{error:'unauthorized'},authorized?200:401);return;}
  if(url.pathname==='/api/events'){json(response,authorized?[]:{error:'unauthorized'},authorized?200:401);return;}
  if(url.pathname.startsWith('/api/drone/')&&url.pathname.endsWith('/track')){
    json(response,authorized?[]:{error:'unauthorized'},authorized?200:401);return;
  }
  response.writeHead(404);response.end('not found');
});
const io=new Server(server,{serveClient:true,transports:['websocket','polling']});
let socketConnections=0;
io.on('connection',socket=>{socketConnections++;socket.emit('snapshot',[marker()]);});
const sizeChecks=[320,390,834,1440];
const assertNoOverflow=async page=>{
 const dimensions=await page.evaluate(()=>({
   scrollWidth:document.documentElement.scrollWidth,
   innerWidth:window.innerWidth,
   mainCount:document.querySelectorAll('main').length,
   opsHidden:document.getElementById('operationsPanel').hidden,
   takHidden:document.getElementById('takPanel').hidden,
   tabs:document.querySelectorAll('[role=tab]').length
 }));
 assert.equal(dimensions.mainCount,1,'one semantic main landmark');
 assert.equal(dimensions.tabs,2,'two accessible tabs');
 assert.ok(dimensions.scrollWidth<=dimensions.innerWidth+1,JSON.stringify(dimensions));
 return dimensions;
};
async function run(){
 await new Promise((resolve,reject)=>{
   server.once('error',reject);
   server.listen(0,'127.0.0.1',resolve);
 });
 const url='http://127.0.0.1:'+server.address().port+'/';
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
  const context=await browser.newContext();
  // Prevent network access to DJI, Pi, external tile servers and CDNs.
  await context.route('https://unpkg.com/leaflet@1.9.4/dist/*',route=>{
    const file=route.request().url().endsWith('.css')?'leaflet.css':'leaflet.js';
    return route.fulfill({
      path:path.join(deps,'leaflet','dist',file),
      contentType:file.endsWith('.css')?'text/css':'application/javascript'
    });
  });
  await context.route('https://tile.openstreetmap.org/**',route=>
    route.fulfill({status:200,body:image,contentType:'image/png'}));
  await context.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.hostname==='127.0.0.1'||url.hostname==='unpkg.com'||url.hostname==='tile.openstreetmap.org')
      return route.fallback();
    return route.abort('blockedbyclient');
  });
  const page=await context.newPage();
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(url,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.querySelector('#count')?.textContent==='1',{timeout:15000});
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent.includes('Live verbunden'),{timeout:15000});
  assert.equal(await page.locator('.leaflet-container').count(),1,'real Leaflet map created');
  assert.ok(await page.locator('.device').count()>0,'synthetic live snapshot appears in device list');
  await page.evaluate(()=>{
    window.__invalidationCount=0;
    const original=window.L.Map.prototype.invalidateSize;
    window.L.Map.prototype.invalidateSize=function(){
      window.__invalidationCount++;
      return original.apply(this,arguments);
    };
  });
  for(const width of sizeChecks){
    await page.setViewportSize({width,height:880});
    await page.getByRole('tab',{name:/TAK/}).click();
    assert.equal(await page.locator('#operationsPanel').isVisible(),false,'Operations panel hidden');
    assert.equal(await page.locator('#takPanel').isVisible(),true,'TAK panel visible');
    assert.ok((await page.locator('#takPanel').innerText()).includes('Export AUS'),'TAK fail-closed');
    assert.equal(await page.locator('#takPanel button').count(),0,'no TAK action buttons');
    await assertNoOverflow(page);
    if(width===320||width===1440)
      await page.screenshot({path:path.join(output,'tak-'+width+'.png'),fullPage:true});
    const beforeInvalidate=await page.evaluate(()=>window.__invalidationCount);
    await page.getByRole('tab',{name:/Operations/}).click();
    assert.equal(await page.locator('#operationsPanel').isVisible(),true);
    await page.waitForFunction(previous=>window.__invalidationCount>previous,beforeInvalidate);
    assert.equal(await page.locator('.device').count(),1,'device list survives tab switches');
    assert.equal(await page.locator('.leaflet-pane').count()>0,true,'Leaflet panes survive tab switches');
    await assertNoOverflow(page);
    if(width===320||width===1440)
      await page.screenshot({path:path.join(output,'operations-'+width+'.png'),fullPage:true});
  }
  await page.getByRole('tab',{name:/Operations/}).focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('#tabTak').getAttribute('aria-selected'),'true');
  assert.equal(await page.evaluate(()=>document.activeElement.id),'tabTak');
  await page.keyboard.press('Home');
  assert.equal(await page.locator('#tabOperations').getAttribute('aria-selected'),'true');
  // Disconnect a real socket: read-only tab navigation must stay functional.
  assert.equal(socketConnections,1,'tab switching must not reconnect Socket.IO');
  io.disconnectSockets(true);
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent==='Verbindung getrennt');
  await page.getByRole('tab',{name:/TAK/}).click();
  assert.equal(await page.locator('#takPanel').isVisible(),true);
  assert.equal(requests.filter(x=>x.path.startsWith('/api/tak')).length,0);
  // Unauthenticated HTTP access must not unlock any TAK action.
  authorized=false;
  const guest=await context.newPage();
  guest.on('pageerror',error=>errors.push(error.message));
  await guest.goto(url,{waitUntil:'domcontentloaded'});
  await guest.waitForFunction(()=>document.querySelector('#devices')?.textContent.includes('Zugriffstoken'),{timeout:15000});
  await guest.getByRole('tab',{name:/TAK/}).click();
  assert.ok((await guest.locator('#takPanel').innerText()).includes('nicht integriert'));
  assert.equal(await guest.locator('#takPanel button').count(),0);
  await assertNoOverflow(guest);
  await guest.close();
  if(errors.length)throw new Error('browser exceptions: '+errors.join('; '));
  const unexpectedWrites=requests.filter(x=>x.method!=='GET');
  assert.equal(unexpectedWrites.length,0,'no API mutations (Socket.IO may use WS)');
  const results={schema:'skyhub-tak-browser-v1',frontend:'actual frontend/public/index.html',
    clientLibraries:'real Leaflet 1.9.4 / Socket.IO 4.8.1',
    backend:'SYNTHETIC LOOPBACK ONLY; no full SkyHub server, no Pi, no DJI',
    screenWidths:sizeChecks,authenticated:true,unauthorized:true,socketDisconnected:true,
    noExportRequests:true,noHttpMutation:true,noPageErrors:true,
    singleSocketSessionDuringTabNavigation:true,leafletRecalculatedOnEveryReturn:true};
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(results,null,2)+'\n');
  process.stdout.write(JSON.stringify(results,null,2)+'\n');
  await context.close();
 }finally{await browser.close();}
}
run().catch(error=>{console.error(error.stack||error);process.exitCode=1;}).finally(async()=>{
 await new Promise(resolve=>io.close(()=>resolve()));
 await new Promise(resolve=>server.close(()=>resolve()));
});