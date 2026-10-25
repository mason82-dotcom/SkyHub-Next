'use strict';
// All route-library operations are local and explicitly initiated by a user.
// No DJI service calls, flight dispatch, or implicit cloud persistence.
(function(){
  const core=window.SkyHubWpmlPlanner,lib=window.SkyHubWpmlRouteLibrary;
  const actionDraft=window.SkyHubWpmlActionDraft;
  const backup=window.SkyHubWpmlRouteBackup;
  const $=id=>document.getElementById(id);
  const STORAGE='skyhub.wpml.local-route-library.v1';
  if(!core||!lib||!actionDraft||!backup){
    $('status').textContent='Routenbibliothek konnte nicht geladen werden.';return;
  }
  let library=lib.blank(),selected=null,activeRouteId=null,points=[],groups=[],dirty=false;
  const message=(text,error=false)=>{
    $('status').textContent=text;
    $('status').style.color=error?'#ffca8c':'#c4e8fa';
  };
  const libraryMessage=text=>{$('library-status').textContent=text;};
  const make=(tag,text)=>{
    const el=document.createElement(tag);
    if(text!==undefined)el.textContent=text;
    return el;
  };
  const button=(title,click)=>{
    const b=make('button',title);b.type='button';
    b.addEventListener('click',click);return b;
  };
  function persist(next){
    // Explicit saves only; no passive tracking or background writes.
    const raw=lib.serialize(next);
    window.localStorage.setItem(STORAGE,raw);
    library=next;
  }
  try{
    const raw=window.localStorage.getItem(STORAGE);
    if(raw)library=lib.load(raw);
  }catch{
    libraryMessage('Lokaler Speicher unlesbar oder gesperrt. Daten nicht überschrieben.');
  }
  function input(label,value,fn,{type='text',min,max,step}={}){
    const wrap=make('label',label),control=make('input');
    control.type=type;control.value=value==null?'':String(value);
    if(min!==undefined)control.min=String(min);
    if(max!==undefined)control.max=String(max);
    if(step!==undefined)control.step=String(step);
    control.addEventListener('input',()=>{
      fn(type==='number'?(control.value.trim()===''?null:Number(control.value)):control.value);
      dirty=true;
    });
    wrap.appendChild(control);return wrap;
  }
  function renderRoutes(){
    const target=$('routes');target.replaceChildren();
    const filter=$('filter').value.trim().toLocaleLowerCase();
    for(const r of lib.list(library).filter(x=>
      !filter||x.folder.toLocaleLowerCase().includes(filter))){
      const line=make('div');line.className='item';
      const select=button((r.id===selected?'● ':'○ ')+r.name+' · '+r.folder+
        ' · '+r.revisionCount+' Rev.',()=>{
          selected=r.id;renderRoutes();renderRevisions();
          libraryMessage('Route ausgewählt; „Revision laden“ ersetzt den Entwurf erst nach Bestätigung.');
        });
      line.appendChild(select);target.appendChild(line);
    }
    renderRevisions();
  }
  function renderRevisions(){
    const field=$('revision-select');field.replaceChildren();
    if(selected==null)return;
    const route=library.routes.find(r=>r.id===selected);
    if(!route)return;
    for(const version of route.revisions){
      const option=make('option','Revision '+version.revision);
      option.value=String(version.revision);
      field.appendChild(option);
    }
    field.value=String(route.revisions.length);
  }
  function renderPoints(){
    const target=$('waypoints');target.replaceChildren();
    for(let i=0;i<points.length;i++){
      const p=points[i],box=make('div');box.className='item';
      box.appendChild(make('strong','Wegpunkt '+(i+1)));
      const row=make('div');row.className='grid';
      row.append(
        input('Breitengrad',p.lat,v=>{p.lat=v;},{type:'number',min:-90,max:90,step:'any'}),
        input('Längengrad',p.lon,v=>{p.lon=v;},{type:'number',min:-180,max:180,step:'any'}));
      box.appendChild(row);
      const tools=make('div');tools.className='row';
      tools.appendChild(button('↑',()=>movePoint(i,i-1)));
      tools.appendChild(button('↓',()=>movePoint(i,i+1)));
      tools.appendChild(button('Entfernen',()=>{
        if(groups.some(g=>g.index===i)&&
           !window.confirm('Wegpunkt und zugehörige Action Group entfernen?'))return;
        points.splice(i,1);
        groups=groups.filter(g=>g.index!==i).map(g=>({
          ...g,index:g.index>i?g.index-1:g.index
        }));
        dirty=true;renderEditor();
      }));
      box.appendChild(tools);target.appendChild(box);
    }
    const select=$('group-index');select.replaceChildren();
    points.forEach((_,i)=>{
      const opt=make('option','Wegpunkt '+(i+1));opt.value=String(i);
      select.appendChild(opt);
    });
  }
  function movePoint(i,j){
    if(j<0||j>=points.length)return;
    [points[i],points[j]]=[points[j],points[i]];
    for(const group of groups){
      if(group.index===i)group.index=j;
      else if(group.index===j)group.index=i;
    }
    dirty=true;renderEditor();
  }
  function renderGroups(){
    const target=$('groups');target.replaceChildren();
    groups.sort((a,b)=>a.index-b.index);
    for(const group of groups){
      const card=make('div');card.className='item';
      card.appendChild(make('strong','Wegpunkt '+(group.index+1)+' · reachPoint'));
      const acts=make('div');
      for(let i=0;i<group.actions.length;i++){
        const a=group.actions[i],line=make('div');line.className='item';
        const select=make('select');
        for(const type of actionDraft.TYPES){
          const opt=make('option',type);opt.value=type;select.appendChild(opt);
        }
        select.value=a.type;
        select.addEventListener('change',()=>{
          a.type=select.value;
          delete a.seconds;delete a.degrees;
          if(a.type==='hover')a.seconds=2;
          if(a.type==='rotateYaw')a.degrees=0;
          dirty=true;renderGroups();
        });
        line.appendChild(select);
        if(a.type==='hover')line.appendChild(input('Schwebedauer (s)',a.seconds,v=>{
          a.seconds=v;
        },{type:'number',min:0.1,max:120,step:'any'}));
        if(a.type==='rotateYaw')line.appendChild(input('Yaw (°)',a.degrees,v=>{
          a.degrees=v;
        },{type:'number',min:-180,max:180,step:'any'}));
        const row=make('div');row.className='row';
        row.append(
          button('↑',()=>reorderAction(group,i,i-1)),
          button('↓',()=>reorderAction(group,i,i+1)),
          button('Aktion löschen',()=>{
            group.actions.splice(i,1);
            if(!group.actions.length)groups=groups.filter(g=>g!==group);
            dirty=true;renderGroups();
          }));
        line.appendChild(row);acts.appendChild(line);
      }
      card.appendChild(acts);
      const actions=make('div');actions.className='row';
      const add=button('Aktion hinzufügen',()=>{
        if(group.actions.length>=8){message('Maximal acht Aktionen je Wegpunkt.',true);return;}
        group.actions.push({type:'takePhoto'});dirty=true;renderGroups();
      });
      actions.append(add,button('Gruppe löschen',()=>{
        groups=groups.filter(g=>g!==group);dirty=true;renderGroups();
      }));
      card.appendChild(actions);target.appendChild(card);
    }
  }
  function reorderAction(group,i,j){
    if(j<0||j>=group.actions.length)return;
    [group.actions[i],group.actions[j]]=[group.actions[j],group.actions[i]];
    dirty=true;renderGroups();
  }
  function renderEditor(){renderPoints();renderGroups();}
  function makePlan(){
    const height=Number($('height').value);
    const plan={
      name:$('route-name').value,model:$('model').value,
      speed:Number($('speed').value),takeoffHeight:Number($('takeoff').value),
      finishAction:$('finish').value,
      waypoints:points.map(p=>({lat:p.lat,lon:p.lon,height,photo:false})),
      ...(groups.length?{actionGroups:groups.map(g=>({
        index:g.index,actions:g.actions.map(a=>({...a}))
      }))}:{})
    };
    core.normalize(plan);
    return plan;
  }
  function review(){
    const output=core.build(makePlan());
    message('Nur Offline-Prüfung: '+output.summary.waypointCount+' Wegpunkte, '+
      output.summary.actionGroupCount+' Action Groups, '+
      output.summary.orderedActionCount+' geordnete Aktionen. '+
      'flightReady=false; DJI Pilot 2 und Kameraaktionen NICHT hardwaregeprüft.');
    return output;
  }
  function applyRevision(version){
    const p=version.plan;
    if(p.intervalPhotos||p.waypoints.some(x=>x.ellipsoidHeight!==undefined||
       x.height!==p.waypoints[0].height||x.photo===true)){
      message('Diese Revision erfordert Höhen-/Intervall-/Legacy-Photo-Optionen '+
        'des einfachen Editors. Nicht stillschweigend übernommen.',true);
      return false;
    }
    // Validate the exact stored version before changing the visible draft.
    core.normalize(p);
    if((dirty||points.length)&&!window.confirm('Aktuellen Entwurf durch die ausgewählte Revision ersetzen?'))
      return false;
    $('route-name').value=p.name;
    $('model').value=p.model;
    $('speed').value=String(p.speed);
    $('height').value=String(p.waypoints[0].height);
    $('takeoff').value=String(p.takeoffHeight);
    $('finish').value=p.finishAction;
    points=p.waypoints.map(x=>({lat:x.lat,lon:x.lon}));
    groups=(p.actionGroups||[]).map(g=>({
      index:g.index,actions:g.actions.map(a=>({...a}))
    }));
    activeRouteId=version.id;
    dirty=false;renderEditor();
    message('Revision '+version.revision+' übernommen – nur lokaler Entwurf, keine Flugfreigabe.');
    return true;
  }
  $('add-point').addEventListener('click',()=>{
    if(points.length>=500){message('Maximal 500 Wegpunkte.',true);return;}
    points.push({lat:null,lon:null});
    dirty=true;renderEditor();
  });
  $('add-group').addEventListener('click',()=>{
    const i=Number($('group-index').value);
    if(!Number.isInteger(i)||i<0||i>=points.length||
       groups.some(g=>g.index===i)){
      message('Bitte Wegpunkt ohne bestehende Action Group auswählen.',true);return;
    }
    groups.push({index:i,actions:[{type:'takePhoto'}]});
    dirty=true;renderGroups();
  });
  function batchSelection(raw,count){
    if(raw==='alle')return Array.from({length:count},(_,i)=>i);
    if(typeof raw!=='string'||raw.length>120||!/^[0-9, -]+$/.test(raw))throw Error('syntax');
    const values=new Set();
    for(const token of raw.split(',')){
      const match=/^\s*([1-9]\d{0,2})(?:\s*-\s*([1-9]\d{0,2}))?\s*$/.exec(token);
      if(!match)throw Error('syntax');
      const start=Number(match[1]),end=Number(match[2]||match[1]);
      if(start<1||end>count||end<start)throw Error('range');
      for(let i=start;i<=end;i++){
        if(values.has(i-1))throw Error('duplicate index');
        values.add(i-1);
      }
    }
    if(!values.size)throw Error('empty selection');
    return [...values].sort((a,b)=>a-b);
  }
  $('batch-apply').addEventListener('click',()=>{
    try{
      if(points.length<2)throw Error('no route');
      const indices=batchSelection($('batch-indices').value.trim().toLocaleLowerCase(),points.length);
      // All-or-nothing transformation, never partially mutates the draft.
      const next=actionDraft.applyTemplate(groups,points.length,{
        indices,template:$('batch-template').value,mode:$('batch-mode').value
      });
      groups=next.groups;
      dirty=true;renderGroups();
      message('Aktionsvorlage auf '+indices.length+
        ' Wegpunkte angewendet. Flugroute und Kameraaktionen erneut prüfen; flightReady=false.');
    }catch{message('Batch-Aktion abgelehnt: Auswahl, Grenze oder Aufnahmesequenz ungültig.',true);}
  });
  $('reverse').addEventListener('click',()=>{
    try{
      const plan=makePlan();
      const result=actionDraft.reverseRoute(plan);
      if(!window.confirm('Routenrichtung und Wegpunktnummern umkehren? Heading, Gimbal, RTH und Kameraziele müssen neu geprüft werden.'))return;
      // All-or-nothing, recording actions cannot be reversed implicitly.
      points=result.plan.waypoints.map(p=>({lat:p.lat,lon:p.lon}));
      groups=result.plan.actionGroups.map(g=>({
        index:g.index,actions:g.actions.map(a=>({...a}))
      }));
      dirty=true;renderEditor();
      message('Flugroute umgekehrt. NEUE Sicht-, Heading-, Gelände- und RTH-Prüfung zwingend; flightReady=false.');
    }catch{message('Routenumkehr blockiert. Video-/Intervallaktionen oder Wegpunkte nicht sicher umkehrbar.',true);}
  });
  $('review').addEventListener('click',()=>{try{review();}catch{
    message('Entwurf enthält ungültige Koordinaten, Flugwerte oder Aktionen.',true);
  }});
  $('save').addEventListener('click',()=>{
    try{
      // Selecting a route in the sidebar does NOT authorize appending the
      // current, potentially unrelated draft as its new revision.
      if(selected!==activeRouteId)throw Error('route selection is not loaded');
      const next=lib.save(library,{routeId:activeRouteId,
        name:$('route-name').value,folder:$('route-folder').value,plan:makePlan()});
      persist(next.library);
      selected=next.routeId;activeRouteId=next.routeId;dirty=false;renderRoutes();
      libraryMessage('Revision '+next.revision+' ausschließlich in diesem Browser gespeichert.');
    }catch{libraryMessage('Speichern abgelehnt. Ausgewählte Route zuerst ausdrücklich laden oder neuen Entwurf anlegen; Speicherplatz und Eingaben prüfen.');}
  });
  $('new').addEventListener('click',()=>{
    if((points.length||dirty)&&!window.confirm('Neuen Entwurf beginnen?'))return;
    points=[];groups=[];selected=null;activeRouteId=null;dirty=false;
    $('route-name').value='Neue WPML-Mission';
    $('route-folder').value='Allgemein';renderEditor();renderRoutes();
    message('Neuer leerer Entwurf. Frühere Revisionen bleiben erhalten.');
  });
  $('load').addEventListener('click',()=>{
    try{
      if(selected==null)throw Error('no selection');
      const version=lib.find(library,selected,Number($('revision-select').value));
      if(applyRevision(version))$('route-folder').value=version.folder;
    }catch{message('Revision konnte nicht geladen werden.',true);}
  });
  $('compare-revision').addEventListener('click',()=>{
    try{
      if(selected==null)throw Error('no selection');
      const chosen=Number($('revision-select').value);
      const latest=lib.list(library).find(x=>x.id===selected);
      if(!latest)throw Error('missing route');
      const diff=lib.compareRevisions(library,selected,chosen,latest.latestRevision);
      const message='Revision '+diff.leftRevision+' gegen '+diff.rightRevision+
        ': Wegpunkte '+diff.leftWaypointCount+'/'+diff.rightWaypointCount+
        ', Positionsänderungen '+diff.positionChanges+
        ', Höhenänderungen '+diff.heightChanges+
        ', Fotoänderungen '+diff.photoChanges+
        ', Aktionsgruppen geändert: '+(diff.actionGroupsChanged?'ja':'nein')+
        ', Profilfelder geändert: '+diff.flightProfileFieldsChanged.length+
        '. Nur Offline-Vergleich, keine Flugfreigabe.';
      $('revision-diff').textContent=message;
    }catch{$('revision-diff').textContent='Revisionsvergleich nicht möglich.';}
  });
  $('restore-revision').addEventListener('click',()=>{
    try{
      if(selected==null)throw Error('no selection');
      const revision=Number($('revision-select').value);
      const ref=lib.find(library,selected,revision);
      if(!window.confirm('Revision '+ref.revision+
          ' als NEUE Revision speichern? Vorhandene Historie bleibt unverändert.'))return;
      const restored=lib.restoreRevision(library,selected,revision);
      persist(restored.library);
      // Never pretend the old editor draft now matches the restored revision.
      activeRouteId=null;
      renderRoutes();
      libraryMessage('Revision '+revision+' als neue Revision '+
        restored.revision+' gesichert. Entwurf unverändert; neue Revision erneut laden.');
      $('revision-diff').textContent='Wiederherstellung angelegt. Vor Flugplanung erneut prüfen.';
    }catch{libraryMessage('Wiederherstellung nicht möglich. Revision oder Speicher prüfen.');}
  });
  $('clone').addEventListener('click',()=>{
    try{
      if(selected==null)throw Error('no selection');
      const next=lib.copy(library,selected);
      persist(next.library);selected=next.routeId;renderRoutes();
      libraryMessage('Separate Kopie gespeichert; ursprüngliche Revisionen bleiben unverändert.');
    }catch{libraryMessage('Kopieren nicht möglich.');}
  });
  $('delete').addEventListener('click',()=>{
    if(selected==null||!window.confirm('Gesamte Route mit allen Revisionen lokal löschen?'))return;
    try{
      const deleted=selected;
      persist(lib.remove(library,selected));selected=null;
      if(activeRouteId===deleted)activeRouteId=null;
      renderRoutes();
      libraryMessage('Route lokal gelöscht; geöffneter Entwurf bleibt unverändert.');
    }catch{libraryMessage('Route konnte nicht entfernt werden.');}
  });
  let pendingBackup=null,backupReadGeneration=0;
  const backupPreview=$('backup-preview');
  function resetBackup(message,error=false){
    pendingBackup=null;
    $('backup-apply').disabled=true;
    $('backup-discard').disabled=true;
    backupPreview.textContent=message;
    backupPreview.style.color=error?'#ffca8c':'#adcadb';
  }
  $('backup-export').addEventListener('click',()=>{
    if(!window.confirm('Sicherung enthält GPS-Koordinaten und Missionsdaten UNVERSCHLÜSSELT. JSON-Datei jetzt lokal exportieren?'))return;
    try{
      const output=backup.exportBackup(library);
      const blob=new Blob([output.content],{type:'application/json'});
      const url=URL.createObjectURL(blob);
      const link=make('a');
      link.href=url;link.download='skyhub-local-routes-'+Date.now()+'.json';
      document.body.appendChild(link);link.click();link.remove();
      setTimeout(()=>URL.revokeObjectURL(url),30000);
      libraryMessage('Lokale Klartext-Sicherung erzeugt: '+
        output.preview.routeCount+' Routen, '+output.preview.revisionCount+
        ' Revisionen. Nicht weitergeben oder öffentlich hochladen.');
    }catch{libraryMessage('Sicherung abgelehnt: Daten ungültig, zu groß oder Dateidownload fehlgeschlagen.');}
  });
  $('backup-file').addEventListener('change',async event=>{
    const input=event.currentTarget;
    const file=input.files&&input.files[0];
    const generation=++backupReadGeneration;
    resetBackup('Keine Sicherung zum Import vorgemerkt.');
    if(!file)return;
    try{
      if(file.size>backup.MAX_SIZE||file.size<2)
        throw Error('file size');
      // Allow cancellation while file.text() is still in progress.
      $('backup-discard').disabled=false;
      backupPreview.textContent='Lokale Datei wird ausschließlich hier geprüft. Import verwerfen ist jederzeit möglich.';
      const contents=await file.text();
      if(generation!==backupReadGeneration)return;
      const inspected=backup.inspectBackup(contents);
      if(generation!==backupReadGeneration)return;
      pendingBackup=inspected.library;
      $('backup-apply').disabled=false;
      $('backup-discard').disabled=false;
      backupPreview.textContent='Lokale Sicherung geprüft: '+
        inspected.preview.routeCount+' Routen, '+
        inspected.preview.revisionCount+' Revisionen, '+
        inspected.preview.waypointOccurrences+' gespeicherte Wegpunkt-Vorkommen. '+
        'Bei Übernahme wird die aktuelle Browserbibliothek VOLLSTÄNDIG ersetzt. '+
        'Inhalte sind unverschlüsselt; kein DJI-Flugauftrag.';
    }catch{
      if(generation!==backupReadGeneration)return;
      resetBackup('Sicherung abgelehnt: Datei, Schema, Duplikatschlüssel oder Missionen ungültig.',true);
    }finally{input.value='';}
  });
  $('backup-discard').addEventListener('click',()=>{
    ++backupReadGeneration;
    resetBackup('Sicherungsimport verworfen. Bibliothek unverändert.');
  });
  $('backup-apply').addEventListener('click',()=>{
    if(!pendingBackup)return;
    if(!window.confirm('ACHTUNG: Die gesamte bisherige lokale Routenbibliothek wird ersetzt. Vorherige Daten nur mit eigener Sicherung wiederherstellbar. Jetzt überschreiben?'))return;
    try{
      const next=lib.check(pendingBackup);
      persist(next); // Atomically replace localStorage before changing UI state.
      ++backupReadGeneration;
      resetBackup('Sicherung übernommen. Routen müssen vor Bearbeitung neu geladen werden.');
      selected=null;activeRouteId=null;
      // A possibly unrelated working draft stays untouched and unsaved.
      renderRoutes();
      libraryMessage('Lokale Routenbibliothek nach ausdrücklicher Bestätigung ersetzt. '+
        'Der derzeitige Editorentwurf bleibt unverändert; kein Flugauftrag.');
    }catch{resetBackup('Übernahme fehlgeschlagen. Aktuelle Browserbibliothek nicht absichtlich verändert.',true);}
  });
  $('clear-storage').addEventListener('click',()=>{
    if(!window.confirm('ALLE lokal gespeicherten Routen und Revisionen löschen?'))return;
    try{
      window.localStorage.removeItem(STORAGE);
      library=lib.blank();selected=null;activeRouteId=null;renderRoutes();
      libraryMessage('Lokaler Bibliotheksspeicher gelöscht. Aktueller Entwurf bleibt geöffnet.');
    }catch{libraryMessage('Löschen fehlgeschlagen.');}
  });
  $('filter').addEventListener('input',renderRoutes);
  $('export').addEventListener('click',()=>{
    try{
      const output=review(),blob=new Blob([output.kmz],
        {type:'application/vnd.google-earth.kmz'});
      const url=URL.createObjectURL(blob);
      const link=make('a');link.href=url;
      link.download='skyhub-offline-route-'+Date.now()+'.kmz';
      document.body.appendChild(link);link.click();link.remove();
      setTimeout(()=>URL.revokeObjectURL(url),30000);
      message('Offline-KMZ erzeugt. Kein Upload, kein DJI-Pilot-2-Test, flightReady=false.');
    }catch{message('KMZ-Export blockiert: ungültiger oder nicht unterstützter Entwurf.',true);}
  });
  for(const id of ['route-name','route-folder','model','speed','height','takeoff','finish'])
    $(id).addEventListener('input',()=>{dirty=true;});
  renderEditor();renderRoutes();
})();
