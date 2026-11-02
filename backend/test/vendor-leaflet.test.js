'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');

// Leaflet is self-hosted: no CDN at runtime, and every reference stays pinned by SRI.
const PUBLIC=path.resolve(__dirname,'../../frontend/public');
const VENDOR=path.join(PUBLIC,'vendor/leaflet/1.9.4');
const sri=file=>'sha256-'+crypto.createHash('sha256').update(fs.readFileSync(file)).digest('base64');

test('frontend loads no third-party CDN scripts or styles',()=>{
  for(const name of fs.readdirSync(PUBLIC).filter(n=>/\.(html|js|css)$/.test(n))){
    const text=fs.readFileSync(path.join(PUBLIC,name),'utf8');
    assert.doesNotMatch(text,/unpkg\.com|cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com/,name);
  }
});

test('every self-hosted Leaflet reference carries the matching SRI hash',()=>{
  let references=0;
  for(const name of fs.readdirSync(PUBLIC).filter(n=>n.endsWith('.html'))){
    const html=fs.readFileSync(path.join(PUBLIC,name),'utf8');
    for(const tag of html.match(/<(?:script|link)\b[^>]*\/vendor\/leaflet\/[^>]*>/g)||[]){
      const url=/(?:src|href)="\/vendor\/leaflet\/1\.9\.4\/([a-z.]+)"/.exec(tag);
      assert.ok(url,name+': unexpected Leaflet path '+tag);
      const integrity=/integrity="([^"]+)"/.exec(tag);
      assert.ok(integrity,name+': Leaflet without SRI');
      assert.equal(integrity[1],sri(path.join(VENDOR,url[1])),name+' '+url[1]);
      references++;
    }
  }
  assert.ok(references>=6,'dashboard, WPML editor and survey preview load Leaflet');
});

test('vendored Leaflet ships its licence and the default marker/layer images',()=>{
  assert.match(fs.readFileSync(path.join(VENDOR,'LICENSE'),'utf8'),/Volodymyr Agafonkin/);
  for(const image of ['layers.png','layers-2x.png','marker-icon.png','marker-icon-2x.png','marker-shadow.png'])
    assert.ok(fs.statSync(path.join(VENDOR,'images',image)).size>0,image);
});
