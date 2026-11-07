'use strict';
// Livestream anfordern (backend/live-control.js, DJI Cloud API 1.18 live_start_push / live_stop_push / live_set_quality /
// live_lens_change). Nur Video: kein Flug- oder Kamerabefehl. Die Kameraliste kommt aus live_capacity der Fernsteuerung.
(function(root){
  const POLL_MS=5000;
  const LENS={wide:'Weitwinkel',zoom:'Zoom',ir:'Wärmebild',normal:'Standard'};
  function createLiveControlPanel({document,fetchImpl,getToken,storage}){
    const el=id=>document.getElementById(id);
    let timer=null,stopped=true,busy=false,state=null;
    let operator=null;
    try{operator=storage&&storage.getItem('liveOperator');}catch(_){}
    if(!operator||!/^[A-Za-z0-9_-]{8,64}$/.test(operator)){
      operator='live-'+Array.from(root.crypto.getRandomValues(new Uint32Array(2))).join('-');
      try{storage&&storage.setItem('liveOperator',operator);}catch(_){}
    }
    const headers=json=>{const h={'X-SkyHub-Operator':operator};const t=getToken();if(t)h.Authorization='Bearer '+t;
      if(json)h['Content-Type']='application/json';return h;};
    const node=(tag,attrs={},...kids)=>{const n=document.createElement(tag);for(const [k,v] of Object.entries(attrs))
      if(k==='text')n.textContent=v;else if(v!==false&&v!==null&&v!==undefined)n.setAttribute(k,v===true?'':String(v));
      n.append(...kids);return n;};
    function say(text,bad){const s=el('liveControlMsg');s.textContent=text;s.className='live-status'+(bad?' bad':'');}

    async function send(path,body){
      if(busy)return;
      busy=true;render();
      say('Anfrage an Pilot 2 …');
      try{
        const r=await fetchImpl('/api/live/control/'+path,{method:'POST',headers:headers(true),body:JSON.stringify(body),
          credentials:'same-origin',cache:'no-store'});
        const b=await r.json().catch(()=>({}));
        if(!r.ok)throw new Error(b.error||('HTTP '+r.status));
        say({start:'Pilot 2 startet den Stream – das Bild erscheint nach einigen Sekunden.',stop:'Stream beendet.',
          quality:'Qualität geändert.',lens:'Objektiv gewechselt.'}[path]);
        if(Array.isArray(b.gateways))state={...state,gateways:b.gateways};
      }catch(err){say(err.message,true);}
      finally{busy=false;render();}
    }

    function render(){
      const box=el('liveControl');
      if(!state){box.hidden=true;return;}
      box.hidden=false;
      const list=el('liveControlList');list.replaceChildren();
      const gws=(state.gateways||[]).filter(g=>g.online);
      if(!gws.length){list.append(node('p',{class:'live-status',text:'Keine Fernsteuerung verbunden.'}));return;}
      for(const g of gws){
        const wrap=node('div',{class:'live-gw'});
        wrap.append(node('strong',{text:(g.model||g.sn)+(g.aircraft?' · '+(g.aircraft.model||g.aircraft.sn):'')}));
        if(!g.streams.length){
          wrap.append(node('p',{class:'live-status',text:g.aircraft&&g.aircraft.online?
            'Pilot 2 hat noch keine Kameras gemeldet (live_capacity).':'Fluggerät nicht verbunden.'}));
          list.append(wrap);continue;
        }
        const running=g.status.filter(s=>s.live);
        const sel=node('select',{'aria-label':'Kamera für den Livestream ('+(g.model||g.sn)+')'});
        for(const s of g.streams)sel.append(node('option',{value:s.videoId,text:(LENS[s.videoType]||s.videoType||s.videoIndex)+' · '+s.cameraIndex}));
        const q=node('select',{'aria-label':'Qualität'});
        for(const [k,v] of Object.entries(state.qualities||{}))q.append(node('option',{value:k,text:v}));
        if(running[0]){sel.value=running[0].videoId;if(running[0].quality!==null)q.value=String(running[0].quality);}
        const row=node('div',{class:'live-row'},sel,q);
        const start=node('button',{type:'button',disabled:busy||running.length>0},'Stream anfordern');
        start.addEventListener('click',()=>send('start',{gateway:g.sn,videoId:sel.value,videoQuality:Number(q.value)}));
        const stop=node('button',{type:'button',class:'secondary',disabled:busy||!running.length},'Stream beenden');
        stop.addEventListener('click',()=>send('stop',{gateway:g.sn,videoId:running[0]?running[0].videoId:sel.value}));
        const setQ=node('button',{type:'button',class:'secondary',disabled:busy||!running.length},'Qualität setzen');
        setQ.addEventListener('click',()=>send('quality',{gateway:g.sn,videoId:running[0].videoId,videoQuality:Number(q.value)}));
        row.append(start,stop,setQ);
        // RC Pro: lens switch on the running stream (live_lens_change). RC Plus 2: only in live control (drc page).
        const cur=running[0]&&g.streams.find(s=>s.videoId===running[0].videoId);
        if(g.kind==='rc-pro'&&cur&&cur.switchable.length){
          for(const t of cur.switchable){
            const b=node('button',{type:'button',class:'secondary',disabled:busy||t===running[0].videoType},LENS[t]||t);
            b.addEventListener('click',()=>send('lens',{gateway:g.sn,videoId:cur.videoId,videoType:t}));
            row.append(b);
          }
        }
        wrap.append(row);
        if(running.length)wrap.append(node('p',{class:'live-status',text:'Pilot 2 sendet: '+running.map(s=>(LENS[s.videoType]||s.videoType||'')+
          (s.quality!==null&&state.qualities?' · '+state.qualities[s.quality]:'')+(s.error?' · Fehler '+s.error:'')).join(', ')}));
        if(g.kind==='rc-plus-2')wrap.append(node('p',{class:'live-status',text:'Objektiv des Streams wechseln: in der Live-Steuerung (DRC).'}));
        list.append(wrap);
      }
    }
    async function poll(){
      try{
        const r=await fetchImpl('/api/live/control',{headers:headers(false),cache:'no-store',credentials:'same-origin'});
        if(r.status===404||r.status===401||r.status===403){state=null;render();return;}   // feature off: stay hidden
        const b=await r.json();
        state=b;if(b.broker!=='verbunden')say('MQTT-Broker getrennt – Anforderung nicht möglich.',true);
        render();
      }catch(_){/* next poll */}
      if(!stopped)timer=setTimeout(poll,POLL_MS);
    }
    return {start(){stopped=false;clearTimeout(timer);poll();},stop(){stopped=true;clearTimeout(timer);}};
  }
  const api={createLiveControlPanel};
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.SkyHubLiveControlPanel=api;
})(typeof window==='object'?window:globalThis);
