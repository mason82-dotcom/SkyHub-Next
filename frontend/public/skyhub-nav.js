'use strict';
// Shared app bar (scripts/webui-shell.py writes the markup): progressive enhancement for the grouped menus.
// Without JavaScript the <details> groups still open and close; this only keeps one menu open at a time and
// closes it on Escape or a click outside. No network access, no storage.
(function(){
  function init(doc){
    const nav=doc.querySelector('.skyhub-appbar .skyhub-global-nav');
    if(!nav)return;
    const groups=[...nav.querySelectorAll('details.skyhub-nav-group')];
    for(const g of groups)g.addEventListener('toggle',()=>{if(g.open)for(const o of groups)if(o!==g)o.open=false;});
    doc.addEventListener('click',e=>{if(!nav.contains(e.target))for(const g of groups)g.open=false;});
    doc.addEventListener('keydown',e=>{
      if(e.key!=='Escape')return;
      const open=groups.find(g=>g.open);
      if(open){open.open=false;open.querySelector('summary').focus();}
    });
  }
  if(typeof module!=='undefined'&&module.exports)module.exports={init};
  else if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>init(document));
  else init(document);
})();
