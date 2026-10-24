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
const {once}=require('node:events');
const root=path.resolve(__dirname,'..');
const deps=process.env.SKYHUB_BROWSER_DEPS;
if(!deps||!path.isAbsolute(deps))throw new Error('absolute SKYHUB_BROWSER_DEPS required');
const {chromium}=require(path.join(deps,'playwright'));
const {Server}=require(path.join(deps,'socket.io'));
const output=process.env.SKYHUB_BROWSER_ARTIFACTS||path.join(os.tmpdir(),'skyhub-tabs-browser-evidence');
fs.mkdirSync(output,{recursive:true});
const get=(name)=>fs.readFileSync(path.join(root,'frontend/public',name));
// Valid neutral 1x1 PNG test tile; makes offline screenshots readable without implying real map geography.
const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGN4/eE7AAWcAtOLY6c0AAAAAElFTkSuQmCC','base64');
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
  if(url.pathname==='/skyhub-light.css'){
    response.writeHead(200,{'Content-Type':'text/css; charset=utf-8'});response.end(get('skyhub-light.css'));return;
  }
  if(['/smart-farming.html','/pilot-login.html'].includes(url.pathname)){
    response.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
    response.end(get(url.pathname.slice(1)));return;
  }
  if(['/smart-farming-ui.js','/pilot-login.js'].includes(url.pathname)){
    response.writeHead(200,{'Content-Type':'application/javascript'});
    response.end(get(url.pathname.slice(1)));return;
  }
  if(url.pathname==='/api/pilot/status'){
    json(response,{configured:false,missing:['offline-test'],requiresHttps:true});
    return;
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
   tabs:document.querySelectorAll('[role=tab]').length,
   allNavLinksVisible:(()=>{
     const nav=document.querySelector('.skyhub-global-nav');
     if(!nav)return false;
     const bound=nav.getBoundingClientRect();
     const links=[...nav.querySelectorAll('a')];
     return links.length===5 && links.every(link=>{
       const rect=link.getBoundingClientRect();
       return rect.left>=bound.left-1 && rect.right<=bound.right+1 &&
         rect.top>=bound.top-1 && rect.bottom<=bound.bottom+1;
     });
   })(),
   lightStylesheet: [...document.styleSheets].some(sheet=>sheet.href?.endsWith('/skyhub-light.css')),
   colorScheme: getComputedStyle(document.documentElement).colorScheme,
   bodyBackground: getComputedStyle(document.body).backgroundColor,
   deviceBackground: document.querySelector('.device') ?
     getComputedStyle(document.querySelector('.device')).backgroundColor : null
 }));
 assert.equal(dimensions.mainCount,1,'one semantic main landmark');
 assert.equal(dimensions.tabs,2,'two accessible tabs');
 assert.equal(dimensions.allNavLinksVisible,true,
   'five module links including the current module must all remain visible');
 assert.equal(dimensions.lightStylesheet,true,'light stylesheet must be loaded successfully');
 assert.equal(dimensions.colorScheme,'light','root color-scheme must remain light');
 assert.equal(dimensions.bodyBackground,'rgb(243, 246, 251)','light canvas must be rendered');
 if(dimensions.deviceBackground!==null)
   assert.equal(dimensions.deviceBackground,'rgb(255, 255, 255)','device cards must be white');
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
  assert.equal(await page.locator('.skyhub-global-nav a[aria-current="page"]').count(),1,
    'operator navigation must mark the current view');
  assert.equal(requests.some(x=>x.path==='/skyhub-light.css'),true,
    'browser must request the real shared CSS asset');
  assert.ok(await page.locator('.device').count()>0,'synthetic live snapshot appears in device list');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(()=>document.activeElement.classList.contains('skyhub-skip-link')),
    true,'first keyboard tab must find the skip-to-content link');
  assert.ok(await page.locator('.skyhub-skip-link').evaluate(el=>{
    const r=el.getBoundingClientRect();return r.top>=0&&r.bottom<=window.innerHeight;
  }),'focused skip link must appear within the viewport');
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(()=>location.hash),'#skyhubMain',
    'keyboard skip must target the main landmark');
  assert.equal(await page.evaluate(()=>document.activeElement.id),'skyhubMain',
    'keyboard skip must move focus to main content');
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

  // Follow real links dashboard ↔ Smart Farming at two phone widths. The
  // HTTP simulator is unauthenticated; no credential may be needed for routing.
  const crossNav=await context.newPage();
  crossNav.on('pageerror',error=>errors.push('cross-module navigation: '+error.message));
  for(const width of [320,390]){
    await crossNav.setViewportSize({width,height:844});
    await crossNav.goto(url,{waitUntil:'load'});
    assert.equal(await crossNav.locator('.skyhub-global-nav a[aria-current="page"]').getAttribute('href'),
      '/','Operations must be the only selected module before navigating');
    await crossNav.locator('.skyhub-global-nav a[href="/smart-farming.html"]').click();
    await crossNav.waitForURL(url+'smart-farming.html',{waitUntil:'load'});
    assert.equal(await crossNav.locator('.skyhub-global-nav a[aria-current="page"]').getAttribute('href'),
      '/smart-farming.html','Smart Farming must be the selected module');
    assert.equal(await crossNav.evaluate(()=>getComputedStyle(document.body).backgroundColor),
      'rgb(243, 246, 251)','Light canvas remains after module navigation');
    assert.ok(await crossNav.locator('main#skyhubMain').count()===1);
    await crossNav.locator('.skyhub-global-nav a[href="/"]').click();
    await crossNav.waitForURL(url,{waitUntil:'load'});
    await assertNoOverflow(crossNav);
  }
  await crossNav.close();

  // Inspect the TWO remaining operationally different light pages with real Chromium:
  // Smart Farming has no imagery; Pilot 2 has no JSBridge or live MQTT connection.
  // Both use the actual shared CSS and synthetic loopback HTTP only.
  for(const [filename,pageType] of [
    ['smart-farming.html','smart-farming'],['pilot-login.html','pilot']
  ]){
    const screen=await context.newPage();
    screen.on('pageerror',error=>errors.push(filename+': '+error.message));
    await screen.goto(url+filename,{waitUntil:'load'});
    if(pageType==='pilot')
      await screen.waitForFunction(()=>document.querySelector('#headline')?.textContent
        .includes('Onboarding noch deaktiviert'));
    await screen.keyboard.press('Tab');
    assert.equal(await screen.evaluate(()=>document.activeElement.classList.contains('skyhub-skip-link')),
      true,filename+' first tab focuses skip link');
    await screen.keyboard.press('Enter');
    assert.equal(await screen.evaluate(()=>document.activeElement.id),'skyhubMain',
      filename+' main receives keyboard focus');
    for(const width of sizeChecks){
      await screen.setViewportSize({width,height:880});
      const visual=await screen.evaluate(()=>{
        const panel=document.querySelector('.panel');
        return {
          lightCss:[...document.styleSheets].some(sheet=>sheet.href?.endsWith('/skyhub-light.css')),
          bg:getComputedStyle(document.body).backgroundColor,
          panelBg:panel?getComputedStyle(panel).backgroundColor:null,
          scheme:getComputedStyle(document.documentElement).colorScheme,
          scrollWidth:document.documentElement.scrollWidth,
          width:window.innerWidth,
          menuLinks:document.querySelectorAll('.skyhub-global-nav a').length,
          navLinksVisible:(()=>{
            const nav=document.querySelector('.skyhub-global-nav');
            if(!nav)return true;
            const parent=nav.getBoundingClientRect();
            return [...nav.querySelectorAll('a')].every(link=>{
              const rect=link.getBoundingClientRect();
              return rect.left>=parent.left-1 && rect.right<=parent.right+1 &&
                rect.top>=parent.top-1 && rect.bottom<=parent.bottom+1;
            });
          })(),
          pilotBridge:typeof window.djiBridge!=='undefined'
        };
      });
      assert.equal(visual.lightCss,true,filename+' missing shared CSS');
      assert.equal(visual.bg,'rgb(243, 246, 251)',filename+' light canvas');
      assert.equal(visual.panelBg,'rgb(255, 255, 255)',filename+' white panel');
      assert.equal(visual.scheme,'light',filename+' color scheme');
      assert.ok(visual.scrollWidth<=visual.width+1,filename+' overflow: '+JSON.stringify(visual));
      assert.equal(visual.menuLinks,pageType==='pilot'?0:5,filename+' operator navigation');
      assert.equal(visual.navLinksVisible,true,filename+' all nav links must remain visible');
      if(pageType==='pilot'){
        assert.equal(visual.pilotBridge,false,'synthetic Pilot 2 has no device bridge');
        assert.match(await screen.locator('#result').innerText(),/JSBridge nicht verfügbar/);
      }else{
        assert.match(await screen.locator('.warning').innerText(),/Keine kalibrierte Vegetationskarte/);
      }
      if(width===320||width===1440)
        await screen.screenshot({path:path.join(output,pageType+'-'+width+'.png'),fullPage:true});
    }
    await screen.close();
  }
  // Browser-level emulation of system accessibility modes. This is a presentation
  // check, not an indication of a real DJI Pilot 2 WebView configuration.
  await page.emulateMedia({forcedColors:'active',reducedMotion:'reduce'});
  const accessibility=await page.evaluate(()=>{
    const selected=document.querySelector('.skyhub-global-nav a[aria-current="page"]');
    const button=document.querySelector('.workspace-tab');
    return {
      forced:matchMedia('(forced-colors: active)').matches,
      reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,
      canvasToken:getComputedStyle(document.documentElement).getPropertyValue('--sky-bg').trim(),
      selectedOutline:getComputedStyle(selected).outlineWidth,
      buttonTransition:getComputedStyle(button).transitionDuration,
      navTransition:getComputedStyle(selected).transitionDuration
    };
  });
  assert.equal(accessibility.forced,true,'forced system contrast mode must activate');
  assert.equal(accessibility.reduced,true,'OS reduced motion must activate');
  assert.equal(accessibility.canvasToken,'Canvas','system canvas color must replace branded canvas');
  assert.equal(accessibility.selectedOutline,'2px','current module must have nonchromatic indicator');
  assert.equal(accessibility.buttonTransition,'0s','no button transition in reduced-motion mode');
  assert.equal(accessibility.navTransition,'0s','no nav transition in reduced-motion mode');
  await page.emulateMedia({forcedColors:'none',reducedMotion:'no-preference'});
  if(errors.length)throw new Error('browser exceptions: '+errors.join('; '));
  const unexpectedWrites=requests.filter(x=>x.method!=='GET');
  assert.equal(unexpectedWrites.length,0,'no API mutations (Socket.IO may use WS)');
  const results={schema:'skyhub-tak-browser-v1',frontend:'actual frontend/public/index.html',
    clientLibraries:'real Leaflet 1.9.4 / Socket.IO 4.8.1',
    backend:'SYNTHETIC LOOPBACK ONLY; no full SkyHub server, no Pi, no DJI',
    screenWidths:sizeChecks,authenticated:true,unauthorized:true,socketDisconnected:true,
    noExportRequests:true,noHttpMutation:true,noPageErrors:true,
    sharedLightCssServed:true,computedLightPaletteChecked:true,
    smartFarmingAndPilotLightScreensChecked:true,
    dashboardSmartFarmingNavigationChecked:true,
    forcedColorsAndReducedMotionChecked:true,
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