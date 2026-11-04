'use strict';
// Elevation profile along a route (SVG, no library): ground from the elevation model, planned flight height,
// the 120 m-above-ground limit as a dashed line. Used by the WPML editor and the mission release page.
// Input: terrain result {status:'ok', profile:[{d, ground, flight, agl, wp?}], maxAgl, minAgl, dataset, assumedTakeoff}.
(function(global){
  const NS='http://www.w3.org/2000/svg';
  const el=(name,attrs={},text)=>{const n=document.createElementNS(NS,name);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,String(v));if(text!==undefined)n.textContent=text;return n;};
  const fmt=v=>Math.round(v).toLocaleString('de-DE');

  function niceStep(span,target){
    const raw=span/target,p=10**Math.floor(Math.log10(raw)),f=raw/p;
    return (f<1.5?1:f<3.5?2:f<7.5?5:10)*p;
  }

  function render(container,result,{maxHeightM=120,minAglM=15,height=220}={}){
    container.replaceChildren();
    container.classList.add('elev-profile');
    if(!result||result.status!=='ok'||!Array.isArray(result.profile)||result.profile.length<2){
      const p=document.createElement('p');p.className='muted';
      p.textContent=!result?'Kein Höhenprofil.':result.status==='skipped'?
        (result.reason==='terrain-follow'?'Geländefolgeflug: Höhe über Grund wird von der Drohne gehalten, kein Profil nötig.':'Höhen in WGS84: kein Profil (Geoid unbekannt).'):
        'Höhenprofil nicht verfügbar'+(result.reason?' ('+result.reason+')':'')+'.';
      container.append(p);return;
    }
    const pts=result.profile.filter(p=>Number.isFinite(p.d));
    const ys=[];for(const p of pts){if(p.ground!==null)ys.push(p.ground,p.ground+maxHeightM);if(p.flight!==null)ys.push(p.flight);}
    let yMin=Math.min(...ys),yMax=Math.max(...ys);
    const pad=Math.max(5,(yMax-yMin)*0.08);yMin-=pad;yMax+=pad;
    const dMax=Math.max(1,pts[pts.length-1].d);
    const W=Math.max(280,Math.round(container.clientWidth||720)),H=height,L=44,R=10,T=10,B=26;
    const x=d=>L+(d/dMax)*(W-L-R),y=v=>T+(1-(v-yMin)/(yMax-yMin))*(H-T-B);
    const svg=el('svg',{viewBox:'0 0 '+W+' '+H,role:'img',class:'elev-svg',width:W,height:H});
    const title=el('title',{},'Höhenprofil entlang der Route');svg.append(title);
    // grid + axes
    const yStep=niceStep(yMax-yMin,4),xStep=niceStep(dMax,Math.max(2,Math.floor((W-L-R)/90)));
    for(let v=Math.ceil(yMin/yStep)*yStep;v<=yMax;v+=yStep){
      svg.append(el('line',{x1:L,x2:W-R,y1:y(v),y2:y(v),class:'grid'}),el('text',{x:L-6,y:y(v)+4,'text-anchor':'end',class:'tick'},fmt(v)));
    }
    for(let d=0;d<=dMax+1e-6;d+=xStep){
      svg.append(el('text',{x:x(d),y:H-10,'text-anchor':'middle',class:'tick'},d>=1000?(d/1000).toLocaleString('de-DE',{maximumFractionDigits:1})+' km':fmt(d)+' m'));
    }
    // ground area
    const g=pts.filter(p=>p.ground!==null);
    if(g.length>1){
      const line=g.map((p,i)=>(i?'L':'M')+x(p.d).toFixed(1)+','+y(p.ground).toFixed(1)).join('');
      svg.append(el('path',{d:line+'L'+x(g[g.length-1].d).toFixed(1)+','+(H-B)+'L'+x(g[0].d).toFixed(1)+','+(H-B)+'Z',class:'ground'}));
      svg.append(el('path',{d:g.map((p,i)=>(i?'L':'M')+x(p.d).toFixed(1)+','+y(p.ground+maxHeightM).toFixed(1)).join(''),class:'limit'}));
    }
    // flight line, low segments highlighted
    const f=pts.filter(p=>p.flight!==null);
    if(f.length>1)svg.append(el('path',{d:f.map((p,i)=>(i?'L':'M')+x(p.d).toFixed(1)+','+y(p.flight).toFixed(1)).join(''),class:'flight'}));
    for(const p of f){
      if(p.agl!==null&&(p.agl>maxHeightM||p.agl<minAglM))svg.append(el('circle',{cx:x(p.d),cy:y(p.flight),r:3.5,class:p.agl>maxHeightM?'over':'low'}));
      if(p.wp)svg.append(el('circle',{cx:x(p.d),cy:y(p.flight),r:2.2,class:'wp'}));
    }
    container.append(svg);
    // legend + text summary (also for screen readers)
    const legend=document.createElement('p');legend.className='elev-legend';
    legend.innerHTML='Höhen in m ü. NN: <span class="k flight"></span>Flughöhe <span class="k ground"></span>Gelände ('+String(result.dataset||'DGM').replace(/[<>&]/g,'')+') <span class="k limit"></span>'+maxHeightM+' m über Grund';
    const sum=document.createElement('p');sum.className='elev-sum';
    sum.textContent='Strecke '+(dMax/1000).toLocaleString('de-DE',{maximumFractionDigits:2})+' km · Höhe über Grund '+
      result.minAgl.aglM+'–'+result.maxAgl.aglM+' m (höchste bei Wegpunkt '+result.maxAgl.waypoint+', niedrigste bei Wegpunkt '+result.minAgl.waypoint+')'+
      ' · Gelände '+result.groundMinM+'–'+result.groundMaxM+' m'+
      (result.assumedTakeoff?' · Startpunkt am ersten Wegpunkt angenommen':'')+
      '. Das Geländemodell enthält Gebäude, Bäume und Masten nicht zuverlässig.';
    title.textContent='Höhenprofil: '+sum.textContent;
    container.append(legend,sum);
  }
  global.SkyHubElevationProfile={render};
})(typeof window!=='undefined'?window:globalThis);
