import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { baseRecord } from './evidence.mjs';
import { assessContinuity, assessRecovery, coldFamilies, generateSignal, liveFamilies, nativeSnapshot, writeCompatibilityRecord, metricHasDecidableFailure, sanitizePerformanceInstrumentation, localContinuityPreparation, writePerformanceRecord } from './performance-evidence.mjs';
const ids = Array.from({ length: 20 }, (_, i) => String(i + 1).padStart(2, '0'));
const output = ids.flatMap(id => [`phase08Metric=first-search|${id}|PASS|4900|semantic-live-result`, `phase08Metric=first-audio|${id}|PASS|5900|visible-and-native-position-advancing`]).join('\n');
assert.equal(liveFamilies(output, 900000).every(metric => metric.status === 'PASS'), true);
assert.equal(liveFamilies(output.replace('first-search|20|PASS', 'first-search|20|TIMEOUT'), 900000)[0].status, 'FAIL');
assert.equal(liveFamilies(output.replace('phase08Metric=first-audio|20|PASS|5900|visible-and-native-position-advancing', ''), 900000)[1].samples.length, 20);
assert.equal(liveFamilies('', 1234).every(metric => metric.status === 'FAIL'), true);
assert.throws(() => liveFamilies(`${output}\nphase08Metric=first-search|01|PASS|1|duplicate`, 1), /duplicate/);
const cold = ids.map(id => `${id}|PASS|true|9000|2900|3000|3900|COLD|none`).join('\n');
const metrics = coldFamilies(cold); assert.equal(metrics[0].p95, 2900); assert.equal(metrics[1].p95, 3900); assert.equal(metrics[0].status, 'PASS'); assert.equal(metrics[1].status, 'NOT_VERIFIED'); assert.equal(metrics[1].reasonCode, 'HOST_UI_DUMP_OBSERVER_OVERHEAD'); assert.equal(metrics[1].samples.every(row => row.status === 'PASS'), true);
assert.equal(coldFamilies(cold.replaceAll('|3900|', '|5350|'))[1].status, 'NOT_VERIFIED'); assert.equal(coldFamilies(cold.replaceAll('|3900|', '|5350|'))[1].p95, 5350);
assert.equal(coldFamilies(cold.replace('20|PASS', '20|FAIL'))[0].status, 'PASS');
const hostFailure=coldFamilies(cold.replaceAll('|PASS|','|FAIL|')); assert.equal(hostFailure[1].samples.every(sample=>sample.status==='FAIL'),true); assert.equal(metricHasDecidableFailure(hostFailure[1]),false);
assert.equal(metricHasDecidableFailure(coldFamilies(cold.replaceAll('|2900|3000|','|3100|3200|'))[0]),true);
assert.equal(metricHasDecidableFailure({...hostFailure[1],name:'first-audio'}),true);
for(const invalid of [cold.replaceAll('|true|','|false|'),cold.replaceAll('|COLD|','|WARM|'),cold.replaceAll('|2900|','||'),cold.replaceAll('|3000|','||')])assert.equal(coldFamilies(invalid)[0].status,'NOT_VERIFIED');
const raw = 'package=other.app\nstate=PlaybackState {state=3, position=999999}\nmetadata: other\npackage=com.dazzlingwuming.listen2\nstate=PlaybackState {state=3, position=1000, buffered position=5000}\nmetadata: size=3, description=Listen2AcceptanceSignal, unknown, null\npackage=another.app\nstate=PlaybackState {state=2, position=1}';
const probeOutput = (position = 1000, elapsed = 1000, state = 'OBSERVED') => `phase08Native=PASS|${state}|${position}|${elapsed}\nINSTRUMENTATION_CODE: -1\nperformanceCommandExitCode=0\nperformanceLifecycle=PASS-same-process\n`;
const native = nativeSnapshot(raw, 1000, probeOutput()); assert.equal(native.positionMs, 1000); assert.equal(native.state, 3); assert.equal(native.synthetic, true); assert.equal(JSON.stringify(native).includes('description='), false);
for (const [token, expected] of [['PLAYING(3)', 3], ['PAUSED(2)', 2], ['ERROR(7)', 7], ['PLAYING(2)', null], ['UNKNOWN(3)', null], ['PLAYING', null], ['33', null]]) {
  const observed = nativeSnapshot(raw.replace('state=3, position=1000', `state=${token}, position=1000`), 1000, probeOutput());
  assert.equal(observed.state, expected);
  assert.equal(observed.status, expected === null ? 'NOT_VERIFIED' : 'PASS');
}
assert.equal(nativeSnapshot(raw + raw, 1000).status, 'NOT_VERIFIED');
assert.equal(nativeSnapshot(raw, 1000).positionMs, null);
assert.equal(nativeSnapshot(raw, 1000).status, 'NOT_VERIFIED'); // Clock/anchor alone is never decoded progress.
assert.equal(nativeSnapshot(raw, 1000, probeOutput(2500)).positionMs, 2500);
assert.equal(nativeSnapshot(raw, 1000, probeOutput(2500)).anchorPositionMs, 1000);
for (const invalid of [probeOutput().replace('PASS|OBSERVED', 'PASS|UNKNOWN'), probeOutput().replace('PASS-same-process', 'FAIL-process-changed'), probeOutput(-1), probeOutput(604800001), probeOutput(1, 999), probeOutput(1, 16001), probeOutput() + probeOutput(), probeOutput().replace('CommandExitCode=0', 'CommandExitCode=1')]) {
  assert.equal(nativeSnapshot(raw, 1000, invalid).status, 'NOT_VERIFIED');
}

assert.equal(nativeSnapshot('package=other.app\nstate=PlaybackState {state=3, position=9}', 1).status, 'NOT_VERIFIED');
const soak = Array.from({ length: 61 }, (_, i) => ({ ...native, screenOffConfirmed: true, screenOffState: 'ASLEEP', positionMs: 1000 + i * 10000, elapsedMs: 1000 + i * 10000 }));
assert.equal(assessContinuity(soak), 'PASS');
assert.equal(assessContinuity(soak.map((row, i) => i === 30 ? { ...row, positionMs: 1 } : row)), 'FAIL');
assert.equal(assessContinuity(soak.slice(0, 60)), 'FAIL');
assert.equal(assessContinuity(soak.map(row => ({ ...row, synthetic: false }))), 'NOT_VERIFIED');
assert.equal(assessRecovery(native, { ...native, positionMs: 4001 }), 'FAIL');
assert.equal(assessRecovery(native, { ...native, positionMs: 3999 }), 'PASS');
const directory = mkdtempSync(resolve(tmpdir(), 'listen2-performance-signal-'));
try { const file = resolve(directory, 'signal.flac'), generated = generateSignal(file), bytes = readFileSync(file); assert.equal(bytes.subarray(0, 4).toString(), 'fLaC'); assert.equal(bytes.includes(Buffer.from('TITLE=Listen2AcceptanceSignal')), true); assert.equal(generated.seconds, 720); assert.throws(() => generateSignal(file), /EEXIST/);
  const run = resolve(directory, 'phase08-20261011T000000Z-aaaaaaaaaaaa'); mkdirSync(resolve(run, 'performance'), { recursive: true });
  const build = baseRecord(run, 'phase8-build', ['REL-001']); build.build.testPayloadSha256 = 'c'.repeat(64);
  writeFileSync(resolve(run, '08-build.json'), JSON.stringify(build)); writeFileSync(resolve(run, '08-build.sha256'), 'synthetic-test-seal');
  writeFileSync(resolve(run, '08-api35-performance.json'), JSON.stringify({ ...build, metrics: coldFamilies(cold) }));
  writeFileSync(resolve(run, 'performance/api26-cold.tsv'), cold.replaceAll('|PASS|','|FAIL|').replaceAll('|3900|COLD|none','||COLD|phone-shell-not-ready'));
  assert.throws(() => writeCompatibilityRecord(run), /ENOENT/);
  writeFileSync(resolve(run, 'performance/api36-cold.tsv'), cold);
  const api35File=resolve(run,'08-api35-performance.json'), originalApi35=readFileSync(api35File,'utf8'), invalidApi35=JSON.parse(originalApi35); invalidApi35.metrics[0].p95-=1; writeFileSync(api35File,JSON.stringify(invalidApi35)); assert.throws(()=>writeCompatibilityRecord(run),/summary is inconsistent/); writeFileSync(api35File,originalApi35);
  const matrix = writeCompatibilityRecord(run); assert.equal(matrix.outcome, 'NOT_VERIFIED'); assert.equal(matrix.metrics.filter(metric => metric.name.endsWith('-ttfd')).every(metric => metric.reasonCode === 'HOST_UI_DUMP_OBSERVER_OVERHEAD'), true); assert.equal(matrix.metrics.length, 6); assert.equal(matrix.fixture.id, 'none'); assert.equal(matrix.fixture.generatedMediaSha256, '0'.repeat(64)); assert.equal(matrix.build.testPayloadSha256, build.build.testPayloadSha256);
  assert.equal(matrix.artifacts.some(item => item.relativePath === '08-build.sha256'), true);
  assert.throws(() => writeCompatibilityRecord(run), /immutable/);
 } finally { rmSync(directory, { recursive: true, force: true }); }
console.log('Performance evidence tests passed: fixed 20 slots, separate device TTID/TTFD, target-only native position, actual 600s continuity, recovery error, immutable generated media.');

const {resumeAnchor}=await import('./performance-evidence.mjs');
const anchored={status:'PASS',state:2,synthetic:true,positionSource:'exoplayer-current-position',positionStatus:'OBSERVED',identitySha256:'a'.repeat(64),positionMs:100000};
assert.equal(resumeAnchor(anchored),'100000');
for(const bad of [{...anchored,positionMs:0},{...anchored,positionMs:-1},{...anchored,positionMs:604800001},{...anchored,positionMs:'100000'},{...anchored,state:7},{...anchored,positionSource:'anchor-clock'},{...anchored,positionStatus:'UNAVAILABLE'},{...anchored,synthetic:false},{...anchored,identitySha256:'private-sentinel'}])assert.equal(resumeAnchor(bad),'');

const {screenOffObservation}=await import('./performance-evidence.mjs');
assert.deepEqual(screenOffObservation('Power Manager State:\n  mWakefulness=Asleep\nprivate-sentinel'),{screenOffConfirmed:true,screenOffState:'ASLEEP'});
for(const [raw,state] of [['mWakefulness=Awake','AWAKE'],['mWakefulness=Dreaming','DREAMING'],['mWakefulness=Dozing','DOZING'],['mWakefulness=Asleep\nmWakefulness=Awake','CONFLICT'],['mWakefulness=Asleep\nmWakefulness=Asleep','CONFLICT'],['mWakefulness=private-sentinel','UNKNOWN'],['mWakefulness=Asleep private-sentinel','UNKNOWN'],['otherWakefulness=Asleep','UNKNOWN'],['private-sentinel','UNKNOWN']]){const safe=screenOffObservation(raw);assert.equal(safe.screenOffConfirmed,false);assert.equal(safe.screenOffState,state);assert.doesNotMatch(JSON.stringify(safe),/private-sentinel/);}
assert.equal(screenOffObservation('x'.repeat(1048577)).screenOffConfirmed,false);
for(const bad of [{screenOffConfirmed:false,screenOffState:'AWAKE'},{screenOffConfirmed:true,screenOffState:'DOZING'},{screenOffConfirmed:undefined,screenOffState:undefined}])assert.equal(assessContinuity(soak.map((r,i)=>i===30?{...r,...bad}:r)),'NOT_VERIFIED');

assert.equal(screenOffObservation('mWakefulness=__proto__').screenOffState,'UNKNOWN');
const {waitForScreenOff}=await import('./performance-evidence.mjs');
let clockMs=0,calls=0;const clock={now:()=>clockMs,sleep:async ms=>{clockMs+=ms;}};
const settled=await waitForScreenOff(()=>++calls===1?'mWakefulness=Dozing':'mWakefulness=Asleep',clock);assert.equal(settled.status,'PASS');assert.equal(settled.observations.length,2);assert.equal(settled.observations[1].elapsedMs,500);
clockMs=0;const never=await waitForScreenOff(()=>'mWakefulness=Dozing\nprivate-sentinel',clock);assert.equal(never.status,'NOT_VERIFIED');assert.equal(never.observations.length,20);assert.equal(clockMs,10000);assert.doesNotMatch(JSON.stringify(never),/private-sentinel/);
clockMs=0;const unavailable=await waitForScreenOff(()=>{throw new Error('private-sentinel');},clock);assert.equal(unavailable.status,'NOT_VERIFIED');assert.equal(unavailable.observations.every(r=>r.screenOffState==='UNKNOWN'),true);
clockMs=0;let lastBudget=0;const bounded=await waitForScreenOff(remainingMs=>{lastBudget=remainingMs;clockMs+=Math.min(1000,remainingMs);return 'mWakefulness=Dozing';},clock);assert.equal(bounded.status,'NOT_VERIFIED');assert.equal(clockMs,10000);assert.equal(lastBudget,1000);

// A steady-state observation is independent of the immutable 6s startup diagnostic.
const steadyHash = 'a'.repeat(64);
const steadyMarker = `phase08LocalContinuity=v1|PASS|12000|steady-ready|2|3|2100|3100|${steadyHash}`;
const steadyEvidence = marker => sanitizePerformanceInstrumentation(`${marker}\nINSTRUMENTATION_CODE: -1\n`, 0) + 'performanceLifecycle=PASS-same-process\n';
assert.equal(localContinuityPreparation(steadyEvidence(steadyMarker)).ready, true);
assert.equal(localContinuityPreparation(steadyEvidence('phase08LocalContinuity=v1|TIMEOUT|15050|audio-pair-unavailable|-1|-1|-1|-1|none')).ready, false);

for (const tuple of [
  steadyMarker.replace('|12000|', '|15001|'), steadyMarker.replace('|12000|', '|20001|'),
  steadyMarker.replace('|2|3|', '|2|2|'), steadyMarker.replace('|2100|3100|', '|2100|3099|'),
  steadyMarker.replace('|2|3|', '|3|2|'), steadyMarker.replace('|2100|3100|', '|3100|2100|'),
  steadyMarker.replace('|2|3|', '|-1|3|'), steadyMarker.replace('|2|3|', '|604800|604801|'),
  steadyMarker.replace('|2100|3100|', '|604800000|604800001|'),
  steadyMarker.replace(steadyHash, 'none'), steadyMarker.replace('steady-ready', 'audio-not-advancing'),
  steadyMarker.replace('v1|', 'v2|'), steadyMarker + '|private-sentinel',
  steadyMarker.replace(steadyHash, 'private-sentinel'),
]) {
  const safe = steadyEvidence(tuple); assert.equal(localContinuityPreparation(safe).ready, false);
  assert.doesNotMatch(safe, /private-sentinel/); assert.equal(sanitizePerformanceInstrumentation(safe), safe);
}
for (const reason of ['identity-changed', 'position-rollback', 'invalid-clock', 'observation-unavailable']) {
  const safe = steadyEvidence(`phase08LocalContinuity=v1|NOT_VERIFIED|15000|${reason}|-1|-1|-1|-1|none`);
  assert.equal(localContinuityPreparation(safe).observation.reason, reason); assert.equal(localContinuityPreparation(safe).ready, false);
}
const steady = steadyEvidence(steadyMarker);
for (const invalid of [
  steady.replace('INSTRUMENTATION_CODE: -1', 'INSTRUMENTATION_CODE: 0'),
  steady.replace('INSTRUMENTATION_CODE: -1\n', ''), steady + 'INSTRUMENTATION_CODE: -1\n',
  steady + steadyMarker + '\n', steady.replace('performanceCommandExitCode=0', 'performanceCommandExitCode=124'),
  steady.replace('performanceLifecycle=PASS-same-process', 'performanceLifecycle=FAIL-process-changed'),
  steady.replace('performanceLifecycle=PASS-same-process\n', ''), steady + 'performanceLifecycle=PASS-same-process\n',
  steady + 'INSTRUMENTATION_STATUS: failureType=AssertionError\n',
]) assert.equal(localContinuityPreparation(invalid).ready, false);

// Execute the actual runner function with a bounded fixed-argv fake ADB.
const runnerSource = readFileSync(resolve(import.meta.dirname, 'run-performance-recovery.sh'), 'utf8');
const continuityFunction = runnerSource.slice(runnerSource.indexOf('instrument_local_continuity() {'), runnerSource.indexOf('# The startup probe is deliberately separate'));
assert.match(continuityFunction, /Date\.now\(\) \+ 20000/u);
assert.doesNotMatch(continuityFunction, /'am', 'start'|AUTO_CREATE|prepareLocal/u);
assert.match(runnerSource, /LOCAL_ORIGIN_PID="\$before"; fi\n    instrument/u);
const transportDir = mkdtempSync(resolve(tmpdir(), 'listen2-continuity-runner-'));
try {
  const fake = resolve(transportDir, 'adb'), out = resolve(transportDir, 'out.txt'), count = resolve(transportDir, 'count');
  writeFileSync(fake, `#!/usr/bin/env node\nconst fs=require('node:fs');const a=process.argv.slice(2);if(a.slice(2).join(' ')==='shell pidof com.dazzlingwuming.listen2'){let n=0;try{n=Number(fs.readFileSync(process.env.COUNT,'utf8'))}catch{}fs.writeFileSync(process.env.COUNT,String(n+1));console.log(process.env.MODE==='changed'&&n>0?'43':process.env.MODE==='wrong-origin'?'43':'42');}else{const expected=['-s','fixture','shell','am','instrument','--no-restart','-w','-r','-e','class','com.listen2mobile.acceptance.PerformanceRecoveryTest#awaitLocalContinuity','com.dazzlingwuming.listen2.test/com.listen2mobile.acceptance.Phase08Instrumentation'];if(JSON.stringify(a)!==JSON.stringify(expected))process.exit(9);console.log(${JSON.stringify(steadyMarker)});if(process.env.MODE==='duplicate')console.log(${JSON.stringify(steadyMarker)});console.log('INSTRUMENTATION_CODE: '+(process.env.MODE==='cancel'?'0':'-1'));if(process.env.MODE==='nonzero')process.exit(124);if(process.env.MODE==='hang')setTimeout(()=>{},25000);}`);
  chmodSync(fake, 0o700);
  const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
  for (const mode of ['pass', 'wrong-origin', 'changed', 'duplicate', 'cancel', 'nonzero', 'bad-prepare-life', 'hang']) {
    rmSync(out, { force: true }); rmSync(count, { force: true });
    let exit = 0;
    try { execFileSync('bash', ['-c', `${continuityFunction}\nADB=${quote(fake)}; SERIAL=fixture; LOCAL_ORIGIN_PID=42; LOCAL_ORIGIN_LIFECYCLE=${mode === 'bad-prepare-life' ? 'FAIL-process-changed' : 'PASS-same-process'}; instrument_local_continuity ${quote(out)}`], { cwd: resolve(import.meta.dirname, '../../..'), env: { ...process.env, MODE: mode, COUNT: count }, stdio: 'pipe' }); } catch (error) { exit = error.status; }
    const evidence = readFileSync(out, 'utf8'); assert.equal(exit === 0, mode === 'pass'); assert.equal(localContinuityPreparation(evidence).ready, mode === 'pass');
    assert.doesNotMatch(evidence, /private-sentinel/);
  }
} finally { rmSync(transportDir, { recursive: true, force: true }); }
console.log('Local continuity contract passed: separate immutable startup, exact fixed transport, original PID chain, strict marker and terminal.');

const writerRoot = mkdtempSync(resolve(tmpdir(), 'listen2-continuity-writer-'));
try {
  const run = resolve(writerRoot, 'phase08-20261011T000000Z-aaaaaaaaaaaa'); mkdirSync(resolve(run, 'performance'), { recursive: true });
  const build = baseRecord(run, 'phase8-build', ['REL-001']); writeFileSync(resolve(run, '08-build.json'), JSON.stringify(build));
  const put = (name, value) => writeFileSync(resolve(run, 'performance', name), typeof value === 'string' ? value : JSON.stringify(value));
  put('api35-instrumentation.txt', sanitizePerformanceInstrumentation(output + '\nINSTRUMENTATION_CODE: -1', 0));
  put('api35-cold.tsv', cold); put('resources-meminfo.txt', { schemaVersion: 1, scope: 'com.dazzlingwuming.listen2', status: 'PASS', unit: 'KiB', values: { 'TOTAL PSS': 1 } });
  put('synthetic-media.json', { sha256: steadyHash }); put('recovery.json', []); put('soak.json', []); put('network.json', {});
  const originalStartup = sanitizePerformanceInstrumentation('phase08LocalAudio=TIMEOUT|6188|audio-pair-unavailable\nINSTRUMENTATION_CODE: 0', 0) + 'performanceLifecycle=PASS-same-process\n';
  put('local-saf-instrumentation.txt', originalStartup); put('local-continuity-instrumentation.txt', steady);
  writePerformanceRecord(run, new Date().toISOString(), 'b'.repeat(64), 1234, 'restored');
  const record = JSON.parse(readFileSync(resolve(run, '.api35-performance.json'), 'utf8'));
  assert.equal(record.command.localStartupDiagnostic.status, 'TIMEOUT'); assert.equal(record.command.localStartupDiagnostic.elapsedMs, 6188);
  assert.equal(record.command.continuityPreparation.status, 'PASS'); assert.equal(record.outcome, 'NOT_VERIFIED');
  assert.equal(record.metrics[3].samples.length, 20); assert.equal(record.metrics[3].p95, 5900);
  for (const name of ['local-saf-instrumentation.txt', 'local-continuity-instrumentation.txt']) assert.equal(record.artifacts.some(item => item.relativePath === `performance/${name}`), true);
  assert.equal(readFileSync(resolve(run, 'performance/local-saf-instrumentation.txt'), 'utf8'), originalStartup);
  assert.equal(record.uncovered.some(item => item.reasonCode === 'LOCAL_STARTUP_DIAGNOSTIC' && item.safeDetail.includes('TIMEOUT')), true);
} finally { rmSync(writerRoot, { recursive: true, force: true }); }
