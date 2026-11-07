'use strict';
// Runs the dedicated-broker script's own config, password file, ACL and probe program against a
// real, throwaway Mosquitto (loopback, random port). Mocks cannot show the behaviour that bit us
// before: wildcard SUBSCRIBEs are acknowledged and filtered only at delivery time.
// Needs the `mosquitto` binary; CI sets SKYHUB_REQUIRE_MOSQUITTO=1 so a missing binary fails there.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const net=require('node:net');
const path=require('node:path');
const {spawn,execFileSync}=require('node:child_process');
const mqtt=require('mqtt');
const {aclText,confText,passwdLine,connectCases,aclCases,deliveryChecks,probeProgram}=
  require('../../scripts/pi-mosquitto-dedicated');

function findMosquitto(){
  const candidates=['/usr/sbin/mosquitto','/usr/bin/mosquitto',
    ...(process.env.PATH||'').split(path.delimiter).map(dir=>path.join(dir,'mosquitto'))];
  return candidates.find(file=>{try{fs.accessSync(file,fs.constants.X_OK);return true;}catch{return false;}});
}
const binary=findMosquitto();
if(!binary && process.env.SKYHUB_REQUIRE_MOSQUITTO==='1')throw new Error('mosquitto binary required but not installed');
const skip=binary?false:'mosquitto binary not installed';

const accounts={
  reader:{username:'t_reader',password:'reader-pass-0123456789'},
  ack:{username:'t_topology',password:'topology-pass-0123456789'},
  pilot:{username:'t_pilot',password:'pilot-pass-0123456789ab'}
};
// Synthetic users only: the test broker never sees any production credentials.
const drcAccounts={...accounts,
  commander:{username:'t_drc_commander',password:'test-drc-commander-pass-0123456789'},
  drcLink:{username:'t_drc_link',password:'test-drc-link-pass-0123456789'}
};
const freePort=()=>new Promise((resolve,reject)=>{
  const server=net.createServer();
  server.once('error',reject);
  server.listen(0,'127.0.0.1',()=>{const {port}=server.address();server.close(()=>resolve(port));});
});
async function waitForPort(port,child,stderr){
  for(let i=0;i<50;i++){
    if(child.exitCode!==null){
      throw new Error('mosquitto exited early with code '+child.exitCode+': '+stderr().trim().slice(-600));
    }
    const open=await new Promise(resolve=>{
      const socket=net.connect(port,'127.0.0.1');
      socket.once('connect',()=>{socket.destroy();resolve(true);});
      socket.once('error',()=>resolve(false));
    });
    if(open)return;
    await new Promise(r=>setTimeout(r,100));
  }
  throw new Error('mosquitto did not start listening');
}
// Starts a broker from the script's real generators; `acl` can be replaced to simulate a bad ACL.
async function withBroker(acl,fn,users=accounts){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'skyhub-mq-'));
  const port=await freePort();
  fs.writeFileSync(path.join(dir,'passwd'),Object.values(users).map(passwdLine).join('\n')+'\n',{mode:0o600});
  fs.writeFileSync(path.join(dir,'acl'),acl,{mode:0o600});
  fs.writeFileSync(path.join(dir,'mosquitto.conf'),
    confText({port,bind:'127.0.0.1',confDir:dir,logDest:'stderr'}),{mode:0o600});
  // Run a private copy: distribution AppArmor profiles attach to /usr/sbin/mosquitto by path and
  // would deny reading config, password and ACL files from a temp directory (exit code 3).
  const executable=path.join(dir,'mosquitto-test-binary');
  fs.copyFileSync(binary,executable);
  fs.chmodSync(executable,0o755);
  const child=spawn(executable,['-c',path.join(dir,'mosquitto.conf')],{stdio:['ignore','ignore','pipe']});
  let stderrText='';
  child.stderr.on('data',chunk=>{stderrText=(stderrText+chunk).slice(-4000);});
  try{
    await waitForPort(port,child,()=>stderrText);
    return await fn('mqtt://127.0.0.1:'+port);
  }finally{
    child.kill('SIGTERM');
    await new Promise(resolve=>child.exitCode!==null?resolve():child.once('exit',resolve));
    fs.rmSync(dir,{recursive:true,force:true});
  }
}
function runProbe(broker,cases,users){
  const program=probeProgram(broker,{cases:cases.map(({expect,name,...c})=>c),users},require.resolve('mqtt'));
  const out=execFileSync(process.execPath,['-'],{input:program,encoding:'utf8',timeout:60000});
  return JSON.parse(out.trim().split('\n').pop());
}
function failures(cases,{results,got},withDelivery){
  const bad=cases.filter((c,i)=>!c.expect.test(results[i])).map((c,i)=>c.name+' -> '+results[cases.indexOf(c)]);
  if(withDelivery)bad.push(...deliveryChecks(got).filter(d=>!d.pass).map(d=>d.name));
  return bad;
}

test('login: anonymous and wrong passwords are refused, the three roles connect',{skip},async()=>{
  await withBroker(aclText(accounts),async broker=>{
    const cases=connectCases(accounts);
    assert.deepEqual(failures(cases,runProbe(broker,cases,null),false),[]);
  });
});

test('ACL: send rights and message delivery match the role matrix',{skip},async()=>{
  await withBroker(aclText(accounts),async broker=>{
    const cases=aclCases(accounts);
    assert.deepEqual(failures(cases,runProbe(broker,cases,accounts),true),[]);
  });
});

test('the delivery check has teeth: a topology account that may read everything is caught',{skip},async()=>{
  const leaky=aclText(accounts)+'\nuser '+accounts.ack.username+'\ntopic read #\n';
  await withBroker(leaky,async broker=>{
    const cases=aclCases(accounts);
    const bad=failures(cases,runProbe(broker,cases,accounts),true);
    assert.ok(bad.some(name=>/Topologie-Publisher erhaelt nichts/.test(name)),'leak not detected: '+JSON.stringify(bad));
  });
});


// End-to-end Mosquitto authorization checks for optional DRC roles. Unlike the
// synthetic session tests, this uses real MQTT v5 PUBACK and actual ACL-filtered
// deliveries over an ephemeral, loopback-only broker. No SkyHub backend or RC.
function connectRole(broker,account,label){
  return new Promise((resolve,reject)=>{
    const client=mqtt.connect(broker,{
      username:account.username,password:account.password,protocolVersion:5,
      reconnectPeriod:0,connectTimeout:3000,clean:true,
      clientId:'skyhub_ci_drc_'+label+'_'+process.pid+'_'+Math.random().toString(16).slice(2)
    });
    client.once('connect',()=>resolve(client));
    client.once('error',err=>{client.end(true);reject(err);});
  });
}
function subscribeAll(client){
  return new Promise((resolve,reject)=>client.subscribe('#',{qos:1},err=>err?reject(err):resolve()));
}
function publishAck(client,topic){
  return new Promise(resolve=>client.publish(topic,JSON.stringify({ci:'drc-acl-only'}),{qos:1,retain:false},err=>resolve(err||null)));
}
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const drcTopic=(channel)=>'thing/product/SIMRCP2/'+channel;

test('DRC ACL on real Mosquitto: service, uplink, and RC OSD deliveries stay role-isolated',{skip},async()=>{
  await withBroker(aclText(drcAccounts),async broker=>{
    const client={};
    try{
      for(const k of ['reader','pilot','commander','drcLink'])
        client[k]=await connectRole(broker,drcAccounts[k],k);
      const seen=Object.fromEntries(Object.keys(client).map(k=>[k,[]]));
      for(const [role,c] of Object.entries(client)){
        c.on('message',topic=>seen[role].push(topic));
        await subscribeAll(c);
      }
      await wait(150);
      // Every publish is QoS 1. A success must be backed by MQTT's real PUBACK.
      const allowed=[
        ['commander','services'],['commander','drc/down'],['commander','events_reply'],
        ['drcLink','drc/up'],['pilot','osd'],['pilot','services_reply'],['pilot','events']
      ];
      for(const [role,channel] of allowed)
        assert.equal(await publishAck(client[role],drcTopic(channel)),null,role+' -> '+channel+' should be permitted');
      const denied=[
        ['reader','services'],['reader','drc/down'],['reader','drc/up'],
        ['commander','drc/up'],['commander','osd'],['drcLink','services'],
        ['drcLink','drc/down'],['drcLink','events_reply'],['drcLink','osd'],
        ['pilot','drc/down']
      ];
      for(const [role,channel] of denied){
        const err=await publishAck(client[role],drcTopic(channel));
        assert.ok(err,role+' -> '+channel+' MUST fail');
        assert.match(String(err.code||err.message),/135|not.authorized|Not.authorized|unauthorized/i);
      }
      await wait(300);
      const has=(role,channel)=>seen[role].includes(drcTopic(channel));
      for(const ch of ['drc/up','osd','services_reply','events'])
        assert.equal(has('commander',ch),true,'commander must receive '+ch);
      for(const ch of ['services','drc/down','events_reply'])
        assert.equal(has('commander',ch),false,'commander must not read '+ch);
      assert.equal(has('drcLink','drc/down'),true,'the RC DRC link receives control frames');
      for(const ch of ['services','drc/up','events_reply','osd','services_reply','events'])
        assert.equal(has('drcLink',ch),false,'DRC link cannot monitor '+ch);
      assert.equal(has('reader','services'),false);
      assert.equal(has('reader','drc/down'),false);
      assert.equal(has('reader','drc/up'),false);
      assert.equal(has('reader','osd'),true);
      assert.equal(has('pilot','services'),true,'Pilot 2 can read service requests');
      assert.equal(has('pilot','drc/down'),true,'Pilot 2 reads DRC control frames');
    }finally{
      for(const c of Object.values(client))c.end(true);
    }
  },drcAccounts);
});
