'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const library=require('../../frontend/public/wpml-route-library-core');
const backup=require('../../frontend/public/wpml-route-library-backup');
const {parseJson}=require('../../frontend/public/wpml-waylines-reference');
function sample(name='GPS coordinate private 49.12345'){
  return {name,model:'matrice4t',speed:5,takeoffHeight:30,
    waypoints:[{lat:49.12345,lon:8.56789,height:50,photo:false},
      {lat:49.125,lon:8.56,height:50,photo:false}]};
}
function seeded(){
  const a=library.save(library.blank(),{name:'Private project route',
    folder:'Sensitive mapping',plan:sample(),savedAt:1234});
  return a.library;
}
test('explicit offline backup roundtrip includes exact revisions but emits redacted preview',()=>{
  const saved=seeded();
  const out=backup.exportBackup(saved);
  const parsed=backup.inspectBackup(out.content);
  assert.equal(backup.SCHEMA,'skyhub-local-waypoint-backup-v1');
  assert.deepEqual(parsed.library,saved);
  assert.equal(parsed.preview.routeCount,1);
  assert.equal(parsed.preview.revisionCount,1);
  assert.equal(parsed.preview.waypointOccurrences,2);
  assert.equal(parsed.preview.containsUnencryptedCoordinates,true);
  assert.equal(parsed.preview.verifiedPilot2Hardware,false);
  assert.equal(parsed.preview.flightReady,false);
  assert.equal(parsed.preview.dispatchAllowed,false);
  assert.doesNotMatch(JSON.stringify(parsed.preview),/49\.12345|8\.56789|Sensitive mapping|Private project route/);
  assert.match(out.content,/49\.12345/); // expected: file itself contains raw GPS
  assert.equal(parsed.library.routes[0].revisions[0].flightReady,false);
});
test('duplicate JSON fields cannot override mission identity or coordinates',()=>{
  const plain=backup.exportBackup(seeded()).content;
  const spoof=plain.replace('"schema":"skyhub-local-waypoint-backup-v1"',
    '"schema":"skyhub-local-waypoint-backup-v1","schema":"skyhub-local-waypoint-backup-v1"');
  assert.throws(()=>backup.inspectBackup(spoof),/Routensicherung/);
  const coord=plain.replace('"lat":49.12345','"lat":49.12345,"lat":13.7777');
  assert.throws(()=>backup.inspectBackup(coord),/Routensicherung/);
});
test('invalid schema, unknown privileges and file overlimits fail before import',()=>{
  const original=backup.exportBackup(seeded()).content;
  for(const invalid of [
    '{}','not json',
    original.replace('skyhub-local-waypoint-backup-v1','skyhub-other-backup-v1'),
    original.replace('"library":','"dispatchAllowed":true,"library":'),
    original.replace('"flightReady":false','"flightReady":true'),
    original.replace('"flightReady":false','"flightReady":false,"dispatchAllowed":true'),
    original.replace('"speed":5','"speed":5,"missionDispatchEnabled":true'),
    ' '.repeat(backup.MAX_SIZE+1)+original
  ])assert.throws(()=>backup.inspectBackup(invalid),/Routensicherung/);
  assert.throws(()=>library.load(JSON.stringify({...seeded(),dispatchAllowed:true})),
    /Routenbibliothek/);
  assert.throws(()=>backup.exportBackup({...seeded(),other:'private'}),
    /Routenbibliothek/);
});
test('strict parser preserves 128 KiB Waylines default and supports bounded backup size',()=>{
  assert.throws(()=>parseJson(' '.repeat(129*1024)+'{}'),/Waylines/);
  const long=' '.repeat(130*1024)+'{}';
  assert.deepEqual(parseJson(long,backup.MAX_SIZE),{});
  assert.throws(()=>parseJson('{}',backup.MAX_SIZE+1),/Waylines/);
});
test('source and browser are completely offline; HTML warns of plaintext location data',()=>{
  const root=path.resolve(__dirname,'../../frontend/public');
  const html=fs.readFileSync(path.join(root,'wpml-route-library.html'),'utf8');
  const script=fs.readFileSync(path.join(root,'wpml-route-library.js'),'utf8');
  const source=fs.readFileSync(path.join(root,'wpml-route-library-backup.js'),'utf8');
  for(const id of ['backup-export','backup-file','backup-preview',
    'backup-apply','backup-discard'])assert.ok(html.includes('id="'+id+'"'),id);
  for(const file of ['wpml-waylines-reference.js','wpml-route-library-backup.js'])
    assert.ok(html.includes('<script src="/'+file+'"></script>'));
  assert.match(html,/unverschlüsselt/);
  assert.doesNotMatch(script+source,/\bfetch\s*\(|XMLHttpRequest|WebSocket|mqtt\.publish|\/api\/mission\/create/);
  assert.match(script,/window\.confirm\('ACHTUNG: Die gesamte/);
});
