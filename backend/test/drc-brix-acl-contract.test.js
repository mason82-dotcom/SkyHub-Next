'use strict';
// Static contract only. NEVER execute brix-drc-setup.sh during CI:
// it creates live broker accounts, enables DRC and restarts a backend.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const script=fs.readFileSync(path.resolve(__dirname,'../../scripts/brix-drc-setup.sh'),'utf8');

test('BRIX DRC setup requires an explicit, validated RC serial before any write',()=>{
  assert.match(script,/GATEWAY="\$\{1:\?Seriennummer der RC Plus 2 angeben\}"/);
  assert.match(script,/\[\[ "\$GATEWAY" =~ \^\[A-Za-z0-9_-\]\{4,64\}\$ \]\]/);
  assert.match(script,/set -Eeuo pipefail/);
});

test('BRIX DRC setup generates only single-RC commander and link ACL entries',()=>{
  const match=script.match(/cat >> \$M\/acl <<ACL\n([\s\S]*?)\nACL/);
  assert.ok(match,'DRC ACL must be in an interpolated, auditable heredoc');
  const block=match[1];
  const lines=block.split('\n').filter(x=>x.startsWith('topic '));
  assert.equal(lines.length,10,'the ten established DRC rights are preserved');
  for(const line of lines){
    assert.match(line,/^topic (?:write|read) thing\/product\/\$\{GATEWAY\}\//);
    assert.doesNotMatch(line,/thing\/product\/\+\//,'wildcard gateway must not control another RC');
  }
  const acl=block.replaceAll('$'+'{GATEWAY}','SIMRCP2');
  const commander=acl.split('user skyhub_commander\n')[1].split('\n\nuser skyhub_drc_link')[0];
  const link=acl.split('user skyhub_drc_link\n')[1];
  assert.match(commander,/topic write thing\/product\/SIMRCP2\/services/);
  assert.match(commander,/topic read thing\/product\/SIMRCP2\/osd/);
  assert.doesNotMatch(commander,/topic read thing\/product\/SIMRCP2\/services\n/,'never expose drc_mode_enter password');
  assert.equal(link.trim(),'topic write thing/product/SIMRCP2/drc/up\ntopic read thing/product/SIMRCP2/drc/down');
});
