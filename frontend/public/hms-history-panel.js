'use strict';
// HMS-Verlauf im Dashboard: gespeicherte Übergänge (neu / Stufe geändert / behoben) aus
// /api/diagnostics/hms-history. Nur lesend; keine Quittierung, kein Befehl an das Gerät.
(function(root){
  const LEVEL=['Hinweis','Achtung','Warnung'];
  const ACTION={appeared:'Neu',updated:'Stufe geändert',resolved:'Behoben'};
  const PAGE=20;

  function age(at,now){
    if(!Number.isFinite(at))return 'Zeit unbekannt';
    const s=Math.floor((now-at)/1000);
    if(s< -5)return 'Zeit unklar';
    if(s<60)return 'vor '+Math.max(0,s)+' s';
    if(s<3600)return 'vor '+Math.floor(s/60)+' min';
    if(s<86400)return 'vor '+Math.floor(s/3600)+' h';
    return 'vor '+Math.floor(s/86400)+' Tagen';
  }
  // Untrusted server data -> plain display strings (rendered only via textContent).
  function formatItem(item,now=Date.now()){
    if(!item||typeof item!=='object'||typeof item.code!=='string'||!/^0x[0-9A-F]{8}$/.test(item.code))return null;
    if(!Object.hasOwn(ACTION,item.action))return null;
    const level=Number.isInteger(item.level)&&item.level>=0&&item.level<=5?item.level:null;
    const text=item.text&&typeof item.text==='object'?(item.text.de||item.text.en):null;
    const at=Date.parse(item.sourceAt);
    const device=typeof item.deviceSn==='string'?item.deviceSn:'?';
    return {
      action:item.action,
      level:level===null?'unknown':String(Math.min(level,2)),
      badge:ACTION[item.action],
      title:(level===null?'HMS':LEVEL[level]||'Stufe '+level)+': '+
        (typeof text==='string'&&text?text:'Unbekannter HMS-Code'),
      meta:(typeof item.modelName==='string'&&item.modelName?item.modelName+' · ':'')+device+' · '+item.code,
      time:age(at,now)+(item.timeVerified===true?'':' · Zeit ungeprüft'),
      at
    };
  }

  function createPanel({document,fetchImpl,getToken,getDevices,now=()=>Date.now()}){
    const el=id=>document.getElementById(id);
    const state={items:[],offset:0,hasMore:false,loading:false,controller:null,loadId:0,loadedOnce:false};
    function headers(){const t=getToken();return t?{Authorization:'Bearer '+t}:{};}
    function note(text){el('hmsHistoryNote').textContent=text;el('hmsHistoryNote').hidden=!text;}
    function render(){
      const list=el('hmsHistoryList');
      list.replaceChildren();
      for(const raw of state.items){
        const item=formatItem(raw,now());
        if(!item)continue;
        const row=document.createElement('li');
        row.className='hms-history-item';
        row.dataset.level=item.level;row.dataset.action=item.action;
        const badge=document.createElement('span');badge.className='hms-history-badge';badge.textContent=item.badge;
        const body=document.createElement('div');
        const title=document.createElement('strong');title.textContent=item.title;
        const meta=document.createElement('small');meta.textContent=item.meta;
        body.append(badge,title,meta);
        const time=document.createElement('small');time.className='hms-history-time';time.textContent=item.time;
        row.append(body,time);
        list.append(row);
      }
      el('hmsHistoryMore').hidden=!state.hasMore;
      el('hmsHistoryMore').disabled=state.loading;
      el('hmsHistoryRefresh').disabled=state.loading;
    }
    function syncDevices(){
      const select=el('hmsHistoryDevice');
      const current=select.value;
      const devices=[...getDevices()].filter(d=>d&&typeof d.sn==='string')
        .sort((a,b)=>String(a.modelName||a.sn).localeCompare(String(b.modelName||b.sn)));
      const wanted=['']; for(const d of devices)wanted.push(d.sn);
      const existing=[...select.options].map(o=>o.value);
      if(existing.join('|')===wanted.join('|'))return;
      select.replaceChildren(new Option('Alle Geräte',''));
      for(const d of devices)select.append(new Option((d.modelName?d.modelName+' · ':'')+d.sn,d.sn));
      select.value=wanted.includes(current)?current:'';
    }
    async function load({append=false}={}){
      if(state.controller)state.controller.abort();
      const id=++state.loadId;
      const controller=new AbortController();
      state.controller=controller;state.loading=true;
      if(!append){state.offset=0;}
      render();
      el('hmsHistorySummary').textContent='wird geladen …';
      const timer=setTimeout(()=>controller.abort(),8000);
      try{
        const query=new URLSearchParams({limit:String(PAGE),offset:String(append?state.offset:0)});
        const device=el('hmsHistoryDevice').value;
        if(device)query.set('device',device);
        const res=await fetchImpl('/api/diagnostics/hms-history?'+query,
          {headers:headers(),cache:'no-store',signal:controller.signal});
        if(id!==state.loadId)return;
        if(res.status===503){
          const body=await res.json().catch(()=>({}));
          if(id!==state.loadId)return;
          state.items=[];state.hasMore=false;
          el('hmsHistorySummary').textContent=body.enabled===false?'nicht aktiviert':'nicht verfügbar';
          note(body.enabled===false?
            'Der HMS-Verlauf ist auf diesem SkyHub nicht aktiviert (SKYHUB_HMS_HISTORY_ENABLED). Aktive Meldungen stehen weiter in der Geräteliste.':
            'Die HMS-Datenbank ist gerade nicht erreichbar.');
          return;
        }
        if(!res.ok)throw new Error('HTTP '+res.status);
        const body=await res.json();
        if(id!==state.loadId)return;
        if(!body||!Array.isArray(body.items))throw new Error('invalid response');
        state.items=append?state.items.concat(body.items):body.items;
        state.offset=(append?state.offset:0)+body.items.length;
        state.hasMore=body.hasMore===true&&state.offset<10000;
        const shown=state.items.filter(item=>formatItem(item,now())).length;
        el('hmsHistorySummary').textContent=shown?shown+(state.hasMore?'+':'')+' Einträge':'keine Einträge';
        note(shown?'':'Noch keine HMS-Übergänge gespeichert.');
      }catch(_err){
        if(id!==state.loadId)return;
        el('hmsHistorySummary').textContent='Abruf fehlgeschlagen';
        note('HMS-Verlauf konnte nicht geladen werden.');
      }finally{
        clearTimeout(timer);
        if(id===state.loadId){state.loading=false;state.controller=null;state.loadedOnce=true;render();}
      }
    }
    el('hmsHistoryRefresh').addEventListener('click',()=>load());
    el('hmsHistoryMore').addEventListener('click',()=>load({append:true}));
    el('hmsHistoryDevice').addEventListener('change',()=>load());
    // Load lazily: only when the operator opens the panel, then on demand.
    el('hmsHistoryPanel').addEventListener('toggle',()=>{
      if(el('hmsHistoryPanel').open){syncDevices();if(!state.loadedOnce)load();}
    });
    return {
      load,syncDevices,
      // Called on (re)connect: forget results fetched with the previous access.
      reset(){
        state.loadId++;if(state.controller)state.controller.abort();
        state.controller=null;state.loading=false;state.items=[];state.hasMore=false;state.loadedOnce=false;
        el('hmsHistorySummary').textContent='aufklappen zum Laden';note('');render();
        if(el('hmsHistoryPanel').open)load();
      },
      // A live HMS change reached the dashboard: refresh an open panel.
      changed(){if(el('hmsHistoryPanel').open&&!state.loading)load();}
    };
  }
  const api={createPanel,formatItem,age,ACTION,LEVEL};
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.SkyHubHmsHistory=api;
})(typeof window==='object'?window:globalThis);
