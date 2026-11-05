'use strict';
// Pilot 2 log viewer (backend/pilot-log.js → /api/pilot-logs).
(function(){
  const $=id=>document.getElementById(id);
  const PAGE=1000;let current=null,offset=0,timer=null;
  const say=(t,bad)=>{$('state').textContent=t;$('state').className=bad?'bad':'muted';};
  const api=async(path,opts={})=>{const r=await fetch('/api/pilot-logs'+path,{cache:'no-store',credentials:'same-origin',...opts});
    const b=await r.json().catch(()=>({}));if(!r.ok)throw new Error(b.error||('HTTP '+r.status));return b;};
  async function load(){
    try{
      const {logs}=await api('');
      $('list').replaceChildren(...(logs.length?logs.map(l=>{
        const li=document.createElement('li'),b=document.createElement('button');b.type='button';b.className='secondary';
        b.textContent=l.name+' · '+new Date(l.receivedAt).toLocaleString('de-DE',{dateStyle:'short',timeStyle:'short'})+' · '+Math.max(1,Math.round(l.bytes/1024))+' KiB';
        b.setAttribute('aria-current',String(current===l.id));
        b.addEventListener('click',()=>{current=l.id;offset=0;show();load();});
        li.append(b);return li;}):[Object.assign(document.createElement('li'),{className:'muted',textContent:'Noch keine Protokolle.'})]));
    }catch(err){say('Liste nicht lesbar: '+err.message,true);}
  }
  async function show(){
    if(!current)return;
    say('Wird entschlüsselt …');
    try{
      const q=$('q').value.trim();
      const b=await api('/'+current+'/text?offset='+offset+'&limit='+PAGE+(q?'&q='+encodeURIComponent(q):''));
      const frag=document.createDocumentFragment();
      for(const l of b.lines){
        const row=document.createElement('div');
        const n=document.createElement('span');n.className='n';n.textContent=l.n;
        const t=document.createElement('span');t.textContent=l.t;
        if(/\b(E\/|ERROR|Error|error|fail|Fail|exception|Exception)/.test(l.t))t.className='e';else if(/\b(W\/|WARN|Warn)/.test(l.t))t.className='w';
        row.append(n,t);frag.append(row);
      }
      $('logText').replaceChildren(frag);
      const shown=b.lines.length?(offset+1)+'–'+(offset+b.lines.length):'0';
      say(b.name+': '+b.total+' Zeilen'+(q?', '+b.matches+' Treffer':'')+' · angezeigt '+shown+
        (b.plain?' · unverschlüsselt':'')+(b.failed?' · '+b.failed+' Zeilen nicht entschlüsselbar':'')+(b.keyChanges?' · eigener Schlüssel in Pilot 2 gesetzt: ohne privaten Schlüssel nicht lesbar':'')+
        (b.redacted?' · '+b.redacted+' Passwort/Token geschwärzt':''),b.failed>0);
      $('prev').disabled=offset===0;$('next').disabled=offset+PAGE>=b.matches;
      $('download').href='/api/pilot-logs/'+current+'/text?download=1';$('download').hidden=false;$('del').disabled=false;
    }catch(err){say('Nicht lesbar: '+err.message,true);}
  }
  $('q').addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(()=>{offset=0;show();},300);});
  $('prev').addEventListener('click',()=>{offset=Math.max(0,offset-PAGE);show();});
  $('next').addEventListener('click',()=>{offset+=PAGE;show();});
  $('del').addEventListener('click',async()=>{
    if(!current||!confirm('Protokoll in SkyHub löschen?'))return;
    try{await api('/'+current,{method:'DELETE'});current=null;$('logText').replaceChildren();$('download').hidden=true;$('del').disabled=true;say('Gelöscht.');load();}
    catch(err){say('Löschen fehlgeschlagen: '+err.message,true);}
  });
  load();
})();
