'use strict';
// Client for the internal DJI Thermal SDK service (docker/dji-tsdk-box64/sdk_server.py).
// The service runs dji_irp (DJI Thermal SDK, x86-64) via box64 in its own isolated container on an
// internal network; the backend never gets a Docker socket. Opt-in: SKYHUB_THERMAL_SDK_URL + token.

// Ranges of dji_irp V1.7 --action measure (identical to the service, checked on both sides).
const RANGES=Object.freeze({
  emissivity:Object.freeze([0.1,1,0.95]),
  distance:Object.freeze([1,25,5]),
  humidity:Object.freeze([20,100,70]),
  ambient:Object.freeze([-40,80,25]),
  reflection:Object.freeze([-40,500,23])
});
const FRAMES=[[640,512],[320,256],[1280,1024]];
const NUMBER=/^-?(?:\d+(?:\.\d*)?|\.\d+)$/;

function invalid(message){const err=new Error(message);err.status=400;return err;}
// Normalised parameters; unknown keys or out-of-range values are rejected, never clamped.
function sdkParameters(input={}){
  const out={};
  for(const [name,[low,high,fallback]] of Object.entries(RANGES)){
    const raw=input[name];
    if(raw===undefined||raw===''){out[name]=fallback;continue;}
    if(typeof raw!=='string'&&typeof raw!=='number')throw invalid(name+' invalid');
    if(typeof raw==='string'&&!NUMBER.test(raw))throw invalid(name+' must be a decimal number');
    const value=Number(raw);
    if(!Number.isFinite(value)||value<low||value>high)throw invalid(name+' outside '+low+'..'+high);
    out[name]=Math.round(value*1000)/1000;
  }
  return out;
}

function createThermalSdkClient({url,token,timeoutMs=45000,fetchImpl=globalThis.fetch,healthTtlMs=30000,
  now=()=>Date.now()}={}){
  let base;
  try{base=new URL(url);}catch{throw new Error('Thermal SDK: invalid URL');}
  if(base.protocol!=='http:'||base.username||base.password||base.search||base.hash)
    throw new Error('Thermal SDK: internal http:// URL without credentials required');
  if(typeof token!=='string'||token.length<32||/\s/.test(token))
    throw new Error('Thermal SDK: token (min. 32 characters) required');
  let health={at:-Infinity,value:null};

  async function available(){
    if(now()-health.at<healthTtlMs)return health.value;
    let value=false;
    try{
      const r=await fetchImpl(new URL('/health',base),{signal:AbortSignal.timeout(3000)});
      value=r.ok&&(await r.json())?.status==='ok';
    }catch{value=false;}
    health={at:now(),value};
    return value;
  }

  async function measure(jpeg,params){
    if(!Buffer.isBuffer(jpeg)||jpeg.length<4)throw invalid('JPEG required');
    const p=sdkParameters(params);
    const target=new URL('/measure',base);
    for(const [k,v] of Object.entries(p))target.searchParams.set(k,String(v));
    let r;
    try{
      r=await fetchImpl(target,{method:'POST',body:jpeg,signal:AbortSignal.timeout(timeoutMs),
        headers:{Authorization:'Bearer '+token,'Content-Type':'image/jpeg','Content-Length':String(jpeg.length)}});
    }catch{
      health={at:-Infinity,value:null};
      const err=new Error('Thermal SDK unavailable');err.status=503;throw err;
    }
    if(!r.ok){
      // 422: SDK cannot measure this camera/file; everything else is a service problem.
      const err=new Error(r.status===422?'SDK cannot measure this image':'Thermal SDK error');
      err.status=r.status===422?422:r.status===400?400:503;
      throw err;
    }
    const width=Number(r.headers.get('x-thermal-width')),height=Number(r.headers.get('x-thermal-height'));
    if(!FRAMES.some(([w,h])=>w===width&&h===height))throw Object.assign(new Error('Invalid SDK size'),{status:502});
    const body=Buffer.from(await r.arrayBuffer());
    if(body.length!==width*height*4)throw Object.assign(new Error('Invalid SDK output'),{status:502});
    const temps=new Float32Array(width*height);
    for(let i=0;i<temps.length;i++){
      const t=body.readFloatLE(i*4);
      if(!Number.isFinite(t)||t<-273.15||t>2000)throw Object.assign(new Error('Implausible SDK value'),{status:502});
      temps[i]=t;
    }
    return {width,height,temps,parameters:p,calibration:'dji-tsdk'};
  }
  return {available,measure,ranges:RANGES};
}

module.exports={createThermalSdkClient,sdkParameters,RANGES};
