'use strict';
// RINEX header check for the PPK page (before upload): which file is the base, where is it, is it the drone's own file?
// RINEX 2/3 header lines carry their label in columns 61-80; APPROX POSITION XYZ is ECEF in metres (ETRS89 ≈ GRS80).
// The DJI aircraft writes .OBS files with empty MARKER/REC/ANT and APPROX 0/0/0 - such a file cannot be the base.
(function(root){
  const label=l=>l.slice(60).trim();
  function ecefToGeo(x,y,z){
    const a=6378137,f=1/298.257222101,e2=f*(2-f),b=a*(1-f),ep2=(a*a-b*b)/(b*b),p=Math.hypot(x,y),th=Math.atan2(z*a,p*b);
    const lat=Math.atan2(z+ep2*b*Math.sin(th)**3,p-e2*a*Math.cos(th)**3),N=a/Math.sqrt(1-e2*Math.sin(lat)**2);
    return {lat:lat*180/Math.PI,lon:Math.atan2(y,x)*180/Math.PI,h:p/Math.cos(lat)-N};
  }
  function parseHeader(text){
    const out={version:null,marker:'',receiver:'',antenna:'',approx:null,complete:false};
    for(const line of String(text).split(/\r?\n/).slice(0,400)){
      const l=label(line);
      if(l==='RINEX VERSION / TYPE')out.version=line.slice(0,9).trim();
      else if(l==='MARKER NAME')out.marker=line.slice(0,60).trim();
      else if(l==='REC # / TYPE / VERS')out.receiver=line.slice(20,40).trim();
      else if(l==='ANT # / TYPE')out.antenna=line.slice(20,40).trim().replace(/\s+/g,' ');
      else if(l==='APPROX POSITION XYZ'){
        const v=line.slice(0,42).trim().split(/\s+/).map(Number);
        if(v.length===3&&v.every(Number.isFinite))out.approx={x:v[0],y:v[1],z:v[2]};
      }else if(l==='END OF HEADER'){out.complete=true;break;}
    }
    return out;
  }
  const distKm=(a,b)=>{const r=Math.PI/180,s=Math.sin((b.lat-a.lat)*r/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin((b.lon-a.lon)*r/2)**2;
    return 12742*Math.asin(Math.sqrt(s));};
  // → {ok, block (stops the run), text, geo}; flights = [{lat, lon}] of the chosen flights (may be empty).
  function assess(h,{mode='header',flights=[]}={}){
    if(!h.version||!h.complete)return {ok:false,block:true,text:'Keine lesbare RINEX-Beobachtungsdatei (Kopf ohne „END OF HEADER“). Komprimierte Dateien (.gz, .crx) bitte vorher entpacken.'};
    const zero=!h.approx||Math.abs(h.approx.x)+Math.abs(h.approx.y)+Math.abs(h.approx.z)<1e6;
    if(zero&&!h.receiver&&!h.antenna)return {ok:false,block:true,
      text:'Diese Datei stammt offenbar von der Drohne (kein Empfänger, keine Antenne, Position 0/0/0). Als Basis die SAPOS-Datei aus dem GPPS-Webshop wählen.'};
    const who=[h.marker&&'Station '+h.marker,h.receiver,h.antenna].filter(Boolean).join(' · ');
    if(zero)return mode==='manual'?{ok:true,block:false,text:'Basis: '+who+' – Position aus der Handeingabe.'}
      :{ok:false,block:true,text:'Basis: '+who+' – der RINEX-Kopf enthält keine Position. „Koordinaten von Hand“ wählen und die Basisposition eintragen.'};
    const geo=ecefToGeo(h.approx.x,h.approx.y,h.approx.z);
    if(!(geo.lat>-90&&geo.lat<90)||!(geo.h>-200&&geo.h<3500))
      return {ok:false,block:true,text:'Position im RINEX-Kopf unplausibel ('+geo.h.toFixed(0)+' m ellipsoidisch). Datei prüfen oder „Koordinaten von Hand“ wählen.'};
    let text='Basis: '+who+' · '+geo.lat.toFixed(4)+' N, '+geo.lon.toFixed(4)+' E, '+geo.h.toFixed(1)+' m ellipsoidisch';
    const d=flights.filter(f=>f&&Number.isFinite(f.lat)&&Number.isFinite(f.lon)).map(f=>distKm(geo,f));
    let warn=false;
    if(d.length){const max=Math.max(...d);text+=' · Abstand zum Flug '+(max<1?Math.round(max*1000)+' m':max.toFixed(1)+' km');
      if(max>30){warn=true;text+=' – zu weit für sicheres Festsetzen (über 30 km); näher gelegene Station oder virtuelle Referenzstation bestellen.';}}
    return {ok:true,block:false,warn,text,geo};
  }
  const api={parseHeader,assess,ecefToGeo,distKm};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.SkyHubRinex=api;
})(typeof self!=='undefined'?self:this);
