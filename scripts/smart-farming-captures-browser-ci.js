'use strict';
// Delivered UI with metadata fixtures on loopback only; no Pi, MinIO or DJI contact.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const root=path.resolve(__dirname,'..');
const express=require(path.join(root,'backend/node_modules/express'));
const {assess,ASSESSMENT_VERSION}=require(path.join(root,'backend/smart-farming-captures'));
const {chromium}=process.env.SKYHUB_BROWSER_DEPS?
  require(path.join(process.env.SKYHUB_BROWSER_DEPS,'playwright')):require('playwright');
const output=process.env.SKYHUB_BROWSER_ARTIFACTS||path.join(os.tmpdir(),'skyhub-captures-browser');
fs.mkdirSync(output,{recursive:true});
const BANDS=['G','R','RE','NIR'];
function capture(n,change=()=>{}){
  const c={captureUUID:String(n).padStart(32,'0'),createdAt:'2026-11-01T12:00:00Z',
    model:'M3M',gps:{lat:49,lon:8},relativeAltitude:30,absoluteAltitude:120,
    gpsAssessment:{positionCount:4,validPositionCount:4,missingOrNonNumericCount:0,
      outOfRangeCount:0,zeroSentinelCount:0,allPositionsValid:true,commonPositionAvailable:true,
      consistency:'exact',maxSpreadMetres:0,distanceMethod:'spherical-haversine-not-gnss-accuracy',toleranceApplied:false},
    metadataConflicts:[],sources:['synthetic-only/'+('x'.repeat(140))],preview:null,
    bands:Object.fromEntries(BANDS.map(b=>[b,{bucket:'dji-cloud',key:'synthetic-only/'+b+'.tif',
      name:b+'.tif',wavelength:650,irradiance:900,size:2000000,etag:'synthetic'}]))};
  change(c);return Object.assign(c,assess(c));
}
const fixtures=[capture(1),capture(2,c=>{c.relativeAltitude=0;}),
  capture(3,c=>{c.bands.R.irradiance=null;}),capture(4,c=>{
    c.bandCounts={G:2,R:1,RE:1,NIR:1};delete c.bands.G;
    Object.assign(c.gpsAssessment,{positionCount:5,validPositionCount:5,maxSpreadMetres:null});
  }),capture(5,c=>{
    c.gps=null;c.metadataConflicts=['gps'];
    Object.assign(c.gpsAssessment,{commonPositionAvailable:false,consistency:'different',maxSpreadMetres:.028009});
  }),capture(6,c=>{
    c.gps=null;
    Object.assign(c.gpsAssessment,{validPositionCount:0,zeroSentinelCount:4,allPositionsValid:false,
      commonPositionAvailable:false,consistency:'unavailable',maxSpreadMetres:null});
  })];
let mode='normal',pending=null,captureRequests=0;
const app=express();
const json=(res,value,status=200)=>res.status(status).set('Cache-Control','no-store').json(value);
function reply(res){
  if(mode==='error')return json(res,{error:'Storage unavailable'},503);
  const list=mode==='empty'?[]:mode==='legacy'?[{...fixtures[0],assessmentVersion:'skyhub-m3m-capture-assessment-v2'}]:fixtures;
  return json(res,{assessmentVersion:mode==='legacy'?undefined:ASSESSMENT_VERSION,
    count:list.length,usable:list.filter(c=>c.usable).length,captures:list,
    notice:'Synthetische Browserprüfung. Keine Radiometrie- oder Mapping-Freigabe.'});
}
app.get('/api/smart-farming/captures',(_req,res)=>{
  captureRequests++;
  if(mode==='slow'){pending=res;return;}
  reply(res);
});
app.get('/api/smart-farming/candidates',(_req,res)=>json(res,{error:'Not enabled'},404));
app.use(express.static(path.join(root,'frontend/public')));
const server=app.listen(0,'127.0.0.1');
async function main(){
  await new Promise(r=>server.listening?r():server.once('listening',r));
  const base='http://127.0.0.1:'+server.address().port;
  let browser;
  try{
    browser=await chromium.launch({headless:true,args:['--no-sandbox']});
    const context=await browser.newContext({viewport:{width:1440,height:1000}});
    await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
    const page=await context.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    const ready=()=>page.locator('#loadCaptures:not([disabled])').waitFor();
    await page.goto(base+'/smart-farming.html');await ready();
    assert.equal(await page.locator('.capture-card').count(),6);
    assert.equal(await page.getByText('Metadaten-Kandidat',{exact:true}).count(),1);
    assert.equal(await page.getByText('Metadaten-Prüfung blockiert',{exact:true}).count(),5);
    assert.match(await page.locator('#captureStatus').innerText(),/Metadaten-Kandidaten: 1/);
    assert.match(await page.locator('.capture-card').nth(1).innerText(),/Höhe über Start unter 1 m/);
    assert.match(await page.locator('.capture-card').nth(2).innerText(),/Sonnensensorwerte fehlen/);
    const conflict=page.locator('.capture-card').nth(3);
    assert.match(await conflict.innerText(),/Bandstatus: mehrdeutig/);
    assert.equal(await conflict.locator('.band-row a').count(),3);
    assert.equal(await conflict.getByText('Grün mehrdeutig',{exact:true}).count(),1);
    assert.equal(await page.getByText(/Auswertbar/).count(),0);
    const different=await page.locator('.capture-card').nth(4).innerText();
    assert.match(different,/4\/4 Objektpositionen gültig; Bandpositionen abweichend/);
    assert.match(different,/maximale Distanz ca. 0,028 m/);
    assert.match(different,/kein gemeinsamer Positionswert/);assert.ok(!different.includes('kein GPS'));
    assert.match(await page.locator('.capture-card').nth(5).innerText(),/0\/4 Objektpositionen gültig/);
    for(const width of [320,390,834,1440]){
      await page.setViewportSize({width,height:1000});
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),
        'capture cards must fit viewport '+width);
      await page.screenshot({path:path.join(output,'m3m-captures-'+width+'.png'),fullPage:true});
    }
    await page.locator('#loadCaptures').focus();
    assert.equal(await page.evaluate(()=>document.activeElement.id),'loadCaptures');
    const before=captureRequests;
    await page.keyboard.press('Enter');await ready();
    assert.equal(captureRequests,before+1,'keyboard reload invokes the real handler');

    mode='legacy';await page.locator('#loadCaptures').click();await ready();
    assert.equal(await page.getByText('Bewertung nicht aktuell',{exact:true}).count(),1);
    assert.equal(await page.getByText('Metadaten-Kandidat',{exact:true}).count(),0);
    assert.match(await page.locator('#captureStatus').innerText(),/Metadaten-Kandidaten: 0/);

    mode='empty';await page.locator('#loadCaptures').click();await ready();
    assert.equal(await page.locator('.capture-card').count(),0);
    assert.match(await page.locator('#captureStatus').innerText(),/0 Aufnahmen/);

    mode='error';await page.locator('#loadCaptures').click();await ready();
    assert.match(await page.locator('#captureStatus').innerText(),/Speicher nicht erreichbar/);
    assert.equal(await page.locator('.capture-card').count(),0);

    mode='slow';await page.locator('#loadCaptures').click();
    await page.waitForFunction(()=>document.querySelector('#captureList').getAttribute('aria-busy')==='true');
    assert.equal(await page.locator('#loadCaptures').isDisabled(),true);
    assert.match(await page.locator('#captureStatus').innerText(),/werden eingelesen/);
    const slowRequests=captureRequests;
    await page.locator('#loadCaptures').dispatchEvent('click');
    assert.equal(captureRequests,slowRequests,'duplicate action while busy is ignored');
    mode='normal';assert.ok(pending);reply(pending);pending=null;await ready();
    assert.equal(await page.locator('.capture-card').count(),6);
    assert.equal(await page.locator('#captureList').getAttribute('aria-busy'),'false');

    // Accelerate only the capture timeout in a separate page; no 30-second sleep.
    const timeoutPage=await context.newPage();
    timeoutPage.on('pageerror',e=>errors.push(e.message));
    await timeoutPage.addInitScript(()=>{
      const original=window.setTimeout;
      window.setTimeout=(callback,delay,...args)=>original(callback,delay===30000?50:delay,...args);
    });
    mode='slow';await timeoutPage.goto(base+'/smart-farming.html');
    await timeoutPage.waitForFunction(()=>document.querySelector('#captureStatus').textContent.includes('Zeitüberschreitung'));
    assert.equal(await timeoutPage.locator('#loadCaptures').isEnabled(),true);
    pending?.destroy();pending=null;
    mode='normal';await timeoutPage.locator('#loadCaptures').click();
    await timeoutPage.locator('#loadCaptures:not([disabled])').waitFor();
    assert.equal(await timeoutPage.locator('.capture-card').count(),6);
    assert.deepEqual(errors,[]);
    fs.writeFileSync(path.join(output,'m3m-captures-report.json'),JSON.stringify({passed:true,
      syntheticOnly:true,widths:[320,390,834,1440],checks:['candidate','ground','missing-irradiance',
        'duplicate-band-no-download','gps-disagreement','gps-zero-sentinel','legacy-version','empty','error','keyboard-reload','busy','timeout-retry'],
      piVerified:false,radiometryVerified:false},null,2));
    console.log('M3M capture Chromium states, keyboard, narrow layout and timeout recovery: PASS (synthetic only)');
  }finally{pending?.destroy();await browser?.close();await new Promise(r=>server.close(r));}
}
main().catch(err=>{console.error(err);process.exitCode=1;});
