/* SKY//PULSE enhancement layer: presentation-only, no network or token access. */
(function(){
'use strict';
const ROUTES=Object.freeze([
 {path:'/',label:'Operations',detail:'Live-Dashboard'},
 {path:'/smart-farming.html',label:'Smart Farming',detail:'Experimentell'},
 {path:'/wpml-editor.html',label:'Mission Studio',detail:'Offline-Entwurf'},
 {path:'/wpml-route-library.html',label:'Routenbibliothek',detail:'Lokal'},
 {path:'/wpml-survey-preview.html',label:'Survey 2D',detail:'Geometrie'}
]);
function init(doc,win){
 if(!doc||!win||!doc.body||!doc.body.classList.contains('skyhub-gfx'))return null;
 const motionButton=doc.getElementById('gfxMotionToggle');
 if(motionButton)motionButton.hidden=false;
 const reduced=win.matchMedia?win.matchMedia('(prefers-reduced-motion: reduce)'):{matches:false};
 const forced=win.matchMedia?win.matchMedia('(forced-colors: active)'):{matches:false};
 let requestedMotion=true;
 function renderMotion(){
   const blocked=reduced.matches||forced.matches;
   const enabled=!blocked&&requestedMotion;
   doc.body.dataset.gfxMotion=enabled?'on':'off';
   if(!motionButton)return;
   motionButton.disabled=blocked;
   motionButton.setAttribute('aria-pressed',String(enabled));
   motionButton.setAttribute('aria-label',blocked?'Animationen durch Systemeinstellung reduziert':enabled?'Visuelle Animationen ausschalten':'Visuelle Animationen einschalten');
   motionButton.textContent=blocked?'GFX · REDUZIERT':enabled?'GFX · AN':'GFX · AUS';
 }
 if(motionButton)motionButton.addEventListener('click',()=>{requestedMotion=!requestedMotion;renderMotion();});
 for(const media of [reduced,forced]){
   if(typeof media.addEventListener==='function')media.addEventListener('change',renderMotion);
   else if(typeof media.addListener==='function')media.addListener(renderMotion);
 }
 renderMotion();
 const header=doc.querySelector('header');
 if(header&&!doc.querySelector('.gfx-module-rail')){
   const nav=doc.createElement('nav');
   nav.className='gfx-module-rail';
   nav.setAttribute('aria-label','SkyHub Modulnavigation');
   const brand=doc.createElement('div');
   brand.className='gfx-rail-signature';
   brand.textContent='SKY//PULSE';
   nav.appendChild(brand);
   const links=doc.createElement('div');
   links.className='gfx-rail-links';
   const pathname=win.location&&win.location.pathname==='/index.html'?'/':(win.location&&win.location.pathname)||'/';
   for(const route of ROUTES){
     const link=doc.createElement('a');
     link.className='gfx-rail-link';
     link.setAttribute('href',route.path);
     if(route.path===pathname)link.setAttribute('aria-current','page');
     const title=doc.createElement('strong');
     title.textContent=route.label;
     const hint=doc.createElement('small');
     hint.textContent=route.detail;
     link.appendChild(title);
     link.appendChild(hint);
     links.appendChild(link);
   }
   nav.appendChild(links);
   header.insertAdjacentElement('afterend',nav);
   // Keep header fallback in HTML, but avoid duplicate links when enhanced.
   const legacyNav=typeof header.querySelector==='function'?header.querySelector('nav'):null;
   if(legacyNav&&typeof legacyNav.remove==='function')legacyNav.remove();
   doc.body.classList.add('gfx-has-module-rail');
 }
 const focus=doc.getElementById('gfxMapFocus');
 if(focus){
   focus.hidden=false;
   focus.addEventListener('click',()=>{
     const on=doc.body.classList.toggle('gfx-map-focus');
     focus.setAttribute('aria-pressed',String(on));
     focus.textContent=on?'Standardlayout':'Karte priorisieren';
     // Leaflet uses the browser resize event to recalculate map dimensions.
     if(typeof win.requestAnimationFrame==='function'&&typeof win.dispatchEvent==='function'){
       win.requestAnimationFrame(()=>win.dispatchEvent(new win.Event('resize')));
     }
   });
 }
 const search=doc.getElementById('deviceSearch');
 const panel=doc.getElementById('operationsPanel');
 if(search&&typeof doc.addEventListener==='function')doc.addEventListener('keydown',event=>{
   if(event.key!=='/'||event.defaultPrevented||event.ctrlKey||event.altKey||event.metaKey||event.shiftKey)return;
   const target=event.target||doc.activeElement;
   if(target&&(target.isContentEditable||/^(INPUT|SELECT|TEXTAREA)$/i.test(target.tagName||'')))return;
   if(search.disabled||search.hidden||(panel&&panel.hidden))return;
   event.preventDefault();
   search.focus();
 });
 return {renderMotion};
}
if(typeof module==='object'&&module.exports)module.exports={init,ROUTES};
if(typeof window!=='undefined'&&typeof document!=='undefined')init(document,window);
})();