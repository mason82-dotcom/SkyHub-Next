'use strict';
// Diagnostics relay of the Pilot 2 page: off by default, redaction, caps, rate limit, page never sends bridge arguments.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createPilotDiagnostics,parseBatch,redact}=require('../pilot-diagnostics');

function fakeRes(){const r={code:200,body:null,status(c){r.code=c;return r;},json(b){r.body=b;return r;}};return r;}

test('off by default: 404 and nothing logged',async()=>{
  const lines=[];const d=createPilotDiagnostics({log:l=>lines.push(l)});
  const res=fakeRes();await d.receive({ip:'1.2.3.4',body:{entries:[{msg:'x'}]}},res,{paired:true});
  assert.equal(res.code,404);assert.equal(lines.length,0);assert.equal(d.enabled,false);
});

test('redaction: tokens, passwords, keys, long hex and query strings never reach the log',()=>{
  assert.equal(redact('password=hunter2 ok'),'password=<…> ok');
  assert.match(redact('Bearer abcdefghijklmnop'),/bearer=<…>|Bearer=<…>/i);
  assert.equal(redact('id '+'a'.repeat(64)),'id <hex>');
  assert.equal(redact('k '+'Ab9_'.repeat(10)),'k <geheim?>');
  assert.equal(redact('GET https://x.example/a?X-Amz-Signature=abc'),'GET https://x.example/a?<…>');
  assert.equal(redact('a\nb\u0000c'),'a b c');
  assert.equal(redact('x'.repeat(500)).length<=300,true);
});

test('batch parsing: caps entries, unknown level/kind normalised, empty messages dropped',()=>{
  assert.equal(parseBatch({entries:new Array(41).fill({msg:'x'})}),null);
  assert.equal(parseBatch({}),null);
  const b=parseBatch({page:'pilot-login',entries:[{level:'fatal',kind:'weird',msg:'hi',t:1793800000000},{msg:''},{msg:42}]});
  assert.deepEqual(b.entries,[{t:1793800000000,level:'info',kind:'step',msg:'hi'}]);
});

test('enabled: one log line per entry with pairing state; rate limit per client and a shared bucket for unpaired',async()=>{
  const lines=[];let t=1793800000000;
  const d=createPilotDiagnostics({enabled:true,log:l=>lines.push(l),now:()=>t});
  let res=fakeRes();
  await d.receive({ip:'192.168.178.39',body:{entries:[{level:'warn',kind:'bridge',msg:'platformLoadComponent(mission) → Code 310001'}]}},res,{paired:true});
  assert.equal(res.code,200);
  assert.match(lines[0],/^\[pilot diag\] .* gekoppelt 192\.168\.178\.39 warn bridge: platformLoadComponent\(mission\) → Code 310001$/);
  for(let i=0;i<29;i++)await d.receive({ip:'192.168.178.39',body:{entries:[{msg:'x'}]}},fakeRes(),{paired:true});
  res=fakeRes();await d.receive({ip:'192.168.178.39',body:{entries:[{msg:'x'}]}},res,{paired:true});
  assert.equal(res.code,429);
  res=fakeRes();await d.receive({ip:'10.0.0.9',body:{entries:[{msg:'y'}]}},res,{paired:false});
  assert.equal(res.code,200);assert.match(lines.at(-1),/NICHT gekoppelt/);
  t+=61000;res=fakeRes();await d.receive({ip:'192.168.178.39',body:{entries:[{msg:'z'}]}},res,{paired:true});
  assert.equal(res.code,200,'window resets');
});

test('pilot-login.js reports method names and codes only, never bridge arguments, callback payloads or the pairing code',()=>{
  const src=fs.readFileSync(path.resolve(__dirname,'../../frontend/public/pilot-login.js'),'utf8');
  const calls=[...src.matchAll(/diag\(([^;]*)\);/g)].map(m=>m[1]);
  assert.ok(calls.length>=8);
  for(const c of calls){
    assert.doesNotMatch(c,/args\.join|JSON\.stringify\(args|_callbackResult|config\.|password|license|appKey|token(?!\s*\?)/i,c);
  }
  assert.match(src,/pi-pilot-pair\/\.test\(text\)\?'Kopplungscode angezeigt/);
  assert.match(src,/setDiagnostics\(data\.diagnostics===true\)/,'only when the server switch is on');
});
