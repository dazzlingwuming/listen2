import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {coldFamilies,metricHasDecidableFailure} from './performance-evidence.mjs';

const runner=readFileSync(new URL('./run-performance-recovery.sh',import.meta.url),'utf8');
const helperStart=runner.indexOf('device_elapsed_millis() {');
const helperEnd=runner.indexOf('\nwait_for_phone_shell() {',helperStart);
const sampleStart=runner.indexOf('sample_startup_probe() {');
const sampleEnd=runner.indexOf('\nNATIVE_PROBE_COUNTER=',sampleStart);
assert.notEqual(helperStart,-1);
assert.notEqual(helperEnd,-1);
assert.notEqual(sampleStart,-1);
assert.notEqual(sampleEnd,-1);
const actualHelper=runner.slice(helperStart,helperEnd);
const actualSample=runner.slice(sampleStart,sampleEnd);

function createFixture(root,includeSample) {
 const adb=resolve(root,'adb');
 const calls=resolve(root,'adb.calls');
 const adbSource=[
  '#!/bin/bash',
  'set -euo pipefail',
  'if [[ "$#" -eq 5 && "$1" == "-s" && "$2" == "emulator-5554" && "$3" == "shell" && "$4" == "cat" && "$5" == "/proc/uptime" ]]; then',
  " printf 'uptime:cat:/proc/uptime\\n' >> \"$ADB_CALLS\"",
  ' [[ "$UPTIME_EXIT" == 0 ]] || exit "$UPTIME_EXIT"',
  ' printf "%s" "$UPTIME_VALUE"',
  ' exit 0',
  'fi',
  'if [[ "$#" -eq 6 && "$1" == "-s" && "$2" == "emulator-5554" && "$3" == "shell" && "$4" == "am" && "$5" == "force-stop" && "$6" == "com.dazzlingwuming.listen2" ]]; then',
  " printf 'force-stop\\n' >> \"$ADB_CALLS\"",
  ' exit 0',
  'fi',
  'if [[ "$#" -eq 8 && "$1" == "-s" && "$2" == "emulator-5554" && "$3" == "shell" && "$4" == "am" && "$5" == "start" && "$6" == "-W" && "$7" == "-n" && "$8" == "com.dazzlingwuming.listen2/com.listen2mobile.MainActivity" ]]; then',
  " printf 'am-start\\n' >> \"$ADB_CALLS\"",
  " printf 'Status: ok\\n'",
  ' [[ "$SCENARIO" == missing-cold ]] || printf "LaunchState: COLD\\\\n"',
  ' if [[ "$SCENARIO" == missing-time ]]; then exit 0; fi',
  ' if [[ "$SCENARIO" == over-budget ]]; then printf "TotalTime: 3100\\\\nWaitTime: 3200\\\\n"; else printf "TotalTime: 2900\\\\nWaitTime: 3000\\\\n"; fi',
  ' exit 0',
  'fi',
  " printf 'unexpected-command\\n' >> \"$ADB_CALLS\"",
  ' exit 64'
 ].join('\n')+'\n';
 writeFileSync(adb,adbSource,{mode:0o700});
 const fixture=resolve(root,includeSample?'sample-fixture.sh':'helper-fixture.sh');
 const setup=[
  '#!/bin/bash',
  'set -euo pipefail',
  'RUN_DIR="$1"; mkdir -p "$RUN_DIR/performance"',
  'ADB="$2"; SCENARIO="$3"',
  'DEVICE_API=35; SERIAL=emulator-5554; PACKAGE=com.dazzlingwuming.listen2',
  'export SCENARIO',
  'now_ms(){ echo 9000; }',
  'wait_for_pid_absence(){ [[ "$SCENARIO" != pidfalse ]]; }',
  'wait_for_phone_shell(){ return 1; }',
  actualHelper
 ];
 if(includeSample)setup.push(actualSample,'sample_startup_probe 01');
 else setup.push('elapsed="$(device_elapsed_millis)"','printf "%s\\\\n" "$elapsed"');
 writeFileSync(fixture,setup.join('\n')+'\n',{mode:0o700});
 return {adb,calls,fixture};
}

function runFixture(root,fixture,adb,calls,scenario,uptimeValue,uptimeExit=0) {
 writeFileSync(calls,'');
 const output=execFileSync('/bin/bash',[fixture,root,adb,scenario],{
  encoding:'utf8',
  env:{...process.env,ADB_CALLS:calls,UPTIME_VALUE:uptimeValue,UPTIME_EXIT:String(uptimeExit)}
 });
 return {output,calls:readFileSync(calls,'utf8').trim().split('\n').filter(Boolean)};
}

function assertLedger(fields) {
 const ledger=Array.from({length:20},(_,i)=>[String(i+1).padStart(2,'0'),...fields.slice(1)].join('|')).join('\n');
 const [ttid,ttfd]=coldFamilies(ledger);
 assert.equal(ttfd.status,'NOT_VERIFIED');
 assert.equal(ttfd.reasonCode,'HOST_UI_DUMP_OBSERVER_OVERHEAD');
 assert.equal(metricHasDecidableFailure(ttfd),false);
 return ttid;
}

test('actual device uptime helper accepts bounded decimal / CRLF and rejects malformed or failed ADB output',()=>{
 const root=mkdtempSync(resolve(tmpdir(),'listen2-device-uptime-helper-'));
 try {
  const f=createFixture(root,false);
  const valid=[
   ['normal','12.345 67.890\n','12345'],
   ['crlf','12.345 67.890\r\n','12345'],
   ['tab-separator','1.0005\t2.0\n','1001'],
   ['safe-integer-limit','9007199254740.991 0.0\n','9007199254740991']
  ];
  for(const [label,input,expected] of valid) {
   const result=runFixture(root,f.fixture,f.adb,f.calls,label,input);
   assert.equal(result.output.trim(),expected,label);
   assert.deepEqual(result.calls,['uptime:cat:/proc/uptime'],label);
  }
  const invalid=[
   ['empty',''],
   ['missing-second','1.0\n'],
   ['extra-field','1.0 2.0 3.0\n'],
   ['negative','-1.0 2.0\n'],
   ['scientific','1e3 2.0\n'],
   ['embedded-newline','1.0\n2.0 3.0\n'],
   ['extra-blank-line','1.0 2.0\n\n'],
   ['oversized','1'.repeat(129)],
   ['overflow','9007199254740.992 0.0\n']
  ];
  for(const [label,input] of invalid) {
   const result=runFixture(root,f.fixture,f.adb,f.calls,label,input);
   assert.equal(result.output.trim(),'','invalid uptime must produce no elapsed value: '+label);
   assert.deepEqual(result.calls,['uptime:cat:/proc/uptime'],label);
  }
  const failed=runFixture(root,f.fixture,f.adb,f.calls,'adb-failed','12.3 4.5\n',23);
  assert.equal(failed.output.trim(),'','failed ADB must produce no elapsed value');
  assert.deepEqual(failed.calls,['uptime:cat:/proc/uptime']);
 } finally {rmSync(root,{recursive:true,force:true});}
});

test('actual startup probe retains the original five cold / AM / UI classifications',()=>{
 const root=mkdtempSync(resolve(tmpdir(),'listen2-cold-ledger-'));
 try {
  const f=createFixture(root,true);
  for(const scenario of ['ui-failure','over-budget','missing-cold','missing-time','pidfalse']) {
   const result=runFixture(root,f.fixture,f.adb,f.calls,scenario,'1.00 0.00\n');
   const fields=result.output.trim().split('|');
   const ttid=assertLedger(fields);
   if(scenario==='ui-failure'){
    assert.equal(ttid.status,'PASS');assert.equal(ttid.p95,2900);assert.equal(fields[7],'COLD');assert.equal(fields[8],'phone-shell-not-ready');
    assert.equal(result.calls.includes('am-start'),true);
   } else if(scenario==='over-budget'){
    assert.equal(ttid.status,'FAIL');assert.equal(metricHasDecidableFailure(ttid),true);assert.equal(result.calls.includes('am-start'),true);
   } else {
    assert.equal(ttid.status,'NOT_VERIFIED');assert.equal(metricHasDecidableFailure(ttid),false);
    assert.equal(result.calls.includes('am-start'),scenario!=='pidfalse');
   }
   if(scenario==='pidfalse')assert.equal(fields[8],'pid-not-gone');
   if(scenario==='missing-cold')assert.equal(fields[8],'activity-start-not-cold');
   if(scenario==='missing-time')assert.equal(fields[8],'missing-device-activity-timing');
   assert.equal(result.calls.includes('unexpected-command'),false);
  }
 } finally {rmSync(root,{recursive:true,force:true});}
});

test('invalid uptime and ADB failure retain one NOT_VERIFIED startup observation without launching the activity',()=>{
 const root=mkdtempSync(resolve(tmpdir(),'listen2-cold-invalid-uptime-'));
 try {
  const f=createFixture(root,true);
  const invalid=[
   ['empty','',0],
   ['missing-second','1.0\n',0],
   ['extra-field','1.0 2.0 3.0\n',0],
   ['negative','-1.0 2.0\n',0],
   ['scientific','1e3 2.0\n',0],
   ['oversized','1'.repeat(129),0],
   ['overflow','9007199254740.992 0.0\n',0],
   ['adb-failed','1.0 2.0\n',23]
  ];
  for(const [scenario,input,exitCode] of invalid) {
   const result=runFixture(root,f.fixture,f.adb,f.calls,scenario,input,exitCode);
   const fields=result.output.trim().split('|');
   const ttid=assertLedger(fields);
   assert.equal(fields.length,9,scenario);
   assert.equal(fields[2],'true',scenario);
   assert.equal(fields[4],'',scenario);
   assert.equal(fields[7],'MISSING',scenario);
   assert.equal(fields[8],'missing-device-monotonic-start',scenario);
   assert.equal(ttid.status,'NOT_VERIFIED',scenario);
   assert.equal(ttid.samples[0].status,'NOT_VERIFIED',scenario);
   assert.equal(ttid.samples[0].reasonCode,'missing-verified-am-cold-timing',scenario);
   assert.equal(result.calls.includes('uptime:cat:/proc/uptime'),true,scenario);
   assert.equal(result.calls.includes('am-start'),false,scenario);
   assert.equal(result.calls.includes('unexpected-command'),false,scenario);
  }
 } finally {rmSync(root,{recursive:true,force:true});}
});
