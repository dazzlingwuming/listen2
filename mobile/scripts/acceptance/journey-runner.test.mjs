import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
const source=readFileSync(new URL('./run-api35-journey.sh',import.meta.url),'utf8');
const prefix=source.slice(0,source.indexOf('if [[ "${1:-}" == "--self-test" ]]'));
const quote=value=>`'${value.replaceAll("'","'\\''")}'`;
function fixture(fn){const root=mkdtempSync(resolve(tmpdir(),'listen2-journey-contract-'));try{return fn(root);}finally{rmSync(root,{recursive:true,force:true});}}
test('diagnostic sanitizer keeps fixed counts and copies no source text or secrets',()=>fixture(root=>{
  const raw=resolve(root,'raw'),clean=resolve(root,'clean');
  writeFileSync(raw,'FATAL EXCEPTION account-name-private\ntoken=private-value https://private.invalid\nANR in private-package\nReactNativeJS: JavascriptException private-lyric\n');
  execFileSync('bash',['-c',`${prefix}\nsanitize_diagnostic_log ${quote(raw)} ${quote(clean)}`]);
  const text=readFileSync(clean,'utf8'),value=JSON.parse(text);
  assert.deepEqual(Object.keys(value),['schemaVersion','mode','lineCount','fatalExceptionCount','applicationNotRespondingCount','javascriptExceptionCount','captureUnavailableCount']);
  assert.equal(value.fatalExceptionCount,1);assert.equal(value.applicationNotRespondingCount,1);assert.equal(value.mode,'fixed-category-counts-only');
  assert.doesNotMatch(text,/private|https?:|token=/);
}));
test('actual capture functions use temporary raw storage and retain only sanitized summaries',()=>fixture(root=>{
  const run=resolve(root,'run'),temp=resolve(root,'temp'),adb=resolve(root,'fake-adb');mkdirSync(run);mkdirSync(temp);
  writeFileSync(adb,"#!/bin/bash\nprintf '%s\\n' 'FATAL EXCEPTION private-person token=private-value'\n",{mode:0o700});
  const functions=source.slice(source.indexOf('stop_diagnostic_capture() {'),source.indexOf("trap 'stop_diagnostic_capture"));
  execFileSync('bash',['-c',`${prefix}\n${functions}\nRUN_DIR=${quote(run)}; TMPDIR=${quote(temp)}; ADB=${quote(adb)}; SERIAL=fixture; PACKAGE=fixture; CAPTURE_LOGCAT_PID=''; CAPTURE_WATCHDOG_PID=''; CAPTURE_DIR=''; CAPTURE_RAW_DIR=''; CAPTURE_MAX_SECONDS=0; start_diagnostic_capture fixture; stop_diagnostic_capture`]);
  assert.deepEqual(readdirSync(temp),[]);
  const retained=resolve(run,'diagnostics/fixture');assert.equal(readdirSync(retained).includes('logcat-raw.txt'),false);
  for(const file of readdirSync(retained)){const text=readFileSync(resolve(retained,file),'utf8');assert.doesNotMatch(text,/private-person|private-value/);assert.equal(JSON.parse(text).mode,'fixed-category-counts-only');}
}));
test('actual record emitter never indexes raw logcat even when a raw file exists',()=>fixture(run=>{
  mkdirSync(resolve(run,'diagnostics/integrated-journey-instrumentation'),{recursive:true});
  writeFileSync(resolve(run,'fixture.json'),'{}');writeFileSync(resolve(run,'journey-events.txt'),'terminal=integrated-journey\n');
  writeFileSync(resolve(run,'diagnostics/integrated-journey-instrumentation/logcat-raw.txt'),'untrusted-raw');
  writeFileSync(resolve(run,'diagnostics/integrated-journey-instrumentation/logcat-sanitized.txt'),'{}');
  const body=source.match(/write_record\(\) \{[\s\S]*?<<'NODE'[^\n]*\n([\s\S]*?)\nNODE/)[1];
  const record=JSON.parse(execFileSync(process.execPath,['--input-type=module','-',run,'a'.repeat(64),'123','b'.repeat(64),'FAIL','integrated-journey','2026-10-11T00:00:00Z','2026-10-11T00:00:01Z','fixture','restore-failed','c'.repeat(40)],{input:body,encoding:'utf8'}));
  assert.equal(record.outcome,'FAIL');assert.equal(record.recovery.cleanupStatus,'restore-failed');assert.equal(record.recovery.deviceStateRestored,false);
  assert.equal(record.artifacts.some(a=>a.relativePath.endsWith('logcat-raw.txt')),false);assert.equal(record.artifacts.some(a=>a.relativePath.endsWith('logcat-sanitized.txt')),true);
}));
test('restore failure remains recorded without set-e abort and first clear increment succeeds',()=>{
  const cleanup=source.match(/^cleanup\(\) \{.*$/m)[0];
  const increment=source.match(/^CLEAR_COUNT=\$\(\(CLEAR_COUNT \+ 1\)\);/m)[0];
  const result=execFileSync('bash',['-c',`set -e; bash(){ return 1; }; SERIAL=fixture; STATE=fixture; CLEANUP_STATUS=pending; ${cleanup}\ncleanup; printf '%s\\n' "$CLEANUP_STATUS"; CLEAR_COUNT=0; ${increment}\nprintf '%s\\n' "$CLEAR_COUNT"`],{encoding:'utf8'});
  assert.equal(result,'restore-failed\n1\n');assert.doesNotMatch(source,/\(\(CLEAR_COUNT\+\+\)\)/);
  assert.match(source,/journey already consumed; preserve old evidence/);assert.match(source,/write_record "FAIL" "\$code"/);
});
