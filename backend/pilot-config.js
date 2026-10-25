'use strict';
const {validateBrokerConfig}=require('./mqtt-config');
const {isIP}=require('node:net');

function tsaTrustedProxyIps(value){
  const peers=String(value??'127.0.0.1,::1').split(',').map(ip=>ip.trim());
  if(peers.length<1||peers.length>8||peers.some(ip=>!isIP(ip)||ip==='0.0.0.0'||ip==='::'))
    throw new Error('TSA requires up to eight exact trusted proxy IPs');
  return [...new Set(peers)];
}

// Pilot MQTT credentials MUST be distinct from read-only SkyHub subscriber credentials.
// The Pilot page remains a safe diagnostics page until all settings are provisioned.
function pilotConfiguration(env) {
  const enabled=env.SKYHUB_PILOT_ENABLED==='true';
  const accessToken=env.SKYHUB_PILOT_ACCESS_TOKEN||'';
  const appId=env.SKYHUB_DJI_APP_ID||'';
  const appKey=env.SKYHUB_DJI_APP_KEY||'';
  const license=env.SKYHUB_DJI_APP_LICENSE||'';
  const mqttUser=env.SKYHUB_PILOT_MQTT_USER||'';
  const mqttPassword=env.SKYHUB_PILOT_MQTT_PASSWORD||'';
  const broker=env.SKYHUB_PILOT_MQTT_URL||'';
  const workspaceId=env.SKYHUB_PILOT_WORKSPACE_ID||'';
  const missing=[];
  if(!enabled)missing.push('SKYHUB_PILOT_ENABLED');
  if(enabled && !['127.0.0.1','::1'].includes(env.SKYHUB_BIND_ADDRESS||'127.0.0.1')){
    missing.push('SKYHUB_BIND_ADDRESS must be loopback behind a trusted HTTPS proxy');
  }
  for(const [key,value] of Object.entries({
    SKYHUB_PILOT_ACCESS_TOKEN:accessToken,
    SKYHUB_DJI_APP_ID:appId,SKYHUB_DJI_APP_KEY:appKey,
    SKYHUB_DJI_APP_LICENSE:license,
    SKYHUB_PILOT_MQTT_USER:mqttUser,
    SKYHUB_PILOT_MQTT_PASSWORD:mqttPassword,
    SKYHUB_PILOT_MQTT_URL:broker,
    SKYHUB_PILOT_WORKSPACE_ID:workspaceId
  })){
    if(!value || value.startsWith('REPLACE_'))missing.push(key);
  }
  if(accessToken && accessToken.length<32)missing.push('SKYHUB_PILOT_ACCESS_TOKEN must be >=32 characters');
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(workspaceId)){
    missing.push('SKYHUB_PILOT_WORKSPACE_ID must be a UUID');
  }
  let mqttHost=null,mqttPort=null;
  if(broker){
    try{
      const b=validateBrokerConfig(broker,env.SKYHUB_MQTT_REQUIRED_PORT||'1884',env.SKYHUB_MQTT_BROKER_KIND||'emqx');
      const hostname=b.host;
      // The RC must reach an actual LAN hostname/IP, never Docker's virtual gateway.
      if(hostname==='host.docker.internal'||hostname==='localhost'||hostname==='127.0.0.1'||hostname==='0.0.0.0'){
        throw Error('The RC needs a reachable LAN address');
      }
      mqttHost=(b.secure?'ssl://':'tcp://')+hostname+':'+b.port;
      if(b.secure)throw Error('TLS transport requires separate DJI Pilot 2 firmware validation');
      mqttPort=b.port; // informational only; set after every check, so null means "not usable"
    }catch(e){missing.push('SKYHUB_PILOT_MQTT_URL: '+e.message);}
  }
  // Situation awareness (TSA) is opt-in and needs the public HTTPS origin the RC can reach:
  // DJI's api and ws modules take a host, and Pilot 2 appends the token itself.
  const tsa={enabled:false,issue:null,apiHost:null,wsHost:null,trustedProxyIps:[]};
  if(env.SKYHUB_DJI_TSA_ENABLED==='true'){
    try{
      const url=new URL(env.SKYHUB_PILOT_PUBLIC_URL||'');
      if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/')
        throw new Error('invalid');
      const peers=tsaTrustedProxyIps(env.SKYHUB_DJI_TSA_TRUSTED_PROXY_IPS);
      tsa.apiHost=url.origin;
      tsa.wsHost='wss://'+url.host+'/ws/tsa';
      tsa.trustedProxyIps=peers;
      tsa.enabled=true;
    }catch(_err){tsa.issue='TSA requires a plain HTTPS origin and valid exact trusted proxy IPs';}
  }
  const ready=missing.length===0;
  return {
    ready,missing,tsa,mqttPort,
    // Called only after successful HTTPS + bearer token verification.
    bootstrap(){
      if(!ready)throw new Error('Pilot 2 onboarding is not configured');
      return {
        appId,appKey,license,
        mqtt:{host:mqttHost,username:mqttUser,password:mqttPassword},
        workspaceId,
        platformName:'SkyHub Next',
        workspaceName:'SkyHub',
        description:'DJI Enterprise Command Center',
        ...(tsa.enabled?{tsa:{apiHost:tsa.apiHost,wsHost:tsa.wsHost}}:{})
      };
    },
    accessToken,workspaceId
  };
}
module.exports={pilotConfiguration};
