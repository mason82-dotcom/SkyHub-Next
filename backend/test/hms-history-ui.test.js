'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {createHmsHistoryHandler}=require('../hms-history');
const panel=require(path.resolve(__dirname,'../../frontend/public/hms-history-panel.js'));

const NOW=Date.parse('2026-11-02T12:00:00Z');
const row=(over={})=>({id:1,deviceSn:'SYNTH-AC-01',code:'0x16100083',level:2,componentIndex:0,sensorIndex:0,
  action:'appeared',sourceAt:'2026-11-02T11:58:00.000Z',timeVerified:true,...over});

test('history rows format into plain German display strings',()=>{
  const item=panel.formatItem({...row(),modelName:'Mavic 3M',text:{de:'Kompass gestört',en:'Compass error'}},NOW);
  assert.deepEqual(item,{action:'appeared',level:'2',badge:'Neu',title:'Warnung: Kompass gestört',
    meta:'Mavic 3M · SYNTH-AC-01 · 0x16100083',time:'vor 2 min',at:Date.parse('2026-11-02T11:58:00Z')});
  assert.equal(panel.formatItem(row({action:'resolved',level:0,text:null}),NOW).title,'Hinweis: Unbekannter HMS-Code');
  assert.equal(panel.formatItem(row({action:'updated',timeVerified:false}),NOW).time,'vor 2 min · Zeit ungeprüft');
  assert.equal(panel.formatItem(row({sourceAt:'nonsense'}),NOW).time,'Zeit unbekannt');
});

test('malformed or hostile rows are dropped instead of rendered',()=>{
  for(const bad of [null,'x',row({code:'<img src=x>'}),row({action:'deleted'}),row({code:'0x1234'})])
    assert.equal(panel.formatItem(bad,NOW),null);
  // Text is only ever assigned via textContent; markup stays literal text.
  assert.match(panel.formatItem(row({text:{de:'<b>x</b>'}}),NOW).title,/<b>x<\/b>/);
});

function call(handler,query){
  return new Promise(resolve=>{
    const res={code:200,status(c){this.code=c;return this;},json(body){resolve({status:this.code,body});}};
    handler({query},res);
  });
}

test('handler reports a disabled history explicitly',async()=>{
  const r=await call(createHmsHistoryHandler({history:null,registry:{get:()=>null}}),{});
  assert.deepEqual(r,{status:503,body:{error:'HMS history disabled',enabled:false}});
});

test('handler adds catalogue text and model name at read time, with pagination hint',async()=>{
  const seen=[];
  const history={async list(device,limit,offset){seen.push([device,limit,offset]);
    return Array.from({length:limit},(_,i)=>row({id:i+1}));}};
  const registry={get:sn=>sn==='SYNTH-AC-01'?{modelName:'Mavic 3M',model:{domain:'0'}}:null};
  const describe=(alert,{domain})=>({de:'Text '+alert.code+' d'+domain,en:'x'});
  const r=await call(createHmsHistoryHandler({history,registry,describe}),{device:'SYNTH-AC-01',limit:'2',offset:'4'});
  assert.equal(r.status,200);
  assert.deepEqual(seen,[['SYNTH-AC-01',2,4]]);
  assert.equal(r.body.enabled,true);
  assert.equal(r.body.hasMore,true);
  assert.equal(r.body.items[0].modelName,'Mavic 3M');
  assert.deepEqual(r.body.items[0].text,{de:'Text 0x16100083 d0',en:'x'});
  const all=await call(createHmsHistoryHandler({history,registry,describe}),{device:''});
  assert.deepEqual(seen[1],[null,50,0]);
  assert.equal(all.body.items.length,50);
});

test('handler maps invalid queries to 400 and store failures to 503 without details',async()=>{
  const invalid=await call(createHmsHistoryHandler({history:{list:async()=>{throw new TypeError('Invalid HMS pagination');}},
    registry:{get:()=>null}}),{limit:'999'});
  assert.deepEqual(invalid,{status:400,body:{error:'Invalid query'}});
  const down=await call(createHmsHistoryHandler({history:{list:async()=>{throw new Error('ECONNREFUSED 10.0.0.1');}},
    registry:{get:()=>null}}),{});
  assert.deepEqual(down,{status:503,body:{error:'HMS history unavailable'}});
});

test('real catalogue resolves German text for a known aircraft code',async()=>{
  const history={list:async()=>[row({code:'0x11000002'})]};
  const r=await call(createHmsHistoryHandler({history,registry:{get:()=>({modelName:'M',model:{domain:'0'}})}}),{});
  assert.match(r.body.items[0].text.de,/^Stromverteilungsplatine 1 des Fluggeräts überhitzt/);
});
