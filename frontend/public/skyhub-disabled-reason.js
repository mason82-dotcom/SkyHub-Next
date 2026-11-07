'use strict';
// Why is this action disabled? A <button data-disabled-reason="…"> gets a visible note (aria-describedby) that shows
// the reason while the button is disabled and disappears when it is enabled. Page scripts keep the reason current
// (dataset.disabledReason); this file only renders it. Optional data-disabled-reason-after="<id>" places the note
// after another element (e.g. after a button row). Text only: no network, no storage, no HTML from data.
(function(){
  function attach(btn){
    const doc=btn.ownerDocument;
    if(btn.dataset.disabledReasonReady)return;
    btn.dataset.disabledReasonReady='1';
    const note=doc.createElement('span');
    note.className='skyhub-disabled-reason';
    note.id=(btn.id||'action')+'-disabled-reason';
    const anchor=btn.dataset.disabledReasonAfter&&doc.getElementById(btn.dataset.disabledReasonAfter)||btn;
    anchor.insertAdjacentElement('afterend',note);
    const ids=(btn.getAttribute('aria-describedby')||'').split(/\s+/).filter(Boolean);
    if(!ids.includes(note.id))btn.setAttribute('aria-describedby',ids.concat(note.id).join(' '));
    const update=()=>{
      const reason=btn.disabled?String(btn.dataset.disabledReason||'').trim():'';
      if(note.textContent!==reason)note.textContent=reason;
      note.hidden=!reason;
    };
    new MutationObserver(update).observe(btn,{attributes:true,attributeFilter:['disabled','data-disabled-reason']});
    update();
  }
  function init(doc){for(const btn of doc.querySelectorAll('button[data-disabled-reason]'))attach(btn);}
  if(typeof module!=='undefined'&&module.exports)module.exports={init,attach};
  else if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>init(document));
  else init(document);
})();
