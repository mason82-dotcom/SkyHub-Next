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
// Synthetic HMS history: 25 transitions (two pages of 20) or an explicitly disabled store.
let hmsHistoryEnabled=true;
const hmsQueries=[];
const hmsRow=i=>({id:100-i,deviceSn:i%2?'SYNTHETIC-RC-01':'SYNTHETIC-DEVICE-01',code:'0x1100000'+(i%10),
  level:i%3,componentIndex:0,sensorIndex:0,action:['appeared','updated','resolved'][i%3],
  sourceAt:new Date(Date.now()-i*60000).toISOString(),timeVerified:i!==1,
  modelName:'Testfluggerät',text:i===0?{de:'<img src=x onerror=alert(1)> Synthetischer Hinweis',en:'x'}:{de:'Synthetische Meldung '+i,en:'x'}});
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
  if(['/workspace-tabs.js','/telemetry-freshness.js','/hms-history-panel.js','/live-panel.js'].includes(url.pathname)){
    response.writeHead(200,{'Content-Type':'application/javascript'});response.end(get(url.pathname.slice(1)));return;
  }
  // Same-origin tile route of the backend; a neutral synthetic tile, never real geography.
  if(/^\/tiles\/osm\/\d+\/\d+\/\d+\.png$/.test(url.pathname)){
    response.writeHead(200,{'Content-Type':'image/png'});response.end(image);return;
  }
  // Self-hosted Leaflet exactly as the backend serves it (no CDN mock needed).
  const vendor=/^\/vendor\/leaflet\/1\.9\.4\/((?:images\/)?[a-z0-9.-]+\.(?:js|css|png))$/.exec(url.pathname);
  if(vendor){
    const type=vendor[1].endsWith('.css')?'text/css':vendor[1].endsWith('.png')?'image/png':'application/javascript';
    response.writeHead(200,{'Content-Type':type});
    response.end(get('vendor/leaflet/1.9.4/'+vendor[1]));return;
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
  if(url.pathname==='/api/diagnostics/hms-history'){
    hmsQueries.push(Object.fromEntries(url.searchParams));
    if(!authorized){json(response,{error:'unauthorized'},401);return;}
    if(!hmsHistoryEnabled){json(response,{error:'HMS history disabled',enabled:false},503);return;}
    const limit=Number(url.searchParams.get('limit')),offset=Number(url.searchParams.get('offset'));
    const device=url.searchParams.get('device');
    const all=Array.from({length:25},(_,i)=>hmsRow(i)).filter(r=>!device||r.deviceSn===device);
    const items=all.slice(offset,offset+limit);
    json(response,{enabled:true,items,limit,offset,hasMore:offset+items.length<all.length});return;
  }
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
   // Shared frame (scripts/webui-shell.py, DESIGN.md "Layout und Navigation", reorganised in #284): top level along the
   // operator workflow = "Lagebild" as a direct link to / plus the groups Planen, Fliegen, Auswerten, Diagnose, all fully
   // visible; the 17 module links live in the group menus (hidden while closed), Thermal included.
   allNavLinksVisible:(()=>{
     const nav=document.querySelector('.skyhub-global-nav');
     if(!nav)return false;
     const bound=nav.getBoundingClientRect();
     const top=[...nav.querySelectorAll(':scope > a, :scope > details > summary')];
     const direct=[...nav.querySelectorAll(':scope > a')].map(a=>a.getAttribute('href'));
     const groups=[...nav.querySelectorAll(':scope > details > summary')].map(g=>g.textContent.replace(/\s+/g,' ').trim());
     const links=[...nav.querySelectorAll('a')].map(a=>a.getAttribute('href'));
     const current=[...nav.querySelectorAll('a[aria-current="page"]')];
     return top.length===5 && direct.length===1 && direct[0]==='/' &&
       ['Planen','Fliegen','Auswerten','Diagnose'].every((name,i)=>(groups[i]||'').startsWith(name)) &&
       links.length===17 && links.includes('/thermal.html') &&
       current.length===1 && current[0].getAttribute('href')==='/' &&
       top.every(item=>{
         const rect=item.getBoundingClientRect();
         return rect.width>0 && rect.left>=bound.left-1 && rect.right<=bound.right+1 &&
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
   'top-level navigation (Lagebild link + Planen, Fliegen, Auswerten, Diagnose) must stay visible; 17 module links, current page marked once');
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
  await context.route('https://tile.openstreetmap.org/**',route=>
    route.fulfill({status:200,body:image,contentType:'image/png'}));
  await context.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.hostname==='127.0.0.1'||url.hostname==='tile.openstreetmap.org')
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
  // UX contract: field ages refresh without rebuilding the device cards. Without new data the 5 s tick must not replace
  // them (a tap could hit a replaced button); a real data change still renders. Window stays below the 15 s freshness.
  io.emit('device_update',marker());
  await page.waitForTimeout(600);
  const rebuilds=await page.evaluate(()=>new Promise(resolve=>{
    let count=0;const box=document.querySelector('#devices');
    const observer=new MutationObserver(list=>{if(list.some(m=>m.target===box&&m.removedNodes.length))count++;});
    observer.observe(box,{childList:true});
    setTimeout(()=>{observer.disconnect();resolve(count);},11000);
  }));
  assert.equal(rebuilds,0,'device cards must not be rebuilt by the 5 s tick without new data');
  io.emit('device_update',{...marker(),telemetry:{...marker().telemetry,battery:55}});
  await page.waitForFunction(()=>document.querySelector('#devices .quick')?.textContent.includes('55 %'),{timeout:5000});
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
    await page.getByRole('tab',{name:/^Lagebild$/}).click();
    assert.equal(await page.locator('#operationsPanel').isVisible(),true);
    await page.waitForFunction(previous=>window.__invalidationCount>previous,beforeInvalidate);
    assert.equal(await page.locator('.device').count(),1,'device list survives tab switches');
    assert.equal(await page.locator('.leaflet-pane').count()>0,true,'Leaflet panes survive tab switches');
    await assertNoOverflow(page);
    const fleetJump=page.locator('.skyhub-mobile-fleet-jump');
    assert.equal(await fleetJump.isVisible(),width<=900,
      'mobile fleet jump must be visible only on compact layouts');
    if(width<=900){
      const jumpRect=await fleetJump.boundingBox();
      assert.ok(jumpRect&&jumpRect.height>=44,'compact fleet shortcut is touch-sized');
      await fleetJump.click();
      assert.equal(await page.evaluate(()=>location.hash),'#fleetPanel',
        'mobile link must target the fleet panel');
      assert.equal(await page.evaluate(()=>document.activeElement.id),'fleetPanel',
        'mobile link must move focus to fleet panel');
      assert.ok(await page.locator('#fleetPanel').evaluate(node=>{
        const b=node.getBoundingClientRect();
        return b.top<window.innerHeight && b.bottom>0;
      }),'fleet region must actually enter mobile viewport');
      assert.equal(await page.locator('.device').count(),1,
        'fleet shortcut must not reset synthetic device data');
      await page.evaluate(()=>{
        history.replaceState(null,'',location.pathname+location.search);
        window.scrollTo(0,0);
      });
    }
    if(width===320||width===1440)
      await page.screenshot({path:path.join(output,'operations-'+width+'.png'),fullPage:true});
    if(width===390){
      const small=await page.evaluate(()=>[...document.querySelectorAll('#operationsPanel summary, #operationsPanel label.toggle')]
        .filter(node=>node.offsetParent!==null)
        .map(node=>[node.textContent.trim().slice(0,30),Math.round(node.getBoundingClientRect().height)])
        .filter(([,height])=>height<24));
      assert.deepEqual(small,[],'tap targets must be at least 24 px high: '+JSON.stringify(small));
    }
  }
  await page.getByRole('tab',{name:/^Lagebild$/}).focus();
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
  await guest.waitForFunction(()=>document.querySelector('#devices')?.textContent.includes('Heimnetz'),{timeout:15000});
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
    // Smart Farming sits in the "Labor" group menu of the shared frame: open the group like a user, then follow the link.
    await crossNav.locator('.skyhub-global-nav details:has(a[href="/smart-farming.html"]) > summary').click();
    await crossNav.locator('.skyhub-global-nav a[href="/smart-farming.html"]').click();
    await crossNav.waitForURL(url+'smart-farming.html',{waitUntil:'load'});
    assert.equal(await crossNav.locator('.skyhub-global-nav a[aria-current="page"]').getAttribute('href'),
      '/smart-farming.html','Smart Farming must be the selected module');
    assert.equal(await crossNav.locator('.skyhub-global-nav details.is-active a[aria-current="page"]').count(),1,
      'the group of the selected module is marked active');
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
    assert.equal(await screen.locator('.skyhub-skip-link').evaluate(el=>
      getComputedStyle(el).clipPath==='inset(50%)'),true,
      filename+' skip link must hide again after focus moves');
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
          // top level of the shared frame (Lagebild link + group buttons); module links sit in the closed group menus
          navLinksVisible:(()=>{
            const nav=document.querySelector('.skyhub-global-nav');
            if(!nav)return true;
            const parent=nav.getBoundingClientRect();
            return [...nav.querySelectorAll(':scope > a, :scope > details > summary')].every(link=>{
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
      assert.equal(visual.menuLinks,pageType==='pilot'?0:17,filename+' operator navigation');
      assert.equal(visual.navLinksVisible,true,filename+' top-level navigation must remain visible');
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
  // HMS history in a fresh dashboard page: lazy load, paging, device filter, literal text, disabled store.
  authorized=true;hmsHistoryEnabled=true;
  const hmsPage=await context.newPage();
  hmsPage.on('pageerror',error=>errors.push(error.message));
  const hmsBefore=hmsQueries.length;
  await hmsPage.goto(url,{waitUntil:'domcontentloaded'});
  await hmsPage.waitForFunction(()=>document.querySelector('#count')?.textContent==='1',{timeout:15000});
  assert.equal(hmsQueries.length,hmsBefore,'HMS history loads lazily, only when opened');
  // HMS history: nothing is fetched until the operator opens the panel.
  // Offline hint moved from a .notice box into the sidebar legend with #284 (calmer status area).
  assert.match(await hmsPage.locator('.sidebar-legend').first().textContent(),/ohne Internet verfügbar/);
  await hmsPage.locator('#hmsHistoryPanel summary').click();
  await hmsPage.waitForFunction(()=>document.querySelectorAll('#hmsHistoryList li').length===20,{timeout:10000});
  assert.match(await hmsPage.locator('#hmsHistorySummary').textContent(),/^20\+ Einträge$/);
  const firstHms=hmsPage.locator('#hmsHistoryList li').first();
  assert.equal(await firstHms.getAttribute('data-action'),'appeared');
  assert.match(await firstHms.textContent(),/<img src=x onerror=alert\(1\)> Synthetischer Hinweis/,'HMS text stays literal');
  assert.equal(await hmsPage.locator('#hmsHistoryList img').count(),0,'no markup injected from HMS text');
  assert.match(await hmsPage.locator('#hmsHistoryList li').nth(1).textContent(),/Zeit ungeprüft/);
  await hmsPage.locator('#hmsHistoryMore').click();
  await hmsPage.waitForFunction(()=>document.querySelectorAll('#hmsHistoryList li').length===25,{timeout:10000});
  assert.equal(await hmsPage.locator('#hmsHistoryMore').isHidden(),true,'no further page after the last entry');
  assert.equal(hmsQueries.at(-1).offset,'20');
  await hmsPage.locator('#hmsHistoryDevice').selectOption('SYNTHETIC-DEVICE-01');
  await hmsPage.waitForFunction(()=>document.querySelectorAll('#hmsHistoryList li').length===13,{timeout:10000});
  assert.equal(hmsQueries.at(-1).device,'SYNTHETIC-DEVICE-01');
  await hmsPage.locator('#hmsHistoryPanel').scrollIntoViewIfNeeded();
  await hmsPage.screenshot({path:path.join(output,'dashboard-hms-history.png')});
  hmsHistoryEnabled=false;
  await hmsPage.locator('#hmsHistoryRefresh').click();
  await hmsPage.waitForFunction(()=>document.querySelector('#hmsHistorySummary').textContent==='nicht aktiviert',{timeout:10000});
  assert.match(await hmsPage.locator('#hmsHistoryNote').textContent(),/SKYHUB_HMS_HISTORY_ENABLED/);
  assert.equal(await hmsPage.locator('#hmsHistoryList li').count(),0);
  hmsHistoryEnabled=true;
  await hmsPage.locator('#hmsHistoryPanel summary').click();
  await hmsPage.close();
  const results={schema:'skyhub-tak-browser-v1',frontend:'actual frontend/public/index.html',
    clientLibraries:'real Leaflet 1.9.4 / Socket.IO 4.8.1',
    backend:'SYNTHETIC LOOPBACK ONLY; no full SkyHub server, no Pi, no DJI',
    screenWidths:sizeChecks,authenticated:true,unauthorized:true,socketDisconnected:true,
    noExportRequests:true,noHttpMutation:true,noPageErrors:true,
    sharedLightCssServed:true,computedLightPaletteChecked:true,
    smartFarmingAndPilotLightScreensChecked:true,
    dashboardSmartFarmingNavigationChecked:true,
    forcedColorsAndReducedMotionChecked:true,
    mobileFleetShortcutFocusChecked:true,
    singleSocketSessionDuringTabNavigation:true,leafletRecalculatedOnEveryReturn:true,
    hmsHistoryPanelChecked:true};
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(results,null,2)+'\n');
  process.stdout.write(JSON.stringify(results,null,2)+'\n');
  await context.close();
 }finally{await browser.close();}
}
run().catch(error=>{console.error(error.stack||error);process.exitCode=1;}).finally(async()=>{
 await new Promise(resolve=>io.close(()=>resolve()));
 await new Promise(resolve=>server.close(()=>resolve()));
});