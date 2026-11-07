'use strict';
// Obstacle list of the WPML editor (name, position, radius, height above take-off), kept only in this browser.
// Separate from the editor on purpose: the editor itself never touches browser storage (no token can be persisted there).
(function(global){
  const KEY='skyhubObstacles';
  const valid=o=>o&&typeof o==='object'&&Number.isFinite(o.lat)&&Number.isFinite(o.lon)&&Number.isFinite(o.radiusM)&&Number.isFinite(o.heightM);
  function load(){
    try{const raw=JSON.parse(global.localStorage.getItem(KEY)||'[]');
      return Array.isArray(raw)?raw.filter(valid).slice(0,200).map(o=>({lat:o.lat,lon:o.lon,radiusM:o.radiusM,heightM:o.heightM,
        name:typeof o.name==='string'?o.name.slice(0,40):'Hindernis'})):[];}
    catch(_){return [];}
  }
  function save(list){try{global.localStorage.setItem(KEY,JSON.stringify((list||[]).filter(valid).slice(0,200)));}catch(_){}}
  global.SkyHubObstacleStore=Object.freeze({load,save});
})(typeof window!=='undefined'?window:globalThis);
