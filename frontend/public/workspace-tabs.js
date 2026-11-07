'use strict';

/**
 * Accessible, client-only main navigation. No token persistence, network I/O,
 * DJI commands or TAK export endpoints are implemented here.
 */
(function(root,factory){
  const api=factory();
  if(typeof module==='object' && module.exports)module.exports=api;
  if(root)root.SkyHubWorkspaceTabs=api;
})(typeof window!=='undefined'?window:null,function(){
  const names=['operations','tak'];
  function init({document:doc,onOperationsShown=()=>{}}={}){
    if(!doc||typeof doc.getElementById!=='function')throw new TypeError('document required');
    const tabs={
      operations:doc.getElementById('tabOperations'),
      tak:doc.getElementById('tabTak')
    };
    const panels={
      operations:doc.getElementById('operationsPanel'),
      tak:doc.getElementById('takPanel')
    };
    if(names.some(name=>!tabs[name]||!panels[name]))throw new Error('SkyHub tab markup missing');
    let active=null;
    function activate(name,{focus=false}={}){
      if(!names.includes(name))return false;
      const previous=active;
      active=name;
      for(const current of names){
        const selected=current===name;
        tabs[current].setAttribute('aria-selected',String(selected));
        tabs[current].tabIndex=selected?0:-1;
        panels[current].hidden=!selected;
      }
      if(focus)tabs[name].focus();
      if(name==='operations'&&previous!==name)onOperationsShown();
      return true;
    }
    for(const name of names){
      tabs[name].addEventListener('click',()=>activate(name));
      tabs[name].addEventListener('keydown',event=>{
        const index=names.indexOf(name);
        const next=event.key==='ArrowRight'?names[(index+1)%names.length]:
          event.key==='ArrowLeft'?names[(index+names.length-1)%names.length]:
          event.key==='Home'?names[0]:event.key==='End'?names[names.length-1]:null;
        if(!next)return;
        event.preventDefault();
        activate(next,{focus:true});
      });
    }
    activate('operations');
    return {activate,get active(){return active;}};
  }
  return {init};
});
