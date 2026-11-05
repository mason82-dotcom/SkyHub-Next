'use strict';
(function(){
 const el=id=>document.getElementById(id);
 // Home network: readable without a token (backend/http-auth.js); no token field on this page.
 let sequence=0;
 const show=(id,rows,columns)=>{
  const root=el(id);root.replaceChildren();
  if(!Array.isArray(rows)||!rows.length){root.textContent='Keine Beobachtungen.';return;}
  const table=document.createElement('table');
  const head=document.createElement('tr');
  for(const col of columns){const th=document.createElement('th');th.textContent=col[0];head.append(th);}
  table.append(head);
  for(const row of rows.slice(0,100)){
   const tr=document.createElement('tr');
   for(const [_,key] of columns){
    const td=document.createElement('td'),value=row?.[key];
    td.textContent=value===null||value===undefined?'—':typeof value==='boolean'?
      (value?'Ja':'Nein'):String(value).slice(0,128);
    tr.append(td);
   }
   table.append(tr);
  }
  root.append(table);
 };
 const iso=n=>Number.isFinite(n)?new Date(n).toLocaleString('de-DE'):'—';
 async function refresh(){
  const current=++sequence;
  try{
   const paths=['rtk','flights','events'];
   const values=await Promise.all(paths.map(async p=>{
    const response=await fetch('/api/diagnostics/fh/'+p,{cache:'no-store',credentials:'same-origin'});
    if(!response.ok)throw Object.assign(new Error('HTTP '+response.status),{status:response.status});
    return response.json();
   }));
   if(current!==sequence)return;
   show('rtk',values[0].devices.map(x=>({...x,
    fixState:x.stale?'Veraltet':x.fixState,
    sampledAt:iso(x.sampledAt)})),
    [['Fluggerät','deviceSn'],['Fix','fixState'],['RTK-Sat.','rtkSatellites'],
    ['GPS-Sat.','gpsSatellites'],['Zeit','sampledAt']]);
   show('flights',values[1].active.map(x=>({...x,startedAt:iso(x.startedAt)})),
    [['Fluggerät','deviceSn'],['Modus','modeCode'],['Start','startedAt']]);
   show('events',values[2].events.map(x=>({...x,at:iso(x.at)})),
    [['Ereignis','type'],['Fluggerät','deviceSn'],['Zeit','at']]);
   el('status').textContent='Aktualisiert: '+new Date().toLocaleTimeString('de-DE');
  }catch(err){
   if(current!==sequence)return;
   el('status').textContent=err&&err.status===401?'Nur aus dem Heimnetz abrufbar (192.168.178.0/24 oder über den Pi).':
    'Backend nicht erreichbar – neuer Versuch in 5 s.';
  }
 }
 refresh();
 setInterval(()=>{if(!document.hidden)refresh();},5000);
})();
