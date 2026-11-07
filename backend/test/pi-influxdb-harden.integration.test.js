'use strict';
// Proves the script's assumptions on a real, throwaway InfluxDB 1.x (random loopback port, temp
// directories, nothing of the host service is touched): env variables override the config, the
// admin is created before auth is switched on, and rollback (env removed) opens it again.
// Skipped when `influxd` is not installed (CI does not install it).
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawn,spawnSync}=require('node:child_process');

const hasInfluxd=spawnSync('influxd',['version'],{stdio:'ignore'}).status===0;
const skip=hasInfluxd?false:'influxd not installed';
const HTTP_PORT=20000+Math.floor(Math.random()*9000);
process.env.SKYHUB_INFLUX_URL='http://127.0.0.1:'+HTTP_PORT;
const harden=require('../../scripts/pi-influxdb-harden');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const base='http://127.0.0.1:'+HTTP_PORT;

test('auth via environment, admin creation and removal of the override',{skip,timeout:120000},async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'skyhub-influx-'));
  let child=null;
  t.after(()=>{try{child?.kill('SIGKILL');}catch(_){}fs.rmSync(dir,{recursive:true,force:true});});
  fs.writeFileSync(path.join(dir,'influxdb.conf'),[
    'reporting-disabled = true','bind-address = "127.0.0.1:'+(HTTP_PORT+1)+'"',
    '[meta]','  dir = "'+dir+'/meta"','[data]','  dir = "'+dir+'/data"','  wal-dir = "'+dir+'/wal"',
    '  index-version = "tsi1"','[http]','  bind-address = "127.0.0.1:'+HTTP_PORT+'"','  auth-enabled = false',
    '[monitor]','  store-enabled = false',''].join('\n'));
  const start=async env=>{
    child=spawn('influxd',['-config',path.join(dir,'influxdb.conf')],{env:{...process.env,...env},stdio:'ignore'});
    for(let i=0;i<80;i++){
      if((await harden.influx(base,{path:'/ping'}).catch(()=>({status:0}))).status===204)return;
      await sleep(250);
    }
    throw new Error('influxd did not start');
  };
  const stop=async()=>{child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));child=null;};
  const credFile=path.join(dir,'admin.cred');

  await start({});
  assert.equal((await harden.influx(base,{query:'SHOW DATABASES'})).status,200,'baseline is open');
  const created=await harden.ensureAdmin({base,user:'skyhub_admin',credFile});
  assert.equal(created.created,true);
  assert.equal(fs.statSync(credFile).mode&0o777,0o600);
  assert.equal((await harden.ensureAdmin({base,user:'skyhub_admin',credFile})).created,false,'idempotent');
  await stop();

  await start({INFLUXDB_HTTP_AUTH_ENABLED:'true'});
  const checks=await harden.verifyState({auth:true,bind:null},harden.readCred(credFile));
  assert.deepEqual(checks.filter(c=>!c.pass),[]);
  assert.equal((await harden.ensureAdmin({base,user:'skyhub_admin',credFile})).created,false,'re-apply with auth on');
  await assert.rejects(harden.ensureAdmin({base,user:'skyhub_admin',credFile:path.join(dir,'missing.cred')}),
    /Zugangsdaten|fehlt/);
  await stop();

  await start({});
  assert.equal((await harden.influx(base,{query:'SHOW DATABASES'})).status,200,'open again after rollback');
});
