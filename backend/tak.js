'use strict';
// TAK / CloudTAK output (design docs/entwurf-missionsfreigabe-ndvi-tak-2026-11-04.md §5): live aircraft (and optionally RC)
// positions as Cursor on Target (CoT 2.0) to a TAK Server (TLS, client certificate) and/or as multicast SA (239.2.3.1:6969).
// Outbound only, off by default. CloudTAK shows what the TAK Server distributes; no CloudTAK-specific interface.
// Rules: only fresh positions with a verified source time, never 0/0; 1 Hz per device at most, on change or every 5 s
// (heartbeat); stale = source time + 15 s; nothing older than 30 s is ever sent (no buffering while disconnected).
const tls=require('node:tls');
const dgram=require('node:dgram');
const fs=require('node:fs');

const esc=s=>String(s).replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));
const iso=ms=>new Date(ms).toISOString();
const num=v=>typeof v==='number'&&Number.isFinite(v)?v:null;

// One CoT event for a registry device snapshot; null when the position may not be sent.
function cotEvent(device,{now=Date.now(),aircraftType='a-f-A-M-H-Q',groundType='a-f-G-U-C',team='Cyan',role='Team Member',maxAgeMs=30000}={}){
  if(!device||typeof device.sn!=='string'||!device.positionFresh||device.positionTimeVerified===false)return null;
  const t=device.telemetry||{},lat=num(t.latitude),lon=num(t.longitude),at=num(device.lastPositionAt);
  if(lat===null||lon===null||Math.abs(lat)>90||Math.abs(lon)>180||(lat===0&&lon===0)||at===null)return null;
  if(at>now+2000||now-at>maxAgeMs)return null;
  const aircraft=device.deviceCategory==='aircraft';
  if(!aircraft&&device.deviceCategory!=='controller')return null;     // docks, payloads, unknown: never
  const hae=num(t.heightEllipsoid);
  const speed=num(t.horizontalSpeed),course=num(t.heading);
  const callsign=(aircraft?'':'RC ')+(device.modelName||'DJI')+' '+device.sn.slice(-4);
  const remarks=[device.modelName,num(t.battery)!==null?'Akku '+Math.round(t.battery)+' %':null,
    num(t.altitude)!==null?'Höhe über Start '+Math.round(t.altitude)+' m':null].filter(Boolean).join(' · ');
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
    '<event version="2.0" uid="SKYHUB-'+esc(device.sn)+'" type="'+esc(aircraft?aircraftType:groundType)+'" how="m-g"'+
    ' time="'+iso(at)+'" start="'+iso(at)+'" stale="'+iso(at+15000)+'">'+
    '<point lat="'+lat.toFixed(7)+'" lon="'+lon.toFixed(7)+'" hae="'+(hae!==null?hae.toFixed(1):'9999999.0')+'" ce="9999999.0" le="9999999.0"/>'+
    '<detail><contact callsign="'+esc(callsign)+'"/>'+
    (speed!==null||course!==null?'<track course="'+((course!==null?(course+360)%360:0).toFixed(1))+'" speed="'+((speed??0).toFixed(1))+'"/>':'')+
    '<__group name="'+esc(team)+'" role="'+esc(role)+'"/><remarks>'+esc(remarks)+'</remarks></detail></event>';
}

function takConfig(env=process.env){
  const server=env.SKYHUB_TAK_SERVER||'',multicast=env.SKYHUB_TAK_MULTICAST_ENABLED==='true';
  if(env.SKYHUB_TAK_ENABLED!=='true')return {enabled:false};
  const cfg={enabled:true,multicast,includeRc:env.SKYHUB_TAK_INCLUDE_RC==='true',aircraftType:env.SKYHUB_TAK_AIRCRAFT_TYPE||'a-f-A-M-H-Q',
    team:env.SKYHUB_TAK_TEAM||'Cyan'};
  if(!/^a-[a-z]-[A-Z](-[A-Za-z]+)*$/.test(cfg.aircraftType))return {enabled:false,issue:'SKYHUB_TAK_AIRCRAFT_TYPE ungültig'};
  if(server){
    const m=/^([A-Za-z0-9.-]{1,253}):(\d{1,5})$/.exec(server);
    if(!m)return {enabled:false,issue:'SKYHUB_TAK_SERVER als host:port (TLS, z. B. tak.example:8089)'};
    for(const k of ['SKYHUB_TAK_CERT','SKYHUB_TAK_KEY','SKYHUB_TAK_CA'])if(!env[k])return {enabled:false,issue:k+' (Dateipfad) fehlt'};
    cfg.server={host:m[1],port:Number(m[2]),cert:env.SKYHUB_TAK_CERT,key:env.SKYHUB_TAK_KEY,ca:env.SKYHUB_TAK_CA,
      passphrase:env.SKYHUB_TAK_KEY_PASSPHRASE||undefined};
  }
  if(!cfg.server&&!cfg.multicast)return {enabled:false,issue:'weder SKYHUB_TAK_SERVER noch SKYHUB_TAK_MULTICAST_ENABLED'};
  return cfg;
}

function createTakOutput({config,registry,log=console,now=()=>Date.now(),connect=tls.connect,createSocket=dgram.createSocket,
  readFile=fs.readFileSync,intervalMs=1000,setTimer=setInterval,clearTimer=clearInterval}){
  const stats={connected:false,sent:0,dropped:0,multicastSent:0,lastError:null,lastSentAt:null,reconnects:0};
  const last=new Map();          // sn → {lat, lon, sentAt}
  let socket=null,backoff=2000,retryTimer=null,closed=false,udp=null;

  function open(){
    if(!config.server||closed)return;
    let opts;
    try{opts={host:config.server.host,port:config.server.port,servername:config.server.host,cert:readFile(config.server.cert),
      key:readFile(config.server.key),ca:readFile(config.server.ca),passphrase:config.server.passphrase,rejectUnauthorized:true};}
    catch(err){stats.lastError='Zertifikatsdatei nicht lesbar ('+(err.code||'Fehler')+')';return schedule();}
    const s=connect(opts,()=>{stats.connected=true;stats.lastError=null;backoff=2000;log.log('[tak] connected to '+config.server.host+':'+config.server.port);});
    s.on('error',err=>{stats.lastError=String(err.code||err.message||'Fehler').slice(0,80);});
    s.on('close',()=>{if(socket===s)socket=null;if(stats.connected)log.log('[tak] disconnected');stats.connected=false;schedule();});
    s.on('data',()=>{});       // the server may send pings/CoT; ignored (outbound only)
    socket=s;
  }
  function schedule(){
    if(closed||retryTimer)return;
    stats.reconnects++;
    retryTimer=setTimeout(()=>{retryTimer=null;open();},backoff);
    if(retryTimer.unref)retryTimer.unref();
    backoff=Math.min(backoff*2,60000);
  }
  function tick(){
    const t=now();
    for(const d of registry.snapshot()){
      if(d.deviceCategory!=='aircraft'&&!(config.includeRc&&d.deviceCategory==='controller'))continue;
      const xml=cotEvent(d,{now:t,aircraftType:config.aircraftType,team:config.team});
      if(!xml){continue;}
      const tel=d.telemetry||{},prev=last.get(d.sn);
      const moved=!prev||prev.lat!==tel.latitude||prev.lon!==tel.longitude;
      if(!moved&&t-prev.sentAt<5000)continue;
      last.set(d.sn,{lat:tel.latitude,lon:tel.longitude,sentAt:t});
      const buf=Buffer.from(xml,'utf8');
      if(socket&&stats.connected&&socket.writable){socket.write(buf);stats.sent++;stats.lastSentAt=new Date(t).toISOString();}
      else if(config.server)stats.dropped++;      // never buffered: stale positions are worse than none
      if(udp){udp.send(buf,6969,'239.2.3.1',err=>{if(err)stats.lastError='Multicast: '+(err.code||err.message);});stats.multicastSent++;}
    }
    if(last.size>500)last.clear();
  }
  if(config.multicast){
    udp=createSocket({type:'udp4',reuseAddr:true});
    udp.on('error',err=>{stats.lastError='Multicast: '+String(err.code||err.message).slice(0,60);});
    udp.bind(0,()=>{try{udp.setMulticastTTL(1);}catch{}});
  }
  open();
  const timer=setTimer(tick,intervalMs);
  if(timer&&timer.unref)timer.unref();
  return {
    status:()=>({...stats,server:config.server?config.server.host+':'+config.server.port:null,multicast:config.multicast,includeRc:config.includeRc}),
    tick,
    close(){closed=true;clearTimer(timer);clearTimeout(retryTimer);if(socket)socket.destroy();if(udp)try{udp.close();}catch{}}
  };
}

module.exports={cotEvent,takConfig,createTakOutput};
