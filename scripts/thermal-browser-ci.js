'use strict';
// Actual Thermal UI and API, synthetic in-memory JPEGs, loopback only. No DJI/Pi/MinIO.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {Readable}=require('node:stream');
const root=path.resolve(__dirname,'..');
const express=require(path.join(root,'backend/node_modules/express'));
const {createThermalRouter}=require(path.join(root,'backend/thermal'));
const {chromium}=process.env.SKYHUB_BROWSER_DEPS?
  require(path.join(process.env.SKYHUB_BROWSER_DEPS,'playwright')):require('playwright');
const output=process.env.SKYHUB_BROWSER_ARTIFACTS||path.join(root,'tmp/thermal-browser');
fs.mkdirSync(output,{recursive:true});
const names={a:'DJI_20261022080518_0001_T.JPG',b:'DJI_20261022080519_0002_T.JPG',c:'DJI_20261022080520_0003_T.JPG'};
function segment(marker,data){const h=Buffer.alloc(4);h[0]=255;h[1]=marker;h.writeUInt16BE(data.length+2,2);return Buffer.concat([h,data]);}
function rjpeg(){
  const raw=Buffer.alloc(320*256*2);for(let i=0;i<raw.length;i+=2)raw.writeUInt16LE(20000,i);
  const parts=[Buffer.from([255,216]),segment(0xE1,Buffer.from('<x:xmpmeta><rdf:Description drone-dji:DroneModel="M4T" drone-dji:ImageSource="InfraredCamera"/></x:xmpmeta>'))];
  for(let i=0;i<raw.length;i+=65000)parts.push(segment(0xE3,raw.subarray(i,i+65000)));
  const app4=Buffer.alloc(64);app4.write('iirp',4);app4.writeFloatLE(.95,40);parts.push(segment(0xE4,app4),Buffer.from([255,218,0,2,255,217]));
  return Buffer.concat(parts);
}
const jpeg=rjpeg();let failB=true,slowC=false,shortRaw=false;
const app=express();
app.get('/api/thermal/raw',(req,res,next)=>{
  if(!shortRaw)return next();
  res.set({'X-Thermal-Version':req.query.version,'X-Thermal-Width':'320','X-Thermal-Height':'256'}).send(Buffer.alloc(2));
});
app.use('/api/thermal',createThermalRouter({
  storage:{getObject:async(_bucket,key)=>{
    if(key==='b'&&failB)throw Object.assign(new Error('Synthetic missing'),{status:404});
    if(key==='c'&&slowC)await new Promise(r=>setTimeout(r,350));
    return {contentLength:jpeg.length,body:Readable.from([jpeg])};
  }},bucketIndex:async()=>({objects:Object.entries(names).map(([key,displayName])=>({key,displayName,size:jpeg.length}))}),
  buckets:async()=>['dji-cloud']
}));
app.use(express.static(path.join(root,'frontend/public')));
const server=app.listen(0,'127.0.0.1');
async function download(page,button){const event=page.waitForEvent('download');await page.locator(button).click();const d=await event;return {name:d.suggestedFilename(),data:fs.readFileSync(await d.path())};}
async function main(){
  await new Promise(r=>server.listening?r():server.once('listening',r));
  const base='http://127.0.0.1:'+server.address().port;
  let browser;
  try{
    browser=await chromium.launch({headless:true,args:['--no-sandbox']});
    const context=await browser.newContext({acceptDownloads:true,viewport:{width:1280,height:900}});
    await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
    await context.addInitScript(()=>{
      window.__thermalTexts=[];
      const fill=CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText=function(text,...args){window.__thermalTexts.push({id:this.canvas.id,text});return fill.call(this,text,...args);};
    });
    const page=await context.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(base+'/thermal.html#bucket=dji-cloud&key=a');
    await page.locator('#export-csv:not([disabled])').waitFor();
    await page.locator('[data-tool=spot]').click();
    await page.locator('#thermal').click({position:{x:100,y:100}});
    await page.locator('#eps').fill('0.85');await page.locator('#reflected').fill('0');
    const expected=await page.evaluate(()=>window.SkyhubThermal.format(window.SkyhubThermal.correct(20000/64-273.15,{epsFile:.95,eps:.85,reflected:0})));
    assert.ok((await page.locator('#measurements').innerText()).includes(expected));
    assert.ok(await page.evaluate(expected=>window.__thermalTexts.some(r=>r.id==='thermal'&&r.text==='1: '+expected),expected));
    const csv=await download(page,'#export-csv');
    assert.match(csv.data.toString(),/Schätzung/);assert.match(csv.data.toString(),/Reflektierte Temperatur °C;0,00/);
    assert.match(csv.data.toString(),/Quellversion SHA-256;[0-9a-f]{64}/);
    const matrix=await download(page,'#export-matrix');
    assert.match(matrix.data.toString(),/Schätzung/);
    assert.equal(matrix.data.toString().trim().split('\r\n').slice(-256).every(line=>line.split(';').length===320),true);
    await page.evaluate(()=>{
      const original=HTMLCanvasElement.prototype.toBlob;
      HTMLCanvasElement.prototype.toBlob=function(cb,...args){original.call(this,blob=>{window.__thermalRelease=()=>cb(blob);},...args);};
    });
    await page.locator('#export-png').click();await page.waitForFunction(()=>typeof window.__thermalRelease==='function');
    await page.locator('#list button').filter({hasText:names.b}).click();
    await page.waitForFunction(()=>document.getElementById('message').textContent.includes('HTTP 404'));
    assert.equal(await page.locator('#export-png').isDisabled(),true);
    const delayed=page.waitForEvent('download');await page.evaluate(()=>window.__thermalRelease());const png=await delayed;
    assert.ok(png.suggestedFilename().startsWith(names.a.replace('.JPG','')+'_'));
    const bytes=fs.readFileSync(await png.path());assert.equal(bytes.subarray(1,4).toString(),'PNG');
    assert.ok(bytes.readUInt32BE(20)>256,'PNG must include provenance footer');
    assert.ok(await page.evaluate(()=>window.__thermalTexts.some(r=>r.id===''&&r.text.includes('Schätzung'))));
    slowC=true;await page.locator('#list button').filter({hasText:names.c}).click();
    assert.equal(await page.locator('#export-csv').isDisabled(),true);
    await page.locator('#list button').filter({hasText:names.a}).click();
    await page.locator('#export-csv:not([disabled])').waitFor();
    await page.waitForTimeout(450);
    assert.equal(new URLSearchParams((await page.evaluate(()=>location.hash)).slice(1)).get('key'),'a');
    shortRaw=true;await page.locator('#list button').filter({hasText:names.a}).click();
    await page.waitForFunction(()=>document.getElementById('message').textContent.includes('nicht zur selben Bildversion'));
    assert.equal(await page.locator('#export-csv').isDisabled(),true);
    shortRaw=false;await page.locator('#list button').filter({hasText:names.a}).click();
    await page.locator('#export-csv:not([disabled])').waitFor();
    await page.locator('#eps').fill('2');assert.equal(await page.locator('#export-csv').isDisabled(),true);
    assert.equal(await page.locator('#eps').getAttribute('aria-invalid'),'true');
    await page.locator('#eps').fill('0.95');await page.locator('#export-csv:not([disabled])').waitFor();
    await page.locator('#tab-series').click();failB=false;
    await page.locator('#series-run').click();await page.locator('#series-csv:not([disabled])').waitFor();
    const series=await download(page,'#series-csv');assert.match(series.data.toString(),/Schätzung/);assert.match(series.data.toString(),/Unkorrigierte Dateischätzung/);
    await page.locator('#tab-image').click();
    for(const width of [320,390,1280]){
      await page.setViewportSize({width,height:900});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'horizontal overflow at '+width);
    }
    await page.screenshot({path:path.join(output,'thermal-synthetic.png'),fullPage:true});
    assert.deepEqual(errors,[]);
    fs.writeFileSync(path.join(output,'thermal-acceptance.json'),JSON.stringify({syntheticOnly:true,hardwareAcceptance:false,passed:true},null,2));
    console.log('Thermal Chromium: load/error/stale/short frame, corrected labels, 0°C, invalid-input recovery, PNG/CSV/matrix/series provenance, 320/390/1280px PASS');
    await context.close();
  }finally{await browser?.close();await new Promise(r=>{server.close(r);server.closeAllConnections();});}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
