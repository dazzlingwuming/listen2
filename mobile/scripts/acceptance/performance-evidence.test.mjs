import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { baseRecord } from './evidence.mjs';
import { assessContinuity, assessRecovery, coldFamilies, generateSignal, liveFamilies, nativeSnapshot, writeCompatibilityRecord } from './performance-evidence.mjs';
const ids = Array.from({ length: 20 }, (_, i) => String(i + 1).padStart(2, '0'));
const output = ids.flatMap(id => [`phase08Metric=first-search|${id}|PASS|4900|semantic-live-result`, `phase08Metric=first-audio|${id}|PASS|5900|visible-and-native-position-advancing`]).join('\n');
assert.equal(liveFamilies(output, 900000).every(metric => metric.status === 'PASS'), true);
assert.equal(liveFamilies(output.replace('first-search|20|PASS', 'first-search|20|TIMEOUT'), 900000)[0].status, 'FAIL');
assert.equal(liveFamilies(output.replace('phase08Metric=first-audio|20|PASS|5900|visible-and-native-position-advancing', ''), 900000)[1].samples.length, 20);
assert.equal(liveFamilies('', 1234).every(metric => metric.status === 'FAIL'), true);
assert.throws(() => liveFamilies(`${output}\nphase08Metric=first-search|01|PASS|1|duplicate`, 1), /duplicate/);
const cold = ids.map(id => `${id}|PASS|true|9000|2900|3000|3900|COLD|none`).join('\n');
const metrics = coldFamilies(cold); assert.equal(metrics[0].p95, 2900); assert.equal(metrics[1].p95, 3900); assert.equal(metrics.every(row => row.status === 'PASS'), true);
assert.equal(coldFamilies(cold.replace('20|PASS', '20|FAIL'))[0].status, 'FAIL');
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
  writeFileSync(resolve(run, 'performance/api26-cold.tsv'), cold);
  assert.throws(() => writeCompatibilityRecord(run), /ENOENT/);
  writeFileSync(resolve(run, 'performance/api36-cold.tsv'), cold);
  const matrix = writeCompatibilityRecord(run); assert.equal(matrix.outcome, 'PASS'); assert.equal(matrix.metrics.length, 6); assert.equal(matrix.fixture.id, 'none'); assert.equal(matrix.fixture.generatedMediaSha256, '0'.repeat(64)); assert.equal(matrix.build.testPayloadSha256, build.build.testPayloadSha256);
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
