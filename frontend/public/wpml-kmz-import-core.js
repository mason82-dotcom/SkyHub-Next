'use strict';
/* SkyHub WPML KMZ import for the mission editor. Browser/Node module.
 * Reads a DJI WPML KMZ (DJI Pilot 2 / FlightHub 2 / SkyHub export) locally and
 * converts the waypoint template into an editable SkyHub draft. Everything the
 * editor cannot represent is listed in `notes`; nothing is dropped silently.
 * No network access, no DJI dispatch, no flight approval.
 */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.SkyHubWpmlKmzImport=factory();
})(typeof globalThis==='object'?globalThis:this,function(){
  const KML='http://www.opengis.net/kml/2.2';
  const WPML_102='http://www.dji.com/wpmz/1.0.2';
  const WPML_106='http://www.dji.com/wpmz/1.0.6';
  const MAX_ZIP=12*1024*1024,MAX_TOTAL=32*1024*1024,MAX_ENTRIES=128,MAX_XML=2*1024*1024;
  const DECODER=new TextDecoder('utf-8',{fatal:true});
  function fail(message){throw new TypeError('KMZ-Import: '+message);}

  function crc32(data){
    let c=0xffffffff;
    for(let k=0;k<data.length;k++){
      c^=data[k];
      for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);
    }
    return (c^0xffffffff)>>>0;
  }
  async function inflateRaw(bytes,expected){
    if(typeof DecompressionStream!=='function')fail('Browser unterstützt keine Deflate-Dekompression.');
    const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    const reader=stream.getReader(),out=new Uint8Array(expected);
    let size=0;
    try{
      for(;;){
        const {done,value}=await reader.read();
        if(done)break;
        if(size+value.length>expected){await reader.cancel();fail('Archiveintrag größer als angegeben.');}
        out.set(value,size);size+=value.length;
      }
    }catch(error){
      if(error instanceof TypeError&&/^KMZ-Import/.test(error.message))throw error;
      fail('Archiveintrag beschädigt.');
    }
    if(size!==expected)fail('Archiveintrag kürzer als angegeben.');
    return out;
  }
  // Bounded ZIP reader mirroring backend/wpml-kmz.js. Only the two WPML
  // documents are decoded; wpmz/res/ resources are counted, never executed.
  async function readKmz(input){
    const bytes=input instanceof Uint8Array?input:
      input instanceof ArrayBuffer?new Uint8Array(input):null;
    if(!bytes||bytes.length<22)fail('keine gültige KMZ-Datei.');
    if(bytes.length>MAX_ZIP)fail('Datei größer als 12 MiB.');
    const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    const u16=p=>view.getUint16(p,true),u32=p=>view.getUint32(p,true);
    let eocd=-1;
    for(let i=bytes.length-22,stop=Math.max(0,bytes.length-22-65535);i>=stop;i--){
      if(u32(i)===0x06054b50&&i+22+u16(i+20)===bytes.length){eocd=i;break;}
    }
    if(eocd<0)fail('ZIP-Verzeichnis fehlt (keine KMZ-Datei?).');
    const count=u16(eocd+10),dirSize=u32(eocd+12),dirOffset=u32(eocd+16);
    if(u16(eocd+4)!==0||u16(eocd+6)!==0||u16(eocd+8)!==count||count<1||count>MAX_ENTRIES||
       dirOffset+dirSize!==eocd)fail('nicht unterstütztes ZIP-Format.');
    const docs=new Map(),names=new Set();
    let pos=dirOffset,total=0,resources=0;
    for(let n=0;n<count;n++){
      if(pos+46>eocd||u32(pos)!==0x02014b50)fail('ZIP-Verzeichnis beschädigt.');
      const flag=u16(pos+8),method=u16(pos+10),crc=u32(pos+16);
      const compressed=u32(pos+20),size=u32(pos+24);
      const nameLen=u16(pos+28),extraLen=u16(pos+30),commentLen=u16(pos+32);
      const attrs=u32(pos+38),local=u32(pos+42);
      const end=pos+46+nameLen+extraLen+commentLen;
      if(end>eocd||nameLen===0)fail('ungültiger ZIP-Eintrag.');
      let name;
      try{name=DECODER.decode(bytes.subarray(pos+46,pos+46+nameLen));}
      catch(_e){fail('ungültiger Dateiname im Archiv.');}
      if(name.includes('\\')||name.startsWith('/')||name.split('/').includes('..')||name.includes('\0'))
        fail('unsicherer Pfad im Archiv.');
      if(names.has(name))fail('doppelter Archiveintrag.');
      names.add(name);
      if((flag&1)||(flag&0x40)||![0,8].includes(method)||(attrs>>>16&0xf000)===0xa000)
        fail('verschlüsselte oder nicht unterstützte Einträge.');
      if(size>MAX_TOTAL||size>compressed*500+4096)fail('Dekompressionslimit überschritten.');
      total+=size;
      if(total>MAX_TOTAL)fail('Archiv entpackt größer als 32 MiB.');
      pos=end;
      const isTemplate=/^(?:wpmz\/)?template\.kml$/.test(name);
      const isWaylines=/^(?:wpmz\/)?waylines\.wpml$/.test(name);
      if(!isTemplate&&!isWaylines){
        if(!name.endsWith('/'))resources++;
        continue;
      }
      if(local+30>dirOffset||u32(local)!==0x04034b50||u16(local+8)!==method)
        fail('lokaler ZIP-Header ungültig.');
      const dataOffset=local+30+u16(local+26)+u16(local+28);
      if(dataOffset+compressed>dirOffset)fail('ZIP-Eintrag überlappt Verzeichnis.');
      if(size>MAX_XML)fail('WPML-Dokument größer als 2 MiB.');
      const raw=bytes.subarray(dataOffset,dataOffset+compressed);
      const plain=method===0?raw:await inflateRaw(raw,size);
      if(plain.length!==size||crc32(plain)!==crc)fail('CRC32-Prüfung fehlgeschlagen.');
      const key=isTemplate?'template':'waylines';
      if(docs.has(key))fail('mehrdeutige WPML-Dokumente.');
      let text;
      try{text=DECODER.decode(plain);}catch(_e){fail('WPML-Dokument ist kein UTF-8.');}
      docs.set(key,text);
    }
    if(pos!==eocd)fail('ZIP-Verzeichnislänge ungültig.');
    if(!docs.has('template'))fail('wpmz/template.kml fehlt.');
    return {template:docs.get('template'),waylines:docs.get('waylines')||null,resourceCount:resources};
  }

  function decodeEntities(input){
    if(/&(?!(?:amp|lt|gt|apos|quot|#\d+|#x[0-9a-fA-F]+);)/.test(input))fail('ungültige XML-Entität.');
    return input.replace(/&(amp|lt|gt|apos|quot|#\d+|#x[0-9a-fA-F]+);/g,(_,s)=>{
      const named={amp:'&',lt:'<',gt:'>',apos:"'",quot:'"'};
      if(named[s])return named[s];
      const n=s.startsWith('#x')?parseInt(s.slice(2),16):Number(s.slice(1));
      if(!Number.isInteger(n)||n<1||n>0x10ffff||(n>=0xd800&&n<=0xdfff)||(n<32&&n!==9&&n!==10&&n!==13))
        fail('ungültiges XML-Zeichen.');
      return String.fromCodePoint(n);
    });
  }
  // Strict, DTD-free XML reader (no entities, no processing instructions after prolog).
  function parseXml(xml){
    if(typeof xml!=='string'||xml.length>MAX_XML)fail('XML zu groß.');
    if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(xml))fail('Steuerzeichen im XML.');
    if(xml.charCodeAt(0)===0xfeff)xml=xml.slice(1);
    let i=0,root=null,count=0;const stack=[];
    while(i<xml.length){
      if(xml.startsWith('<!--',i)){
        const end=xml.indexOf('-->',i+4);
        if(end<0)fail('ungültiger XML-Kommentar.');
        i=end+3;continue;
      }
      if(xml.startsWith('<?',i)){
        const end=xml.indexOf('?>',i+2);
        if(end<0||root||stack.length||!/^<\?xml\s/.test(xml.slice(i,end+2)))fail('XML-Verarbeitungsanweisung nicht erlaubt.');
        i=end+2;continue;
      }
      if(xml.startsWith('<![CDATA[',i)){
        const end=xml.indexOf(']]>',i+9);
        if(end<0||!stack.length)fail('ungültiger CDATA-Block.');
        stack[stack.length-1].text+=xml.slice(i+9,end);i=end+3;continue;
      }
      if(xml.startsWith('<!',i))fail('DTD/Entitäten sind nicht erlaubt.');
      if(xml[i]!=='<'){
        const next=xml.indexOf('<',i),stop=next<0?xml.length:next;
        const text=decodeEntities(xml.slice(i,stop));
        if(stack.length)stack[stack.length-1].text+=text;
        else if(text.trim())fail('Text außerhalb des Wurzelelements.');
        i=stop;continue;
      }
      let end=i+1,quote=null;
      for(;end<xml.length;end++){
        const c=xml[end];
        if(quote){if(c===quote)quote=null;}
        else if(c==='"'||c==="'")quote=c;
        else if(c==='>')break;
        else if(c==='<')fail('verschachteltes Markup.');
      }
      if(end>=xml.length)fail('nicht abgeschlossenes Tag.');
      const raw=xml.slice(i+1,end);
      if(raw.startsWith('/')){
        const m=/^\/([A-Za-z_][\w.:-]*)\s*$/.exec(raw);
        if(!m||!stack.length||stack[stack.length-1].name!==m[1])fail('unausgeglichene XML-Tags.');
        stack.pop();i=end+1;continue;
      }
      const m=/^([A-Za-z_][\w.:-]*)([\s\S]*)$/.exec(raw);
      if(!m)fail('ungültiges XML-Tag.');
      const selfClose=/\/\s*$/.test(m[2]);
      const attrText=selfClose?m[2].replace(/\/\s*$/,''):m[2];
      const attributes={};let offset=0;
      while(offset<attrText.length&&!/^\s*$/.test(attrText.slice(offset))){
        const a=/^\s+([A-Za-z_][\w.:-]*)\s*=\s*("[^"]*"|'[^']*')/.exec(attrText.slice(offset));
        if(!a||Object.hasOwn(attributes,a[1]))fail('ungültiges XML-Attribut.');
        attributes[a[1]]=decodeEntities(a[2].slice(1,-1));offset+=a[0].length;
      }
      if(stack.length&&(Object.hasOwn(attributes,'xmlns')||Object.hasOwn(attributes,'xmlns:wpml')))
        fail('verschachtelte Namespace-Umdefinition nicht unterstützt.');
      if(++count>20000||stack.length>=48)fail('XML zu komplex.');
      const node={name:m[1],attributes,children:[],text:''};
      if(stack.length)stack[stack.length-1].children.push(node);
      else if(root)fail('mehrere Wurzelelemente.');
      else root=node;
      if(!selfClose)stack.push(node);
      i=end+1;
    }
    if(stack.length||!root)fail('unvollständiges XML-Dokument.');
    if(root.name!=='kml'||root.attributes.xmlns!==KML)fail('kein KML-Dokument.');
    const ns=root.attributes['xmlns:wpml'];
    if(ns!==WPML_102&&ns!==WPML_106)fail('unbekannter WPML-Namespace (erwartet 1.0.2 oder 1.0.6).');
    return {root,version:ns===WPML_106?'1.0.6':'1.0.2'};
  }
  const kids=(node,name)=>node?node.children.filter(c=>c.name===name):[];
  const one=(node,name)=>kids(node,name)[0]||null;
  const text=(node,name)=>{const n=one(node,'wpml:'+name);return n?n.text.trim():'';};
  function number(raw,label){
    if(!/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?$/.test(raw))fail(label+' ist keine Zahl.');
    const n=Number(raw);
    if(!Number.isFinite(n))fail(label+' ist keine endliche Zahl.');
    return n;
  }
  const optNumber=(node,name,label)=>{const raw=text(node,name);return raw===''?null:number(raw,label);};
  const round7=v=>Math.round(v*1e7)/1e7;
  function coordinates(placemark,label){
    const raw=one(one(placemark,'Point'),'coordinates')?.text.trim()||'';
    const parts=raw.split(',').map(s=>s.trim());
    if(parts.length<2||parts.length>3)fail(label+': Koordinate fehlt oder ungültig.');
    const lon=number(parts[0],label+' Längengrad'),lat=number(parts[1],label+' Breitengrad');
    if(lat<-90||lat>90||lon<-180||lon>180)fail(label+': Koordinate außerhalb WGS84.');
    return {lat:round7(lat),lon:round7(lon)};
  }
  function actionGroups(container){
    const groups=[];
    for(const group of kids(container,'wpml:actionGroup')){
      const trigger=one(group,'wpml:actionTrigger');
      groups.push({
        start:optNumber(group,'actionGroupStartIndex','actionGroupStartIndex'),
        end:optNumber(group,'actionGroupEndIndex','actionGroupEndIndex'),
        trigger:trigger?text(trigger,'actionTriggerType'):'',
        param:trigger?text(trigger,'actionTriggerParam'):'',
        actions:kids(group,'wpml:action').map(a=>text(a,'actionActuatorFunc')||'unbekannt')
      });
    }
    return groups;
  }
  function sanitizeName(fileName){
    const base=String(fileName||'').replace(/\.kmz$/i,'').replace(/[\u0000-\u001f\u007f]/g,' ')
      .replace(/\s+/g,' ').trim().slice(0,70).trim();
    return base||'Importierte Mission';
  }

  // Aircraft profile for droneInfo/payloadInfo. Exact match first. DJI Pilot 2 itself writes Matrice 4T routes as
  // droneSubEnumValue 0 (= Matrice 4E) with the 4T camera 89 (seen 05.11.2026, routes from Feb/Mar 2025) and lists them as M4T:
  // within one aircraft family the camera decides, as in backend/wpml-product-support.js. The re-export carries the corrected
  // droneSubEnumValue; the note makes the correction visible. A camera from another family stays an error.
  function resolveModel(models,droneEnum,droneSub,payloadEnum){
    const keys=Object.keys(models||{});
    const same=(k,sub)=>String(models[k].drone)===droneEnum&&(sub===undefined||String(models[k].subtype)===sub);
    const exact=keys.find(k=>same(k,droneSub)&&(payloadEnum===''||String(models[k].payload)===payloadEnum));
    if(exact)return {key:exact,note:null};
    const declared=keys.find(k=>same(k,droneSub));
    const byCamera=payloadEnum!==''&&declared?keys.find(k=>same(k)&&String(models[k].payload)===payloadEnum):undefined;
    if(!byCamera)return {key:undefined,note:null};
    return {key:byCamera,note:'Fluggerät: droneSubEnumValue '+droneSub+' ('+models[declared].name+') passt nicht zur Kamera '+
      payloadEnum+' der '+models[byCamera].name+'; übernommen als '+models[byCamera].name+' wie in DJI Pilot 2 '+
      '(droneSubEnumValue '+models[byCamera].subtype+' im Export). Bitte das Fluggerät in Pilot 2 prüfen.'};
  }

  function convert({template,waylines=null,fileName='',models}={}){
    if(!models||typeof models!=='object')fail('Fluggeräteprofile fehlen.');
    const notes=[];
    const parsed=parseXml(template);
    if(parsed.version==='1.0.6')
      notes.push('WPML 1.0.6 (DJI Pilot 2/FlightHub 2) wird als 1.0.2-Entwurf neu exportiert – nicht semantisch gleichwertig.');
    const documentNode=one(parsed.root,'Document');
    if(!documentNode)fail('KML-Document fehlt.');
    const config=one(documentNode,'wpml:missionConfig');
    if(!config)fail('missionConfig fehlt.');
    const drone=one(config,'wpml:droneInfo'),payload=one(config,'wpml:payloadInfo');
    const droneEnum=drone?text(drone,'droneEnumValue'):'',droneSub=drone?text(drone,'droneSubEnumValue')||'0':'';
    const payloadEnum=payload?text(payload,'payloadEnumValue'):'';
    const {key:modelKey,note:modelNote}=resolveModel(models,droneEnum,droneSub,payloadEnum);
    if(modelNote)notes.push(modelNote);
    if(!modelKey)fail('Fluggerät/Nutzlast (drone '+(droneEnum||'?')+'/'+(droneSub||'?')+', payload '+
      (payloadEnum||'?')+') wird vom Editor nicht unterstützt.');
    const finish=text(config,'finishAction')||'goHome';
    if(!['goHome','noAction'].includes(finish))
      fail('Missionsende „'+finish+'“ wird vom Editor nicht unterstützt (nur RTH oder keine Aktion).');
    const exitRc=text(config,'exitOnRCLost'),lostAction=text(config,'executeRCLostAction');
    if(exitRc!=='executeLostAction'||(lostAction&&lostAction!=='goBack'))
      notes.push('RC-Signalverlust: Quelle „'+(exitRc||'?')+(lostAction?' / '+lostAction:'')+
        '“ – der Editor exportiert immer executeLostAction / goBack (RTH).');
    if(text(config,'flyToWaylineMode')==='pointToPoint')
      notes.push('Anflugmodus pointToPoint wird zu „safely“.');
    const takeoffHeight=optNumber(config,'takeOffSecurityHeight','takeOffSecurityHeight')??30;
    const transition=optNumber(config,'globalTransitionalSpeed','globalTransitionalSpeed');
    // DJI requires globalRTHHeight; take it over when it fits the editor's 20–120 m range.
    const sourceRth=text(config,'globalRTHHeight')?optNumber(config,'globalRTHHeight','globalRTHHeight'):null;
    let rthHeight=100;
    if(sourceRth===null)notes.push('Quelle ohne RTH-Höhe: der Editor setzt 100 m (bitte prüfen).');
    else if(sourceRth<20||sourceRth>120)
      notes.push('RTH-Höhe der Quelle '+sourceRth+' m liegt außerhalb 20–120 m; der Editor setzt 100 m (bitte prüfen).');
    else rthHeight=sourceRth;

    const folders=kids(documentNode,'Folder');
    if(folders.length!==1)fail('genau ein Template-Folder erwartet, gefunden: '+folders.length+'.');
    const folder=folders[0];
    const type=text(folder,'templateType');
    if(type!=='waypoint'){
      // Mapping/corridor routes cannot be edited; the editor offers a read-only preview (previewMapping) instead.
      const error=new TypeError('KMZ-Import: Template-Typ „'+(type||'?')+'“ ist keine Wegpunktmission (Mapping/Korridor nicht editierbar).');
      error.templateType=type||null;
      throw error;
    }
    const coord=one(folder,'wpml:waylineCoordinateSysParam');
    const heightMode=coord?text(coord,'heightMode'):'';
    if(heightMode!=='relativeToStartPoint')
      fail('Höhenreferenz „'+(heightMode||'?')+'“ nicht unterstützt; der Editor arbeitet nur relativ zum Startpunkt.');
    if(coord&&text(coord,'coordinateMode')&&text(coord,'coordinateMode')!=='WGS84')fail('nur WGS84-Koordinaten unterstützt.');
    const speed=optNumber(folder,'autoFlightSpeed','autoFlightSpeed');
    if(speed===null)fail('autoFlightSpeed fehlt.');
    if(transition!==null&&transition!==speed)
      notes.push('Übergangsgeschwindigkeit '+transition+' m/s wird auf Missionsgeschwindigkeit '+speed+' m/s gesetzt.');
    const globalHeight=optNumber(folder,'globalHeight','globalHeight');
    const turnMode=text(folder,'globalWaypointTurnMode');
    if(turnMode&&turnMode!=='toPointAndStopWithDiscontinuityCurvature')
      notes.push('Kurvenmodus „'+turnMode+'“ wird zu „Anhalten an jedem Wegpunkt“.');
    const headingParam=one(folder,'wpml:globalWaypointHeadingParam');
    const headingMode=headingParam?text(headingParam,'waypointHeadingMode'):'';
    if(headingMode&&headingMode!=='followWayline')
      notes.push('Globale Ausrichtung „'+headingMode+'“ wird zu „followWayline“.');
    const gimbalMode=text(folder,'gimbalPitchMode');
    if(gimbalMode&&gimbalMode!=='manual')notes.push('Gimbal-Neigungsmodus „'+gimbalMode+'“ wird zu „manual“.');

    const placemarks=kids(folder,'Placemark');
    if(placemarks.length<2||placemarks.length>500)fail('2 bis 500 Wegpunkte erforderlich, gefunden: '+placemarks.length+'.');
    const ordered=placemarks.map((pm,pos)=>({pm,index:optNumber(pm,'index','Wegpunktindex')??pos}))
      .sort((a,b)=>a.index-b.index);
    ordered.forEach((entry,pos)=>{if(entry.index!==pos)fail('Wegpunktindizes sind nicht lückenlos 0…n-1.');});
    let speedNotes=0,headingNotes=0,turnNotes=0;
    const raw=ordered.map(({pm},pos)=>{
      const label='Wegpunkt '+(pos+1);
      const {lat,lon}=coordinates(pm,label);
      const useGlobal=text(pm,'useGlobalHeight')!=='0';
      const height=useGlobal?globalHeight:optNumber(pm,'height',label+' Höhe');
      if(height===null)fail(label+': Höhe fehlt.');
      if(text(pm,'useGlobalSpeed')==='0'){
        const s=optNumber(pm,'waypointSpeed',label+' Geschwindigkeit');
        if(s!==null&&s!==speed)speedNotes++;
      }
      if(text(pm,'useGlobalHeadingParam')==='0')headingNotes++;
      if(text(pm,'useGlobalTurnParam')==='0')turnNotes++;
      return {lat,lon,height,useGlobal,ellipsoidHeight:optNumber(pm,'ellipsoidHeight',label+' Ellipsoidhöhe'),
        groups:actionGroups(pm)};
    });
    if(speedNotes)notes.push(speedNotes+' Wegpunkt(e) mit eigener Geschwindigkeit fliegen künftig mit '+speed+' m/s.');
    if(headingNotes)notes.push(headingNotes+' Wegpunkt(e) mit eigener Ausrichtung/POI werden auf „followWayline“ gesetzt.');
    if(turnNotes)notes.push(turnNotes+' Wegpunkt(e) mit eigenem Kurvenverhalten werden auf „Anhalten“ gesetzt.');
    const localHeights=raw.some(p=>!p.useGlobal);
    if(localHeights&&raw.some(p=>p.ellipsoidHeight===null))
      fail('individuelle Wegpunkthöhen ohne WGS84-Ellipsoidhöhe an jedem Wegpunkt – SkyHub schätzt diese nicht.');
    if(!localHeights&&raw.some(p=>p.ellipsoidHeight!==null))
      notes.push('Ellipsoidhöhen der Quelle werden ignoriert, weil alle Wegpunkte die globale Höhe nutzen.');
    for(let i=1;i<raw.length;i++){
      if(raw[i].lat===raw[i-1].lat&&raw[i].lon===raw[i-1].lon)
        fail('Wegpunkte '+i+' und '+(i+1)+' sind identisch.');
    }

    // Action groups: template Placemarks first; fall back to the executable waylines file.
    let groups=raw.flatMap(p=>p.groups);
    let wayline=null;
    if(waylines){
      const w=parseXml(waylines);
      const wFolders=kids(one(w.root,'Document'),'Folder');
      if(wFolders.length>1)notes.push('waylines.wpml enthält '+wFolders.length+' Flugwege; nur die Vorlage wird übernommen.');
      wayline=wFolders[0]||null;
      if(wayline){
        const wp=kids(wayline,'Placemark');
        if(wp.length!==raw.length)
          notes.push('waylines.wpml hat '+wp.length+' statt '+raw.length+' Wegpunkte; die Vorlage (template.kml) wird übernommen.');
        else{
          const moved=wp.filter((pm,pos)=>{
            try{const c=coordinates(pm,'Flugweg '+(pos+1));
              return Math.abs(c.lat-raw[pos].lat)>1e-6||Math.abs(c.lon-raw[pos].lon)>1e-6;}
            catch(_e){return true;}
          }).length;
          if(moved)notes.push(moved+' Wegpunkt(e) weichen zwischen template.kml und waylines.wpml ab; die Vorlage wird übernommen.');
        }
        if(!groups.length)groups=wp.flatMap(actionGroups);
      }
    }
    const photo=new Array(raw.length).fill(false);
    let intervalPhotos=null;
    const skipped=[];
    for(const g of groups){
      const span=g.start===null?'?':g.start===g.end?'WP '+(g.start+1):'WP '+(g.start+1)+'–'+((g.end??g.start)+1);
      const onlyPhoto=g.actions.length===1&&g.actions[0]==='takePhoto';
      if(g.trigger==='reachPoint'&&onlyPhoto&&g.start!==null&&g.start===g.end&&g.start>=0&&g.start<raw.length){
        photo[g.start]=true;continue;
      }
      if((g.trigger==='multipleDistance'||g.trigger==='multipleTiming')&&onlyPhoto&&!intervalPhotos&&
         g.start===0&&g.end===raw.length-1&&/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(g.param)){
        intervalPhotos={type:g.trigger,interval:g.param};continue;
      }
      skipped.push(span+': '+(g.trigger||'?')+' → '+g.actions.join(', '));
    }
    if(intervalPhotos&&photo.some(Boolean)){
      notes.push('Intervallfotos und Einzelfotos kombiniert: Einzelfotos werden verworfen (Editor erlaubt nur eines).');
      photo.fill(false);
    }
    if(skipped.length)notes.push('Nicht übernommene Aktionsgruppen ('+skipped.length+'): '+
      skipped.slice(0,8).join('; ')+(skipped.length>8?'; …':''));

    const plan={
      name:sanitizeName(fileName),model:modelKey,speed,takeoffHeight,rthHeight,finishAction:finish,
      waypoints:raw.map((p,i)=>localHeights?
        {lat:p.lat,lon:p.lon,height:p.height,ellipsoidHeight:p.ellipsoidHeight,photo:photo[i]}:
        {lat:p.lat,lon:p.lon,height:p.height,photo:photo[i]}),
      ...(intervalPhotos?{intervalPhotos}:{})
    };
    return Object.freeze({
      plan,localHeights,globalHeight:localHeights?null:globalHeight,
      review:Object.freeze({
        wpmlVersion:parsed.version,aircraft:models[modelKey].name,
        waypointCount:raw.length,photoCount:photo.filter(Boolean).length,
        intervalPhotos:intervalPhotos?{...intervalPhotos}:null,
        skippedActionGroups:skipped.length,hasWaylines:Boolean(wayline)
      }),
      notes:Object.freeze(notes),flightReady:false
    });
  }
  // --- Read-only preview of mapping / oblique / corridor routes (DJI WPML template.kml + waylines.wpml) -----------------
  // Shows what Pilot 2 will fly; nothing is converted, edited or exported. Coordinates in KML order lon,lat[,alt].
  const MAPPING=Object.freeze({mapping2d:'Flächenkartierung (2D)',mapping3d:'Schrägaufnahme (3D)',mappingStrip:'Korridor'});
  function coordList(raw,label,max=20000){
    const tokens=String(raw||'').trim().split(/\s+/).filter(Boolean);
    if(tokens.length>max)fail(label+': zu viele Koordinaten.');
    return tokens.map((t,i)=>{
      const parts=t.split(',');
      if(parts.length<2||parts.length>3)fail(label+' '+(i+1)+': Koordinate ungültig.');
      const lon=number(parts[0],label+' Längengrad'),lat=number(parts[1],label+' Breitengrad');
      if(lat<-90||lat>90||lon<-180||lon>180)fail(label+': Koordinate außerhalb WGS84.');
      return {lat:round7(lat),lon:round7(lon)};
    });
  }
  const RAD=Math.PI/180,R=6371008.8;
  function haversine(a,b){
    const dLat=(b.lat-a.lat)*RAD,dLon=(b.lon-a.lon)*RAD;
    const h=Math.sin(dLat/2)**2+Math.cos(a.lat*RAD)*Math.cos(b.lat*RAD)*Math.sin(dLon/2)**2;
    return 2*R*Math.asin(Math.min(1,Math.sqrt(h)));
  }
  const pathLength=list=>list.slice(1).reduce((sum,p,i)=>sum+haversine(list[i],p),0);
  // Polygon area on a local equirectangular projection (accurate enough for fields of a few km).
  function polygonArea(ring){
    if(ring.length<3)return 0;
    const lat0=ring.reduce((s,p)=>s+p.lat,0)/ring.length*RAD;
    const xy=ring.map(p=>[p.lon*RAD*R*Math.cos(lat0),p.lat*RAD*R]);
    let a=0;for(let i=0;i<xy.length;i++){const [x1,y1]=xy[i],[x2,y2]=xy[(i+1)%xy.length];a+=x1*y2-x2*y1;}
    return Math.abs(a)/2;
  }
  function previewMapping({template,waylines=null,fileName='',models}={}){
    const parsed=parseXml(template);
    const documentNode=one(parsed.root,'Document');
    if(!documentNode)fail('KML-Document fehlt.');
    const config=one(documentNode,'wpml:missionConfig');
    if(!config)fail('missionConfig fehlt.');
    const folders=kids(documentNode,'Folder');
    if(folders.length!==1)fail('genau ein Template-Folder erwartet, gefunden: '+folders.length+'.');
    const folder=folders[0],type=text(folder,'templateType');
    if(!Object.hasOwn(MAPPING,type))fail('Template-Typ „'+(type||'?')+'“ ist keine Kartierungs- oder Korridormission.');
    const drone=one(config,'wpml:droneInfo'),payload=one(config,'wpml:payloadInfo');
    const droneEnum=drone?text(drone,'droneEnumValue'):'',droneSub=drone?text(drone,'droneSubEnumValue')||'0':'';
    const payloadEnum=payload?text(payload,'payloadEnumValue'):'';
    const {key:modelKey}=resolveModel(models,droneEnum,droneSub,payloadEnum);
    const placemark=one(folder,'Placemark');
    const polygon=placemark?one(one(one(one(placemark,'Polygon'),'outerBoundaryIs'),'LinearRing'),'coordinates'):null;
    const lineString=placemark?one(one(placemark,'LineString'),'coordinates'):null;
    let area=polygon?coordList(polygon.text,'Fläche'):[];
    if(area.length>1&&area[0].lat===area.at(-1).lat&&area[0].lon===area.at(-1).lon)area=area.slice(0,-1);
    const corridor=lineString?coordList(lineString.text,'Korridor'):[];
    const coord=one(folder,'wpml:waylineCoordinateSysParam');
    const overlap=placemark?one(placemark,'wpml:overlap'):null;
    const optional=(node,name)=>{if(!node)return null;const raw=text(node,name);return raw===''?null:number(raw,name);};
    // Flown path: the executable waylines.wpml (all Folders, waypoints in order).
    const path=[];
    if(waylines){
      const wdoc=one(parseXml(waylines).root,'Document');
      for(const wfolder of kids(wdoc,'Folder'))for(const pm of kids(wfolder,'Placemark'))path.push(coordinates(pm,'Fluglinie'));
    }
    const speed=optional(folder,'autoFlightSpeed');
    const lengthM=Math.round(pathLength(path));
    const shootHeight=optional(coord,'globalShootHeight')??optional(placemark,'height')??optional(coord,'surfaceRelativeHeight');
    return Object.freeze({
      // DJI wayline names allow no . _ : etc. (store rule); clean the file name so "Original ablegen" works as is.
      kind:'mapping',templateType:type,label:MAPPING[type],wpmlVersion:parsed.version,
      name:sanitizeName(fileName).replace(/[<>:"/|?*._\\]+/g,' ').replace(/\s+/g,' ').trim().slice(0,64).trim()||'Kartierungsroute',
      aircraft:modelKey?models[modelKey].name:'drone '+(droneEnum||'?')+'/'+(droneSub||'?'),payloadEnum:payloadEnum||null,
      area:Object.freeze(area),corridor:Object.freeze(corridor),path:Object.freeze(path),
      stats:Object.freeze({
        areaM2:Math.round(polygonArea(area)),corridorM:Math.round(pathLength(corridor)),
        waypoints:path.length,lengthM,speedMs:speed,
        durationMin:speed&&lengthM?Math.round(lengthM/speed/6)/10:null,
        shootHeightM:shootHeight,heightMode:coord?text(coord,'heightMode')||null:null,
        terrainFollow:optional(coord,'surfaceFollowModeEnable')===1,
        overlapH:optional(overlap,'orthoCameraOverlapH'),overlapW:optional(overlap,'orthoCameraOverlapW'),
        direction:optional(placemark,'direction'),smartOblique:optional(placemark,'smartObliqueEnable')===1,
        shootType:placemark?text(placemark,'shootType')||null:null,
        finishAction:text(config,'finishAction')||null,rcLost:text(config,'executeRCLostAction')||text(config,'exitOnRCLost')||null
      }),
      flightReady:false
    });
  }
  async function previewKmz(bytes,{fileName,models}={}){
    const docs=await readKmz(bytes);
    return previewMapping({template:docs.template,waylines:docs.waylines,fileName,models});
  }
  async function importKmz(bytes,{fileName,models}={}){
    const docs=await readKmz(bytes);
    const result=convert({template:docs.template,waylines:docs.waylines,fileName,models});
    if(docs.resourceCount)
      return Object.freeze({...result,notes:Object.freeze([...result.notes,
        docs.resourceCount+' Ressourcendatei(en) unter wpmz/res/ werden nicht übernommen.'])});
    return result;
  }
  return Object.freeze({readKmz,parseXml,convert,importKmz,previewMapping,previewKmz,MAPPING,crc32});
});
