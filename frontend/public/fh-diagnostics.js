'use strict';
(function(){
 const el=id=>document.getElementById(id);
 let token='',sequence=0;
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
  if(!token)return;
  try{
   const paths=['rtk','flights','events'];
   const values=await Promise.all(paths.map(async p=>{
    const response=await fetch('/api/diagnostics/fh/'+p,{
     headers:{authorization:'Bearer '+token},cache:'no-store',credentials:'same-origin'
    });
    if(!response.ok)throw new Error('HTTP '+response.status);
    return response.json();
   }));
   if(current!==sequence)return;
   show('rtk',values[0].devices.map(x=>({...x,
    fixState:x.stale?'Veraltet':x.fixState,
    sampledAt:iso(x.sampledAt)})),
    [['Aircraft','deviceSn'],['Fix','fixState'],['RTK-Sat.','rtkSatellites'],
    ['GPS-Sat.','gpsSatellites'],['Zeit','sampledAt']]);
   show('flights',values[1].active.map(x=>({...x,startedAt:iso(x.startedAt)})),
    [['Aircraft','deviceSn'],['Modus','modeCode'],['Start','startedAt']]);
   show('events',values[2].events.map(x=>({...x,at:iso(x.at)})),
    [['Ereignis','type'],['Aircraft','deviceSn'],['Zeit','at']]);
   el('status').textContent='Aktualisiert: '+new Date().toLocaleTimeString('de-DE');
  }catch(_err){if(current===sequence)el('status').textContent='Zugriff fehlgeschlagen oder Backend nicht erreichbar.';}
 }
 el('authForm').addEventListener('submit',event=>{
  event.preventDefault();token=el('token').value;el('token').value='';refresh();
 });
 el('clear').addEventListener('click',()=>{
  token='';sequence++;el('token').value='';
  for(const id of ['rtk','flights','events'])el(id).textContent='Keine Daten.';
  el('status').textContent='Zugang gelöscht.';
 });
 setInterval(()=>{if(token&&!document.hidden)refresh();},5000);
})();
