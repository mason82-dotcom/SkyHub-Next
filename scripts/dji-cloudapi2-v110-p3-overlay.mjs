#!/usr/bin/env node
// Apply the reviewed local lab Vue overlay to the pinned DJI Cloud API 2 repo.
// No Docker, deployment, network, device, auth, or broker calls.
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync, mkdirSync, writeFileSync, copyFileSync, unlinkSync, readdirSync, rmSync } from 'node:fs'
import { resolve, dirname, join, relative } from 'node:path'
import { createHash } from 'node:crypto'

const PIN = '705c73f48a77bb5120b28d73436d73594d289359'
const ROOT = resolve(import.meta.dirname ?? dirname(new URL(import.meta.url).pathname), '..')
const OVERLAY = join(ROOT, 'integrations/dji-cloud-api2-v110-overlay/web')
const prefix = 'devkit/skeleton/web/'
const files = [
  'src/composables/useLabLocale.ts',
  'src/components/AppTopNav.vue',
  'src/components/AppTopNav.test.ts',
  'src/components/UserDropdown.vue',
  'src/components/dashboard/AssetPanel.vue',
  'src/components/dashboard/DockStatusSection.vue',
  'src/components/dashboard/DataResultSection.vue',
  'src/components/dashboard/TaskPanel.vue',
  'src/components/dashboard/StatGrid.vue',
  'src/components/dashboard/TimeRangeSelector.vue',
  'src/components/dashboard/TaskDistributionChart.vue',
  'src/components/dashboard/ExecutionResultChart.vue',
  'src/components/dashboard/FlightDataSection.vue',
  'src/views/DashboardView.vue',
]
const args = process.argv.slice(2)
const mode = args.includes('--apply') ? 'apply' : args.includes('--restore') ? 'restore' : 'check'
const argValue = key => { const i=args.indexOf(key);return i===-1 ? undefined : args[i+1] }
const vendor = resolve(argValue('--vendor') ?? join(process.env.HOME ?? '', 'Projekte/skyhub-next-brix-ops/vendor/dji-cloud-api2'))
const checksum = str => createHash('sha256').update(str).digest('hex')
const git = (...a) => execFileSync('git', ['-C',vendor,...a], {encoding:'utf8',stdio:['ignore','pipe','pipe']})
function abort(msg) { console.error('FAIL-CLOSED:',msg);process.exitCode=1 }
function sourceState(rel) {
  const target=join(vendor,prefix,rel)
  const original=rel==='src/composables/useLabLocale.ts'? null : git('show','HEAD:'+prefix+rel)
  const patch=readFileSync(join(OVERLAY,rel),'utf8')
  const actual=existsSync(target)?readFileSync(target,'utf8'):null
  if(actual===patch)return {rel,target,original,patch,state:'PATCHED'}
  if(actual===original)return {rel,target,original,patch,state:'READY'}
  return {rel,target,original,patch,state:'DRIFT'}
}
function writeAtomic(dst,data) {
  mkdirSync(dirname(dst),{recursive:true})
  const temp=dst+'.p3-stage-'+process.pid
  try {writeFileSync(temp,data,{mode:0o600});copyFileSync(temp,dst)} finally {if(existsSync(temp))unlinkSync(temp)}
}
function restore() {
  const dir=argValue('--backup')
  if(!dir)throw Error('Restore requires --backup <directory>')
  const manifest=JSON.parse(readFileSync(join(resolve(dir),'manifest.json'),'utf8'))
  if(manifest.vendor!==vendor||manifest.pin!==PIN)throw Error('Backup vendor/pin mismatch')
  for(const entry of manifest.files) {
    if(!files.includes(entry.rel))throw Error('Unknown path in manifest')
    const dest=join(vendor,prefix,entry.rel)
    const actual=existsSync(dest)?checksum(readFileSync(dest)):null
    if(actual!==entry.overlayHash)throw Error('Patched file modified since overlay: '+entry.rel)
  }
  for(const entry of manifest.files) {
    const dst=join(vendor,prefix,entry.rel)
    if(entry.wasMissing)unlinkSync(dst)
    else writeAtomic(dst,readFileSync(join(resolve(dir),entry.rel)))
  }
  console.log('PASS: Sources restored; no containers were changed')
}
try {
  if(git('rev-parse','HEAD').trim()!==PIN)throw Error('Expected upstream DJI V1.1.0 commit '+PIN)
  if(mode==='restore')restore()
  else {
    const states=files.map(sourceState)
    for(const v of states)console.log(v.state.padEnd(8),v.rel)
    const drift=states.filter(v=>v.state==='DRIFT')
    if(drift.length)throw Error('Vendor sources differ from pinned baseline or overlay; refusing overwrite')
    const patched=states.filter(v=>v.state==='PATCHED').length
    if(mode==='apply') {
      if(patched && patched!==states.length)throw Error('Mixed patched/baseline state; refusing partial apply')
      if(patched===states.length)console.log('PASS: Overlay already applied')
      else {
        const dir=join(dirname(vendor),'dji-p3-backups',new Date().toISOString().replaceAll(':','-'))
        mkdirSync(dir,{recursive:true,mode:0o700})
        const manifest={vendor,pin:PIN,files:[]}
        for(const {rel,original,patch} of states) {
          if(original!==null)writeAtomic(join(dir,rel),original)
          manifest.files.push({rel,wasMissing:original===null,overlayHash:checksum(patch)})
        }
        writeAtomic(join(dir,'manifest.json'),JSON.stringify(manifest,null,2)+'\n')
        for(const {rel,target,patch} of states)writeAtomic(target,patch)
        console.log('PASS: Overlay staged in local vendor working tree')
        console.log('Backup:',dir)
        console.log('Rollback: node scripts/dji-cloudapi2-v110-p3-overlay.mjs --restore --vendor '+vendor+' --backup '+dir)
        console.log('Next: cd '+join(vendor,prefix)+' && npm ci && npm run build')
      }
    } else console.log('PASS: Pinned DJI tree and all overlay targets validated; no files changed')
  }
} catch(e) {abort(e instanceof Error?e.message:String(e))}
