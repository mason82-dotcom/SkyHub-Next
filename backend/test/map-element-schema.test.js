'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const ddl=fs.readFileSync(path.resolve(__dirname,'../db/migrations/001_dji_map_elements.sql'),'utf8');
const server=fs.readFileSync(path.resolve(__dirname,'../server.js'),'utf8');
const envExample=fs.readFileSync(path.resolve(__dirname,'../../.env.example'),'utf8');

test('DJI map element storage draft is workspace-scoped and separate from annotations',()=>{
  assert.match(ddl,/PRIMARY KEY \(workspace_id, group_id\)/);
  assert.match(ddl,/PRIMARY KEY \(workspace_id, group_id, element_id\)/);
  assert.match(ddl,/FOREIGN KEY \(workspace_id, group_id\)/);
  assert.match(ddl,/geometry JSONB NOT NULL/);
  assert.match(ddl,/group_type IN \(0, 1, 2\)/);
  assert.match(ddl,/is_distributed BOOLEAN NOT NULL DEFAULT TRUE/);
  assert.match(ddl,/resource_type IN \(0, 1, 2\)/);
  assert.doesNotMatch(ddl,/ON DELETE\s+CASCADE/i);
  assert.doesNotMatch(ddl,/\bDROP\s+(TABLE|COLUMN)\b/i);
  assert.doesNotMatch(ddl,/map_annotations/);
});

test('DJI map element migration draft is not run at server startup',()=>{
  assert.match(ddl,/Draft only: not loaded by server startup/);
  assert.doesNotMatch(server,/001_dji_map_elements\.sql/);
});

test('DJI map-group endpoint stays disabled in the example configuration',()=>{
  assert.match(envExample,/^SKYHUB_DJI_MAP_ELEMENTS_ENABLED=false$/m);
  assert.match(fs.readFileSync(path.join(__dirname,'..','pilot-routes.js'),'utf8'),
    /SKYHUB_DJI_MAP_ELEMENTS_ENABLED==='true'&&pilot\.ready/);
});
