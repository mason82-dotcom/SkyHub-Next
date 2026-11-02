'use strict';
// Livestream im Dashboard: zeigt das von DJI Pilot 2 gesendete Kamerabild (RTMP -> MediaMTX -> HLS
// über das SkyHub-Backend). Nur Anzeige: kein Start/Stopp, kein Befehl an RC oder Fluggerät.
(function(root){
  const HLS_SRC='/vendor/hls.js/1.7.3/hls.min.js';
  const HLS_SRI='sha256-oS5+4c1kpp3NsxQVfkXa/LpwW/sLFEC3k1yyZdN0Qj4=';
  const PLAYLIST='/api/live/hls/pilot/index.m3u8';
  const POLL_MS=5000;

  // Untrusted status JSON -> display state.
  function describeStatus(body){
    if(!body||typeof body!=='object'||body.enabled!==true)return {enabled:false};
    if(body.relay!=='online')return {enabled:true,ready:false,text:'Livestream-Relay nicht erreichbar.'};
    if(body.ready!==true)return {enabled:true,ready:false,
      text:'Kein Livestream aktiv. Start in DJI Pilot 2: SkyHub-Seite → „Livestream starten“.'};
    const tracks=Array.isArray(body.tracks)?body.tracks.filter(t=>typeof t==='string').slice(0,4):[];
    const since=Date.parse(body.since);
    return {enabled:true,ready:true,
      text:'LIVE'+(tracks.length?' · '+tracks.join(', '):'')+
        (Number.isFinite(since)?' · seit '+new Date(since).toLocaleTimeString('de-DE'):'')+
        (Number.isInteger(body.viewers)&&body.viewers>0?' · '+body.viewers+' Zuschauer':'')};
  }

  function createLivePanel({document,fetchImpl,getToken,loadScript,setTimer=setTimeout,clearTimer=clearTimeout}){
    const el=id=>document.getElementById(id);
    let timer=null,hls=null,hlsLib=null,attached=false,stopped=true,generation=0;
    function headers(){const t=getToken();return t?{Authorization:'Bearer '+t}:{};}
    function setText(text,live){
      el('liveStatus').textContent=text;
      el('livePanel').dataset.live=live?'true':'false';
    }
    function detach(){
      if(hls){try{hls.destroy();}catch(_){}hls=null;}
      const video=el('liveVideo');
      video.removeAttribute('src');video.load?.();
      video.hidden=true;attached=false;
    }
    async function library(){
      if(hlsLib)return hlsLib;
      if(root.Hls){hlsLib=root.Hls;return hlsLib;}
      await loadScript(HLS_SRC,HLS_SRI);
      hlsLib=root.Hls||null;
      return hlsLib;
    }
    async function attach(){
      const video=el('liveVideo');
      const Hls=await library().catch(()=>null);
      if(Hls&&Hls.isSupported()){
        hls=new Hls({lowLatencyMode:false,liveSyncDurationCount:2,maxBufferLength:10,
          xhrSetup:xhr=>{const t=getToken();if(t)xhr.setRequestHeader('Authorization','Bearer '+t);}});
        hls.on(Hls.Events.ERROR,(_event,data)=>{
          // A fatal error (stream ended, relay restarted) is retried with the next status poll.
          if(data&&data.fatal){detach();setText('Livestream unterbrochen – neuer Versuch …',false);}
        });
        hls.loadSource(PLAYLIST);
        hls.attachMedia(video);
      }else if(video.canPlayType('application/vnd.apple.mpegurl')&&!getToken()){
        video.src=PLAYLIST; // native HLS (Safari) in the token-free home network
      }else{
        setText('Dieser Browser kann den Livestream nicht abspielen.',false);
        return;
      }
      video.hidden=false;attached=true;
      video.play?.().catch(()=>{}); // muted autoplay; the user can still press play
    }
    async function poll(){
      const id=generation;
      let state;
      try{
        const res=await fetchImpl('/api/live/status',{headers:headers(),cache:'no-store'});
        const body=await res.json().catch(()=>null);
        state=describeStatus(body);
        if(res.status===401)state={enabled:false};
      }catch(_){state={enabled:true,ready:false,text:'Livestream-Status nicht abrufbar.'};}
      if(id!==generation||stopped)return;
      if(!state.enabled){
        // Feature off on this SkyHub: stay invisible and stop asking.
        el('livePanel').hidden=true;detach();return;
      }
      el('livePanel').hidden=false;
      setText(state.text,state.ready);
      if(state.ready&&!attached)await attach();
      else if(!state.ready&&attached)detach();
      if(id===generation&&!stopped)timer=setTimer(poll,POLL_MS);
    }
    return {
      start(){generation++;stopped=false;if(timer)clearTimer(timer);detach();poll();},
      stop(){generation++;stopped=true;if(timer)clearTimer(timer);timer=null;detach();}
    };
  }
  // Loads a same-origin script exactly once, verified by Subresource Integrity.
  function loadScriptOnce(document){
    const pending=new Map();
    return (src,integrity)=>{
      if(pending.has(src))return pending.get(src);
      const promise=new Promise((resolve,reject)=>{
        const s=document.createElement('script');
        s.src=src;s.integrity=integrity;s.async=true;
        s.onload=()=>resolve();s.onerror=()=>{pending.delete(src);reject(new Error('script'));};
        document.head.append(s);
      });
      pending.set(src,promise);
      return promise;
    };
  }
  const api={createLivePanel,describeStatus,loadScriptOnce,HLS_SRC,HLS_SRI};
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.SkyHubLivePanel=api;
})(typeof window==='object'?window:globalThis);
