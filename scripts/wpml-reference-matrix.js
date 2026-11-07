#!/usr/bin/env node
'use strict';
// Deterministic in-memory synthetic test matrix only; not a hardware or Go-SDK run.
const {runReferenceMatrix}=require('../backend/wpml-reference-matrix');
try{
  process.stdout.write(JSON.stringify(runReferenceMatrix(),null,2)+'\n');
}catch{
  process.stderr.write('WPML synthetic reference matrix failed\n');
  process.exitCode=2;
}
