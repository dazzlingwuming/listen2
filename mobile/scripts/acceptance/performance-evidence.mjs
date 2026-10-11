import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { summarizeFamily } from './summarize-performance.mjs';
import { runRootFor, writeRecord } from './evidence.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const ids = Array.from({ length: 20 }, (_, index) => String(index + 1).padStart(2, '0'));
const SDK_FAILURE_TYPES = new Set(['PatternSyntaxException', 'IllegalStateException', 'IllegalArgumentException', 'NullPointerException', 'SecurityException', 'NoSuchMethodError', 'NoClassDefFoundError', 'AbstractMethodError', 'AssertionError', 'Exception']);
const AUDIO_FAILURES = new Set(['audio-initial-tap-failed', 'audio-mini-tap-failed', 'audio-notification-failed', 'audio-native-shell-failed', 'audio-unknown-assert', 'audio-resume-control-failed', 'audio-resume-position-rollback']);
const AUDIO_TIMEOUTS = new Set(['audio-ui-progress-unavailable', 'audio-native-getter-unavailable', 'audio-playing-identity-unavailable', 'audio-not-advancing', 'audio-pair-unavailable']);
const LIVE_REASONS = new Set(['semantic-live-result', 'visible-and-native-position-advancing', 'search-setup-failed', 'visible-provider-error', 'no-matching-live-result', 'audio-not-advancing', 'audio-ui-action-failed', 'search-action-failed', 'no-matching-live-track', ...AUDIO_FAILURES, ...AUDIO_TIMEOUTS]);
const LIVE_STATUS = new Set(['PASS', 'FAIL', 'TIMEOUT', 'DEGRADED', 'NOT_VERIFIED']);
export function sanitizePerformanceInstrumentation(raw, commandExitCode) {
  const retained = []; let rejected = false;
  for (const original of raw.split(/\r?\n/u)) {
    const line = original.trim();
    const metric = line.match(/^(?:INSTRUMENTATION_STATUS: )?phase08Metric=(first-search|first-audio)\|([0-9]{2})\|([A-Z_]+)\|([0-9]{1,12})\|([a-z-]+)$/u);
    const observation = line.match(/^(?:INSTRUMENTATION_STATUS: )?phase08LocalObservation=([0-9]{1,2})\|([0-9]{1,6})\|(-1|[0-9]{1,6})\|(-1|[0-9]{1,6})\|(-1|[0-9]{1,9})\|(-1|[0-9]{1,9})\|(true|false)\|(true|false)\|(true|false)$/u);
    const validObservation = observation && Number(observation[1]) >= 1 && Number(observation[1]) <= 32 && Number(observation[2]) <= 120000 && Number(observation[3]) <= 604800 && Number(observation[4]) <= 604800 && Number(observation[5]) <= 604800000 && Number(observation[6]) <= 604800000;
    const failure = line.match(/^INSTRUMENTATION_STATUS: failureType=([A-Za-z]{1,40})$/u);
    const preparation = line.match(/^(?:INSTRUMENTATION_STATUS: )?phase08LocalPreparation=(start|close-player|back-detail|shell-ready|navigation-limit|action-failed|deadline-exceeded)\|([0-9]{1,12})$/u);
    const local = line.match(/^(?:INSTRUMENTATION_STATUS: )?phase08LocalAudio=(PASS|FAIL|TIMEOUT|NOT_VERIFIED)\|([0-9]{1,6})\|([a-z-]+)$/u);
    const timing = line.match(/^(?:INSTRUMENTATION_STATUS: )?phase08LocalTiming=(initial-tap-complete|first-observation)\|([0-9]{1,6})\|([0-9]{1,12})$/u);
    const validLocal = local && Number(local[2]) <= 120000 && (local[1] === 'PASS' && local[3] === 'visible-and-native-position-advancing' || local[1] === 'FAIL' && AUDIO_FAILURES.has(local[3]) || local[1] === 'TIMEOUT' && AUDIO_TIMEOUTS.has(local[3]) || local[1] === 'NOT_VERIFIED' && (local[3] === 'audio-observation-clock-invalid' || local[2] === '0' && ['diagnostic-elapsed-out-of-range', 'audio-resume-anchor-unavailable'].includes(local[3])));
    if (validObservation) retained.push(`phase08LocalObservation=${observation.slice(1).join('|')}`);
    else if (/^(?:INSTRUMENTATION_STATUS: )?phase08LocalObservationStatus=NOT_VERIFIED\|(?:sample-limit|diagnostic-values-out-of-range)$/u.test(line)) retained.push(line.replace(/^INSTRUMENTATION_STATUS: /u, ''));
    else if (line.includes('phase08LocalObservation=') || line.includes('phase08LocalObservationStatus=')) rejected = true;
    else if (failure && SDK_FAILURE_TYPES.has(failure[1])) retained.push(line);
    else if (preparation) retained.push(`phase08LocalPreparation=${preparation.slice(1).join('|')}`);
    else if (line.includes('phase08LocalPreparation=')) rejected = true;
    else if (validLocal) retained.push(`phase08LocalAudio=${local.slice(1).join('|')}`);
    else if (line.includes('phase08LocalAudio=')) rejected = true;
    else if (timing && Number(timing[2]) <= 120000) retained.push(`phase08LocalTiming=${timing.slice(1).join('|')}`);
    else if (line.includes('phase08LocalTiming=')) rejected = true;
    else if (metric && ids.includes(metric[2]) && LIVE_STATUS.has(metric[3]) && LIVE_REASONS.has(metric[5])) retained.push(`phase08Metric=${metric.slice(1).join('|')}`);
    else if (line.includes('phase08Metric=')) rejected = true;
    else if (/^(?:INSTRUMENTATION_STATUS: )?phase08Native=(?:PASS\|OBSERVED|NOT_VERIFIED\|UNAVAILABLE)\|[0-9]{1,12}\|[0-9]{1,12}$/u.test(line)) retained.push(line.replace(/^INSTRUMENTATION_STATUS: /u, ''));
    else if (line.includes('phase08Native=')) rejected = true;
    else if (/^INSTRUMENTATION_(?:STATUS_CODE|CODE): -?[0-9]{1,3}$/u.test(line)) retained.push(line);
    else if (/^performanceCommandExitCode=[0-9]{1,3}$/u.test(line)) retained.push(line);
    else if (/^performanceLifecycle=(?:PASS-same-process|FAIL-launch|FAIL-process-unavailable|FAIL-process-changed)$/u.test(line)) retained.push(line);
    else if (/^INSTRUMENTATION_STATUS: stream=Phase08Instrumentation (?:started|completed)$/u.test(line)) retained.push(line);
    else if (/^INSTRUMENTATION_STATUS: stage=(?:runner-start|live-performance-attempt-(?:[1-9]|1[0-9]|20)|saf-generated-local-(?:import|playing)|resume-local-player|native-read-only-sample|compatibility-cold-start-(?:launch|shell|complete)|startup-probe-(?:launch|complete))$/u.test(line)) retained.push(line);
    else if (line === 'INSTRUMENTATION_STATUS: failureType=EvidencePrivacyOrScenarioFailure') retained.push(line);
    else if (/INSTRUMENTATION_FAILED|INSTRUMENTATION_ABORTED|failureType=|shortMsg=|FAILURES!!!|AssertionError/u.test(line)) rejected = true;
  }
  if (rejected) retained.push('INSTRUMENTATION_STATUS: failureType=EvidencePrivacyOrScenarioFailure');
  if (commandExitCode !== undefined) {
    if (!Number.isInteger(commandExitCode) || commandExitCode < 0 || commandExitCode > 255) throw new Error('invalid command exit status');
    retained.push(`performanceCommandExitCode=${commandExitCode}`);
  }
  return `${retained.join('\n')}\n`;
}
export function performanceInstrumentationOk(text) {
  const terminal = [...text.matchAll(/^INSTRUMENTATION_CODE: (-?[0-9]+)$/gmu)];
  const exit = [...text.matchAll(/^performanceCommandExitCode=([0-9]+)$/gmu)];
  return !/phase08LocalObservationStatus=NOT_VERIFIED\||phase08LocalPreparation=(?:navigation-limit|action-failed|deadline-exceeded)\||phase08LocalAudio=(?:FAIL|TIMEOUT|NOT_VERIFIED)\||failureType=|INSTRUMENTATION_STATUS_CODE: -1|performanceLifecycle=FAIL-/u.test(text) && terminal.length === 1 && ['-1','0'].includes(terminal[0][1]) && exit.length === 1 && exit[0][1] === '0';
}
const MEMORY_KEYS = ['Java Heap', 'Native Heap', 'Code', 'Stack', 'Graphics', 'Private Other', 'System', 'TOTAL PSS', 'TOTAL RSS', 'TOTAL SWAP PSS'];
export function sanitizePerformanceMemory(raw) {
  const target = raw.split(/(?=\*\* MEMINFO in pid )/u).find(section => /^\*\* MEMINFO in pid [0-9]+ \[com\.dazzlingwuming\.listen2\] \*\*/u.test(section));
  const values = {};
  if (target) for (const line of target.split(/\r?\n/u)) {
    const row = line.trim().match(/^([A-Za-z ]+):\s*([0-9]{1,12})(?:\s+([0-9]{1,12}))?$/u);
    if (row && MEMORY_KEYS.includes(row[1])) values[row[1]] = Number(row[2]);
    else if (/^(?:TOTAL (?:PSS|RSS|SWAP PSS):\s*[0-9]{1,12}\s*)+$/u.test(line.trim())) for (const total of line.matchAll(/(TOTAL (?:PSS|RSS|SWAP PSS)):\s*([0-9]{1,12})/gu)) values[total[1]] = Number(total[2]);
  }
  return { schemaVersion: 1, scope: 'com.dazzlingwuming.listen2', status: target && Object.hasOwn(values, 'TOTAL PSS') ? 'PASS' : 'NOT_VERIFIED', unit: 'KiB', values };
}
export function assertPerformanceMemory(value) {
  if (!value || Object.keys(value).sort().join(',') !== 'schemaVersion,scope,status,unit,values' || value.schemaVersion !== 1 || value.scope !== 'com.dazzlingwuming.listen2' || value.unit !== 'KiB' || !['PASS','NOT_VERIFIED'].includes(value.status) || !value.values || typeof value.values !== 'object' || Array.isArray(value.values)) throw new Error('memory evidence is not sanitized');
  for (const [key, row] of Object.entries(value.values)) if (!MEMORY_KEYS.includes(key) || !Number.isSafeInteger(row) || row < 0) throw new Error('memory evidence is not sanitized');
  if (value.status === 'PASS' && !Object.hasOwn(value.values, 'TOTAL PSS')) throw new Error('memory evidence false pass');
}
export function screenOffObservation(raw) {
  if (typeof raw !== 'string' || raw.length > 1048576) return { screenOffConfirmed: false, screenOffState: 'UNKNOWN' };
  const rows = [...raw.matchAll(/^\s*mWakefulness=([^\r\n]*)$/gmu)];
  const states = { Asleep: 'ASLEEP', Awake: 'AWAKE', Dreaming: 'DREAMING', Dozing: 'DOZING' };
  const state = rows.length > 1 ? 'CONFLICT' : rows.length === 1 && Object.hasOwn(states, rows[0][1].trim()) ? states[rows[0][1].trim()] : 'UNKNOWN';
  return { screenOffConfirmed: state === 'ASLEEP', screenOffState: state };
}
export async function waitForScreenOff(readPower, clock = { now: () => performance.now(), sleep: ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  const started = clock.now(), observations = [];
  while (clock.now() - started < 10000 && observations.length < 20) {
    let raw = '';
    try { raw = await readPower(Math.max(1, Math.floor(10000 - (clock.now() - started)))); } catch { /* Only safe UNKNOWN is retained. */ }
    const observation = { elapsedMs: Math.round(clock.now() - started), ...screenOffObservation(raw) };
    observations.push(observation);
    if (observation.screenOffConfirmed && observation.elapsedMs <= 10000) return { status: 'PASS', observations };
    const remaining = 10000 - (clock.now() - started);
    if (remaining > 0) await clock.sleep(Math.min(500, remaining));
  }
  return { status: 'NOT_VERIFIED', observations };
}
export function resumeAnchor(snapshot) {
  return snapshot?.status === 'PASS' && [2, 3].includes(snapshot.state) && snapshot.synthetic === true &&
    snapshot.positionSource === 'exoplayer-current-position' && snapshot.positionStatus === 'OBSERVED' &&
    /^[a-f0-9]{64}$/u.test(snapshot.identitySha256 ?? '') && Number.isSafeInteger(snapshot.positionMs) &&
    snapshot.positionMs > 0 && snapshot.positionMs <= 604800000 ? String(snapshot.positionMs) : '';
}
export function nativeSnapshot(raw, elapsedMs, probeOutput = '') {
  // Consume only the exact target package's section; never persist raw sessions.
  const sections = raw.split(/\bpackage=/u).slice(1);
  const targets = sections.filter(section => /^com\.dazzlingwuming\.listen2(?:\s|$)/u.test(section));
  const target = targets.length === 1 ? targets[0] : undefined;
  const token = target?.match(/PlaybackState\s*\{\s*state=([^,}\s]+)/u)?.[1];
  const names = ['NONE', 'STOPPED', 'PAUSED', 'PLAYING', 'FAST_FORWARDING', 'REWINDING', 'BUFFERING', 'ERROR', 'CONNECTING', 'SKIPPING_TO_PREVIOUS', 'SKIPPING_TO_NEXT', 'SKIPPING_TO_QUEUE_ITEM'];
  const named = token?.match(/^([A-Z_]+)\(([0-9]+)\)$/u);
  const state = token && /^(?:[0-9]|1[01])$/u.test(token) ? token : named && names[Number(named[2])] === named[1] ? named[2] : undefined;
  const position = target?.match(/PlaybackState\s*\{[^\n]*?\bposition=(\d+)/u)?.[1];
  const metadata = target?.match(/metadata:\s*([^\n]+)/u)?.[1];
  const probes = [...probeOutput.matchAll(/^phase08Native=(PASS|NOT_VERIFIED)\|([A-Z_]+)\|([0-9]+)\|([0-9]+)$/gmu)];
  const probe = probes.length === 1 ? probes[0] : null;
  const actual = Boolean(probe && probe[1] === 'PASS' && performanceInstrumentationOk(probeOutput) &&
    probeOutput.includes('performanceLifecycle=PASS-same-process') &&
    probe[2] === 'OBSERVED' &&
    Number.isSafeInteger(Number(probe[3])) && Number(probe[3]) <= 604800000 &&
    Number.isSafeInteger(Number(probe[4])) && Number(probe[4]) >= elapsedMs && Number(probe[4]) - elapsedMs <= 15000);
  return { status: state && position && metadata && actual ? 'PASS' : 'NOT_VERIFIED', state: state ? Number(state) : null,
    positionMs: actual ? Number(probe[3]) : null, anchorPositionMs: position ? Number(position) : null,
    positionSource: actual ? 'exoplayer-current-position' : 'unavailable', positionStatus: actual ? probe[2] : 'UNAVAILABLE',
    identitySha256: metadata ? hash(metadata) : null,
    synthetic: Boolean(metadata?.includes('Listen2AcceptanceSignal')), elapsedMs: actual ? Number(probe[4]) : elapsedMs };
}
export function liveFamilies(output, terminalDurationMs) {
  return [['first-search', 5000], ['first-audio', 6000]].map(([name, budget]) => {
    const found = [...output.matchAll(/phase08Metric=([a-z-]+)\|([0-9]{2})\|([A-Z_]+)\|([0-9]+)\|([a-z0-9-]+)/gu)].filter(match => match[1] === name);
    if (new Set(found.map(match => match[2])).size !== found.length || found.some(match => !ids.includes(match[2]))) throw new Error('duplicate or invalid live metric attempt ID');
    const samples = ids.map(id => {
      const row = found.find(match => match[2] === id);
      return row ? { id, status: row[3], elapsedMs: Number(row[4]), reasonCode: row[5], stage: name === 'first-search' ? 'visible-kugou-semantic-live-result' : 'visible-live-track-and-native-playing-position' }
        : { id, status: 'NOT_VERIFIED', elapsedMs: terminalDurationMs, reasonCode: 'instrumentation-ended-before-observation', stage: 'terminal-command-duration-only' };
    });
    return { name, unit: 'ms', samples, ...summarizeFamily(samples, budget) };
  });
}
export function coldFamilies(ledger) {
  const rows = ledger.trim().split('\n').filter(Boolean).map(line => line.split('|'));
  return [['ttid', 3000, 4, 'device-am-start-total-time'], ['ttfd', 4000, 6, 'device-monotonic-visible-upper-bound-including-uiautomator-observer']].map(([name, budget, index, stage]) => {
    const samples = rows.map(row => ({ id: row[0], status: row[1], elapsedMs: row[index] ? Number(row[index]) : Number(row[3]), stage: row[index] ? stage : 'terminal-command-duration-only', reasonCode: row[8] }));
    return { name, unit: 'ms', samples, ...summarizeFamily(samples, budget) };
  });
}
export function assessContinuity(rows, seconds = 600) {
  if (!rows.length || rows.some(row => row.status !== 'PASS' || row.state !== 3 || row.screenOffConfirmed !== true || row.screenOffState !== 'ASLEEP' || row.positionStatus !== 'OBSERVED' || row.positionSource !== 'exoplayer-current-position' || !row.synthetic)) return 'NOT_VERIFIED';
  if (rows.length < 61 || rows.at(-1).elapsedMs - rows[0].elapsedMs < seconds * 1000) return 'FAIL';
  for (let i = 1; i < rows.length; i += 1) {
    const previous = rows[i - 1], row = rows[i];
    const elapsed = row.elapsedMs - previous.elapsedMs, advanced = row.positionMs - previous.positionMs;
    if (row.identitySha256 !== previous.identitySha256 || elapsed <= 0 || elapsed > 15000 || advanced <= 0 || Math.abs(advanced - elapsed) > 3000) return 'FAIL';
  }
  return 'PASS';
}
export function assessRecovery(before, after) {
  if ([before, after].some(row => row.status !== 'PASS' || row.positionSource !== 'exoplayer-current-position' || ![2, 3].includes(row.state) || row.positionStatus !== 'OBSERVED' || !row.synthetic)) return 'NOT_VERIFIED';
  return before.identitySha256 === after.identitySha256 && Math.abs(after.positionMs - before.positionMs) <= 3000 ? 'PASS' : 'FAIL';
}
export function generateSignal(file) {
  // RFC 9639: fixed 1000-sample mono verbatim frames, no external encoder.
  // Vorbis TITLE is understood by Android's FLAC metadata extractor; WAV
  // INFO/INAM is not a portable MediaMetadataRetriever title source.
  const rate = 8000, seconds = 720, blockSize = 1000, samples = rate * seconds;
  const period = Buffer.alloc(800), pcm = Buffer.alloc(samples * 2);
  for (let index = 0; index < 400; index++) period.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 11 * index / 400) * 1200), index * 2);
  for (let offset = 0; offset < pcm.length; offset += period.length) period.copy(pcm, offset);
  const checksum = (width, polynomial) => {
    const mask = (1 << width) - 1, top = 1 << (width - 1);
    const table = Array.from({ length: 256 }, (_, byte) => {
      let crc = byte << (width - 8);
      for (let bit = 0; bit < 8; bit++) crc = ((crc << 1) ^ (crc & top ? polynomial : 0)) & mask;
      return crc;
    });
    return bytes => { let crc = 0; for (const byte of bytes) crc = ((crc << 8) ^ table[((crc >>> (width - 8)) ^ byte) & 255]) & mask; return crc; };
  };
  const crc8 = checksum(8, 0x07), crc16 = checksum(16, 0x8005), frames = [];
  for (let number = 0; number < samples / blockSize; number++) {
    // Frame numbers are at most 5759, within ordinary UTF-8's scalar range.
    const codedNumber = Buffer.from(String.fromCodePoint(number), 'utf8');
    const header = Buffer.concat([Buffer.from([0xff, 0xf8, 0x74, 0x08]), codedNumber, Buffer.from([0x03, 0xe7])]);
    const audio = Buffer.from(pcm.subarray(number * blockSize * 2, (number + 1) * blockSize * 2)).swap16();
    const frame = Buffer.concat([header, Buffer.from([crc8(header), 0x02]), audio, Buffer.alloc(2)]);
    frame.writeUInt16BE(crc16(frame.subarray(0, -2)), frame.length - 2); frames.push(frame);
  }
  const streaminfo = Buffer.alloc(38); streaminfo.writeUIntBE(34, 1, 3);
  streaminfo.writeUInt16BE(blockSize, 4); streaminfo.writeUInt16BE(blockSize, 6);
  streaminfo.writeUIntBE(Math.min(...frames.map(frame => frame.length)), 8, 3);
  streaminfo.writeUIntBE(Math.max(...frames.map(frame => frame.length)), 11, 3);
  streaminfo.writeBigUInt64BE((BigInt(rate) << 44n) | (15n << 36n) | BigInt(samples), 14);
  createHash('md5').update(pcm).digest().copy(streaminfo, 22);
  const vendor = Buffer.from('Listen2 controlled synthetic fixture'), title = Buffer.from('TITLE=Listen2AcceptanceSignal');
  const comment = Buffer.alloc(4 + 4 + vendor.length + 4 + 4 + title.length);
  comment[0] = 0x84; comment.writeUIntBE(comment.length - 4, 1, 3);
  comment.writeUInt32LE(vendor.length, 4); vendor.copy(comment, 8);
  comment.writeUInt32LE(1, 8 + vendor.length); comment.writeUInt32LE(title.length, 12 + vendor.length); title.copy(comment, 16 + vendor.length);
  writeFileSync(file, Buffer.concat([Buffer.from('fLaC'), streaminfo, comment, ...frames]), { flag: 'wx', mode: 0o600 });
  return { sha256: hash(readFileSync(file)), bytes: statSync(file).size, seconds, source: 'generated-synthetic-flac-verbatim-with-fixed-title', copyrightedMedia: false };
}
export function writePerformanceRecord(run, startedAt, serialHash, liveDuration, cleanupStatus) {
  const build = JSON.parse(readFileSync(resolve(run, '08-build.json'), 'utf8'));
  const read = name => readFileSync(resolve(run, 'performance', name), 'utf8');
  const instrumentation = read('api35-instrumentation.txt');
  if (sanitizePerformanceInstrumentation(instrumentation) !== instrumentation) throw new Error('instrumentation evidence is not sanitized');
  assertPerformanceMemory(JSON.parse(read('resources-meminfo.txt')));
  const instrumentationPass = performanceInstrumentationOk(instrumentation);
  const metrics = [...coldFamilies(read('api35-cold.tsv')), ...liveFamilies(instrumentation, Number(liveDuration))];
  const recovery = JSON.parse(read('recovery.json'));
  const soak = JSON.parse(read('soak.json'));
  const network = JSON.parse(read('network.json'));
  const continuity = assessContinuity(soak);
  const recovered = recovery.length === 5 && recovery.every(row => row.resumeVerified === true && assessRecovery(row.before, row.after) === 'PASS');
  const networkPass = network.disabledConfirmed && network.enabledConfirmed && [network.before, network.offline, network.after].every(row => row?.status === 'PASS' && row.state === 3 && row.positionStatus === 'OBSERVED' && row.positionSource === 'exoplayer-current-position' && row.synthetic && row.identitySha256 === network.before?.identitySha256) && network.offline.positionMs > network.before.positionMs && network.after.positionMs > network.offline.positionMs;
  const measuredPass = instrumentationPass && metrics.every(metric => metric.status === 'PASS') && recovered && continuity === 'PASS' && networkPass && cleanupStatus === 'restored';
  const probeFiles = readdirSync(resolve(run, 'performance')).filter(name => /^native-probe-[0-9]+-instrumentation\.txt$/u.test(name)).sort();
  for (const name of probeFiles) if (sanitizePerformanceInstrumentation(read(name)) !== read(name)) throw new Error('native probe evidence is not sanitized');
  const files = [...probeFiles, 'api35-cold.tsv', 'api35-instrumentation.txt', 'synthetic-media.json', 'listen2-performance-signal.flac', 'recovery.json', 'soak-screen-off-preflight.json', 'soak.json', 'network.json', 'continuity-status.json', 'resources-meminfo.txt'].filter(name => existsSync(resolve(run, 'performance', name)));
  const record = { ...build, recordId: 'api35-performance-sealed', recordedAt: new Date().toISOString(),
    device: { ...build.device, serialHash, apiLevel: 35 }, network: { mode: 'live-public-search-and-generated-local-continuity', transport: 'emulator', offlineWindows: ['recorded-wifi-off-window'], proxyConfigured: false },
    fixture: { ...build.fixture, id: 'phase08-performance-local', revision: '1', manifestSha256: hash(readFileSync(resolve(run, 'performance/synthetic-media.json'))), queryIds: ['qinghuaci-kugou-live'], generatedMediaSha256: JSON.parse(read('synthetic-media.json')).sha256 },
    command: { id: 'api35-performance-once', argvRedacted: ['explicit-api35-serial', '20-fixed-cold-live-search-live-audio-attempts', 'generated-local-saf', 'five-process-recovery', '600-second-native-position-soak'], startedAt, endedAt: new Date().toISOString(), timezone: 'Asia/Shanghai', exitCode: measuredPass ? 0 : 4, evidenceKinds: ['PERFORMANCE', 'LIVE_PUBLIC_PROVIDER', 'RECOVERY_SOAK'] },
    requirements: ['PERF-001', 'PERF-002', 'PERF-003', 'TEST-004'], metrics, outcome: !instrumentationPass || metrics.some(metric => metric.samples.some(sample => ['FAIL', 'TIMEOUT'].includes(sample.status)) || metric.samples.every(sample => sample.status === 'PASS') && metric.status === 'FAIL') || continuity === 'FAIL' ? 'FAIL' : 'NOT_VERIFIED',
    artifacts: files.map(name => { const file = resolve(run, 'performance', name); return { kind: name, relativePath: `performance/${name}`, sha256: hash(readFileSync(file)), bytes: statSync(file).size, sanitized: true }; }),
    uncovered: [{ requirement: 'PERF-001', reasonCode: 'COMPATIBILITY_MATRIX_PENDING', safeDetail: 'This record covers API35 measurements only; API26 and API36 device metrics are separate.', ownerAction: 'Consume separately sealed compatibility lanes before claiming PERF-001.' }, { requirement: 'PERF-002', reasonCode: 'LIVE_METRICS_REQUIRE_INDIVIDUAL_REVIEW', safeDetail: `liveSearch=${metrics[2].status};liveAudio=${metrics[3].status};bridgeNetworkMedia3Substages=NOT_VERIFIED`, ownerAction: 'Review actual terminal samples; no local fixture may replace a live sample.' }, { requirement: 'PERF-003', reasonCode: 'PERFORMANCE_OR_CONTINUITY_NON_PASS', safeDetail: `compatibilityMatrix=NOT_VERIFIED;providerNetworkRecovery=NOT_VERIFIED;duplicateMutationAndAnrCrash=NOT_VERIFIED;coldLiveMetricsPass=${metrics.every(metric => metric.status === 'PASS')};fiveRecoveryPass=${recovered};generatedPlaybackSoak=${continuity};networkLocalContinuityPass=${Boolean(networkPass)};cleanup=${cleanupStatus}`, ownerAction: 'Inspect immutable attempt and state evidence; fix the cause before a new candidate run. Local continuity does not establish provider network recovery.' }],
    recovery: { cleanupStatus, deviceStateRestored: cleanupStatus === 'restored', rollbackArtifactSha256: build.build.sha256, steps: ['original wifi setting restored', 'screen woken', 'retained immutable native position observations'] } };
  writeFileSync(resolve(run, '.api35-performance.json'), JSON.stringify(record, null, 2), { flag: 'wx', mode: 0o600 });
  return measuredPass;
}

export function writeCompatibilityRecord(run) {
  const read = name => readFileSync(resolve(run, name), 'utf8');
  const api35 = JSON.parse(read('08-api35-performance.json'));
  const build = JSON.parse(read('08-build.json'));
  const api35Metrics = api35.metrics.filter(metric => ['ttid', 'ttfd'].includes(metric.name));
  if (api35Metrics.length !== 2 || api35.git.sha !== build.git.sha || api35.runId !== build.runId || api35.build.sha256 !== build.build.sha256) throw new Error('API35 performance provenance is inconsistent');
  const metrics = [
    ...api35Metrics.map(metric => ({ ...metric, name: `api35-${metric.name}`, ...summarizeFamily(metric.samples, metric.budget) })),
    ...[26, 36].flatMap(api => coldFamilies(read(`performance/api${api}-cold.tsv`)).map(metric => ({ ...metric, name: `api${api}-${metric.name}` }))),
  ];
  const pass = metrics.every(metric => metric.status === 'PASS');
  const files = ['08-api35-performance.json', '08-build.json', '08-build.sha256', 'performance/api26-cold.tsv', 'performance/api36-cold.tsv'];
  const now = new Date().toISOString();
  const record = { ...build, recordId: 'phase8-performance-matrix', recordedAt: now, fixture: { id: 'none', revision: '0', manifestSha256: '0'.repeat(64), generatedMediaSha256: '0'.repeat(64), queryIds: [], accountLane: 'none' }, requirements: ['PERF-001', 'TEST-004'], metrics,
    command: { id: 'aggregate-sealed-compatibility-matrix', argvRedacted: ['aggregate-compatibility', 'immutable-api26-api35-api36-ledgers'], startedAt: now, endedAt: now, timezone: 'Asia/Shanghai', exitCode: pass ? 0 : 4, evidenceKinds: ['PERFORMANCE'] },
    outcome: pass ? 'PASS' : metrics.some(metric => metric.samples.some(sample => ['FAIL', 'TIMEOUT'].includes(sample.status))) ? 'FAIL' : 'NOT_VERIFIED',
    artifacts: files.map(name => ({ kind: name.split('/').pop(), relativePath: name, sha256: hash(readFileSync(resolve(run, name))), bytes: statSync(resolve(run, name)).size, sanitized: true })),
    uncovered: pass ? [] : [{ requirement: 'PERF-001', reasonCode: 'COLD_MATRIX_NON_PASS', safeDetail: 'Every API retains all 20 terminal slots. TTFD is a visible-shell upper bound including UiAutomator observer overhead, not an isolated render duration.', ownerAction: 'Review all immutable device timing samples before a new candidate run.' }],
  };
  writeRecord(run, '08-performance.json', record);
  return record;
}

if (resolve(process.argv[1] || '') === resolve(import.meta.filename)) {
  try {
    if (process.argv.length !== 5 || process.argv[2] !== '--aggregate-compatibility' || process.argv[3] !== '--run-dir') throw new Error('usage: performance-evidence.mjs --aggregate-compatibility --run-dir DIR');
    const run = runRootFor(process.argv[4]);
    const repo = resolve(import.meta.dirname, '../../..');
    const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
    git('diff', '--quiet'); git('diff', '--cached', '--quiet');
    const build = JSON.parse(readFileSync(resolve(run, '08-build.json'), 'utf8'));
    if (build.git.sha !== git('rev-parse', 'HEAD')) throw new Error('current HEAD differs from candidate');
    if (readFileSync(resolve(run, '08-build.sha256'), 'utf8').trim() !== hash(readFileSync(resolve(run, '08-build.json')))) throw new Error('build seal mismatch');
    console.log(JSON.stringify({ outcome: writeCompatibilityRecord(run).outcome }));
  } catch (error) { console.error(`BLOCKED: ${error.message}`); process.exitCode = 3; }
}
