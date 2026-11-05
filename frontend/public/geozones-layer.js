'use strict';
// Geographic UAS zones of Germany (dipul, Deutsche Flugsicherung DFS) as a switchable overlay for Leaflet maps.
// Idea: fcsonline/droneroute airspace layers (MIT); for Germany the official source is dipul:
//   WMS https://uas-betrieb.de/geoservices/dipul/wms  (WMS 1.3.0, EPSG:3857, image/png)
//   Terms: CC BY-ND 4.0, https://dipul.de/homepage/de/informationen/geografische-gebiete/wfs-wms/ – shown unchanged with attribution.
// Off by default: when switched on, the browser asks DFS for map images of the visible area (no route data is sent).
// Display aid only: it is not an airspace check and not a flight authorisation; dipul.de stays the reference.
(function(root){
  const URL_WMS='https://uas-betrieb.de/geoservices/dipul/wms';
  const LAYERS=['flughaefen','flugplaetze','kontrollzonen','flugbeschraenkungsgebiete','temporaere_betriebseinschraenkungen',
    'modellflugplaetze','haengegleiter','militaerische_anlagen','behoerden','diplomatische_vertretungen','internationale_organisationen',
    'polizei','sicherheitsbehoerden','justizvollzugsanstalten','labore','krankenhaeuser','industrieanlagen','kraftwerke',
    'umspannwerke','stromleitungen','windkraftanlagen','bundesautobahnen','bundesstrassen','bahnanlagen','binnenwasserstrassen',
    'seewasserstrassen','schifffahrtsanlagen','naturschutzgebiete','nationalparks','vogelschutzgebiete','ffh-gebiete',
    'freibaeder','wohngrundstuecke'];
  const KEY='skyhub.geozones.on';
  function attach(map){
    if(!map||!root.L||typeof root.L.tileLayer?.wms!=='function')return null;
    const L=root.L;
    const layer=L.tileLayer.wms(URL_WMS,{layers:LAYERS.join(','),format:'image/png',transparent:true,version:'1.3.0',
      opacity:0.55,maxZoom:19,attribution:'Geozonen: <a href="https://dipul.de" target="_blank" rel="noopener noreferrer">dipul</a> © DFS, CC BY-ND 4.0'});
    const Control=L.Control.extend({options:{position:'topright'},onAdd(){
      const box=L.DomUtil.create('label','skyhub-geozones');
      box.style.cssText='background:#fff;padding:6px 9px;border-radius:8px;box-shadow:0 1px 4px rgba(0,0,0,.25);font:13px system-ui,sans-serif;display:flex;gap:6px;align-items:center;cursor:pointer';
      box.title='Geografische UAS-Gebiete der DFS (dipul) einblenden. Nur Anzeige – maßgeblich ist dipul.de.';
      const input=L.DomUtil.create('input','',box);input.type='checkbox';
      box.appendChild(document.createTextNode('Geozonen (dipul)'));
      L.DomEvent.disableClickPropagation(box);
      const set=on=>{if(on)layer.addTo(map);else map.removeLayer(layer);try{localStorage.setItem(KEY,on?'1':'0');}catch(_){}};
      input.addEventListener('change',()=>set(input.checked));
      let start=false;try{start=localStorage.getItem(KEY)==='1';}catch(_){}
      if(start){input.checked=true;set(true);}
      return box;
    }});
    map.addControl(new Control());
    return layer;
  }
  root.SkyHubGeozones=Object.freeze({attach,URL_WMS,LAYERS});
})(typeof globalThis==='object'?globalThis:this);
