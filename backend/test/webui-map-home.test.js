'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..','..','frontend','public');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');

test('every map starts at the shared home view (76694 Forst)',()=>{
  const home=require(path.join(root,'skyhub-map-home.js'));
  assert.deepEqual({lat:home.lat,lon:home.lon,zoom:home.zoom},{lat:49.153,lon:8.585,zoom:13});
  assert.match(home.label,/76694 Forst/);
  const maps=[['index.html','index.html'],['drc.html','drc.js'],['missionsfreigabe.html','missionsfreigabe.js'],
    ['abdeckung.html','abdeckung.js'],['kartenelemente.html','kartenelemente.js'],
    ['wpml-editor.html','wpml-editor.js'],['wpml-survey-preview.html','wpml-survey-preview.js']];
  for(const [page,script] of maps){
    const html=read(page),src=read(script);
    const homeTag=html.indexOf('<script src="/skyhub-map-home.js"></script>');
    assert.ok(homeTag>0,page+' loads skyhub-map-home.js');
    if(script!==page)assert.ok(homeTag<html.indexOf('<script src="/'+script+'"></script>'),page+': home before page script');
    assert.match(src,/setView\(\[HOME\.lat,HOME\.lon\],HOME\.zoom\)/,script);
  }
  // No page keeps its own hard-coded start view.
  for(const f of fs.readdirSync(root).filter(f=>/\.(js|html)$/.test(f)))
    assert.doesNotMatch(read(f),/L\.map\([^)]*\)(\.setView\(\[\s*-?\d)/,f);
});
