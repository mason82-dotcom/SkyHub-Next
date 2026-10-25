#!/usr/bin/env node
'use strict';
// Optional read-only directory scan; never prints input paths or filenames.
// No recursive scan, no symlinks, no file contents, no object storage.
const fs=require('node:fs');
const path=require('node:path');
const {inventoryMediaNames,MAX_ENTRIES}=require('../backend/m3m-media-inventory');
function run(argv){
  if(argv.length===1&&argv[0]==='--help'){
    console.log('Usage: node scripts/pi-m3m-media-inventory.js --directory /absolute/path/to/M3M/files');
    console.log('Read-only and nonrecursive. Outputs counts only, not filenames, dates or paths.');
    return;
  }
  if(argv.length!==2||argv[0]!=='--directory'||!path.isAbsolute(argv[1]))
    throw new Error('Specify exactly --directory and an absolute directory path');
  const directory=argv[1];
  const st=fs.lstatSync(directory);
  if(st.isSymbolicLink()||!st.isDirectory())
    throw new Error('Input is not a regular directory');
  // Fail closed on excessive entries. No file contents or symlinks opened.
  const entries=fs.readdirSync(directory,{withFileTypes:true});
  if(entries.length>MAX_ENTRIES)throw new Error('Directory exceeds safe inventory limit');
  const files=entries.filter(e=>e.isFile()).map(e=>e.name);
  const report=inventoryMediaNames(files);
  console.log(JSON.stringify({...report,ignoredNonregularEntries:entries.length-files.length},null,2));
}
try{run(process.argv.slice(2));}
catch(_){console.error('M3M inventory unavailable: check argument, directory permissions or file count. No files were modified.');process.exitCode=2;}
