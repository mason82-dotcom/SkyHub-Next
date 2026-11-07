'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..','..','frontend','public');
const helper=require(path.join(root,'skyhub-disabled-reason.js'));

// Minimal DOM stand-ins: enough for attach() (insertAdjacentElement, attributes, dataset, MutationObserver).
function fakeDom(){
  const observers=[];
  global.MutationObserver=class{constructor(cb){this.cb=cb;}observe(target){observers.push({target,cb:this.cb});}};
  const byId=new Map(),inserted=[];
  const doc={
    createElement:()=>({hidden:false,textContent:'',className:'',id:''}),
    getElementById:id=>byId.get(id)||null,
    querySelectorAll:()=>[]
  };
  const element=(id,extra={})=>{
    const attrs=new Map();
    const el={id,ownerDocument:doc,dataset:{},disabled:false,...extra,
      getAttribute:n=>attrs.has(n)?attrs.get(n):null,setAttribute:(n,v)=>attrs.set(n,String(v)),
      insertAdjacentElement:(pos,node)=>inserted.push({after:id,node})};
    byId.set(id,el);return el;
  };
  const fire=target=>{for(const o of observers)if(o.target===target)o.cb();};
  return {doc,element,fire,inserted};
}

test('reason is shown only while the button is disabled and is linked via aria-describedby',()=>{
  const {element,fire,inserted}=fakeDom();
  const btn=element('run');btn.disabled=true;btn.dataset.disabledReason='Erst Flug wählen.';
  btn.setAttribute('aria-describedby','hint');
  helper.attach(btn);
  const note=inserted[0].node;
  assert.equal(inserted[0].after,'run');
  assert.equal(note.textContent,'Erst Flug wählen.');assert.equal(note.hidden,false);
  assert.equal(btn.getAttribute('aria-describedby'),'hint run-disabled-reason');
  btn.dataset.disabledReason='Auswertung läuft.';fire(btn);
  assert.equal(note.textContent,'Auswertung läuft.');
  btn.disabled=false;fire(btn);
  assert.equal(note.textContent,'');assert.equal(note.hidden,true);
  helper.attach(btn);
  assert.equal(inserted.length,1,'attaching twice adds no second note');
});

test('note can be placed after another element; an empty reason shows nothing',()=>{
  const {element,inserted}=fakeDom();
  element('cancel');
  const btn=element('run2');btn.disabled=true;btn.dataset.disabledReasonAfter='cancel';btn.dataset.disabledReason='';
  helper.attach(btn);
  assert.equal(inserted[0].after,'cancel');
  assert.equal(inserted[0].node.hidden,true);
});

test('pages with primary actions load the helper and keep their reasons in text form',()=>{
  for(const [page,ids] of [['ppk.html',['run']],['abdeckung.html',['run']],['wpml-editor.html',['export','store-save','profile-run']]]){
    const html=fs.readFileSync(path.join(root,page),'utf8');
    assert.match(html,/<script defer src="\/skyhub-disabled-reason\.js"><\/script>/,page);
    for(const id of ids)assert.match(html,new RegExp('id="'+id+'"[^>]*data-disabled-reason='),page+' #'+id);
  }
  const src=fs.readFileSync(path.join(root,'skyhub-disabled-reason.js'),'utf8');
  assert.doesNotMatch(src,/innerHTML|fetch\(|localStorage|sessionStorage/);
});
