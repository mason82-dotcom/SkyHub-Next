'use strict';
// Start view of every SkyHub map (single source): 76694 Forst (Baden). Loaded synchronously before the page
// scripts. Maps still follow content after loading (a live aircraft fix, a selected element, a placed waypoint).
(function(root){
  const home=Object.freeze({lat:49.153,lon:8.585,zoom:13,label:'76694 Forst (Baden)'});
  if(typeof module!=='undefined'&&module.exports)module.exports=home;
  else root.SkyHubMapHome=home;
})(typeof globalThis==='object'?globalThis:this);
