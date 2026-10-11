import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {coldFamilies,metricHasDecidableFailure} from './performance-evidence.mjs';
const runner=readFileSync(new URL('./run-performance-recovery.sh',import.meta.url),'utf8');
const actual=runner.slice(runner.indexOf('sample_startup_probe() {'),runner.indexOf('\nNATIVE_PROBE_COUNTER='));
const dir=mkdtempSync(resolve(tmpdir(),'listen2-cold-ledger-'));
try {
 const adb=resolve(dir,'adb');
 writeFileSync(adb,`#!/bin/bash
if [[ "$*" == *'am start -W'* ]]; then
 printf 'Status: ok\\n'
 [[ "$SCENARIO" == missing-cold ]] || printf 'LaunchState: COLD\\n'
 [[ "$SCENARIO" == missing-time ]] || { if [[ "$SCENARIO" == over-budget ]]; then printf 'TotalTime: 3100\\nWaitTime: 3200\\n'; else printf 'TotalTime: 2900\\nWaitTime: 3000\\n'; fi; }
fi
`,{mode:0o700});
 const fixture=resolve(dir,'fixture.sh');writeFileSync(fixture,`#!/bin/bash
set -euo pipefail
RUN_DIR="$1";mkdir -p "$RUN_DIR/performance"
ADB="$2";SCENARIO="$3";export SCENARIO
DEVICE_API=35;SERIAL=emulator-5554;PACKAGE=com.dazzlingwuming.listen2
now_ms(){ echo 9000; }
device_elapsed_millis(){ echo 1000; }
wait_for_pid_absence(){ [[ "$SCENARIO" != pidfalse ]]; }
wait_for_phone_shell(){ return 1; }
${actual}
sample_startup_probe 01
`);
 for(const scenario of ['ui-failure','over-budget','missing-cold','missing-time','pidfalse']) {
  const row=execFileSync('/bin/bash',[fixture,dir,adb,scenario],{encoding:'utf8'}).trim();const fields=row.split('|');
  const ledger=Array.from({length:20},(_,i)=>[String(i+1).padStart(2,'0'),...fields.slice(1)].join('|')).join('\n');
  const [ttid,ttfd]=coldFamilies(ledger);
  assert.equal(ttfd.status,'NOT_VERIFIED');assert.equal(ttfd.reasonCode,'HOST_UI_DUMP_OBSERVER_OVERHEAD');assert.equal(metricHasDecidableFailure(ttfd),false);
  if(scenario==='ui-failure'){assert.equal(ttid.status,'PASS');assert.equal(ttid.p95,2900);assert.equal(fields[7],'COLD');assert.equal(fields[8],'phone-shell-not-ready');assert.equal(ttfd.samples.every(s=>s.status==='FAIL'),true);}
  else if(scenario==='over-budget'){assert.equal(ttid.status,'FAIL');assert.equal(metricHasDecidableFailure(ttid),true);}
  else {assert.equal(ttid.status,'NOT_VERIFIED');assert.equal(metricHasDecidableFailure(ttid),false);}
 }
} finally {rmSync(dir,{recursive:true,force:true});}
console.log('Actual cold runner keeps verified AM timing through UI failure; missing cold/PID/timing stays NV, true AM budget failures remain FAIL.');
